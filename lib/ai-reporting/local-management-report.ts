import type { AcceptedAnalyticsRun } from "../analytics/accepted-data-adapter";
import type { WarningPolicy } from "../analytics";
import type {
  AcceptedDataPayload,
  AcceptedDataset,
  AcceptedTransaction,
  AcceptedWarning,
} from "../ingestion/accepted-data";
import {
  AI_REPORTING_CONTRACT_VERSION,
  EVIDENCE_BUNDLE_VERSION,
  type ClaimCaveatCode,
  type ClaimProposal,
  type DeterministicCalculationEvidence,
  type EvidenceBundle,
  type EvidenceItem,
  type EvidenceWarning,
  type GroundedClaim,
  type MonetaryBasis,
  type ReportingPeriod,
  type SourceLineage,
  type VerifiedSourceEvidence,
} from "./contracts";
import { deriveCurrencyScope, evaluateEvidenceBundle, exactDecimal, groundClaim } from "./grounding-policy";
import {
  createManagementReportPresentation,
  formatReportDate,
  formatReportMoney,
  formatReportMonth,
  formatReportPeriod,
  formatReportTimestamp,
} from "./report-presentation";
import {
  FINANCIAL_EXPLANATION_HTML_CSS,
  renderFinancialExplanationHtml,
} from "./financial-explanation-presentation";
import type { ValidatedFinancialExplanation } from "./financial-explanation-validation";
import { renderQuarterlyFinancialActivityHtml } from "./quarterly-report-html";

const REPORT_TIMEZONE = "Asia/Kuching";
const REPORT_TEMPLATE_VERSION = "local-management-source-values-0.3";

type AggregateField = "sourceAmountTotal" | "debitTotal" | "creditTotal";
type SourceField = "source_amount" | "debit" | "credit";

const aggregateDefinitions: ReadonlyArray<{
  aggregateField: AggregateField;
  sourceField: SourceField;
  label: string;
  sourceComponent: "SOURCE_AMOUNT" | "DEBIT" | "CREDIT";
}> = [
  { aggregateField: "sourceAmountTotal", sourceField: "source_amount", label: "Total supplied amount values", sourceComponent: "SOURCE_AMOUNT" },
  { aggregateField: "debitTotal", sourceField: "debit", label: "Total supplied debit values", sourceComponent: "DEBIT" },
  { aggregateField: "creditTotal", sourceField: "credit", label: "Total supplied credit values", sourceComponent: "CREDIT" },
];

export interface LocalReportMetric {
  metricId: string;
  label: string;
  period: string;
  exactValue: string;
  currency: string | null;
  monetaryBasis: MonetaryBasis;
  evidenceId: string;
  claim: GroundedClaim;
}

export type LocalReportAnomaly = AcceptedAnalyticsRun["anomalies"][number] & {
  description: string | null;
  reference: string | null;
};

export interface LocalReportWarning {
  sourceRowId: string;
  sourceRowNumber: number;
  canonicalDate: string;
  description: string | null;
  reference: string | null;
  messages: readonly string[];
  issues: readonly Pick<AcceptedWarning, "rule" | "field" | "message">[];
}

export type LocalReportType = "TRANSACTION_REVIEW" | "QUARTERLY_FINANCIAL_ACTIVITY";

export interface QuarterlyReportPeriod {
  key: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  label: string;
  startDate: string;
  endDate: string;
}

export interface QuarterlyPeriodActivity {
  period: QuarterlyReportPeriod;
  acceptedTransactionCount: number;
  includedTransactionCount: number;
  warningCount: number;
  includedWarningCount: number;
  statisticalFlagCount: number;
  bankCredits: string;
  bankDebits: string;
  currency: string;
  monetaryBasis: MonetaryBasis;
  evidenceIds: {
    bankCredits: readonly string[];
    bankDebits: readonly string[];
  };
  netRecordedBankMovement: {
    status: "UNAVAILABLE";
    exactValue: null;
    reason: string;
  };
  openingBankBalance: {
    status: "UNAVAILABLE";
    exactValue: null;
    reason: string;
  };
  closingBankBalance: {
    status: "UNAVAILABLE";
    exactValue: null;
    reason: string;
  };
}

export interface QuarterlyActivityComparison {
  measure: "BANK_CREDITS" | "BANK_DEBITS" | "TRANSACTION_COUNT";
  label: string;
  currentExactValue: string;
  comparisonExactValue: string;
  absoluteChange: string;
  percentageChange: string | null;
  percentageUnavailableReason: string | null;
  currency: string | null;
}

export interface QuarterlyActivityMonth {
  period: string;
  label: string;
  bankCredits: string;
  bankDebits: string;
  transactionCount: number;
  warningCount: number;
  currency: string;
  monetaryBasis: MonetaryBasis;
  evidenceIds: {
    bankCredits: readonly string[];
    bankDebits: readonly string[];
  };
}

export type WorkbookSupplementStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export interface WorkbookMonthlySummaryRow {
  sourceRowNumber: number;
  period: string;
  openingBalance: string;
  totalCredits: string;
  totalDebits: string;
  closingBalance: string;
  transactionCount: number;
  labeledAnomalyCount: number;
  reconciliation: {
    credits: "MATCH" | "MISMATCH";
    debits: "MATCH" | "MISMATCH";
    transactionCount: "MATCH" | "MISMATCH";
  };
}

export interface WorkbookGroundTruthRow {
  sourceRowNumber: number;
  transactionId: string;
  sourceCategory: string;
  businessCategory: string;
  isAnomaly: boolean;
  anomalyType: string | null;
  reviewExpected: boolean;
}

