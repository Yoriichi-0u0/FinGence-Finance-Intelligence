import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PersistenceError } from "../../lib/server/persistence/contracts";
import { createPersistenceService } from "../../lib/server/persistence/service";
import { clone, syntheticResult } from "./fixtures";

describe("internal new-attempt persistence service", () => {
  it.each([null, {}, { results: [] }, { intent: "RETRY", results: [] },
    { intent: "NEW_ATTEMPT_NO_RETRY", results: [], idempotencyKey: "synthetic-key" },
    { intent: "NEW_ATTEMPT_NO_RETRY", results: [], retryOf: "synthetic-attempt" }])("rejects ambiguous, duplicate/retry contracts %# before database work", async input => {
    const persistNewAttempt = vi.fn();
    await expect(createPersistenceService({ persistNewAttempt }).persistNewAttempt(input)).rejects.toMatchObject({ code: "IDEMPOTENCY_UNSUPPORTED" });
    expect(persistNewAttempt).not.toHaveBeenCalled();
  });
  it("preflights before repository work", async () => {
    const result = await syntheticResult();
    result.schema_version = "later";
    const persistNewAttempt = vi.fn();
    await expect(createPersistenceService({ persistNewAttempt }).persistNewAttempt({ intent: "NEW_ATTEMPT_NO_RETRY", results: [result] })).rejects.toMatchObject({ code: "UNSUPPORTED_VERSION" });
    expect(persistNewAttempt).not.toHaveBeenCalled();
  });
  it("snapshots before awaiting storage and returns only a committed receipt", async () => {
    const result = await syntheticResult(), before = clone(result);
    const receipt = { outcome: "PERSISTED_NEW_ATTEMPT" as const, batch_id: "10000000-0000-4000-8000-000000000001",
      ingestion_batch_id: result.context.batchId, accepted_record_count: 1, warning_count: 0 };
    const persistNewAttempt = vi.fn(async plan => {
      result.normalized[0].source_amount = "changed-caller-input";
      expect(plan.datasets[0].records[0].financial_record.source_amount).toBe(before.normalized[0].source_amount);
      return receipt;
    });
    expect(await createPersistenceService({ persistNewAttempt }).persistNewAttempt({ intent: "NEW_ATTEMPT_NO_RETRY", results: [result] })).toEqual(receipt);
    expect(persistNewAttempt).toHaveBeenCalledTimes(1);
  });
  it.each([new Error("private SQL credentials"), new PersistenceError("COMMIT_OUTCOME_UNKNOWN")])("sanitizes repository failures without retry %#", async error => {
    const persistNewAttempt = vi.fn(async () => { throw error; });
    const promise = createPersistenceService({ persistNewAttempt }).persistNewAttempt({ intent: "NEW_ATTEMPT_NO_RETRY", results: [await syntheticResult()] });
    await expect(promise).rejects.toMatchObject({ code: error instanceof PersistenceError ? error.code : "PERSISTENCE_FAILED" });
    expect(persistNewAttempt).toHaveBeenCalledTimes(1);
  });
});

it("passes explicit authoritative filename through service preflight and rejects mismatch", async () => {
  const result = await syntheticResult();
  const repository = { persistNewAttempt: vi.fn().mockResolvedValue({ outcome: "PERSISTED_NEW_ATTEMPT" }) };
  const service = createPersistenceService(repository);
  await service.persistNewAttempt({ intent: "NEW_ATTEMPT_NO_RETRY", results: [result], source_file: result.dataset.file.name });
  expect(repository.persistNewAttempt.mock.calls[0][0].batch.source_file).toBe(result.dataset.file.name);
  repository.persistNewAttempt.mockClear();
  await expect(service.persistNewAttempt({ intent: "NEW_ATTEMPT_NO_RETRY", results: [result], source_file: "different.csv" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(repository.persistNewAttempt).not.toHaveBeenCalled();
});
