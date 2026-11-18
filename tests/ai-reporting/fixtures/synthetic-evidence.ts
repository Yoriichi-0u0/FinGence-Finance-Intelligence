import {
  AI_REPORTING_CONTRACT_VERSION,
  EVIDENCE_BUNDLE_VERSION,
  deriveCurrencyScope,
  exactDecimal,
  type ApprovedFinancialInterpretationEvidence,
  type EvidenceBundle,
  type EvidenceItem,
  type ReportingPeriod,
  type VerifiedSourceEvidence,
} from "../../../lib/ai-reporting";

/** Synthetic-only values; no client financial data or accounting convention is represented. */
export const SYNTHETIC_PERIOD: ReportingPeriod = {
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  timezone: "Asia/Kuching",
  dateBasis: "CANONICAL_DATE",
};

const SYNTHETIC_LINEAGE = {
  schemaVersion: "0.1",
  rulesetVersion: "0.1",
  datasetId: "synthetic-ledger:0",
  sourceSystem: "Synthetic ledger",
  sourceFile: "synthetic-ledger.csv",
  sourceSheet: null,
  fileSha256: "a".repeat(64),
  ingestionBatchId: "synthetic-batch-001",
  ingestedAt: "2026-10-20T00:00:00.000Z",
  sourceRowId: "synthetic-ledger:0:2",
  sourceRowNumber: 2,
} as const;

export const SYNTHETIC_SOURCE_DEBIT = {
  evidenceId: "source:synthetic-ledger:0:2:debit",
  evidenceClass: "VERIFIED_SOURCE_STRUCTURE",
  sourceField: "debit",
  value: {
    kind: "MONETARY",
    amount: exactDecimal("9007199254740993.1"),
    currency: "MYR",
    currencyBasis: "SOURCE",
    monetaryBasis: "debit_credit",
    sourceComponent: "DEBIT",
  },
  period: SYNTHETIC_PERIOD,
  warnings: [],
  sensitivity: "CONFIDENTIAL",
  lineage: SYNTHETIC_LINEAGE,
  interpretation: {
    status: "UNAVAILABLE",
    reason: "A debit label does not establish revenue, expense, profit, or cash-flow meaning.",
    requiredForRequest: false,
  },
} satisfies VerifiedSourceEvidence;

export const SYNTHETIC_WARNING_AMOUNT = {
  evidenceId: "source:synthetic-bank:0:3:amount",
  evidenceClass: "VERIFIED_SOURCE_STRUCTURE",
  sourceField: "source_amount",
  value: {
    kind: "MONETARY",
    amount: exactDecimal("125.5"),
    currency: "MYR",
    currencyBasis: "DATASET_DEFAULT",
    monetaryBasis: "source_amount_with_direction",
    sourceComponent: "SOURCE_AMOUNT",
  },
  period: SYNTHETIC_PERIOD,
  warnings: [{
    rule: "SYNTHETIC_REVIEW_WARNING",
    category: "business",
    field: "reference",
    sourceColumn: "Reference",
    originalValue: "SYN-003",
    message: "Synthetic warning for policy testing.",
    sensitivity: "CONFIDENTIAL",
  }],
  sensitivity: "CONFIDENTIAL",
  lineage: {
    ...SYNTHETIC_LINEAGE,
    datasetId: "synthetic-bank:0",
    sourceSystem: "Synthetic bank",
    sourceFile: "synthetic-bank.csv",
    fileSha256: "b".repeat(64),
    sourceRowId: "synthetic-bank:0:3",
    sourceRowNumber: 3,
  },
  interpretation: {
    status: "UNAVAILABLE",
    reason: "A source amount and direction do not establish cash-flow or financial-statement meaning.",
    requiredForRequest: false,
  },
} satisfies VerifiedSourceEvidence;