export interface WorkbookTransactionScheduleRow {
  sourceRowNumber: number;
  transactionId: string;
  transactionDate: string;
  statementMonth: string;
  industry: string;
  accountNumber: string;
  currency: string;
  description: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  sourceCategory: string;
  businessCategory: string;
  bankFormat: string;
  counterparty: string;
  reference: string;
  runningBalance: string;
  generationMethod: string;
  groundTruth: {
    matched: boolean;
    sourceCategory: string | null;
    businessCategory: string | null;
    isAnomaly: boolean | null;
    anomalyType: string | null;
    reviewExpected: boolean | null;
  };
}

export interface WorkbookCategoryActivityRow {
  sourceCategory: string;
  businessCategory: string;
  transactionCount: number;
  creditCount: number;
  debitCount: number;
  creditAmount: string;
  debitAmount: string;
}

export interface QuarterlyWorkbookSupplements {
  version: "quarterly-workbook-supplements-0.1";
  fileSha256: string;
  authority: "SUPPLEMENTARY_WORKBOOK_CONTEXT_ONLY";
  usedForHeadlineCalculations: false;
  monthlySummary: {
    status: WorkbookSupplementStatus;
    sourceSheet: "Monthly Summary";
    reason: string | null;
    rows: readonly WorkbookMonthlySummaryRow[];
  };
  groundTruth: {
    status: WorkbookSupplementStatus;
    sourceSheet: "Ground Truth";
    reason: string | null;
    evaluationOnly: true;
    expectedTransactionCount: number;
    matchedTransactionCount: number;
    labeledAnomalyCount: number;
    reviewExpectedCount: number;
    anomalyTypes: readonly { label: string; count: number }[];
    /** Optional for browser snapshots created before detailed evaluation schedules were retained. */
    rows?: readonly WorkbookGroundTruthRow[];
  };
  categoryMapping: {
    status: WorkbookSupplementStatus;
    sourceSheet: "Category Mapping";
    reason: string | null;
    interpretationApproval: "UNAPPROVED_REFERENCE_ONLY";
    rows: readonly {
      sourceRowNumber: number;
      sourceCategory: string;
      businessCategory: string;
      generationWeight: string;
    }[];
  };
  methodology: {
    status: WorkbookSupplementStatus;
    sourceSheet: "Source & Methodology";
    reason: string | null;
    externallyVerified: false;
    entries: readonly { sourceRowNumber: number; item: string; details: string }[];
  };
  /** Optional for browser snapshots created before the full workbook appendix was retained. */
  readme?: {
    status: WorkbookSupplementStatus;
    sourceSheet: "README";
    reason: string | null;
    title: string | null;
    entries: readonly { sourceRowNumber: number; item: string; value: string; reference: string | null }[];
    businessCoverage: readonly {
      sourceRowNumber: number;
      businessName: string;
      transactionCount: number;
      labeledAnomalyCount: number;
    }[];
  };
  /** Raw-workbook schedule for the selected company and current quarter only. */
  transactionSchedule?: {
    status: WorkbookSupplementStatus;
    sourceSheet: "Transactions";
    reason: string | null;
    scope: "SELECTED_BUSINESS_CURRENT_QUARTER";
    expectedTransactionCount: number;
    matchedTransactionCount: number;
    rows: readonly WorkbookTransactionScheduleRow[];
  };
  /** Deterministic grouping of the supplementary transaction schedule; never an approved accounting view. */
  categoryActivity?: {
    status: WorkbookSupplementStatus;
    sourceSheet: "Transactions";
    reason: string | null;
    interpretationApproval: "UNAPPROVED_REFERENCE_ONLY";
    currency: string | null;
    rows: readonly WorkbookCategoryActivityRow[];
    bankFormats: readonly { label: string; count: number }[];
  };
}

export interface QuarterlyActivityReportData {
  business: {
    identifier: string;
    displayName: string;
    nameBasis: "REGISTERED_SYNTHETIC" | "REVIEWED_USER_INPUT";
    sourceField: "entity_id";
  };
  current: QuarterlyPeriodActivity;
  comparison: QuarterlyPeriodActivity | null;
  comparisons: readonly QuarterlyActivityComparison[];
  months: readonly QuarterlyActivityMonth[];
  evidenceWindow: ReportingPeriod;
  calculation: {
    functionId: "analytics.aggregateSourceRecords";
    version: string;
    warningPolicy: WarningPolicy;
    exactDecimalStrings: true;
  };
  categoryBreakdown: {
    status: "UNAVAILABLE";
    reason: string;
  };
  /** Optional because legacy browser snapshots predate supplementary workbook sections. */
  workbookSupplements?: QuarterlyWorkbookSupplements | null;
}

export interface LocalManagementReport {
  /** Missing on legacy browser snapshots and treated as TRANSACTION_REVIEW. */
  reportType?: LocalReportType;
  quarterlyActivity?: QuarterlyActivityReportData | null;
  reportId: string;
  status: "LOCAL_DRAFT_PREVIEW";
  organizationName: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  reportingPeriod: ReportingPeriod;
  dataset: {
    datasetId: string;
    sourceSystem: string;
    sourceFile: string;
    sourceSheet: string | null;
    fileSha256: string;
    ingestionBatchId: string;
    ingestedAt: string;
  };
  generation: {
    method: "MANUAL_TEMPLATE";
    templateVersion: typeof REPORT_TEMPLATE_VERSION;
    llmUsed: false;
  };
  currencyLabel: string;
  evidenceBundle: EvidenceBundle;
  metrics: readonly LocalReportMetric[];
  rejectedClaims: readonly GroundedClaim[];
  anomalies: readonly LocalReportAnomaly[];
  warnings: readonly LocalReportWarning[];
  unavailableMetrics: readonly {
    label: string;
    reason: string;
  }[];
  limitations: readonly string[];
  policyExceptions: EvidenceBundle["exceptions"];
  structuralPrecheck: "PASSED" | "REVIEW_REQUIRED";
  publicationAuthorized: false;
}

