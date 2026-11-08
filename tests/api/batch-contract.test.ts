import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { BATCH_STATUSES, InvalidBatchContractError, batchTimestamp, parseBatchId, parseBatchListFilters, projectBatchRow } from "../../lib/server/api/batch-contract";
import { attemptId, batchA, row } from "./batch.fixtures";

describe("internal batch contract", () => {
  it("uses bounded defaults", () => {
    expect(parseBatchListFilters(new URLSearchParams())).toEqual({ limit: 25, cursor: null, status: null, persistenceAttemptId: null });
  });
  it.each(BATCH_STATUSES)("accepts the actual %s status", status => {
    expect(parseBatchListFilters(new URLSearchParams({ limit: "100", cursor: "opaque_-", status,
      persistence_attempt_id: attemptId }))).toMatchObject({ limit: 100, cursor: "opaque_-", status, persistenceAttemptId: attemptId });
  });
  it.each(["limit=0", "limit=-1", "limit=101", "limit=01", "limit=2.5", "limit=", "limit=1&limit=2",
    "cursor=", "cursor=unsafe%2F", "cursor=" + "a".repeat(513), "status=COMPLETED", "status=ACTIVE&status=FAILED",
    "persistence_attempt_id=bad", "organization_id=forged", "role=admin", "foo=bar"])("rejects invalid request %s", query => {
    expect(() => parseBatchListFilters(new URLSearchParams(query))).toThrow(InvalidBatchContractError);
  });
  it.each([null, undefined, "", "0001", batchA + "' OR true", 1])("rejects invalid lookup ID %o", value => {
    expect(() => parseBatchId(value)).toThrow(InvalidBatchContractError);
  });
  it("normalizes UUID spelling only", () => { expect(parseBatchId("ABCDEF00-0000-4000-8000-000000000001")).toBe("abcdef00-0000-4000-8000-000000000001"); });
  it("projects stored counts with safe summaries and no sensitive fields", () => {
    const result = projectBatchRow({ ...row, source_file: "secret.csv", context: { raw: true }, dataset_id: "sensitive",
      records: [{ amount: "1" }], original_value: "secret", message: "secret", internal_error: "secret" });
    expect(result).toEqual({ batch_id: batchA, ingestion_batch_id: row.ingestion_batch_id, persistence_attempt_id: null,
      status: "ACTIVE", created_at: row.created_at, completed_at: row.completed_at, rows_received: 5, valid_count: 2,
      warning_count: 1, rejected_count: 2, accepted_count: 3,
      validation_summary: { total_warning_issues: 2, technical_warning_issues: 1, business_warning_issues: 1 } });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.validation_summary)).toBe(true);
  });
  it("preserves legacy NULLs and completed-empty rejection counts", () => {
    expect(projectBatchRow({ ...row, status: "PROCESSING", completed_at: null })).toMatchObject({ completed_at: null, persistence_attempt_id: null });
    expect(projectBatchRow({ ...row, status: "COMPLETED_EMPTY", rows_received: 7, valid_count: 0, warning_count: 0, rejected_count: 7,
      total_warning_issues: "0", technical_warning_issues: "0", business_warning_issues: "0" })).toMatchObject({ status: "COMPLETED_EMPTY", accepted_count: 0, rejected_count: 7 });
  });
  it.each([
    { completed_at: undefined }, { persistence_attempt_id: undefined }, { created_at: undefined }, { warning_count: undefined },
    { status: "COMPLETED" }, { rows_received: 4 }, { valid_count: -1 }, { warning_count: "1" }, { rejected_count: NaN },
    { status: "COMPLETED_EMPTY" }, { created_at: "2026-02-30T00:00:00.000000Z" },
    { completed_at: "2025-09-01T00:00:00.000000Z" }, { total_warning_issues: "3" },
    { total_warning_issues: 2 }, { technical_warning_issues: "9007199254740992" },
  ])("rejects malformed or missing projected data %o", changes => {
    expect(() => projectBatchRow({ ...row, ...changes })).toThrow(InvalidBatchContractError);
  });
  it.each([null, [], undefined, 1, {}])("rejects invalid database input %o", input => {
    expect(() => projectBatchRow(input)).toThrow(InvalidBatchContractError);
  });
  it("preserves microseconds and rejects noncanonical timestamp output", () => {
    expect(batchTimestamp(row.created_at)).toBe("2026-09-01T00:00:00.123456Z");
    expect(() => batchTimestamp("01/09/2026 00:00:00")).toThrow(InvalidBatchContractError);
  });
});
