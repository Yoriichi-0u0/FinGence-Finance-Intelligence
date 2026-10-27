import "server-only";

export const BATCH_STATUSES = ["PROCESSING", "ACTIVE", "SUPERSEDED", "FAILED", "COMPLETED_EMPTY"] as const;
export type BatchStatus = typeof BATCH_STATUSES[number];
export const BATCH_PAGE_DEFAULT = 25;
export const BATCH_PAGE_MAX = 100;
export class InvalidBatchContractError extends Error {
  readonly code = "INVALID_BATCH_CONTRACT";
  constructor() { super("Invalid batch request or projection"); this.name = "InvalidBatchContractError"; }
}
export function parseBatchId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new InvalidBatchContractError();
  }
  return value.toLowerCase();
}
/** Canonical UTC PostgreSQL timestamp text, preserving all six fractional digits. */
export function batchTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) throw new InvalidBatchContractError();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value.slice(0, 19)) throw new InvalidBatchContractError();
  return value;
}
export interface BatchListFilters {
  readonly limit: number;
  readonly cursor: string | null;
  readonly status: BatchStatus | null;
  readonly persistenceAttemptId: string | null;
}
export function parseBatchListFilters(parameters: URLSearchParams): BatchListFilters {
  if (!(parameters instanceof URLSearchParams)) throw new InvalidBatchContractError();
  for (const [key] of parameters) {
    if (!["limit", "cursor", "status", "persistence_attempt_id"].includes(key) || parameters.getAll(key).length !== 1) {
      throw new InvalidBatchContractError();
    }
  }
  const rawLimit = parameters.get("limit");
  if (rawLimit !== null && !/^[1-9]\d{0,2}$/.test(rawLimit)) throw new InvalidBatchContractError();
  const limit = rawLimit === null ? BATCH_PAGE_DEFAULT : Number(rawLimit);
  if (limit > BATCH_PAGE_MAX) throw new InvalidBatchContractError();
  const cursor = parameters.get("cursor");
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new InvalidBatchContractError();
  const status = parameters.get("status");
  if (status !== null && !(BATCH_STATUSES as readonly string[]).includes(status)) throw new InvalidBatchContractError();
  const attempt = parameters.get("persistence_attempt_id");
  return Object.freeze({ limit, cursor, status: status as BatchStatus | null,
    persistenceAttemptId: attempt === null ? null : parseBatchId(attempt) });
}
export interface BatchItem {
  readonly batch_id: string;
  readonly ingestion_batch_id: string;
  /** Parent correlation only: neither a batch ID nor proof of attempt access. */
  readonly persistence_attempt_id: string | null;
  readonly status: BatchStatus;
  readonly created_at: string;
  readonly completed_at: string | null;
  readonly rows_received: number;
  readonly valid_count: number;
  readonly warning_count: number;
  readonly rejected_count: number;
  /** Stored VALID + WARNING counts; not an economic deduplication count. */
  readonly accepted_count: number;
  readonly validation_summary: Readonly<{
    total_warning_issues: number;
    technical_warning_issues: number;
    business_warning_issues: number;
  }>;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new InvalidBatchContractError();
  return value;
}
function aggregateCount(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) throw new InvalidBatchContractError();
  return count(Number(value));
}
/** Explicit minimal allowlist; missing nullable columns are invalid, not silently fabricated. */
export function projectBatchRow(input: unknown): BatchItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InvalidBatchContractError();
  const row = input as Record<string, unknown>;
  const batchId = parseBatchId(row.id);
  if (typeof row.ingestion_batch_id !== "string" || row.ingestion_batch_id.trim().length === 0
    || typeof row.status !== "string" || !(BATCH_STATUSES as readonly string[]).includes(row.status)) throw new InvalidBatchContractError();
  const attemptId = row.persistence_attempt_id === null ? null : parseBatchId(row.persistence_attempt_id);
  const createdAt = batchTimestamp(row.created_at);
  const completedAt = row.completed_at === null ? null : batchTimestamp(row.completed_at);
  const rowsReceived = count(row.rows_received), valid = count(row.valid_count), warning = count(row.warning_count), rejected = count(row.rejected_count);
  const accepted = count(valid + warning);
  const totalIssues = aggregateCount(row.total_warning_issues);
  const technicalIssues = aggregateCount(row.technical_warning_issues), businessIssues = aggregateCount(row.business_warning_issues);
  if (rowsReceived !== accepted + rejected || totalIssues !== technicalIssues + businessIssues
    || (completedAt !== null && completedAt < createdAt)
    || (row.status === "COMPLETED_EMPTY" && (accepted !== 0 || completedAt === null))) throw new InvalidBatchContractError();
  return Object.freeze({ batch_id: batchId, ingestion_batch_id: row.ingestion_batch_id,
    persistence_attempt_id: attemptId, status: row.status as BatchStatus, created_at: createdAt, completed_at: completedAt,
    rows_received: rowsReceived, valid_count: valid, warning_count: warning, rejected_count: rejected, accepted_count: accepted,
    validation_summary: Object.freeze({ total_warning_issues: totalIssues,
      technical_warning_issues: technicalIssues, business_warning_issues: businessIssues }) });
}