function reportPeriod(rows: readonly AcceptedTransaction[]): ReportingPeriod {
  const dates = rows.map(row => row.canonical_date).sort();
  if (!dates.length) throw new Error("A report requires at least one accepted record with a canonical date.");
  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    timezone: REPORT_TIMEZONE,
    dateBasis: "CANONICAL_DATE",
  };
}

function lineage(payload: AcceptedDataPayload, dataset: AcceptedDataset, row: AcceptedTransaction): SourceLineage {
  return {
    schemaVersion: payload.schema_version,
    rulesetVersion: payload.ruleset_version,
    datasetId: dataset.dataset_id,
    sourceSystem: dataset.source_system,
    sourceFile: dataset.source_file,
    sourceSheet: dataset.source_sheet,
    fileSha256: dataset.file_sha256,
    ingestionBatchId: dataset.ingestion_batch_id,
    ingestedAt: dataset.ingested_at,
    sourceRowId: row.source_row_id,
    sourceRowNumber: row.source_row_number,
  };
}

function evidenceWarnings(row: AcceptedTransaction): EvidenceWarning[] {
  return row.validation_messages.map(warning => ({
    rule: warning.rule,
    category: warning.category,
    field: warning.field,
    sourceColumn: warning.sourceColumn,
    originalValue: warning.originalValue,
    message: warning.message,
    sensitivity: "CONFIDENTIAL",
  }));
}

function sourceEvidenceId(datasetId: string, rowId: string, field: SourceField): string {
  return `source:${datasetId}:${rowId}:${field}`;
}

function createSourceEvidence(
  payload: AcceptedDataPayload,
  dataset: AcceptedDataset,
  row: AcceptedTransaction,
  field: SourceField,
): VerifiedSourceEvidence | null {
  const amount = row[field];
  if (amount === null) return null;
  const sourceComponent = field === "debit" ? "DEBIT" : field === "credit" ? "CREDIT" : "SOURCE_AMOUNT";
  return {
    evidenceId: sourceEvidenceId(dataset.dataset_id, row.source_row_id, field),
    evidenceClass: "VERIFIED_SOURCE_STRUCTURE",
    sourceField: field,
    value: {
      kind: "MONETARY",
      amount: exactDecimal(amount),
      currency: row.currency,
      currencyBasis: row.currency_basis,
      monetaryBasis: row.monetary_basis,
      sourceComponent,
    },
    period: {
      startDate: row.canonical_date,
      endDate: row.canonical_date,
      timezone: REPORT_TIMEZONE,
      dateBasis: "CANONICAL_DATE",
    },
    warnings: evidenceWarnings(row),
    sensitivity: "CONFIDENTIAL",
    lineage: lineage(payload, dataset, row),
    interpretation: {
      status: "UNAVAILABLE",
      reason: "A supplied source monetary field has no automatic revenue, expense, profit, or cash-flow meaning.",
      requiredForRequest: false,
    },
  };
}

function uniqueWarnings(rows: readonly AcceptedTransaction[]): EvidenceWarning[] {
  const warnings = rows.flatMap(evidenceWarnings);
  return warnings.filter((warning, index) => warnings.findIndex(candidate =>
    candidate.rule === warning.rule
    && candidate.field === warning.field
    && candidate.message === warning.message) === index);
}

function currencyBasis(rows: readonly AcceptedTransaction[]) {
  const bases = [...new Set(rows.map(row => row.currency_basis))];
  return bases.length === 1 ? bases[0] : null;
}

function aggregateEvidenceId(datasetId: string, period: string, currency: string, basis: string, field: SourceField): string {
  return `deterministic:${datasetId}:${period}:${currency}:${basis}:${field}`;
}

function createAggregateEvidence(
  payload: AcceptedDataPayload,
  dataset: AcceptedDataset,
  analysis: AcceptedAnalyticsRun,
  includedRows: readonly AcceptedTransaction[],
): DeterministicCalculationEvidence[] {
  return analysis.monthlyAggregates.flatMap(group => {
    const rows = includedRows.filter(row =>
      row.canonical_date.startsWith(`${group.period}-`)
      && (row.currency ?? "UNSPECIFIED") === group.currency
      && row.monetary_basis === group.monetary_basis);
    const period = reportPeriod(rows);

    return aggregateDefinitions.flatMap(definition => {
      const value = group[definition.aggregateField];
      if (value === null) return [];
      const inputEvidenceIds = rows
        .filter(row => row[definition.sourceField] !== null)
        .map(row => sourceEvidenceId(dataset.dataset_id, row.source_row_id, definition.sourceField));
      return [{
        evidenceId: aggregateEvidenceId(
          dataset.dataset_id,
          group.period,
          group.currency,
          group.monetary_basis,
          definition.sourceField,
        ),
        evidenceClass: "DETERMINISTIC_CALCULATION",
        value: {
          kind: "MONETARY",
          amount: exactDecimal(value),
          currency: group.currency === "UNSPECIFIED" ? null : group.currency,
          currencyBasis: currencyBasis(rows),
          monetaryBasis: group.monetary_basis,
          sourceComponent: "DERIVED_TOTAL",
        },
        period,
        warnings: uniqueWarnings(rows),
        sensitivity: "CONFIDENTIAL",
        derivation: {
          functionId: "analytics.aggregateSourceRecords",
          version: `${analysis.schema_version}/${analysis.ruleset_version}`,
          inputEvidenceIds,
        },
        lineage: rows.map(row => lineage(payload, dataset, row)),
        interpretation: {
          status: "UNAVAILABLE",
          reason: "This is a deterministic source-field total, not an approved financial-statement interpretation.",
          requiredForRequest: false,
        },
      } satisfies DeterministicCalculationEvidence];
    });
  });
}

