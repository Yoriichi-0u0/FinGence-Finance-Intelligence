import {
  GROUNDING_POLICY_VERSION,
  type ClaimCaveatCode,
  type ClaimProposal,
  type CurrencyScope,
  type EvidenceBundle,
  type EvidenceItem,
  type ExactDecimalString,
  type GroundedClaim,
  type ReportDraft,
  type ReportException,
} from "./contracts";
import { createReportException } from "./exceptions";

const exactDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function isExactDecimalString(value: unknown): value is ExactDecimalString {
  return typeof value === "string" && exactDecimalPattern.test(value);
}

/** Validates without normalizing, rounding, trimming, or converting through number. */
export function exactDecimal(value: string): ExactDecimalString {
  if (!isExactDecimalString(value)) {
    throw new TypeError(`Invalid exact decimal string: ${JSON.stringify(value)}.`);
  }
  return value;
}

function monetaryItems(items: readonly EvidenceItem[]) {
  return items.filter((item): item is EvidenceItem & { value: Extract<EvidenceItem["value"], { kind: "MONETARY" }> } =>
    item.value.kind === "MONETARY");
}

export function deriveCurrencyScope(items: readonly EvidenceItem[]): CurrencyScope {
  const monetary = monetaryItems(items);
  const currencies = [...new Set(monetary.flatMap(item =>
    item.value.currency && item.value.currency.trim() ? [item.value.currency] : []))].sort();
  return {
    status: currencies.length === 0 ? "NONE" : currencies.length === 1 ? "SINGLE" : "MIXED",
    currencies,
    hasMissingCurrency: monetary.some(item => !item.value.currency || !item.value.currency.trim()),
  };
}

export interface EvidenceBundlePolicyDecision {
  currencyScope: CurrencyScope;
  exceptions: readonly ReportException[];
  publishable: boolean;
}

