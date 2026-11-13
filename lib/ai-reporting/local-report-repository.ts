import { z } from "zod";
import { createFinancialExplanationRequest } from "./financial-explanation-input";
import type { ValidatedFinancialExplanation } from "./financial-explanation-validation";
import type { LocalManagementReport } from "./local-management-report";
import { createManagementReportPresentation } from "./report-presentation";

export const LOCAL_REPORT_STORAGE_VERSION = "local-synthetic-report-1" as const;
export const LOCAL_REPORT_STORAGE_KIND = "BROWSER_INDEXED_DB_SYNTHETIC_ONLY" as const;
export const LOCAL_REPORT_DATABASE_NAME = "fingence-ai-reporting-local-v1";
export const LOCAL_REPORT_OBJECT_STORE = "reports";
export const LOCAL_REPORT_RETENTION_DAYS = 90;

const MAX_STORED_REPORT_CHARACTERS = 16_000_000;
const MAX_STORED_EXPLANATION_CHARACTERS = 5_000_000;
const exactDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

/** Published synthetic sample hashes shared by the local Data/Reports demonstration. */
export const REGISTERED_SYNTHETIC_REPORT_HASHES = new Set([
  "da31e6f437ddff7cfb3a029db21caa56320bd1c6162c5701503f60687ba9ef3e", // Data: Rimba Demo Kitchen bank statement
  "48668a7eb1fca288f8c853aee5a7b6d2ebcf9076e7cd7ba95a6d7f0df386a5fc", // Data: Straits Demo Bakery Q1 bank statement
  "42e0789e996c5b4af3653d39128f6c91190faefa7708f1c1ec5d8bfc54fb14d9", // ledger.csv
  "8a4d11c7b5850dc99c1392ec1bd941cf4fa04fac2b61f621dffb35a0226896cf", // bank_statement.xlsx
  "6224c108304ab11e0919919e2454492e8d3dbad9448771e5088d310a3736ccfd", // edge_cases.csv
  "f10edefcf4f09a7695125ff1d727e2501ebb22f7283d441d0ed8a22336173d3a", // realistic_company_ledger.csv
  "13c0d038845941abb8e974bc55832f0b1f157bac343c4f4ab5189ba0b0a30bfb", // optional supplied synthetic Datasets.xlsx; bytes remain outside Git
]);

const envelopeSchema = z.strictObject({
  storageVersion: z.literal(LOCAL_REPORT_STORAGE_VERSION),
  storageKind: z.literal(LOCAL_REPORT_STORAGE_KIND),
  reportId: z.string().min(1).max(500),
  sourceKey: z.string().min(1).max(500),
  savedAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
  expiresAt: z.string().min(1).max(64),
  report: z.unknown(),
  aiExplanation: z.unknown().nullable(),
});

export type LocalReportLoadIssueCode =
  | "CORRUPT_ENTRY"
  | "INCOMPATIBLE_VERSION"
  | "EXPIRED_ENTRY"
  | "AI_EXPLANATION_DISCARDED";

export interface LocalReportLoadIssue {
  code: LocalReportLoadIssueCode;
  reportId: string | null;
}

export interface SavedLocalReport {
  storageVersion: typeof LOCAL_REPORT_STORAGE_VERSION;
  storageKind: typeof LOCAL_REPORT_STORAGE_KIND;
  reportId: string;
  sourceKey: string;
  savedAt: string;
  updatedAt: string;
  expiresAt: string;
  report: LocalManagementReport;
  aiExplanation: ValidatedFinancialExplanation | null;
}

export interface LocalReportListResult {
  reports: readonly SavedLocalReport[];
  issues: readonly LocalReportLoadIssue[];
}

export interface LocalReportStorageDriver {
  readAll(): Promise<readonly unknown[]>;
  read(reportId: string): Promise<unknown | undefined>;
  write(value: SavedLocalReport): Promise<void>;
  remove(reportId: string): Promise<void>;
}

export interface LocalReportRepository {
  listReports(): Promise<LocalReportListResult>;
  saveReport(report: LocalManagementReport): Promise<SavedLocalReport>;
  saveExplanation(reportId: string, explanation: ValidatedFinancialExplanation): Promise<SavedLocalReport>;
  deleteReport(reportId: string): Promise<void>;
}