function createQualityEvidence(
  payload: AcceptedDataPayload,
  dataset: AcceptedDataset,
  analysis: AcceptedAnalyticsRun,
  period: ReportingPeriod,
): DeterministicCalculationEvidence[] {
  const definitions = [
    { key: "accepted", value: dataset.summary.accepted, unit: "RECORDS" as const, functionId: "ingestion.createAcceptedDataPayload.quality" },
    { key: "included", value: analysis.prepared.counts.included, unit: "RECORDS" as const, functionId: "ingestion.createAcceptedDataPayload.quality" },
    { key: "warnings", value: dataset.summary.warning, unit: "WARNINGS" as const, functionId: "ingestion.createAcceptedDataPayload.quality" },
    { key: "rejected", value: dataset.summary.rejected, unit: "REJECTIONS" as const, functionId: "ingestion.createAcceptedDataPayload.quality" },
    { key: "statistical-flags", value: analysis.anomalies.length, unit: "OTHER" as const, functionId: "analytics.detectRobustAmountAnomalies.count" },
  ];
  return definitions.map(definition => ({
    evidenceId: `deterministic:${dataset.dataset_id}:quality:${definition.key}`,
    evidenceClass: "DETERMINISTIC_CALCULATION",
    value: { kind: "COUNT", value: definition.value, unit: definition.unit },
    period,
    warnings: [],
    sensitivity: "CONFIDENTIAL",
    derivation: {
      functionId: definition.functionId,
      version: `${payload.schema_version}/${payload.ruleset_version}`,
      inputEvidenceIds: [],
    },
    lineage: [],
    interpretation: { status: "NOT_APPLICABLE" },
  }));
}