function uniqueExceptions(exceptions: readonly ReportException[]): ReportException[] {
  const seen = new Set<string>();
  return exceptions.filter(exception => {
    const key = `${exception.code}:${exception.evidenceIds.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currencyScopesAgree(declared: CurrencyScope, derived: CurrencyScope): boolean {
  if (declared.status !== derived.status || declared.hasMissingCurrency !== derived.hasMissingCurrency) return false;
  if (declared.currencies.length !== derived.currencies.length) return false;
  const declaredCurrencies = [...declared.currencies].sort();
  return declaredCurrencies.every((currency, index) => currency === derived.currencies[index]);
}

function currencyScopeConsistencyException(bundle: EvidenceBundle, derived: CurrencyScope): ReportException | null {
  if (currencyScopesAgree(bundle.currencyScope, derived)) return null;
  return createReportException("EVIDENCE_METADATA_INCONSISTENT", {
    message: "Declared currency scope does not agree with the scope derived from the bundle's monetary evidence.",
    evidenceIds: monetaryItems(bundle.items).map(item => item.evidenceId),
  });
}

export function evaluateEvidenceBundle(bundle: EvidenceBundle): EvidenceBundlePolicyDecision {
  const currencyScope = deriveCurrencyScope(bundle.items);
  const exceptions: ReportException[] = [...bundle.exceptions];

  const consistencyException = currencyScopeConsistencyException(bundle, currencyScope);
  if (consistencyException) exceptions.push(consistencyException);
  if (currencyScope.hasMissingCurrency) {
    exceptions.push(createReportException("CURRENCY_UNSPECIFIED", {
      evidenceIds: monetaryItems(bundle.items)
        .filter(item => !item.value.currency || !item.value.currency.trim())
        .map(item => item.evidenceId),
    }));
  }
  if (currencyScope.status === "MIXED") {
    exceptions.push(createReportException("MIXED_CURRENCY", {
      evidenceIds: monetaryItems(bundle.items).map(item => item.evidenceId),
    }));
  }
  if (bundle.quality.warningCount > 0) {
    exceptions.push(createReportException(
      bundle.warningPolicy === "INCLUDE_WITH_CAVEATS" ? "WARNING_RECORDS_INCLUDED" : "WARNING_RECORDS_EXCLUDED",
    ));
  }
  if (bundle.quality.rejectedCount > 0) {
    exceptions.push(createReportException("REJECTED_ROWS_PRESENT"));
  }
  for (const item of bundle.items) {
    if (item.evidenceClass === "APPROVED_FINANCIAL_INTERPRETATION") continue;
    if ((item.interpretation.status === "UNAVAILABLE" || item.interpretation.status === "REFERENCE_ONLY")
      && item.interpretation.requiredForRequest) {
      exceptions.push(createReportException("INTERPRETATION_UNAVAILABLE", { evidenceIds: [item.evidenceId] }));
    }
  }

  const result = uniqueExceptions(exceptions);
  return {
    currencyScope,
    exceptions: result,
    publishable: result.every(exception => !exception.blocksPublication),
  };
}

function evidenceExactValue(item: EvidenceItem): ExactDecimalString | null {
  if (item.value.kind === "MONETARY") return item.value.amount;
  if (item.value.kind === "DECIMAL") return item.value.value;
  return null;
}

/**
 * Performs structural grounding only. It does not decide whether arbitrary
 * narrative text is semantically entailed by the evidence.
 */
export function groundClaim(proposal: ClaimProposal, bundle: EvidenceBundle): GroundedClaim {
  const evidenceById = new Map(bundle.items.map(item => [item.evidenceId, item]));
  const explicitlyCitedIds = new Set(proposal.evidenceIds);
  const cited = proposal.evidenceIds.flatMap(id => {
    const item = evidenceById.get(id);
    return item ? [item] : [];
  });
  const exceptions: ReportException[] = [];
  const consistencyException = currencyScopeConsistencyException(bundle, deriveCurrencyScope(bundle.items));
  if (consistencyException) exceptions.push(consistencyException);
  const missingIds = proposal.evidenceIds.filter(id => !evidenceById.has(id));

  if (proposal.evidenceIds.length === 0 || missingIds.length > 0) {
    exceptions.push(createReportException("CLAIM_NOT_GROUNDED", {
      message: missingIds.length > 0
        ? `The claim cites unknown evidence IDs: ${missingIds.join(", ")}.`
        : "The claim does not cite any evidence.",
      evidenceIds: missingIds,
    }));
  }

  const uncitedAssertionIds = [...new Set(proposal.valueAssertions
    .filter(assertion => !explicitlyCitedIds.has(assertion.evidenceId))
    .map(assertion => assertion.evidenceId))];
  if (uncitedAssertionIds.length > 0) {
    exceptions.push(createReportException("CLAIM_NOT_GROUNDED", {
      exceptionId: `policy:CLAIM_NOT_GROUNDED:uncited-assertions:${proposal.claimId}`,
      message: `Claim value assertions must be explicitly cited in evidenceIds: ${uncitedAssertionIds.join(", ")}.`,
      evidenceIds: uncitedAssertionIds,
    }));
  }

  for (const assertion of proposal.valueAssertions) {
    const item = evidenceById.get(assertion.evidenceId);
    const value = item ? evidenceExactValue(item) : null;
    const monetary = item?.value.kind === "MONETARY" ? item.value : null;
    if (!item || value !== assertion.exactValue
      || (monetary && (monetary.currency !== assertion.currency || monetary.monetaryBasis !== assertion.monetaryBasis))) {
      exceptions.push(createReportException("CLAIM_NOT_GROUNDED", {
        exceptionId: `policy:CLAIM_NOT_GROUNDED:${assertion.evidenceId}`,
        message: `The asserted value or context does not exactly match evidence ${assertion.evidenceId}.`,
        evidenceIds: [assertion.evidenceId],
      }));
    }
  }

  if (proposal.kind === "FINANCIAL_INTERPRETATION") {
    const approval = proposal.financialMeaning && cited.find(item =>
      item.evidenceClass === "APPROVED_FINANCIAL_INTERPRETATION"
      && item.interpretation.interpretationId === proposal.financialMeaning?.interpretationId
      && item.interpretation.label === proposal.financialMeaning?.label
      && item.interpretation.snapshotId === bundle.snapshot.snapshotId);
    if (!approval) {
      exceptions.push(createReportException("UNSUPPORTED_FINANCIAL_MEANING", {
        evidenceIds: cited.map(item => item.evidenceId),
      }));
    }
    const unavailable = cited.filter(item => item.evidenceClass !== "APPROVED_FINANCIAL_INTERPRETATION"
      && (item.interpretation.status === "UNAVAILABLE" || item.interpretation.status === "REFERENCE_ONLY"));
    if (unavailable.length > 0) {
      exceptions.push(createReportException("INTERPRETATION_UNAVAILABLE", {
        evidenceIds: unavailable.map(item => item.evidenceId),
      }));
    }
  }

  const citedMonetary = monetaryItems(cited);
  const citedCurrencies = deriveCurrencyScope(cited);
  if (citedCurrencies.hasMissingCurrency) {
    exceptions.push(createReportException("CURRENCY_UNSPECIFIED", {
      evidenceIds: citedMonetary.filter(item => !item.value.currency).map(item => item.evidenceId),
    }));
  }
  if (citedCurrencies.status === "MIXED") {
    exceptions.push(createReportException("MIXED_CURRENCY", {
      evidenceIds: citedMonetary.map(item => item.evidenceId),
    }));
  }

  const requiredCaveats: ClaimCaveatCode[] = [];
  if (cited.some(item => item.warnings.length > 0)) requiredCaveats.push("WARNING_EVIDENCE");
  if (citedCurrencies.hasMissingCurrency || citedCurrencies.status === "MIXED") requiredCaveats.push("CURRENCY_LIMITATION");
  if (cited.some(item => item.evidenceClass !== "APPROVED_FINANCIAL_INTERPRETATION"
    && item.interpretation.status !== "NOT_APPLICABLE")) requiredCaveats.push("INTERPRETATION_LIMITATION");
  if (bundle.quality.rejectedCount > 0) requiredCaveats.push("REJECTED_COUNT");

  const missingCaveats = requiredCaveats.filter(code => !proposal.caveatCodes.includes(code));
  if (missingCaveats.length > 0) {
    exceptions.push(createReportException("CLAIM_NOT_GROUNDED", {
      exceptionId: `policy:CLAIM_NOT_GROUNDED:caveats:${proposal.claimId}`,
      message: `The claim omits required caveats: ${missingCaveats.join(", ")}.`,
      evidenceIds: cited.map(item => item.evidenceId),
    }));
  }

  const result = uniqueExceptions(exceptions);
  const unsupported = result.some(exception => exception.blocksPublication);
  return {
    ...proposal,
    support: {
      assurance: "STRUCTURAL_ONLY",
      status: unsupported ? "UNSUPPORTED" : requiredCaveats.length > 0 ? "SUPPORTED_WITH_CAVEAT" : "SUPPORTED",
      policyVersion: GROUNDING_POLICY_VERSION,
      requiredCaveats,
      exceptions: result,
    },
  };
}

/**
 * Structural policy precheck only. A true result is necessary but insufficient
 * for publication and grants no authorization to create an approved artifact.
 */
export function canApproveDraft(draft: ReportDraft): boolean {
  return draft.validation.assurance === "STRUCTURAL_ONLY"
    && draft.validation.status === "PASSED"
    && draft.validation.unsupportedClaimIds.length === 0
    && draft.claims.every(claim => claim.support.status !== "UNSUPPORTED")
    && [...draft.exceptions, ...draft.claims.flatMap(claim => claim.support.exceptions)]
      .every(exception => !exception.blocksPublication);
}