export const SYNTHETIC_APPROVED_REVENUE = {
  evidenceId: "approved:synthetic:revenue:2026-09",
  evidenceClass: "APPROVED_FINANCIAL_INTERPRETATION",
  value: {
    kind: "MONETARY",
    amount: exactDecimal("250"),
    currency: "MYR",
    currencyBasis: "SOURCE",
    monetaryBasis: "approved_interpretation",
    sourceComponent: "APPROVED_METRIC",
  },
  period: SYNTHETIC_PERIOD,
  warnings: [],
  sensitivity: "CONFIDENTIAL",
  basisEvidenceIds: [SYNTHETIC_SOURCE_DEBIT.evidenceId],
  derivation: {
    functionId: "synthetic-approved-metric",
    version: "test-only-1",
    inputEvidenceIds: [SYNTHETIC_SOURCE_DEBIT.evidenceId],
  },
  lineage: [SYNTHETIC_LINEAGE],
  interpretation: {
    status: "APPROVED",
    interpretationId: "synthetic-revenue-definition",
    label: "Synthetic revenue",
    definitionReference: "test-only:synthetic-revenue-definition",
    approvalReference: "test-only:synthetic-approval-001",
    approvedByActorId: "synthetic-reviewer",
    approvedAt: "2026-10-20T00:00:00.000Z",
    organizationId: "synthetic-organization",
    snapshotId: "synthetic-snapshot-001",
    source: "TRUSTED_SERVER_CONTEXT",
  },
} satisfies ApprovedFinancialInterpretationEvidence;

export const SYNTHETIC_USD_AMOUNT = {
  ...SYNTHETIC_SOURCE_DEBIT,
  evidenceId: "source:synthetic-ledger:0:4:debit-usd",
  value: { ...SYNTHETIC_SOURCE_DEBIT.value, amount: exactDecimal("10"), currency: "USD" },
  lineage: { ...SYNTHETIC_LINEAGE, sourceRowId: "synthetic-ledger:0:4", sourceRowNumber: 4 },
} satisfies VerifiedSourceEvidence;

export const SYNTHETIC_MISSING_CURRENCY = {
  ...SYNTHETIC_SOURCE_DEBIT,
  evidenceId: "source:synthetic-ledger:0:5:debit-no-currency",
  value: {
    ...SYNTHETIC_SOURCE_DEBIT.value,
    amount: exactDecimal("12"),
    currency: null,
    currencyBasis: null,
  },
  lineage: { ...SYNTHETIC_LINEAGE, sourceRowId: "synthetic-ledger:0:5", sourceRowNumber: 5 },
} satisfies VerifiedSourceEvidence;

export function createSyntheticEvidenceBundle(
  items: readonly EvidenceItem[] = [SYNTHETIC_SOURCE_DEBIT, SYNTHETIC_WARNING_AMOUNT],
  overrides: Partial<Omit<EvidenceBundle, "items" | "currencyScope">> = {},
): EvidenceBundle {
  return {
    bundleVersion: EVIDENCE_BUNDLE_VERSION,
    contractVersion: AI_REPORTING_CONTRACT_VERSION,
    bundleId: "synthetic-evidence-bundle-001",
    snapshot: {
      snapshotId: "synthetic-snapshot-001",
      snapshotSha256: "c".repeat(64),
      schemaVersion: "0.1",
      rulesetVersion: "0.1",
      datasetIds: [...new Set(items.flatMap(item => item.evidenceClass === "VERIFIED_SOURCE_STRUCTURE"
        ? [item.lineage.datasetId]
        : item.lineage.map(lineage => lineage.datasetId)))],
      ingestionBatchIds: ["synthetic-batch-001"],
      createdAt: "2026-10-20T00:00:00.000Z",
    },
    period: SYNTHETIC_PERIOD,
    warningPolicy: "INCLUDE_WITH_CAVEATS",
    currencyScope: deriveCurrencyScope(items),
    quality: {
      acceptedCount: 2,
      validCount: 1,
      warningCount: 1,
      includedWarningCount: 1,
      excludedWarningCount: 0,
      rejectedCount: 1,
      rejectedRecordsInEvidence: 0,
    },
    sensitivity: "CONFIDENTIAL",
    items,
    exceptions: [],
    ...overrides,
  };
}
