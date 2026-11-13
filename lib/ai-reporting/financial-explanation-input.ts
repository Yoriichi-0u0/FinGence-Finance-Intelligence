import type {
  DeterministicCalculationEvidence,
  EvidenceValue,
} from "./contracts";
import type { LocalManagementReport } from "./local-management-report";
import {
  FINANCIAL_EXPLANATION_REQUEST_VERSION,
  financialExplanationRequestSchema,
  type FinancialExplanationRequest,
} from "./financial-explanation-schema";
import { FINANCIAL_EXPLANATION_PROMPT_VERSION } from "./prompts/financial-explanation";

const qualityLabels: Readonly<Record<string, string>> = {
  accepted: "Accepted source records",
  included: "Records included under the selected warning policy",
  warnings: "Accepted records with warnings",
  rejected: "Rejected records excluded from report evidence",
};

function evidenceLabel(report: LocalManagementReport, item: DeterministicCalculationEvidence): string {
  const metric = report.metrics.find(candidate => candidate.evidenceId === item.evidenceId);
  if (metric) return metric.label;
  if (item.derivation.functionId === "analytics.detectRobustAmountAnomalies") {
    return "Statistical amount review flag";
  }
  if (item.derivation.functionId === "analytics.detectRobustAmountAnomalies.count") {
    return "Statistical amount review flags";
  }
  const qualityKey = item.evidenceId.split(":").at(-1) ?? "";
  return qualityLabels[qualityKey] ?? "Deterministic report evidence";
}

function promptValue(value: EvidenceValue) {
  if (value.kind === "MONETARY" || value.kind === "COUNT") return value;
  if (value.kind === "TEXT" && value.value === "STATISTICAL_AMOUNT_REVIEW_FLAG") {
    return { kind: "TEXT" as const, value: "STATISTICAL_AMOUNT_REVIEW_FLAG" as const };
  }
  throw new Error("The local AI explanation supports monetary totals, quality counts and statistical review flags only.");
}

function isEligible(item: DeterministicCalculationEvidence): boolean {
  return item.derivation.functionId === "analytics.aggregateSourceRecords"
    || item.derivation.functionId === "analytics.detectRobustAmountAnomalies.count"
    || item.derivation.functionId === "ingestion.createAcceptedDataPayload.quality";
}

function quarterlyExplanationEvidence(
  report: LocalManagementReport,
): FinancialExplanationRequest["bundle"]["evidenceItems"] | null {
  const activity = report.quarterlyActivity;
  if (report.reportType !== "QUARTERLY_FINANCIAL_ACTIVITY" || !activity) return null;
  const current = activity.current;
  const period = {
    startDate: current.period.startDate,
    endDate: current.period.endDate,
    timezone: report.reportingPeriod.timezone,
    dateBasis: report.reportingPeriod.dateBasis,
  };
  const prefix = `quarterly:${activity.business.identifier}:${current.period.key}`;
  const calculationVersion = activity.calculation.version;
  return [
    {
      evidenceId: `${prefix}:bank-credits`,
      evidenceClass: "DETERMINISTIC_CALCULATION",
      label: `Recorded bank credits for ${current.period.label}`,
      value: {
        kind: "MONETARY",
        amount: current.bankCredits,
        currency: current.currency,
        currencyBasis: null,
        monetaryBasis: current.monetaryBasis,
        sourceComponent: "CREDIT",
      },
      period,
      warningRules: [],
      derivation: { functionId: "analytics.aggregateSourceRecords", version: calculationVersion },
      interpretationStatus: "UNAVAILABLE",
    },
    {
      evidenceId: `${prefix}:bank-debits`,
      evidenceClass: "DETERMINISTIC_CALCULATION",
      label: `Recorded bank debits for ${current.period.label}`,
      value: {
        kind: "MONETARY",
        amount: current.bankDebits,
        currency: current.currency,
        currencyBasis: null,
        monetaryBasis: current.monetaryBasis,
        sourceComponent: "DEBIT",
      },
      period,
      warningRules: [],
      derivation: { functionId: "analytics.aggregateSourceRecords", version: calculationVersion },
      interpretationStatus: "UNAVAILABLE",
    },
    {
      evidenceId: `${prefix}:included`,
      evidenceClass: "DETERMINISTIC_CALCULATION",
      label: `Records included for ${current.period.label} under the selected warning policy`,
      value: { kind: "COUNT", value: current.includedTransactionCount, unit: "RECORDS" },
      period,
      warningRules: [],
      derivation: { functionId: "ingestion.createAcceptedDataPayload.quality", version: calculationVersion },
      interpretationStatus: "NOT_APPLICABLE",
    },
    {
      evidenceId: `${prefix}:statistical-review`,
      evidenceClass: "DETERMINISTIC_CALCULATION",
      label: `Statistical amount review candidates for ${current.period.label}`,
      value: { kind: "COUNT", value: current.statisticalFlagCount, unit: "RECORDS" },
      period,
      warningRules: [],
      derivation: { functionId: "analytics.detectRobustAmountAnomalies.count", version: calculationVersion },
      interpretationStatus: "NOT_APPLICABLE",
    },
  ];
}

