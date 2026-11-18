import { describe, expect, it } from "vitest";
import {
  AI_REPORTING_CONTRACT_VERSION,
  GROUNDING_POLICY_VERSION,
  REPORT_EXCEPTION_CODES,
  REPORT_EXCEPTION_POLICY,
  canApproveDraft,
  deriveCurrencyScope,
  evaluateEvidenceBundle,
  exactDecimal,
  groundClaim,
  isExactDecimalString,
  type ClaimProposal,
  type ReportDraft,
  type ReportRequest,
} from "../../lib/ai-reporting";
import {
  SYNTHETIC_APPROVED_REVENUE,
  SYNTHETIC_MISSING_CURRENCY,
  SYNTHETIC_PERIOD,
  SYNTHETIC_SOURCE_DEBIT,
  SYNTHETIC_USD_AMOUNT,
  SYNTHETIC_WARNING_AMOUNT,
  createSyntheticEvidenceBundle,
} from "./fixtures/synthetic-evidence";

function sourceClaim(overrides: Partial<ClaimProposal> = {}): ClaimProposal {
  return {
    claimId: "claim-source-debit",
    sectionId: "results",
    text: "The cited source debit field contains MYR 9007199254740993.1.",
    kind: "SOURCE_STRUCTURE",
    evidenceIds: [SYNTHETIC_SOURCE_DEBIT.evidenceId],
    valueAssertions: [{
      evidenceId: SYNTHETIC_SOURCE_DEBIT.evidenceId,
      exactValue: exactDecimal("9007199254740993.1"),
      currency: "MYR",
      monetaryBasis: "debit_credit",
    }],
    financialMeaning: null,
    caveatCodes: ["INTERPRETATION_LIMITATION", "REJECTED_COUNT"],
    ...overrides,
  };
}

describe("exact decimal policy", () => {
  it("returns exact text beyond JavaScript safe integer range without normalization", () => {
    const value = exactDecimal("9007199254740993.10");
    expect(value).toBe("9007199254740993.10");
    expect(typeof value).toBe("string");
  });

  it.each(["1e3", "+10", " 10", "01", "", "NaN"])("rejects non-canonical decimal text %j", value => {
    expect(isExactDecimalString(value)).toBe(false);
    expect(() => exactDecimal(value)).toThrow(TypeError);
  });
});