function createAnomalyEvidence(
  payload: AcceptedDataPayload,
  dataset: AcceptedDataset,
  analysis: AcceptedAnalyticsRun,
  includedRows: readonly AcceptedTransaction[],
): DeterministicCalculationEvidence[] {
  return analysis.anomalies.flatMap(finding => {
    const row = includedRows.find(candidate => candidate.source_row_id === finding.source_row_id);
    if (!row) return [];
    const inputEvidenceIds = (["source_amount", "debit", "credit"] as const)
      .filter(field => row[field] !== null)
      .map(field => sourceEvidenceId(dataset.dataset_id, row.source_row_id, field));
    return [{
      evidenceId: `deterministic:${dataset.dataset_id}:statistical-amount-flag:${row.source_row_id}`,
      evidenceClass: "DETERMINISTIC_CALCULATION",
      value: { kind: "TEXT", value: "STATISTICAL_AMOUNT_REVIEW_FLAG" },
      period: {
        startDate: finding.canonical_date,
        endDate: finding.canonical_date,
        timezone: REPORT_TIMEZONE,
        dateBasis: "CANONICAL_DATE",
      },
      warnings: evidenceWarnings(row),
      sensitivity: "CONFIDENTIAL",
      derivation: {
        functionId: "analytics.detectRobustAmountAnomalies",
        version: `${analysis.schema_version}/${analysis.ruleset_version}`,
        inputEvidenceIds,
      },
      lineage: [lineage(payload, dataset, row)],
      interpretation: { status: "NOT_APPLICABLE" },
    } satisfies DeterministicCalculationEvidence];
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function metricLabel(item: DeterministicCalculationEvidence): string {
  const sourceField = item.derivation.inputEvidenceIds[0]?.split(":").at(-1);
  return aggregateDefinitions.find(definition => definition.sourceField === sourceField)?.label
    ?? "Deterministic source-value total";
}

function claimForMetric(
  item: DeterministicCalculationEvidence,
  rejectedCount: number,
): ClaimProposal {
  if (item.value.kind !== "MONETARY") throw new Error("Local report metrics must be monetary evidence.");
  const caveats: ClaimCaveatCode[] = ["INTERPRETATION_LIMITATION"];
  if (item.warnings.length > 0) caveats.push("WARNING_EVIDENCE");
  if (item.value.currency === null) caveats.push("CURRENCY_LIMITATION");
  if (rejectedCount > 0) caveats.push("REJECTED_COUNT");
  const currency = item.value.currency ?? "currency unspecified";
  const proposal: ClaimProposal = {
    claimId: `claim:${item.evidenceId}`,
    sectionId: "supported-source-values",
    text: `${metricLabel(item)} for ${item.period.startDate.slice(0, 7)} is ${currency} ${item.value.amount}. This source-value total has no automatic revenue, expense, profit, or cash-flow meaning.`,
    kind: "DETERMINISTIC_RESULT",
    evidenceIds: [item.evidenceId],
    valueAssertions: [{
      evidenceId: item.evidenceId,
      exactValue: item.value.amount,
      currency: item.value.currency,
      monetaryBasis: item.value.monetaryBasis,
    }],
    financialMeaning: null,
    caveatCodes: caveats,
  };
  return proposal;
}

function currencyLabel(bundle: EvidenceBundle): string {
  if (bundle.currencyScope.hasMissingCurrency) {
    return bundle.currencyScope.currencies.length
      ? `${bundle.currencyScope.currencies.join(", ")} + unspecified`
      : "Unspecified";
  }
  if (bundle.currencyScope.status === "MIXED") return `Mixed — ${bundle.currencyScope.currencies.join(", ")}`;
  return bundle.currencyScope.currencies[0] ?? "No monetary evidence";
}

export async function createLocalManagementReport(input: {
  payload: AcceptedDataPayload;
  analysis: AcceptedAnalyticsRun;
  warningPolicy: WarningPolicy;
  organizationName: string;
  generatedAt?: string;
}): Promise<LocalManagementReport> {
  if (input.payload.datasets.length !== 1) {
    throw new Error("The local report requires one explicitly selected accepted dataset.");
  }
  const dataset = input.payload.datasets[0];
  if (!dataset.normalized.length) throw new Error("The selected dataset has no accepted records to report.");
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const snapshotSha256 = await sha256(JSON.stringify({
    schema_version: input.payload.schema_version,
    ruleset_version: input.payload.ruleset_version,
    dataset,
  }));
  const includedRows = input.warningPolicy === "include"
    ? dataset.normalized
    : dataset.normalized.filter(row => row.ingestion_status === "VALID");
  const sourceItems = includedRows.flatMap(row =>
    (["source_amount", "debit", "credit"] as const).flatMap(field => {
      const item = createSourceEvidence(input.payload, dataset, row, field);
      return item ? [item] : [];
    }));
  const aggregateItems = createAggregateEvidence(input.payload, dataset, input.analysis, includedRows);
  const period = reportPeriod(dataset.normalized);
  const qualityItems = createQualityEvidence(input.payload, dataset, input.analysis, period);
  const anomalyItems = createAnomalyEvidence(input.payload, dataset, input.analysis, includedRows);
  const items: EvidenceItem[] = [...sourceItems, ...aggregateItems, ...qualityItems, ...anomalyItems];
  const baseBundle: EvidenceBundle = {
    bundleVersion: EVIDENCE_BUNDLE_VERSION,
    contractVersion: AI_REPORTING_CONTRACT_VERSION,
    bundleId: `local-report:${dataset.dataset_id}:${dataset.ingestion_batch_id}`,
    snapshot: {
      snapshotId: `local-c1:${dataset.ingestion_batch_id}:${snapshotSha256.slice(0, 12)}`,
      snapshotSha256,
      schemaVersion: input.payload.schema_version,
      rulesetVersion: input.payload.ruleset_version,
      datasetIds: [dataset.dataset_id],
      ingestionBatchIds: [dataset.ingestion_batch_id],
      createdAt: generatedAt,
    },
    period,
    warningPolicy: input.warningPolicy === "exclude" ? "EXCLUDE" : "INCLUDE_WITH_CAVEATS",
    currencyScope: deriveCurrencyScope(items),
    quality: {
      acceptedCount: dataset.summary.accepted,
      validCount: dataset.summary.valid,
      warningCount: dataset.summary.warning,
      includedWarningCount: input.warningPolicy === "include" ? input.analysis.prepared.counts.warning : 0,
      excludedWarningCount: input.warningPolicy === "exclude" ? input.analysis.prepared.counts.warning : 0,
      rejectedCount: dataset.summary.rejected,
      rejectedRecordsInEvidence: 0,
    },
    sensitivity: "CONFIDENTIAL",
    items,
    exceptions: [],
  };
  const decision = evaluateEvidenceBundle(baseBundle);
  const evidenceBundle: EvidenceBundle = { ...baseBundle, exceptions: decision.exceptions };
  const groundedClaims = aggregateItems.map(item =>
    groundClaim(claimForMetric(item, dataset.summary.rejected), evidenceBundle));
  const supportedClaims = groundedClaims.filter(claim => claim.support.status !== "UNSUPPORTED");
  const rejectedClaims = groundedClaims.filter(claim => claim.support.status === "UNSUPPORTED");
  const metrics = aggregateItems.flatMap(item => {
    if (item.value.kind !== "MONETARY") return [];
    const claim = supportedClaims.find(candidate => candidate.evidenceIds.includes(item.evidenceId));
    if (!claim) return [];
    return [{
      metricId: item.evidenceId,
      label: metricLabel(item),
      period: item.period.startDate.slice(0, 7),
      exactValue: item.value.amount,
      currency: item.value.currency,
      monetaryBasis: item.value.monetaryBasis,
      evidenceId: item.evidenceId,
      claim,
    } satisfies LocalReportMetric];
  });

  return {
    reportType: "TRANSACTION_REVIEW",
    quarterlyActivity: null,
    reportId: `local-draft:${dataset.dataset_id}:${dataset.ingestion_batch_id}:${generatedAt}`,
    status: "LOCAL_DRAFT_PREVIEW",
    organizationName: input.organizationName,
    title: "Management Financial Data Review",
    subtitle: `Source-value results and data-quality review for ${formatReportPeriod(period.startDate, period.endDate)}.`,
    generatedAt,
    reportingPeriod: baseBundle.period,
    dataset: {
      datasetId: dataset.dataset_id,
      sourceSystem: dataset.source_system,
      sourceFile: dataset.source_file,
      sourceSheet: dataset.source_sheet,
      fileSha256: dataset.file_sha256,
      ingestionBatchId: dataset.ingestion_batch_id,
      ingestedAt: dataset.ingested_at,
    },
    generation: {
      method: "MANUAL_TEMPLATE",
      templateVersion: REPORT_TEMPLATE_VERSION,
      llmUsed: false,
    },
    currencyLabel: currencyLabel(evidenceBundle),
    evidenceBundle,
    metrics,
    rejectedClaims,
    anomalies: input.analysis.anomalies.map(finding => {
      const row = dataset.normalized.find(candidate => candidate.source_row_id === finding.source_row_id);
      return {
        ...finding,
        description: row?.description ?? null,
        reference: row?.reference ?? null,
      };
    }),
    warnings: dataset.normalized
      .filter(row => row.ingestion_status === "WARNING")
      .map(row => ({
        sourceRowId: row.source_row_id,
        sourceRowNumber: row.source_row_number,
        canonicalDate: row.canonical_date,
        description: row.description,
        reference: row.reference,
        messages: row.validation_messages.map(warning => warning.message),
        issues: row.validation_messages.map(warning => ({
          rule: warning.rule,
          field: warning.field,
          message: warning.message,
        })),
      })),
    unavailableMetrics: [
      { label: "Revenue", reason: "No client-approved revenue interpretation is associated with this dataset." },
      { label: "Expenses", reason: "No client-approved expense interpretation is associated with this dataset." },
      { label: "Profit", reason: "Revenue and expense interpretations are unavailable; profit must not be inferred." },
      { label: "Cash flow", reason: "Source signs and Debit/Credit labels do not establish universal cash-flow meaning." },
      { label: "Budget variance", reason: "No approved budget source is connected to the selected dataset." },
      { label: "Reconciliation", reason: "Ingestion acceptance does not establish reconciliation status." },
    ],
    limitations: [
      "Checked input remains in the browser-memory session and is cleared by refresh. For a registered synthetic demonstration source only, the generated report snapshot may be retained in this browser's IndexedDB for 90 days.",
      "This report body uses a fixed manual template; an optional AI explanation is a separate, review-required artifact.",
      "Structural grounding checks cited IDs, exact values, currency and monetary basis; it does not prove arbitrary narrative entailment.",
      "Rejected row contents are excluded from report evidence; only their count is disclosed.",
      "No trusted server persistence, authentication, reviewer authorization, immutable approved-artifact workflow or publication approval is implemented.",
      "Source-value aggregates are not revenue, expenses, profit or cash flow without separately approved interpretation evidence.",
    ],
    policyExceptions: decision.exceptions,
    structuralPrecheck: decision.publishable && rejectedClaims.length === 0 && metrics.length > 0
      ? "PASSED"
      : "REVIEW_REQUIRED",
    publicationAuthorized: false,
  };
}

function escapeHtml(value: string | number | null): string {
  return String(value ?? "Not supplied")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlList(items: readonly string[]): string {
  return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function summarizeManagementReport(report: LocalManagementReport): string {
  return createManagementReportPresentation(report).overviewSummary;
}

/** Self-contained downloadable HTML using deterministic report data and, when supplied, an already-validated AI draft. */
export function renderLocalManagementReportHtml(
  report: LocalManagementReport,
  explanation: ValidatedFinancialExplanation | null = null,
): string {
  if (report.reportType === "QUARTERLY_FINANCIAL_ACTIVITY" && report.quarterlyActivity) {
    return renderQuarterlyFinancialActivityHtml(report, explanation);
  }
  const presentation = createManagementReportPresentation(report);
  const findings = presentation.findings.map(finding => `<li><strong>${escapeHtml(finding.title)}.</strong> ${escapeHtml(finding.detail)}</li>`).join("");
  const attentionItems = presentation.attentionItems.map(item => {
    const sourceDetails = [
      item.sourceRowNumber === null ? null : `Source row ${item.sourceRowNumber}`,
      item.date ? formatReportDate(item.date) : null,
      item.reference ? `Reference: ${item.reference}` : null,
    ].filter(Boolean).map(value => escapeHtml(value)).join(" | ");
    const kind = item.kind === "STATISTICAL_FLAG"
      ? "Amount review"
      : item.kind === "STATISTICAL_FLAG_SUMMARY"
        ? "Review-list boundary"
        : item.kind === "WARNING_RECORD"
          ? "Source information"
          : "Excluded records";
    return `<article class="attention-item"><div class="attention-head"><h3>${escapeHtml(item.title)}</h3><span>${kind}</span></div>${sourceDetails ? `<p class="source-details">${sourceDetails}</p>` : ""}${item.description ? `<p><strong>Description:</strong> ${escapeHtml(item.description)}</p>` : ""}<p>${escapeHtml(item.summary)}</p><p><strong>Why it matters:</strong> ${escapeHtml(item.whyItMatters)}</p><p><strong>Suggested action:</strong> ${escapeHtml(item.suggestedAction)}</p></article>`;
  }).join("");
  const visibleFigureColumns = [
    { label: "Supplied amount", key: "sourceAmountTotal" as const },
    { label: "Supplied debit", key: "debitTotal" as const },
    { label: "Supplied credit", key: "creditTotal" as const },
  ].filter(column => presentation.figureRows.some(row => row[column.key] !== null));
  const figureHeadings = visibleFigureColumns.map(column => `<th scope="col">${escapeHtml(column.label)}</th>`).join("");
  const figureRows = presentation.figureRows.map(row => `<tr><th scope="row">${escapeHtml(formatReportMonth(row.period))}</th><td>${escapeHtml(row.currency ?? "Not specified")}</td>${visibleFigureColumns.map(column => {
    const value = row[column.key];
    return `<td>${value === null ? "-" : escapeHtml(formatReportMoney(row.currency, value))}</td>`;
  }).join("")}</tr>`).join("");
  const comparisonRows = presentation.periodComparisons.map(item => `<tr><th scope="row">${escapeHtml(item.label)}</th><td><strong>${escapeHtml(formatReportMoney(item.currency, item.currentExactValue))}</strong><small>${escapeHtml(formatReportMonth(item.currentPeriod))}</small></td><td><strong>${escapeHtml(formatReportMoney(item.currency, item.priorExactValue))}</strong><small>${escapeHtml(formatReportMonth(item.priorPeriod))}</small></td></tr>`).join("");
  const qualityRows = presentation.qualityCards.map(card => `<tr><th scope="row">${escapeHtml(card.label)}</th><td>${card.value}</td><td>${escapeHtml(card.note)}</td></tr>`).join("");
  const references = report.metrics.map(metric => `<li><code>${escapeHtml(metric.claim.claimId)}</code><br><span>Evidence: <code>${escapeHtml(metric.evidenceId)}</code></span></li>`).join("");
  const warningReferences = report.warnings.map(warning => `<li>Source row ${warning.sourceRowNumber}: <code>${escapeHtml(warning.sourceRowId)}</code></li>`).join("");
  const anomalyAuditRows = report.anomalies.slice(0, 50).map(finding => `<li>${escapeHtml(finding.source_file)} · source row ${finding.source_row_number} · robust score ${escapeHtml(finding.robustScore)} · ${escapeHtml(finding.reason)}</li>`);
  if (report.anomalies.length > anomalyAuditRows.length) {
    anomalyAuditRows.push(`<li>${report.anomalies.length - anomalyAuditRows.length} additional statistical flags are retained in the deterministic report snapshot and are not expanded in this HTML view.</li>`);
  }
  const anomalyAudit = anomalyAuditRows.join("");
  const exceptions = report.policyExceptions.length
    ? report.policyExceptions.map(exception => `<li><strong>${escapeHtml(exception.code)}</strong>: ${escapeHtml(exception.message)}</li>`).join("")
    : "<li>No bundle exception was detected by the AI-01 structural policy.</li>";
  const metadataRows = [
    ["Reporting period", formatReportPeriod(report.reportingPeriod.startDate, report.reportingPeriod.endDate)],
    ["Source file", `${report.dataset.sourceFile} (${report.dataset.sourceSheet ?? "CSV"})`],
    ["Currency scope", report.currencyLabel],
    ["Records reviewed", `${presentation.checkedCount} checked; ${presentation.includedCount} included`],
    ["Report status", "Draft - not approved"],
    ["Generation method", "Deterministic calculations and manual template"],
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  const aiExplanationSection = explanation ? renderFinancialExplanationHtml(explanation) : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.title)} - Draft</title><style>
@page{size:A4;margin:18mm 17mm}*{box-sizing:border-box}html{background:#e5e7eb}body{margin:0;color:#111827;font:12px/1.55 Arial,Helvetica,sans-serif}.page{width:210mm;min-height:297mm;margin:24px auto;background:#fff;box-shadow:0 16px 45px #0f172a24}.document-header,.document-body,.document-footer{padding-left:17mm;padding-right:17mm}.document-header{padding-top:18mm;padding-bottom:10mm}.release-line{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #111;padding-bottom:5px;font-size:9px}.release-line strong{text-transform:uppercase;letter-spacing:.08em}.title-block{max-width:170mm;margin:0 auto;padding:28px 0;text-align:center}.organization{margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.title-block h1{margin:20px 0 0;font-size:23px;line-height:1.25;text-transform:uppercase}.subtitle{max-width:145mm;margin:13px auto 0;font-size:12px;font-style:italic}.period{margin:15px 0 0;font-weight:700}.currency{margin:4px 0 0;font-size:9px}.status{border-top:2px solid #111;border-bottom:2px solid #111;padding:6px;text-align:center;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.document-body{padding-bottom:14mm}.intro{margin:0;text-align:justify;font-size:12px;line-height:1.75}.section{margin-top:25px}.section h2{margin:0 0 10px;border-bottom:1px solid #111;padding-bottom:3px;font-size:13px;text-decoration:underline;text-underline-offset:3px}.section h3{margin:15px 0 5px;font-size:11px}.section p{margin:6px 0}.section ul,.section ol{margin:7px 0;padding-left:19px}.section li{margin:4px 0}.note{font-size:9px;line-height:1.6}.meta{margin:0}.meta div{display:grid;grid-template-columns:42mm 1fr;gap:8px;border-bottom:1px dotted #6b7280;padding:5px 0}.meta dt{font-weight:700}.meta dd{margin:0;text-align:right}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin:10px 0;font-size:9px}thead tr{border-top:2px solid #111;border-bottom:2px solid #111}tbody tr{border-bottom:1px solid #d1d5db}th,td{padding:6px 7px;text-align:right;vertical-align:top}th:first-child,td:first-child{text-align:left}tbody th{font-weight:400}td small{display:block;color:#4b5563}.comparison-table td strong{font-size:10px}.attention-item{border-bottom:1px solid #d1d5db;padding:10px 0}.attention-item:first-of-type{padding-top:0}.attention-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.attention-head h3{margin:0;font-size:11px}.attention-head span{font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4b5563}.source-details{font-size:8px;color:#4b5563}.interpretation-note{border-top:1px solid #111;padding-top:6px;font-size:9px}.quality-table td:nth-child(2){font-weight:700}${FINANCIAL_EXPLANATION_HTML_CSS}.technical{margin-top:27px;border-top:1px solid #111;border-bottom:1px solid #111;padding:8px 0;font-size:9px}.technical summary{cursor:pointer;font-size:10px;font-weight:700;text-decoration:underline;text-underline-offset:3px}.technical h3{margin:15px 0 4px;font-size:10px}.technical code{overflow-wrap:anywhere;font-size:8px}.document-footer{display:flex;justify-content:space-between;gap:10px;border-top:1px solid #111;padding-top:6px;padding-bottom:10mm;color:#4b5563;font-size:8px;letter-spacing:.05em;text-transform:uppercase}@media(max-width:850px){.page{width:auto;min-height:0;margin:0}.document-header,.document-body,.document-footer{padding-left:24px;padding-right:24px}.document-header{padding-top:32px}.meta div{grid-template-columns:1fr}.meta dd{text-align:left}.attention-head,.document-footer{display:block}.table-wrap{margin-left:-12px;margin-right:-12px}.table-wrap table{min-width:620px}}@media print{html,body{background:#fff}.page{width:auto;min-height:0;margin:0;box-shadow:none}.document-header,.document-body,.document-footer{padding-left:0;padding-right:0}.document-header{padding-top:0}.document-footer{padding-bottom:0}details>*{display:block!important}details summary{margin-bottom:10px}.page-break{break-before:page}.attention-item,tr{break-inside:avoid}}
</style></head><body><article class="page">
<header class="document-header"><div class="release-line"><strong>For internal review</strong><span>Generated ${escapeHtml(formatReportTimestamp(report.generatedAt, report.reportingPeriod.timezone))}</span></div><div class="title-block"><p class="organization">${escapeHtml(report.organizationName)}</p><h1>${escapeHtml(report.title)}</h1><p class="subtitle">${escapeHtml(report.subtitle)}</p><p class="period">${escapeHtml(presentation.reportingPeriodLabel)}</p><p class="currency">Currency scope: ${escapeHtml(report.currencyLabel)}</p></div><div class="status">Draft - not approved</div></header>
<main class="document-body"><p class="intro">${escapeHtml(summarizeManagementReport(report))}</p>
<section class="section"><h2>Selected Period Highlights</h2><ul>${findings}</ul></section>
${aiExplanationSection}
<section class="section"><h2>Summary of Selected Source-Value Results</h2><p class="note">The amounts below are exact totals of monetary fields supplied in the uploaded file. They describe source fields only and are not automatically income, expenses, profit, or cash flow.</p>${comparisonRows ? `<div class="table-wrap"><table class="comparison-table"><thead><tr><th scope="col">Source measure</th><th scope="col">Latest reported month</th><th scope="col">Previous reported month</th></tr></thead><tbody>${comparisonRows}</tbody></table></div>` : "<p class=\"note\">A prior comparable month is not available for this selected dataset.</p>"}</section>
<section class="section"><h2>Report Basis and Scope</h2><dl class="meta">${metadataRows}</dl></section>
<section class="section"><h2>Items Requiring Review</h2>${attentionItems || "<p class=\"note\">No specific warning, rejected-record, or statistical-flag action is currently listed. Normal source review and approval controls still apply.</p>"}</section>
<section class="section"><h2>Detailed Monthly Source Values</h2><div class="table-wrap"><table><thead><tr><th scope="col">Month</th><th scope="col">Currency</th>${figureHeadings}</tr></thead><tbody>${figureRows || `<tr><td colspan="${2 + visibleFigureColumns.length}">No supported monetary figures are available.</td></tr>`}</tbody></table></div><p class="interpretation-note"><strong>Interpretation note.</strong> Debit and credit are preserved source labels, not universal descriptions of money spent or received. Revenue, expenses, profit, and cash flow require approved accounting interpretation.</p></section>
<section class="section"><h2>Data Quality</h2><div class="table-wrap"><table class="quality-table"><thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Meaning</th></tr></thead><tbody>${qualityRows}</tbody></table></div><p class="note">Warnings identify accepted records needing source information checked; rejections identify excluded records; statistical flags identify unusual amounts among included records.</p></section>
<section class="section"><h2>Management Review and Next Steps</h2><p>${escapeHtml(presentation.managementConclusion)}</p><ol>${presentation.nextSteps.map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol></section>
<section class="section"><h2>Report Limitations</h2>${htmlList(presentation.plainLimitations)}<p class="note"><strong>Not calculated:</strong> ${escapeHtml(report.unavailableMetrics.map(item => item.label).join(", "))}.</p><p class="note">Any optional AI explanation is separate, review-required, and cannot authorize publication.</p></section>
<details class="technical page-break"><summary>Technical Details and Audit Information</summary><div><h3>Source and report controls</h3><ul><li>Source system: ${escapeHtml(report.dataset.sourceSystem)}</li><li>Worksheet: ${escapeHtml(report.dataset.sourceSheet ?? "CSV")}</li><li>Producer batch: <code>${escapeHtml(report.dataset.ingestionBatchId)}</code></li><li>Source file SHA-256: <code>${escapeHtml(report.dataset.fileSha256)}</code></li><li>Evidence bundle: <code>${escapeHtml(report.evidenceBundle.bundleId)}</code></li><li>Snapshot: <code>${escapeHtml(report.evidenceBundle.snapshot.snapshotId)}</code></li><li>Structural precheck: ${escapeHtml(report.structuralPrecheck)}</li><li>Warning policy: ${escapeHtml(report.evidenceBundle.warningPolicy)}</li><li>Rejected contents included in evidence: ${report.evidenceBundle.quality.rejectedRecordsInEvidence}</li><li>Generation method: ${escapeHtml(report.generation.method)}; LLM used: ${String(report.generation.llmUsed)}</li><li>Publication authorized: ${String(report.publicationAuthorized)}</li></ul><h3>Policy exceptions</h3><ul>${exceptions}</ul><h3>Grounded claim references</h3><ul>${references || "<li>No supported claim references.</li>"}</ul>${warningReferences ? `<h3>Warning row references</h3><ul>${warningReferences}</ul>` : ""}${anomalyAudit ? `<h3>Statistical audit values</h3><ul>${anomalyAudit}</ul>` : ""}<h3>Unavailable financial interpretations</h3>${htmlList(report.unavailableMetrics.map(item => `${item.label}: ${item.reason}`))}<h3>Complete implementation limitations</h3>${htmlList(report.limitations)}</div></details>
</main><footer class="document-footer"><span>FinGence Finance Intelligence</span><span>Report ID: ${escapeHtml(report.reportId)}</span><span>Draft - not approved</span></footer>
</article></body></html>`;
}