export class LocalReportRepositoryError extends Error {
  constructor(
    readonly code:
      | "STORAGE_UNAVAILABLE"
      | "UNREGISTERED_SYNTHETIC_REQUIRED"
      | "INVALID_REPORT"
      | "INVALID_EXPLANATION"
      | "REPORT_NOT_FOUND"
      | "IMMUTABLE_REPORT_CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isReportingPeriod(value: unknown): boolean {
  return isRecord(value)
    && isString(value.startDate)
    && isString(value.endDate)
    && isString(value.timezone)
    && ["TRANSACTION_DATE", "POSTING_DATE", "CANONICAL_DATE"].includes(String(value.dateBasis));
}

function isReportException(value: unknown): boolean {
  return isRecord(value)
    && isString(value.exceptionId)
    && isString(value.code)
    && ["INFO", "WARNING", "BLOCKING"].includes(String(value.severity))
    && typeof value.blocksPublication === "boolean"
    && isString(value.message)
    && isString(value.resolution)
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every(isString);
}

function isGroundedClaim(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.support)) return false;
  return isString(value.claimId)
    && isString(value.sectionId)
    && isString(value.text)
    && isString(value.kind)
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every(isString)
    && Array.isArray(value.valueAssertions)
    && value.valueAssertions.every(assertion => isRecord(assertion)
      && isString(assertion.evidenceId)
      && typeof assertion.exactValue === "string"
      && exactDecimalPattern.test(assertion.exactValue)
      && isNullableString(assertion.currency))
    && Array.isArray(value.caveatCodes)
    && value.caveatCodes.every(isString)
    && value.support.assurance === "STRUCTURAL_ONLY"
    && ["SUPPORTED", "SUPPORTED_WITH_CAVEAT", "UNSUPPORTED"].includes(String(value.support.status))
    && isString(value.support.policyVersion)
    && Array.isArray(value.support.requiredCaveats)
    && value.support.requiredCaveats.every(isString)
    && Array.isArray(value.support.exceptions)
    && value.support.exceptions.every(isReportException);
}

function isReportMetric(value: unknown): boolean {
  return isRecord(value)
    && isString(value.metricId)
    && isString(value.label)
    && isString(value.period)
    && typeof value.exactValue === "string"
    && exactDecimalPattern.test(value.exactValue)
    && isNullableString(value.currency)
    && isString(value.monetaryBasis)
    && isString(value.evidenceId)
    && isGroundedClaim(value.claim);
}

function isReportWarning(value: unknown): boolean {
  return isRecord(value)
    && isString(value.sourceRowId)
    && isNonnegativeInteger(value.sourceRowNumber)
    && isString(value.canonicalDate)
    && isNullableString(value.description)
    && isNullableString(value.reference)
    && Array.isArray(value.messages)
    && value.messages.every(isString)
    && Array.isArray(value.issues)
    && value.issues.every(issue => isRecord(issue) && isString(issue.rule) && isString(issue.field) && isString(issue.message));
}

function isReportAnomaly(value: unknown): boolean {
  return isRecord(value)
    && isString(value.source_row_id)
    && isNonnegativeInteger(value.source_row_number)
    && isString(value.source_file)
    && isString(value.canonical_date)
    && isString(value.currency)
    && typeof value.magnitude === "string"
    && exactDecimalPattern.test(value.magnitude)
    && typeof value.robustScore === "number"
    && Number.isFinite(value.robustScore)
    && isString(value.reason)
    && isNullableString(value.description)
    && isNullableString(value.reference);
}

function isEvidenceQuality(value: unknown): boolean {
  return isRecord(value)
    && ["acceptedCount", "validCount", "warningCount", "includedWarningCount", "excludedWarningCount", "rejectedCount", "rejectedRecordsInEvidence"]
      .every(key => isNonnegativeInteger(value[key]))
    && value.rejectedRecordsInEvidence === 0;
}

function isQuarterlyPeriod(value: unknown): boolean {
  return isRecord(value)
    && isString(value.key)
    && Number.isInteger(value.year)
    && [1, 2, 3, 4].includes(Number(value.quarter))
    && isString(value.label)
    && isString(value.startDate)
    && isString(value.endDate);
}

function isUnavailableQuarterlyValue(value: unknown): boolean {
  return isRecord(value)
    && value.status === "UNAVAILABLE"
    && value.exactValue === null
    && isString(value.reason);
}

function isQuarterlyEvidenceIds(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.bankCredits)
    && value.bankCredits.every(isString)
    && Array.isArray(value.bankDebits)
    && value.bankDebits.every(isString);
}

function isQuarterlyPeriodActivity(value: unknown): boolean {
  return isRecord(value)
    && isQuarterlyPeriod(value.period)
    && ["acceptedTransactionCount", "includedTransactionCount", "warningCount", "includedWarningCount", "statisticalFlagCount"]
      .every(key => isNonnegativeInteger(value[key]))
    && typeof value.bankCredits === "string"
    && exactDecimalPattern.test(value.bankCredits)
    && typeof value.bankDebits === "string"
    && exactDecimalPattern.test(value.bankDebits)
    && isString(value.currency)
    && ["source_signed_amount", "source_amount_with_direction", "debit_credit", "approved_interpretation"].includes(String(value.monetaryBasis))
    && isQuarterlyEvidenceIds(value.evidenceIds)
    && isUnavailableQuarterlyValue(value.netRecordedBankMovement)
    && isUnavailableQuarterlyValue(value.openingBankBalance)
    && isUnavailableQuarterlyValue(value.closingBankBalance);
}

function isSupplementStatus(value: unknown): boolean {
  return ["AVAILABLE", "PARTIAL", "UNAVAILABLE"].includes(String(value));
}