describe("evidence bundle policy", () => {
  it("derives a single source currency without claiming ISO membership", () => {
    expect(deriveCurrencyScope([SYNTHETIC_SOURCE_DEBIT, SYNTHETIC_WARNING_AMOUNT])).toEqual({
      status: "SINGLE", currencies: ["MYR"], hasMissingCurrency: false,
    });
  });

  it("surfaces included or excluded warnings and rejected counts", () => {
    const included = evaluateEvidenceBundle(createSyntheticEvidenceBundle());
    expect(included.exceptions.map(exception => exception.code)).toEqual([
      "WARNING_RECORDS_INCLUDED", "REJECTED_ROWS_PRESENT",
    ]);
    expect(included.publishable).toBe(true);

    const excluded = evaluateEvidenceBundle(createSyntheticEvidenceBundle(
      [SYNTHETIC_SOURCE_DEBIT],
      {
        warningPolicy: "EXCLUDE",
        quality: {
          acceptedCount: 2, validCount: 1, warningCount: 1,
          includedWarningCount: 0, excludedWarningCount: 1,
          rejectedCount: 1, rejectedRecordsInEvidence: 0,
        },
      },
    ));
    expect(excluded.exceptions.map(exception => exception.code)).toEqual([
      "WARNING_RECORDS_EXCLUDED", "REJECTED_ROWS_PRESENT",
    ]);
  });

  it("blocks missing and mixed currencies instead of combining them", () => {
    const missing = evaluateEvidenceBundle(createSyntheticEvidenceBundle([SYNTHETIC_MISSING_CURRENCY], {
      quality: {
        acceptedCount: 1, validCount: 1, warningCount: 0,
        includedWarningCount: 0, excludedWarningCount: 0,
        rejectedCount: 0, rejectedRecordsInEvidence: 0,
      },
    }));
    expect(missing.currencyScope).toEqual({ status: "NONE", currencies: [], hasMissingCurrency: true });
    expect(missing.exceptions.map(exception => exception.code)).toContain("CURRENCY_UNSPECIFIED");
    expect(missing.publishable).toBe(false);

    const mixed = evaluateEvidenceBundle(createSyntheticEvidenceBundle([
      SYNTHETIC_SOURCE_DEBIT, SYNTHETIC_USD_AMOUNT,
    ], {
      quality: {
        acceptedCount: 2, validCount: 2, warningCount: 0,
        includedWarningCount: 0, excludedWarningCount: 0,
        rejectedCount: 0, rejectedRecordsInEvidence: 0,
      },
    }));
    expect(mixed.currencyScope).toEqual({ status: "MIXED", currencies: ["MYR", "USD"], hasMissingCurrency: false });
    expect(mixed.exceptions.map(exception => exception.code)).toContain("MIXED_CURRENCY");
    expect(mixed.publishable).toBe(false);
  });

  it("blocks a declared currency scope that disagrees with actual evidence", () => {
    const actualItems = [SYNTHETIC_SOURCE_DEBIT, SYNTHETIC_USD_AMOUNT];
    const consistent = createSyntheticEvidenceBundle(actualItems, {
      quality: {
        acceptedCount: 2, validCount: 2, warningCount: 0,
        includedWarningCount: 0, excludedWarningCount: 0,
        rejectedCount: 0, rejectedRecordsInEvidence: 0,
      },
    });
    const adversarialBundle = {
      ...consistent,
      currencyScope: { status: "SINGLE", currencies: ["MYR"], hasMissingCurrency: false },
    } as const;

    const decision = evaluateEvidenceBundle(adversarialBundle);
    expect(decision.currencyScope).toEqual({
      status: "MIXED", currencies: ["MYR", "USD"], hasMissingCurrency: false,
    });
    expect(decision.exceptions.map(exception => exception.code)).toEqual(expect.arrayContaining([
      "EVIDENCE_METADATA_INCONSISTENT", "MIXED_CURRENCY",
    ]));
    expect(decision.publishable).toBe(false);

    const claim = groundClaim(sourceClaim(), adversarialBundle);
    expect(claim.support.status).toBe("UNSUPPORTED");
    expect(claim.support.exceptions.map(exception => exception.code)).toContain("EVIDENCE_METADATA_INCONSISTENT");
  });

  it("defines a policy for every stable exception code", () => {
    expect(Object.keys(REPORT_EXCEPTION_POLICY).sort()).toEqual([...REPORT_EXCEPTION_CODES].sort());
    expect(REPORT_EXCEPTION_POLICY.CLAIM_NOT_GROUNDED).toMatchObject({
      defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "REJECT_CLAIM",
    });
  });
});

