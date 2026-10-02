/** Provisional transport contract. Money stays decimal text, never IEEE-754. */
export const SCHEMA_VERSION = "0.1";
export const RULE_VERSION = "0.1";
export const CANONICAL_FIELDS = [
  "transaction_date", "posting_date", "reference", "source_transaction_id",
  "account_code", "account_id", "entity_id", "description", "counterparty",
  "debit", "credit", "source_amount", "balance", "entry_side", "currency",
] as const;
export type CanonicalField = typeof CANONICAL_FIELDS[number];
export type RawCell = string | boolean | null | { kind: "excel_date" | "excel_number"; value: string };
export type RowStatus = "VALID" | "WARNING" | "REJECTED";
export type MonetaryMode = "debit_credit" | "signed_amount" | "amount_direction";
export type NumberFormat = "plain" | "dot_comma" | "comma_dot";
export type DateOrder = "ISO" | "DMY" | "MDY";
export interface ValidationIssue {
  rule: string;
  category: "technical" | "business";
  severity: "WARNING" | "REJECTED";
  field: string;
  sourceColumn: string | null;
  originalValue: RawCell;
  message: string;
}
export interface RawRow {
  rowNumber: number;
  cells: RawCell[];
  issues: ValidationIssue[];
}
export interface RawSheet { name: string | null; index: number; rows: RawRow[] }
export interface LoadedFile {
  name: string;
  type: "CSV" | "XLSX";
  fingerprint: string;
  sizeBytes: number;
  sheets: RawSheet[];
  delimiter: string | null;
}
export interface Dataset {
  id: string;
  file: LoadedFile;
  sheet: RawSheet;
  headerRow: number;
  columns: string[];
  rows: RawRow[];
}
export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  columns: { name: string; inferredType: string; missing: number }[];
  duplicateRowCount: number;
  duplicateRowNumbers: number[];
  sampleRows: RawRow[];
}
export interface ColumnMapping {
  sourceIndex: number;
  sourceColumn: string;
  target: CanonicalField | null;
  method: "exact_match" | "alias_match" | "normalized_match" | "manual" | "unmapped";
  confidence: number | null;
  userConfirmed: boolean;
}
export interface IngestionOptions {
  sourceSystem: string;
  monetaryMode: MonetaryMode;
  dateBasis: "transaction_date" | "posting_date";
  dateOrder: DateOrder;
  numberFormat: NumberFormat;
  blankSideAsZero: boolean;
  negativeDebitCredit: "warn" | "reject" | "allow";
  bothDebitCredit: "warn" | "reject" | "allow";
  currencyDefault: string | null;
}
export const DEFAULT_OPTIONS: IngestionOptions = {
  sourceSystem: "Other",
  monetaryMode: "signed_amount",
  dateBasis: "transaction_date",
  dateOrder: "ISO",
  numberFormat: "plain",
  blankSideAsZero: false,
  negativeDebitCredit: "warn",
  bothDebitCredit: "warn",
  currencyDefault: null,
};
export interface IngestionContext { batchId: string; ingestedAt: string }
export interface Provenance {
  source_system: string;
  source_file: string;
  source_sheet: string | null;
  source_row_number: number;
  source_row_id: string;
  file_sha256: string;
  ingestion_batch_id: string;
  ingested_at: string;
}
/** Explicitly approved blank-side conversions, separate from quality issues. */
export interface NormalizationTransformation {
  field: "debit" | "credit";
  source_column: string | null;
  original_value: RawCell;
  normalized_value: "0";
  rule: "APPROVED_BLANK_SIDE_ZERO";
}
export interface CanonicalTransaction extends Provenance {
  transaction_date: string | null;
  posting_date: string | null;
  canonical_date: string;
  canonical_date_basis: "TRANSACTION_DATE" | "POSTING_DATE";
  reference: string | null;
  source_transaction_id: string | null;
  account_code: string | null;
  account_id: string | null;
  entity_id: string | null;
  description: string | null;
  counterparty: string | null;
  debit: string | null;
  credit: string | null;
  source_amount: string | null;
  derived_ledger_net: string | null;
  balance: string | null;
  entry_side: "DEBIT" | "CREDIT" | null;
  monetary_basis: "source_signed_amount" | "source_amount_with_direction" | "debit_credit";
  currency: string | null;
  currency_basis: "SOURCE" | "DATASET_DEFAULT" | null;
  transformations: NormalizationTransformation[];
  ingestion_status: "VALID" | "WARNING";
  validation_messages: ValidationIssue[];
}
export type StagingValues = Partial<Record<CanonicalField, RawCell>>;
export type CanonicalCandidate = Omit<CanonicalTransaction, "canonical_date" | "ingestion_status" | "validation_messages"> & {
  canonical_date: string | null;
};
export interface ProcessedRow {
  provenance: Provenance;
  raw: RawRow;
  staging: StagingValues;
  candidate: CanonicalCandidate;
  status: RowStatus;
  issues: ValidationIssue[];
  populatedRequiredSlots: number;
  missingDate: boolean;
  missingMoney: boolean;
}
export interface QualitySummary {
  filesProcessed: number;
  datasetsProcessed: number;
  rowsReceived: number;
  valid: number;
  warning: number;
  rejected: number;
  accepted: number;
  successRate: number | null;
  cleanValidityRate: number | null;
  requiredCompleteness: number | null;
  duplicateRows: number;
  missingDates: number;
  missingMoney: number;
  missingReferences: number;
  unmappedColumns: number;
}
export interface IngestionResult {
  schema_version: string;
  ruleset_version: string;
  dataset: Dataset;
  profile: DatasetProfile;
  mapping: ColumnMapping[];
  options: IngestionOptions;
  context: IngestionContext;
  records: ProcessedRow[];
  normalized: CanonicalTransaction[];
  summary: QualitySummary;
}
export class IngestionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "IngestionError";
  }
}
