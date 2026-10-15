import type {
  CanonicalTransaction, IngestionResult, NormalizationTransformation, RawCell,
  ValidationIssue,
} from "../../ingestion/models";

/** Consumer compatibility is pinned independently of producer constants. */
export const SUPPORTED_PERSISTENCE_VERSIONS = {
  schema_version: "0.1", ruleset_version: "0.1",
} as const;

export type PersistenceErrorCode = "INVALID_INPUT" | "UNSUPPORTED_VERSION" | "MIXED_BATCH_IDS"
  | "DATABASE_CONFIGURATION" | "DATABASE_UNAVAILABLE" | "PERSISTENCE_FAILED"
  | "COMMIT_OUTCOME_UNKNOWN" | "ROLLBACK_UNCONFIRMED" | "IDEMPOTENCY_UNSUPPORTED" | "EMPTY_ACCEPTED_BATCH_UNSUPPORTED";
const messages: Record<PersistenceErrorCode, string> = {
  INVALID_INPUT: "Persistence input is invalid or inconsistent.",
  UNSUPPORTED_VERSION: "Persistence input uses an unsupported contract version.",
  MIXED_BATCH_IDS: "Phase 2A requires a single producer batch ID.",
  DATABASE_CONFIGURATION: "Server database configuration is missing or invalid.",
  DATABASE_UNAVAILABLE: "The persistence database is unavailable.",
  PERSISTENCE_FAILED: "The persistence attempt failed.",
  COMMIT_OUTCOME_UNKNOWN: "Commit outcome is unknown. Do not retry this attempt.",
  ROLLBACK_UNCONFIRMED: "Rollback could not be confirmed. Do not retry this attempt.",
  IDEMPOTENCY_UNSUPPORTED: "Only an explicit new attempt is supported. Duplicate and retry requests are unsupported.",
  EMPTY_ACCEPTED_BATCH_UNSUPPORTED: "Activation of an attempt without accepted records is not yet supported.",
};
/** Safe codes/messages only: never include source values or underlying errors. */
export class PersistenceError extends Error {
  constructor(public readonly code: PersistenceErrorCode) {
    super(messages[code]);
    this.name = "PersistenceError";
  }
}

/** Internal trusted-engine input, not an HTTP payload or authorization proof. */
export interface PersistenceRequest {
  readonly results: readonly IngestionResult[];
  /** Omitted by retained internal callers: derived from verified producer file metadata. */
  readonly source_file?: string;
}
export interface PersistenceCounts {
  rows_received: number;
  valid_count: number;
  warning_count: number;
  rejected_count: number;
}
export interface AcceptedValidationIssue extends Omit<ValidationIssue, "severity"> {
  severity: "WARNING";
}
export interface AcceptedTransaction extends Omit<CanonicalTransaction, "validation_messages"> {
  validation_messages: AcceptedValidationIssue[];
}
export interface ValidatedDataset {
  dataset_id: string;
  counts: PersistenceCounts;
  records: AcceptedTransaction[];
}
/** An owned snapshot, excluding raw/staging/rejected evidence. Not a DB receipt. */
export interface ValidatedPersistenceInput {
  source_file: string;
  schema_version: "0.1";
  ruleset_version: "0.1";
  ingestion_batch_id: string;
  datasets: ValidatedDataset[];
}

/** UUIDs/FKs and lifecycle/context metadata are assigned by a future writer. */
export interface BatchValues extends PersistenceCounts {
  source_file: string;
  ingestion_batch_id: string;
  schema_version: "0.1";
  ruleset_version: "0.1";
}
export type FinancialRecordValues = Omit<CanonicalTransaction, "validation_messages" | "transformations"> & {
  transformations: NormalizationTransformation[];
};
export interface ValidationIssueValues {
  issue_ordinal: number;
  rule: string;
  category: ValidationIssue["category"];
  severity: "WARNING";
  field: string;
  source_column: string | null;
  original_value: RawCell;
  message: string;
}
/** Nesting keeps issues attached to their record until database UUIDs exist. */
export interface RecordPlan {
  financial_record: FinancialRecordValues;
  validation_issues: ValidationIssueValues[];
}
export interface PersistencePlan {
  kind: "PREPARED";
  batch: BatchValues;
  datasets: { dataset_id: string; records: RecordPlan[] }[];
}

/** Explicit caller intent, not a durable idempotency key or replay guarantee. */
export interface NewPersistenceAttempt extends PersistenceRequest {
  intent: "NEW_ATTEMPT_NO_RETRY";
}
export interface PersistedAttempt {
  outcome: "PERSISTED_NEW_ATTEMPT";
  batch_id: string;
  ingestion_batch_id: string;
  accepted_record_count: number;
  warning_count: number;
}