function isWorkbookGroundTruthRow(value: unknown): boolean {
  return isRecord(value)
    && isNonnegativeInteger(value.sourceRowNumber)
    && isString(value.transactionId)
    && isString(value.sourceCategory)
    && isString(value.businessCategory)
    && typeof value.isAnomaly === "boolean"
    && isNullableString(value.anomalyType)
    && typeof value.reviewExpected === "boolean";
}

function isWorkbookTransactionScheduleRow(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.groundTruth)) return false;
  return isNonnegativeInteger(value.sourceRowNumber)
    && ["transactionId", "transactionDate", "statementMonth", "industry", "accountNumber", "currency", "description",
      "sourceCategory", "businessCategory", "bankFormat", "counterparty", "reference", "generationMethod"]
      .every(key => isString(value[key]))
    && ["DEBIT", "CREDIT"].includes(String(value.direction))
    && typeof value.amount === "string" && exactDecimalPattern.test(value.amount)
    && typeof value.runningBalance === "string" && exactDecimalPattern.test(value.runningBalance)
    && typeof value.groundTruth.matched === "boolean"
    && isNullableString(value.groundTruth.sourceCategory)
    && isNullableString(value.groundTruth.businessCategory)
    && (value.groundTruth.isAnomaly === null || typeof value.groundTruth.isAnomaly === "boolean")
    && isNullableString(value.groundTruth.anomalyType)
    && (value.groundTruth.reviewExpected === null || typeof value.groundTruth.reviewExpected === "boolean");
}

function isWorkbookReadme(value: unknown): boolean {
  return isRecord(value)
    && isSupplementStatus(value.status)
    && value.sourceSheet === "README"
    && isNullableString(value.reason)
    && isNullableString(value.title)
    && Array.isArray(value.entries)
    && value.entries.every(entry => isRecord(entry)
      && isNonnegativeInteger(entry.sourceRowNumber)
      && isString(entry.item)
      && isString(entry.value)
      && isNullableString(entry.reference))
    && Array.isArray(value.businessCoverage)
    && value.businessCoverage.every(row => isRecord(row)
      && isNonnegativeInteger(row.sourceRowNumber)
      && isString(row.businessName)
      && isNonnegativeInteger(row.transactionCount)
      && isNonnegativeInteger(row.labeledAnomalyCount));
}

function isWorkbookCategoryActivity(value: unknown): boolean {
  return isRecord(value)
    && isSupplementStatus(value.status)
    && value.sourceSheet === "Transactions"
    && isNullableString(value.reason)
    && value.interpretationApproval === "UNAPPROVED_REFERENCE_ONLY"
    && isNullableString(value.currency)
    && Array.isArray(value.rows)
    && value.rows.every(row => isRecord(row)
      && isString(row.sourceCategory)
      && isString(row.businessCategory)
      && isNonnegativeInteger(row.transactionCount)
      && isNonnegativeInteger(row.creditCount)
      && isNonnegativeInteger(row.debitCount)
      && typeof row.creditAmount === "string" && exactDecimalPattern.test(row.creditAmount)
      && typeof row.debitAmount === "string" && exactDecimalPattern.test(row.debitAmount))
    && Array.isArray(value.bankFormats)
    && value.bankFormats.every(item => isRecord(item) && isString(item.label) && isNonnegativeInteger(item.count));
}

