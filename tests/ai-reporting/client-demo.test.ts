import { describe, expect, it } from "vitest";
import {
  AI_REPORTING_CONTRACT_VERSION,
  GROUNDING_POLICY_VERSION,
  canApproveDraft,
  evaluateEvidenceBundle,
  exactDecimal,
  groundClaim,
  type ClaimProposal,
  type ReportDraft,
  type ReportRequest,
} from "../../lib/ai-reporting";
import {
  SYNTHETIC_APPROVED_REVENUE,
  SYNTHETIC_PERIOD,
  SYNTHETIC_WARNING_AMOUNT,
  createSyntheticEvidenceBundle,
} from "./fixtures/synthetic-evidence";

/**
 * Executable AI-01 demonstration only.
 *
 * All values and approvals are synthetic. The preview is a manual template,
 * not LLM output, and a passing structural precheck does not authorize
 * publication.
 */
function createSyntheticClientDemo() {
  const bundle = createSyntheticEvidenceBundle([
    SYNTHETIC_APPROVED_REVENUE,
    SYNTHETIC_WARNING_AMOUNT,
  ]);
  const bundleDecision = evaluateEvidenceBundle(bundle);

  const request: ReportRequest = {
    contractVersion: AI_REPORTING_CONTRACT_VERSION,
    requestId: "synthetic-demo-request-001",
    trustedContext: {
      organizationId: "synthetic-organization",
      actorId: "synthetic-demo-operator",
      resolution: "TRUSTED_SERVER_CONTEXT",
    },
    period: SYNTHETIC_PERIOD,
    population: {
      snapshotId: bundle.snapshot.snapshotId,
      snapshotSha256: bundle.snapshot.snapshotSha256,
      persistenceAttemptIds: ["synthetic-persistence-attempt-001"],
      ingestionBatchIds: bundle.snapshot.ingestionBatchIds,
      datasetIds: bundle.snapshot.datasetIds,
      selection: "EXPLICIT",
    },
    templateId: "synthetic-management-summary",
    templateVersion: "demo-only-1",
    warningPolicy: bundle.warningPolicy,
    interpretationApprovalIds: [SYNTHETIC_APPROVED_REVENUE.interpretation.approvalReference],
    language: "en-MY",
    audience: "MANAGEMENT_REVIEWER",
  };

  const revenueProposal: ClaimProposal = {
    claimId: "synthetic-approved-revenue",
    sectionId: "management-summary",
    text: "The test-only approved synthetic revenue metric is MYR 250.",
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
    caveatCodes: ["REJECTED_COUNT"],
  };

  const warningProposal: ClaimProposal = {
    claimId: "synthetic-warning-source-amount",
    sectionId: "data-quality",
    text: "A warning-flagged synthetic source amount is MYR 125.5; no accounting meaning is assigned.",
    kind: "SOURCE_STRUCTURE",
    evidenceIds: [SYNTHETIC_WARNING_AMOUNT.evidenceId],
    valueAssertions: [{
      evidenceId: SYNTHETIC_WARNING_AMOUNT.evidenceId,
      exactValue: exactDecimal("125.5"),
      currency: "MYR",
      monetaryBasis: "source_amount_with_direction",
    }],
    financialMeaning: null,
    caveatCodes: ["WARNING_EVIDENCE", "INTERPRETATION_LIMITATION", "REJECTED_COUNT"],
  };

  const unsupportedProfitProposal: ClaimProposal = {
    claimId: "synthetic-unsupported-profit",
    sectionId: "management-summary",
    text: "Synthetic profit is MYR 250.",
    kind: "FINANCIAL_INTERPRETATION",
    evidenceIds: [SYNTHETIC_APPROVED_REVENUE.evidenceId],
    valueAssertions: [{
      evidenceId: SYNTHETIC_APPROVED_REVENUE.evidenceId,
      exactValue: exactDecimal("250"),
      currency: "MYR",
      monetaryBasis: "approved_interpretation",
    }],
    financialMeaning: {
      interpretationId: "synthetic-profit-definition",
      label: "Synthetic profit",
    },
    caveatCodes: ["REJECTED_COUNT"],
  };

  const acceptedClaims = [
    groundClaim(revenueProposal, bundle),
    groundClaim(warningProposal, bundle),
  ];
  const rejectedClaim = groundClaim(unsupportedProfitProposal, bundle);

  const draft: ReportDraft = {
    contractVersion: AI_REPORTING_CONTRACT_VERSION,
    reportId: "synthetic-demo-draft-001",
    workflowState: "DRAFT",
    request,
    evidenceBundleId: bundle.bundleId,
    inputSnapshotId: bundle.snapshot.snapshotId,
    generation: {
      method: "MANUAL_TEMPLATE",
      promptVersion: null,
      modelIdentifier: null,
      policyVersion: GROUNDING_POLICY_VERSION,
    },
    sections: [{
      sectionId: "management-summary",
      title: "Synthetic management summary",
      narrative: "The test-only approved synthetic revenue metric is MYR 250.",
      claimIds: [acceptedClaims[0].claimId],
    }, {
      sectionId: "data-quality",
      title: "Evidence and limitations",
      narrative: "One warning record is included with a caveat. One rejected row is counted but its contents are excluded.",
      claimIds: [acceptedClaims[1].claimId],
    }],
    claims: acceptedClaims,
    exceptions: bundleDecision.exceptions,
    validation: {
      assurance: "STRUCTURAL_ONLY",
      status: "PASSED",
      validatedAt: "2026-10-27T00:00:00.000Z",
      unsupportedClaimIds: [],
    },
    createdAt: "2026-10-27T00:00:00.000Z",
  };

  return {
    labels: {
      data: "SYNTHETIC_ONLY",
      generation: "MANUAL_TEMPLATE_NOT_LLM",
      workflow: "DRAFT_NOT_AUTHORIZED_FOR_PUBLICATION",
    },
    request,
    evidence: {
      bundleId: bundle.bundleId,
      snapshotId: bundle.snapshot.snapshotId,
      period: bundle.period,
      currencyScope: bundleDecision.currencyScope,
      evidenceIds: bundle.items.map(item => item.evidenceId),
      quality: bundle.quality,
      policyExceptions: bundleDecision.exceptions.map(exception => exception.code),
    },
    managementPreview: draft.sections,
    acceptedClaims: acceptedClaims.map(claim => ({
      claimId: claim.claimId,
      support: claim.support.status,
      assurance: claim.support.assurance,
      evidenceIds: claim.evidenceIds,
      caveats: claim.support.requiredCaveats,
    })),
    rejectedClaim: {
      claimId: rejectedClaim.claimId,
      support: rejectedClaim.support.status,
      exceptionCodes: rejectedClaim.support.exceptions.map(exception => exception.code),
    },
    approvalBoundary: {
      structuralPrecheckPasses: canApproveDraft(draft),
      publicationAuthorized: false,
      reason: "AI-01 has no trusted server-side approval or artifact publication workflow.",
    },
  };
}