describe("claim grounding policy", () => {
  it("supports an exact source-structure claim without assigning accounting meaning", () => {
    const claim = groundClaim(sourceClaim(), createSyntheticEvidenceBundle([SYNTHETIC_SOURCE_DEBIT], {
      quality: {
        acceptedCount: 1, validCount: 1, warningCount: 0,
        includedWarningCount: 0, excludedWarningCount: 0,
        rejectedCount: 1, rejectedRecordsInEvidence: 0,
      },
    }));
    expect(claim.support).toMatchObject({
      assurance: "STRUCTURAL_ONLY", status: "SUPPORTED_WITH_CAVEAT", policyVersion: GROUNDING_POLICY_VERSION,
    });
    expect(claim.support.exceptions).toEqual([]);
  });

  it("rejects a value assertion whose evidence is present but not explicitly cited", () => {
    const bundle = createSyntheticEvidenceBundle([SYNTHETIC_SOURCE_DEBIT, SYNTHETIC_WARNING_AMOUNT], {
      quality: {
        acceptedCount: 2, validCount: 1, warningCount: 1,
        includedWarningCount: 1, excludedWarningCount: 0,
        rejectedCount: 0, rejectedRecordsInEvidence: 0,
      },
    });
    const claim = groundClaim(sourceClaim({
      claimId: "uncited-assertion",
      evidenceIds: [SYNTHETIC_WARNING_AMOUNT.evidenceId],
      caveatCodes: ["WARNING_EVIDENCE", "INTERPRETATION_LIMITATION"],
    }), bundle);

    expect(claim.support.status).toBe("UNSUPPORTED");
    expect(claim.support.exceptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "CLAIM_NOT_GROUNDED",
        evidenceIds: [SYNTHETIC_SOURCE_DEBIT.evidenceId],
        message: expect.stringContaining("explicitly cited"),
      }),
    ]));
  });

  it.each(["Revenue", "Expenses", "Profit", "Cash flow"])(
    "rejects a raw debit labelled as %s without approved interpretation",
    label => {
      const claim = groundClaim(sourceClaim({
        claimId: `unsupported-${label}`,
        text: `The cited debit is ${label}.`,
        kind: "FINANCIAL_INTERPRETATION",
        financialMeaning: { interpretationId: label.toLowerCase().replace(" ", "-"), label },
      }), createSyntheticEvidenceBundle([SYNTHETIC_SOURCE_DEBIT]));
      expect(claim.support.status).toBe("UNSUPPORTED");
      expect(claim.support.exceptions.map(exception => exception.code)).toEqual(expect.arrayContaining([
        "UNSUPPORTED_FINANCIAL_MEANING", "INTERPRETATION_UNAVAILABLE",
      ]));
    },
  );

  it("supports financial meaning only when trusted approval evidence matches", () => {
    const proposal: ClaimProposal = {
      claimId: "approved-synthetic-revenue",
      sectionId: "results",
      text: "The synthetic approved revenue metric is MYR 250.",
      kind: "FINANCIAL_INTERPRETATION",
      evidenceIds: [SYNTHETIC_APPROVED_REVENUE.evidenceId],
      valueAssertions: [{
        evidenceId: SYNTHETIC_APPROVED_REVENUE.evidenceId,
        exactValue: exactDecimal("250"),
        currency: "MYR",
        monetaryBasis: "approved_interpretation",
      }],
      financialMeaning: {
        interpretationId: SYNTHETIC_APPROVED_REVENUE.interpretation.interpretationId,
        label: SYNTHETIC_APPROVED_REVENUE.interpretation.label,
      },
      caveatCodes: [],
    };
    const claim = groundClaim(proposal, createSyntheticEvidenceBundle([SYNTHETIC_APPROVED_REVENUE], {
      quality: {
        acceptedCount: 1, validCount: 1, warningCount: 0,
        includedWarningCount: 0, excludedWarningCount: 0,
        rejectedCount: 0, rejectedRecordsInEvidence: 0,
      },
    }));
    expect(claim.support).toMatchObject({ status: "SUPPORTED", exceptions: [] });
  });

  it("rejects an approved interpretation ID paired with a different label", () => {
    const claim = groundClaim({
      claimId: "mislabeled-approved-meaning",
      sectionId: "results",
      text: "The synthetic metric is profit.",
      kind: "FINANCIAL_INTERPRETATION",
      evidenceIds: [SYNTHETIC_APPROVED_REVENUE.evidenceId],
      valueAssertions: [{
        evidenceId: SYNTHETIC_APPROVED_REVENUE.evidenceId,
        exactValue: exactDecimal("250"),
        currency: "MYR",
        monetaryBasis: "approved_interpretation",
      }],
      financialMeaning: {
        interpretationId: SYNTHETIC_APPROVED_REVENUE.interpretation.interpretationId,
        label: "Synthetic profit",
      },
      caveatCodes: [],
    }, createSyntheticEvidenceBundle([SYNTHETIC_APPROVED_REVENUE], {
      quality: {
        acceptedCount: 1, validCount: 1, warningCount: 0,
        includedWarningCount: 0, excludedWarningCount: 0,
        rejectedCount: 0, rejectedRecordsInEvidence: 0,
      },
    }));

    expect(claim.support.status).toBe("UNSUPPORTED");
    expect(claim.support.exceptions.map(exception => exception.code)).toContain("UNSUPPORTED_FINANCIAL_MEANING");
  });

  it("rejects approved interpretation evidence bound to a different snapshot", () => {
    const staleApproval = structuredClone(SYNTHETIC_APPROVED_REVENUE);
    staleApproval.interpretation.snapshotId = "different-snapshot";
    const claim = groundClaim({
      claimId: "stale-approved-meaning",
      sectionId: "results",
      text: "The synthetic approved revenue metric is MYR 250.",
      kind: "FINANCIAL_INTERPRETATION",
      evidenceIds: [staleApproval.evidenceId],
      valueAssertions: [{
        evidenceId: staleApproval.evidenceId,
        exactValue: exactDecimal("250"),
        currency: "MYR",
        monetaryBasis: "approved_interpretation",
      }],
      financialMeaning: {
        interpretationId: staleApproval.interpretation.interpretationId,
        label: staleApproval.interpretation.label,
      },
      caveatCodes: [],
    }, createSyntheticEvidenceBundle([staleApproval], {
      quality: {
        acceptedCount: 1, validCount: 1, warningCount: 0,
        includedWarningCount: 0, excludedWarningCount: 0,
        rejectedCount: 0, rejectedRecordsInEvidence: 0,
      },
    }));

    expect(claim.support.status).toBe("UNSUPPORTED");
    expect(claim.support.exceptions.map(exception => exception.code)).toContain("UNSUPPORTED_FINANCIAL_MEANING");
  });

  it("marks structurally matching claims as structural-only, not semantic approval", () => {
    const claim = groundClaim(sourceClaim({
      claimId: "adversarial-narrative",
      text: "The cited debit proves fraud, profit, and future performance.",
    }), createSyntheticEvidenceBundle([SYNTHETIC_SOURCE_DEBIT], {
      quality: {
        acceptedCount: 1, validCount: 1, warningCount: 0,
        includedWarningCount: 0, excludedWarningCount: 0,
        rejectedCount: 1, rejectedRecordsInEvidence: 0,
      },
    }));

    expect(claim.support).toMatchObject({
      assurance: "STRUCTURAL_ONLY",
      status: "SUPPORTED_WITH_CAVEAT",
    });
  });

  it("rejects fabricated evidence IDs, changed values, and omitted warning caveats", () => {
    const bundle = createSyntheticEvidenceBundle([SYNTHETIC_WARNING_AMOUNT]);
    const claim = groundClaim({
      claimId: "invalid-claim",
      sectionId: "results",
      text: "An unsupported value.",
      kind: "SOURCE_STRUCTURE",
      evidenceIds: [SYNTHETIC_WARNING_AMOUNT.evidenceId, "fabricated:evidence"],
      valueAssertions: [{
        evidenceId: SYNTHETIC_WARNING_AMOUNT.evidenceId,
        exactValue: exactDecimal("999"),
        currency: "MYR",
        monetaryBasis: "source_amount_with_direction",
      }],
      financialMeaning: null,
      caveatCodes: [],
    }, bundle);
    expect(claim.support.status).toBe("UNSUPPORTED");
    expect(claim.support.requiredCaveats).toEqual(expect.arrayContaining([
      "WARNING_EVIDENCE", "INTERPRETATION_LIMITATION", "REJECTED_COUNT",
    ]));
    expect(claim.support.exceptions.every(exception => exception.code === "CLAIM_NOT_GROUNDED")).toBe(true);
  });

  it("does not approve drafts with unsupported claims", () => {
    const bundle = createSyntheticEvidenceBundle([SYNTHETIC_SOURCE_DEBIT]);
    const unsupported = groundClaim(sourceClaim({
      kind: "FINANCIAL_INTERPRETATION",
      financialMeaning: { interpretationId: "profit", label: "Profit" },
    }), bundle);
    const request: ReportRequest = {
      contractVersion: AI_REPORTING_CONTRACT_VERSION,
      requestId: "synthetic-request",
      trustedContext: { organizationId: "synthetic-organization", actorId: "analyst", resolution: "TRUSTED_SERVER_CONTEXT" },
      period: SYNTHETIC_PERIOD,
      population: {
        snapshotId: bundle.snapshot.snapshotId,
        snapshotSha256: bundle.snapshot.snapshotSha256,
        persistenceAttemptIds: [], ingestionBatchIds: bundle.snapshot.ingestionBatchIds,
        datasetIds: bundle.snapshot.datasetIds, selection: "EXPLICIT",
      },
      templateId: "synthetic-template", templateVersion: "0.1",
      warningPolicy: "INCLUDE_WITH_CAVEATS", interpretationApprovalIds: [],
      language: "en", audience: "FINANCE_ANALYST",
    };
    const draft: ReportDraft = {
      contractVersion: AI_REPORTING_CONTRACT_VERSION,
      reportId: "synthetic-report", workflowState: "DRAFT", request,
      evidenceBundleId: bundle.bundleId, inputSnapshotId: bundle.snapshot.snapshotId,
      generation: { method: "MANUAL_TEMPLATE", promptVersion: null, modelIdentifier: null, policyVersion: GROUNDING_POLICY_VERSION },
      sections: [], claims: [unsupported], exceptions: [],
      validation: {
        assurance: "STRUCTURAL_ONLY", status: "FAILED",
        validatedAt: "2026-10-20T00:00:00.000Z", unsupportedClaimIds: [unsupported.claimId],
      },
      createdAt: "2026-10-20T00:00:00.000Z",
    };
    expect(canApproveDraft(draft)).toBe(false);
  });
});