function isQuarterlyWorkbookSupplements(value: unknown): boolean {
  return isRecord(value)
    && value.version === "quarterly-workbook-supplements-0.1"
    && typeof value.fileSha256 === "string" && sha256Pattern.test(value.fileSha256)
    && value.authority === "SUPPLEMENTARY_WORKBOOK_CONTEXT_ONLY"
    && value.usedForHeadlineCalculations === false
    && isRecord(value.monthlySummary)
    && isSupplementStatus(value.monthlySummary.status)
    && value.monthlySummary.sourceSheet === "Monthly Summary"
    && isNullableString(value.monthlySummary.reason)
    && Array.isArray(value.monthlySummary.rows)
    && value.monthlySummary.rows.every(row => isRecord(row)
      && isNonnegativeInteger(row.sourceRowNumber)
      && isString(row.period)
      && [row.openingBalance, row.totalCredits, row.totalDebits, row.closingBalance].every(item => typeof item === "string" && exactDecimalPattern.test(item))
      && isNonnegativeInteger(row.transactionCount)
      && isNonnegativeInteger(row.labeledAnomalyCount)
      && isRecord(row.reconciliation)
      && [row.reconciliation.credits, row.reconciliation.debits, row.reconciliation.transactionCount].every(item => ["MATCH", "MISMATCH"].includes(String(item))))
    && isRecord(value.groundTruth)
    && isSupplementStatus(value.groundTruth.status)
    && value.groundTruth.sourceSheet === "Ground Truth"
    && isNullableString(value.groundTruth.reason)
    && value.groundTruth.evaluationOnly === true
    && isNonnegativeInteger(value.groundTruth.expectedTransactionCount)
    && isNonnegativeInteger(value.groundTruth.matchedTransactionCount)
    && isNonnegativeInteger(value.groundTruth.labeledAnomalyCount)
    && isNonnegativeInteger(value.groundTruth.reviewExpectedCount)
    && Array.isArray(value.groundTruth.anomalyTypes)
    && value.groundTruth.anomalyTypes.every(item => isRecord(item) && isString(item.label) && isNonnegativeInteger(item.count))
    && (value.groundTruth.rows === undefined
      || (Array.isArray(value.groundTruth.rows) && value.groundTruth.rows.every(isWorkbookGroundTruthRow)))
    && isRecord(value.categoryMapping)
    && isSupplementStatus(value.categoryMapping.status)
    && value.categoryMapping.sourceSheet === "Category Mapping"
    && isNullableString(value.categoryMapping.reason)
    && value.categoryMapping.interpretationApproval === "UNAPPROVED_REFERENCE_ONLY"
    && Array.isArray(value.categoryMapping.rows)
    && value.categoryMapping.rows.every(row => isRecord(row)
      && isNonnegativeInteger(row.sourceRowNumber)
      && isString(row.sourceCategory)
      && isString(row.businessCategory)
      && typeof row.generationWeight === "string" && exactDecimalPattern.test(row.generationWeight))
    && isRecord(value.methodology)
    && isSupplementStatus(value.methodology.status)
    && value.methodology.sourceSheet === "Source & Methodology"
    && isNullableString(value.methodology.reason)
    && value.methodology.externallyVerified === false
    && Array.isArray(value.methodology.entries)
    && value.methodology.entries.every(entry => isRecord(entry)
      && isNonnegativeInteger(entry.sourceRowNumber)
      && isString(entry.item)
      && isString(entry.details))
    && (value.readme === undefined || isWorkbookReadme(value.readme))
    && (value.transactionSchedule === undefined || (isRecord(value.transactionSchedule)
      && isSupplementStatus(value.transactionSchedule.status)
      && value.transactionSchedule.sourceSheet === "Transactions"
      && isNullableString(value.transactionSchedule.reason)
      && value.transactionSchedule.scope === "SELECTED_BUSINESS_CURRENT_QUARTER"
      && isNonnegativeInteger(value.transactionSchedule.expectedTransactionCount)
      && isNonnegativeInteger(value.transactionSchedule.matchedTransactionCount)
      && Array.isArray(value.transactionSchedule.rows)
      && value.transactionSchedule.rows.every(isWorkbookTransactionScheduleRow)))
    && (value.categoryActivity === undefined || isWorkbookCategoryActivity(value.categoryActivity));
}

function isQuarterlyActivity(value: unknown): boolean {
  return isRecord(value)
    && isRecord(value.business)
    && isString(value.business.identifier)
    && isString(value.business.displayName)
    && ["REGISTERED_SYNTHETIC", "REVIEWED_USER_INPUT"].includes(String(value.business.nameBasis))
    && value.business.sourceField === "entity_id"
    && isQuarterlyPeriodActivity(value.current)
    && (value.comparison === null || isQuarterlyPeriodActivity(value.comparison))
    && Array.isArray(value.comparisons)
    && value.comparisons.every(item => isRecord(item)
      && ["BANK_CREDITS", "BANK_DEBITS", "TRANSACTION_COUNT"].includes(String(item.measure))
      && isString(item.label)
      && typeof item.currentExactValue === "string" && exactDecimalPattern.test(item.currentExactValue)
      && typeof item.comparisonExactValue === "string" && exactDecimalPattern.test(item.comparisonExactValue)
      && typeof item.absoluteChange === "string" && exactDecimalPattern.test(item.absoluteChange)
      && (item.percentageChange === null || (typeof item.percentageChange === "string" && exactDecimalPattern.test(item.percentageChange)))
      && isNullableString(item.percentageUnavailableReason)
      && isNullableString(item.currency))
    && Array.isArray(value.months)
    && value.months.length === 3
    && value.months.every(month => isRecord(month)
      && isString(month.period)
      && isString(month.label)
      && typeof month.bankCredits === "string" && exactDecimalPattern.test(month.bankCredits)
      && typeof month.bankDebits === "string" && exactDecimalPattern.test(month.bankDebits)
      && isNonnegativeInteger(month.transactionCount)
      && isNonnegativeInteger(month.warningCount)
      && isString(month.currency)
      && isString(month.monetaryBasis)
      && isQuarterlyEvidenceIds(month.evidenceIds))
    && isReportingPeriod(value.evidenceWindow)
    && isRecord(value.calculation)
    && value.calculation.functionId === "analytics.aggregateSourceRecords"
    && isString(value.calculation.version)
    && ["include", "exclude"].includes(String(value.calculation.warningPolicy))
    && value.calculation.exactDecimalStrings === true
    && isRecord(value.categoryBreakdown)
    && value.categoryBreakdown.status === "UNAVAILABLE"
    && isString(value.categoryBreakdown.reason)
    && (value.workbookSupplements === undefined
      || value.workbookSupplements === null
      || isQuarterlyWorkbookSupplements(value.workbookSupplements));
}