describe("AI-01 synthetic client demonstration", () => {
  it("prepares a traceable draft and rejects an unsupported profit interpretation", () => {
    const demo = createSyntheticClientDemo();

    expect(demo.labels).toEqual({
      data: "SYNTHETIC_ONLY",
      generation: "MANUAL_TEMPLATE_NOT_LLM",
      workflow: "DRAFT_NOT_AUTHORIZED_FOR_PUBLICATION",
    });
    expect(demo.evidence.currencyScope).toEqual({
      status: "SINGLE",
      currencies: ["MYR"],
      hasMissingCurrency: false,
    });
    expect(demo.evidence.quality).toMatchObject({
      warningCount: 1,
      rejectedCount: 1,
      rejectedRecordsInEvidence: 0,
    });
    expect(demo.acceptedClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        claimId: "synthetic-approved-revenue",
        support: "SUPPORTED_WITH_CAVEAT",
        assurance: "STRUCTURAL_ONLY",
      }),
      expect.objectContaining({
        claimId: "synthetic-warning-source-amount",
        support: "SUPPORTED_WITH_CAVEAT",
        assurance: "STRUCTURAL_ONLY",
      }),
    ]));
    expect(demo.rejectedClaim).toEqual({
      claimId: "synthetic-unsupported-profit",
      support: "UNSUPPORTED",
      exceptionCodes: ["UNSUPPORTED_FINANCIAL_MEANING"],
    });
    expect(demo.approvalBoundary).toEqual({
      structuralPrecheckPasses: true,
      publicationAuthorized: false,
      reason: "AI-01 has no trusted server-side approval or artifact publication workflow.",
    });

    if (process.env.AI_REPORTING_DEMO === "1") {
      process.stdout.write(`\n${JSON.stringify(demo, null, 2)}\n`);
    }
  });
});