/**
 * Build the minimized model input from the existing evidence bundle.
 * Raw rows, descriptions, warning messages, filenames and rejected contents are
 * deliberately excluded from the provider request.
 */
export function createFinancialExplanationRequest(report: LocalManagementReport): FinancialExplanationRequest {
  const quarterlyEvidence = quarterlyExplanationEvidence(report);
  const evidenceItems = quarterlyEvidence ?? report.evidenceBundle.items
    .filter((item): item is DeterministicCalculationEvidence =>
      item.evidenceClass === "DETERMINISTIC_CALCULATION" && isEligible(item))
    .map(item => ({
      evidenceId: item.evidenceId,
      evidenceClass: item.evidenceClass,
      label: evidenceLabel(report, item),
      value: promptValue(item.value),
      period: item.period,
      warningRules: item.warnings.map(warning => ({
        rule: warning.rule,
        category: warning.category,
        field: warning.field,
      })),
      derivation: {
        functionId: item.derivation.functionId as
          | "analytics.aggregateSourceRecords"
          | "analytics.detectRobustAmountAnomalies.count"
          | "ingestion.createAcceptedDataPayload.quality",
        version: item.derivation.version,
      },
      interpretationStatus: item.interpretation.status === "NOT_APPLICABLE" ? "NOT_APPLICABLE" as const : "UNAVAILABLE" as const,
    }));
  const eligibleEvidenceIds = new Set(evidenceItems.map(item => item.evidenceId));
  const quarterly = report.quarterlyActivity?.current;
  const quality = quarterlyEvidence && quarterly
    ? {
        acceptedCount: quarterly.acceptedTransactionCount,
        validCount: Math.max(0, quarterly.acceptedTransactionCount - quarterly.warningCount),
        warningCount: quarterly.warningCount,
        includedWarningCount: report.evidenceBundle.warningPolicy === "INCLUDE_WITH_CAVEATS" ? quarterly.warningCount : 0,
        excludedWarningCount: report.evidenceBundle.warningPolicy === "EXCLUDE" ? quarterly.warningCount : 0,
        rejectedCount: 0,
        rejectedRecordsInEvidence: 0 as const,
      }
    : report.evidenceBundle.quality;
  const currencyScope = quarterlyEvidence && quarterly
    ? { status: "SINGLE" as const, currencies: [quarterly.currency], hasMissingCurrency: false }
    : report.evidenceBundle.currencyScope;

  return financialExplanationRequestSchema.parse({
    requestVersion: FINANCIAL_EXPLANATION_REQUEST_VERSION,
    promptVersion: FINANCIAL_EXPLANATION_PROMPT_VERSION,
    reportId: report.reportId,
    sourceFileSha256: report.dataset.fileSha256,
    requestedAudience: "MANAGEMENT",
    untrustedSourceTextPolicy: "EXCLUDED_FROM_MODEL_INPUT",
    bundle: {
      bundleId: report.evidenceBundle.bundleId,
      snapshotId: report.evidenceBundle.snapshot.snapshotId,
      snapshotSha256: report.evidenceBundle.snapshot.snapshotSha256,
      schemaVersion: report.evidenceBundle.snapshot.schemaVersion,
      rulesetVersion: report.evidenceBundle.snapshot.rulesetVersion,
      period: quarterlyEvidence ? evidenceItems[0].period : report.evidenceBundle.period,
      warningPolicy: report.evidenceBundle.warningPolicy,
      currencyScope,
      quality,
      sensitivity: report.evidenceBundle.sensitivity,
      evidenceItems,
      exceptions: (quarterlyEvidence ? [] : report.policyExceptions).map(exception => ({
        code: exception.code,
        severity: exception.severity,
        blocksPublication: exception.blocksPublication,
        evidenceIds: exception.evidenceIds.filter(evidenceId => eligibleEvidenceIds.has(evidenceId)),
      })),
    },
  });
}

export function serializeFinancialExplanationEvidence(input: FinancialExplanationRequest): string {
  const parsed = financialExplanationRequestSchema.parse(input);
  return JSON.stringify(parsed);
}