function reportSourceKey(report: LocalManagementReport): string {
  return `${report.dataset.fileSha256}:${report.dataset.datasetId}:${report.dataset.ingestionBatchId}:${report.evidenceBundle.snapshot.snapshotSha256}`;
}

function serializedSizeWithinLimit(value: unknown, maximumCharacters: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" && serialized.length <= maximumCharacters;
  } catch {
    return false;
  }
}

export function isRegisteredSyntheticReport(report: LocalManagementReport): boolean {
  return REGISTERED_SYNTHETIC_REPORT_HASHES.has(report.dataset.fileSha256);
}

export function isRegisteredSyntheticReportHash(fileSha256: string): boolean {
  return REGISTERED_SYNTHETIC_REPORT_HASHES.has(fileSha256);
}

/** Runtime validation for browser-restored report snapshots, not an external API contract. */
export function validateStoredLocalManagementReport(value: unknown): LocalManagementReport {
  if (!isRecord(value)
    || !(value.reportType === undefined || ["TRANSACTION_REVIEW", "QUARTERLY_FINANCIAL_ACTIVITY"].includes(String(value.reportType)))
    || !(value.quarterlyActivity === undefined || value.quarterlyActivity === null || isQuarterlyActivity(value.quarterlyActivity))
    || (value.reportType === "QUARTERLY_FINANCIAL_ACTIVITY" && !isQuarterlyActivity(value.quarterlyActivity))
    || (value.reportType === "TRANSACTION_REVIEW" && value.quarterlyActivity !== undefined && value.quarterlyActivity !== null)
    || value.status !== "LOCAL_DRAFT_PREVIEW"
    || !isString(value.reportId)
    || !isString(value.organizationName)
    || !isString(value.title)
    || !isString(value.subtitle)
    || !isValidDate(value.generatedAt)
    || !isReportingPeriod(value.reportingPeriod)
    || !isRecord(value.dataset)
    || !isString(value.dataset.datasetId)
    || !isString(value.dataset.sourceSystem)
    || !isString(value.dataset.sourceFile)
    || !isNullableString(value.dataset.sourceSheet)
    || typeof value.dataset.fileSha256 !== "string"
    || !sha256Pattern.test(value.dataset.fileSha256)
    || !isString(value.dataset.ingestionBatchId)
    || !isValidDate(value.dataset.ingestedAt)
    || !isRecord(value.generation)
    || value.generation.method !== "MANUAL_TEMPLATE"
    || value.generation.llmUsed !== false
    || !isString(value.generation.templateVersion)
    || !isString(value.currencyLabel)
    || !isRecord(value.evidenceBundle)
    || value.evidenceBundle.bundleVersion !== "0.1"
    || value.evidenceBundle.contractVersion !== "0.1"
    || !isString(value.evidenceBundle.bundleId)
    || !isRecord(value.evidenceBundle.snapshot)
    || !isString(value.evidenceBundle.snapshot.snapshotId)
    || typeof value.evidenceBundle.snapshot.snapshotSha256 !== "string"
    || !sha256Pattern.test(value.evidenceBundle.snapshot.snapshotSha256)
    || !isString(value.evidenceBundle.snapshot.schemaVersion)
    || !isString(value.evidenceBundle.snapshot.rulesetVersion)
    || !Array.isArray(value.evidenceBundle.snapshot.datasetIds)
    || !value.evidenceBundle.snapshot.datasetIds.every(isString)
    || !Array.isArray(value.evidenceBundle.snapshot.ingestionBatchIds)
    || !value.evidenceBundle.snapshot.ingestionBatchIds.every(isString)
    || !isValidDate(value.evidenceBundle.snapshot.createdAt)
    || !isReportingPeriod(value.evidenceBundle.period)
    || !["INCLUDE_WITH_CAVEATS", "EXCLUDE"].includes(String(value.evidenceBundle.warningPolicy))
    || !isRecord(value.evidenceBundle.currencyScope)
    || !["NONE", "SINGLE", "MIXED"].includes(String(value.evidenceBundle.currencyScope.status))
    || !Array.isArray(value.evidenceBundle.currencyScope.currencies)
    || !value.evidenceBundle.currencyScope.currencies.every(isString)
    || typeof value.evidenceBundle.currencyScope.hasMissingCurrency !== "boolean"
    || !["UNCLASSIFIED", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(String(value.evidenceBundle.sensitivity))
    || !isEvidenceQuality(value.evidenceBundle.quality)
    || !Array.isArray(value.evidenceBundle.items)
    || !value.evidenceBundle.items.every(item => isRecord(item) && isString(item.evidenceId) && isString(item.evidenceClass))
    || !Array.isArray(value.evidenceBundle.exceptions)
    || !value.evidenceBundle.exceptions.every(isReportException)
    || !Array.isArray(value.metrics)
    || !value.metrics.every(isReportMetric)
    || !Array.isArray(value.rejectedClaims)
    || !value.rejectedClaims.every(isGroundedClaim)
    || !Array.isArray(value.anomalies)
    || !value.anomalies.every(isReportAnomaly)
    || !Array.isArray(value.warnings)
    || !value.warnings.every(isReportWarning)
    || !Array.isArray(value.unavailableMetrics)
    || !value.unavailableMetrics.every(item => isRecord(item) && isString(item.label) && isString(item.reason))
    || !Array.isArray(value.limitations)
    || !value.limitations.every(isString)
    || !Array.isArray(value.policyExceptions)
    || !value.policyExceptions.every(isReportException)
    || !["PASSED", "REVIEW_REQUIRED"].includes(String(value.structuralPrecheck))
    || value.publicationAuthorized !== false
    || !serializedSizeWithinLimit(value, MAX_STORED_REPORT_CHARACTERS)) {
    throw new LocalReportRepositoryError("INVALID_REPORT", "The saved report snapshot does not match the supported local report contract.");
  }

  const report = value as unknown as LocalManagementReport;
  if (!isRegisteredSyntheticReport(report)) {
    throw new LocalReportRepositoryError("UNREGISTERED_SYNTHETIC_REQUIRED", "Only registered synthetic demonstration reports may be stored in this browser.");
  }
  const workbookSupplements = report.quarterlyActivity?.workbookSupplements;
  const transactionSchedule = workbookSupplements?.transactionSchedule;
  const groundTruthRows = workbookSupplements?.groundTruth.rows;
  const categoryActivityCount = workbookSupplements?.categoryActivity?.rows
    .reduce((total, row) => total + row.transactionCount, 0);
  const supplementaryScheduleIsInconsistent = Boolean(
    (transactionSchedule && (
      transactionSchedule.matchedTransactionCount !== transactionSchedule.rows.length
      || transactionSchedule.matchedTransactionCount > transactionSchedule.expectedTransactionCount
    ))
    || (groundTruthRows && workbookSupplements
      && groundTruthRows.length !== workbookSupplements.groundTruth.matchedTransactionCount)
    || (transactionSchedule && categoryActivityCount !== undefined
      && categoryActivityCount !== transactionSchedule.matchedTransactionCount),
  );
  const evidenceIds = new Set(report.evidenceBundle.items.map(item => item.evidenceId));
  const quarterlyEvidenceIds = report.quarterlyActivity ? [
    ...report.quarterlyActivity.current.evidenceIds.bankCredits,
    ...report.quarterlyActivity.current.evidenceIds.bankDebits,
    ...(report.quarterlyActivity.comparison?.evidenceIds.bankCredits ?? []),
    ...(report.quarterlyActivity.comparison?.evidenceIds.bankDebits ?? []),
    ...report.quarterlyActivity.months.flatMap(month => [...month.evidenceIds.bankCredits, ...month.evidenceIds.bankDebits]),
  ] : [];
  if (supplementaryScheduleIsInconsistent
    || report.metrics.some(metric => !evidenceIds.has(metric.evidenceId))
    || quarterlyEvidenceIds.some(evidenceId => !evidenceIds.has(evidenceId))
    || (report.quarterlyActivity !== undefined && report.quarterlyActivity !== null
      && (report.quarterlyActivity.business.displayName !== report.organizationName
        || report.quarterlyActivity.current.period.startDate !== report.reportingPeriod.startDate
        || report.quarterlyActivity.current.period.endDate !== report.reportingPeriod.endDate
        || (report.quarterlyActivity.workbookSupplements !== undefined
          && report.quarterlyActivity.workbookSupplements !== null
          && report.quarterlyActivity.workbookSupplements.fileSha256 !== report.dataset.fileSha256)))
    || report.evidenceBundle.snapshot.datasetIds.length !== 1
    || report.evidenceBundle.snapshot.datasetIds[0] !== report.dataset.datasetId
    || report.evidenceBundle.snapshot.ingestionBatchIds.length !== 1
    || report.evidenceBundle.snapshot.ingestionBatchIds[0] !== report.dataset.ingestionBatchId) {
    throw new LocalReportRepositoryError("INVALID_REPORT", "The saved report snapshot has inconsistent dataset or evidence references.");
  }
  try {
    createManagementReportPresentation(report);
    createFinancialExplanationRequest(report);
  } catch {
    throw new LocalReportRepositoryError("INVALID_REPORT", "The saved report cannot be reconstructed through the current reporting contracts.");
  }
  return report;
}

function validateStoredExplanation(value: unknown, report: LocalManagementReport): ValidatedFinancialExplanation {
  if (!isRecord(value)
    || value.version !== "financial-explanation-result-0.1"
    || value.status !== "AI_DRAFT_REQUIRES_REVIEW"
    || !isString(value.managementSummary)
    || !Array.isArray(value.claims)
    || !value.claims.every(item => isRecord(item) && isString(item.topic) && isGroundedClaim(item.claim))
    || !Array.isArray(value.limitationCodes)
    || !value.limitationCodes.every(isString)
    || !value.limitationCodes.includes("SOURCE_VALUES_NOT_FINANCIAL_STATEMENT_METRICS")
    || !value.limitationCodes.includes("HUMAN_REVIEW_REQUIRED")
    || !Array.isArray(value.references)
    || !value.references.every(reference => isRecord(reference) && isString(reference.evidenceId) && isString(reference.label))
    || !Array.isArray(value.bundleExceptions)
    || !value.bundleExceptions.every(exception => isRecord(exception) && isString(exception.code) && isString(exception.severity) && typeof exception.blocksPublication === "boolean")
    || !isRecord(value.validation)
    || value.validation.assurance !== "STRUCTURAL_ONLY"
    || value.validation.status !== "PASSED"
    || value.validation.semanticReviewRequired !== true
    || value.validation.publicationAuthorized !== false
    || !isRecord(value.generation)
    || !["OPENAI", "GROQ", "TEST"].includes(String(value.generation.provider))
    || typeof value.generation.actualModelRequest !== "boolean"
    || !isString(value.generation.modelIdentifier)
    || !isNullableString(value.generation.requestId)
    || !(value.generation.inputTokens === null || isNonnegativeInteger(value.generation.inputTokens))
    || !(value.generation.outputTokens === null || isNonnegativeInteger(value.generation.outputTokens))
    || !isValidDate(value.generation.generatedAt)
    || !isString(value.generation.promptVersion)
    || !serializedSizeWithinLimit(value, MAX_STORED_EXPLANATION_CHARACTERS)) {
    throw new LocalReportRepositoryError("INVALID_EXPLANATION", "The saved AI explanation does not match the supported validated-output contract.");
  }
  const evidenceIds = new Set(report.evidenceBundle.items.map(item => item.evidenceId));
  const citedIds = (value.claims as Array<{ claim: { evidenceIds: string[] } }>).flatMap(item => item.claim.evidenceIds);
  const referenceIds = (value.references as Array<{ evidenceId: string }>).map(reference => reference.evidenceId);
  if ([...citedIds, ...referenceIds].some(evidenceId => !evidenceIds.has(evidenceId))) {
    throw new LocalReportRepositoryError("INVALID_EXPLANATION", "The saved AI explanation references evidence outside its report snapshot.");
  }
  return value as unknown as ValidatedFinancialExplanation;
}

function reportIdFromUnknown(value: unknown): string | null {
  return isRecord(value) && typeof value.reportId === "string" ? value.reportId : null;
}

function parseEnvelope(value: unknown, now: Date): { entry: SavedLocalReport; issue: LocalReportLoadIssue | null } {
  if (isRecord(value) && value.storageVersion !== LOCAL_REPORT_STORAGE_VERSION) {
    throw new LocalReportRepositoryError("INVALID_REPORT", "INCOMPATIBLE_VERSION");
  }
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) throw new LocalReportRepositoryError("INVALID_REPORT", "CORRUPT_ENTRY");
  if (![parsed.data.savedAt, parsed.data.updatedAt, parsed.data.expiresAt].every(isValidDate)) {
    throw new LocalReportRepositoryError("INVALID_REPORT", "CORRUPT_ENTRY");
  }
  if (Date.parse(parsed.data.expiresAt) <= now.getTime()) {
    throw new LocalReportRepositoryError("INVALID_REPORT", "EXPIRED_ENTRY");
  }
  const report = validateStoredLocalManagementReport(parsed.data.report);
  if (parsed.data.reportId !== report.reportId || parsed.data.sourceKey !== reportSourceKey(report)) {
    throw new LocalReportRepositoryError("INVALID_REPORT", "CORRUPT_ENTRY");
  }
  let explanation: ValidatedFinancialExplanation | null = null;
  let issue: LocalReportLoadIssue | null = null;
  if (parsed.data.aiExplanation !== null) {
    try {
      explanation = validateStoredExplanation(parsed.data.aiExplanation, report);
    } catch {
      issue = { code: "AI_EXPLANATION_DISCARDED", reportId: report.reportId };
    }
  }
  return {
    entry: { ...parsed.data, report, aiExplanation: explanation },
    issue,
  };
}

function issueCode(error: unknown): LocalReportLoadIssueCode {
  if (error instanceof LocalReportRepositoryError && error.message === "INCOMPATIBLE_VERSION") return "INCOMPATIBLE_VERSION";
  if (error instanceof LocalReportRepositoryError && error.message === "EXPIRED_ENTRY") return "EXPIRED_ENTRY";
  return "CORRUPT_ENTRY";
}

export function createLocalReportRepository(
  driver: LocalReportStorageDriver,
  now: () => Date = () => new Date(),
): LocalReportRepository {
  return {
    async listReports() {
      let values: readonly unknown[];
      try {
        values = await driver.readAll();
      } catch {
        throw new LocalReportRepositoryError("STORAGE_UNAVAILABLE", "Saved reports are unavailable because browser storage could not be opened.");
      }
      const reports: SavedLocalReport[] = [];
      const issues: LocalReportLoadIssue[] = [];
      const seen = new Set<string>();
      for (const value of values) {
        const candidateId = reportIdFromUnknown(value);
        try {
          const parsed = parseEnvelope(value, now());
          if (seen.has(parsed.entry.reportId)) {
            issues.push({ code: "CORRUPT_ENTRY", reportId: parsed.entry.reportId });
            continue;
          }
          seen.add(parsed.entry.reportId);
          reports.push(parsed.entry);
          if (parsed.issue) issues.push(parsed.issue);
        } catch (error) {
          const code = issueCode(error);
          issues.push({ code, reportId: candidateId });
          if (candidateId) await driver.remove(candidateId).catch(() => undefined);
        }
      }
      reports.sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
      return { reports, issues };
    },

    async saveReport(reportValue) {
      const report = validateStoredLocalManagementReport(reportValue);
      let existingValue: unknown;
      try {
        existingValue = await driver.read(report.reportId);
      } catch {
        throw new LocalReportRepositoryError("STORAGE_UNAVAILABLE", "The report was prepared but local browser storage could not be read.");
      }
      if (existingValue !== undefined) {
        const existing = parseEnvelope(existingValue, now()).entry;
        if (JSON.stringify(existing.report) !== JSON.stringify(report)) {
          throw new LocalReportRepositoryError("IMMUTABLE_REPORT_CONFLICT", "A saved report with this ID has different snapshot contents.");
        }
        return existing;
      }
      const savedAt = now().toISOString();
      const expiresAt = new Date(Date.parse(savedAt) + LOCAL_REPORT_RETENTION_DAYS * 86_400_000).toISOString();
      const entry: SavedLocalReport = {
        storageVersion: LOCAL_REPORT_STORAGE_VERSION,
        storageKind: LOCAL_REPORT_STORAGE_KIND,
        reportId: report.reportId,
        sourceKey: reportSourceKey(report),
        savedAt,
        updatedAt: savedAt,
        expiresAt,
        report,
        aiExplanation: null,
      };
      try {
        await driver.write(entry);
      } catch {
        throw new LocalReportRepositoryError("STORAGE_UNAVAILABLE", "The report was prepared but could not be saved in local browser storage.");
      }
      return entry;
    },

    async saveExplanation(reportId, explanationValue) {
      let stored: unknown;
      try {
        stored = await driver.read(reportId);
      } catch {
        throw new LocalReportRepositoryError("STORAGE_UNAVAILABLE", "The AI explanation could not be attached to the saved report.");
      }
      if (stored === undefined) throw new LocalReportRepositoryError("REPORT_NOT_FOUND", "The saved report no longer exists.");
      const existing = parseEnvelope(stored, now()).entry;
      const explanation = validateStoredExplanation(explanationValue, existing.report);
      const updated: SavedLocalReport = { ...existing, aiExplanation: explanation, updatedAt: now().toISOString() };
      try {
        await driver.write(updated);
      } catch {
        throw new LocalReportRepositoryError("STORAGE_UNAVAILABLE", "The AI explanation was generated but could not be saved locally.");
      }
      return updated;
    },

    async deleteReport(reportId) {
      try {
        await driver.remove(reportId);
      } catch {
        throw new LocalReportRepositoryError("STORAGE_UNAVAILABLE", "The saved report could not be deleted from local browser storage.");
      }
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

export function createIndexedDbReportRepository(factory: IDBFactory | undefined = globalThis.indexedDB): LocalReportRepository {
  if (!factory) {
    const unavailable: LocalReportStorageDriver = {
      readAll: async () => Promise.reject(new Error("IndexedDB unavailable.")),
      read: async () => Promise.reject(new Error("IndexedDB unavailable.")),
      write: async () => Promise.reject(new Error("IndexedDB unavailable.")),
      remove: async () => Promise.reject(new Error("IndexedDB unavailable.")),
    };
    return createLocalReportRepository(unavailable);
  }

  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = () => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = factory.open(LOCAL_REPORT_DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(LOCAL_REPORT_OBJECT_STORE)) {
          const store = db.createObjectStore(LOCAL_REPORT_OBJECT_STORE, { keyPath: "reportId" });
          store.createIndex("savedAt", "savedAt", { unique: false });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked by another tab."));
    });
    return databasePromise;
  };

  const driver: LocalReportStorageDriver = {
    async readAll() {
      const db = await database();
      return requestResult(db.transaction(LOCAL_REPORT_OBJECT_STORE, "readonly").objectStore(LOCAL_REPORT_OBJECT_STORE).getAll());
    },
    async read(reportId) {
      const db = await database();
      return requestResult(db.transaction(LOCAL_REPORT_OBJECT_STORE, "readonly").objectStore(LOCAL_REPORT_OBJECT_STORE).get(reportId));
    },
    async write(value) {
      const db = await database();
      const transaction = db.transaction(LOCAL_REPORT_OBJECT_STORE, "readwrite");
      transaction.objectStore(LOCAL_REPORT_OBJECT_STORE).put(value);
      await transactionComplete(transaction);
    },
    async remove(reportId) {
      const db = await database();
      const transaction = db.transaction(LOCAL_REPORT_OBJECT_STORE, "readwrite");
      transaction.objectStore(LOCAL_REPORT_OBJECT_STORE).delete(reportId);
      await transactionComplete(transaction);
    },
  };
  return createLocalReportRepository(driver);
}
