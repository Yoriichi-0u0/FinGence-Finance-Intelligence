import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { QueryResult, TransactionDatabase } from "../../lib/server/db/postgres";
import { createPersistenceRepository } from "../../lib/server/persistence/repository";
import { preparePersistencePlan } from "../../lib/server/persistence/map";
import { syntheticResult } from "./fixtures";

const batchId = "10000000-0000-4000-8000-000000000001";
const recordId = "20000000-0000-4000-8000-000000000001";
function mockDatabase(change?: (sql: string) => QueryResult | undefined) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const database: TransactionDatabase = {
    close: async () => {},
    async transaction(work) {
      return work({ async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        calls.push({ sql, values });
        const result = change?.(sql) ?? (sql.startsWith("INSERT INTO public.ingestion_batches") ? { rows: [{ id: batchId }], rowCount: 1 }
          : sql.startsWith("INSERT INTO public.financial_records") ? { rows: [{ id: recordId }], rowCount: 1 }
          : sql.startsWith("SELECT count") ? { rows: [{ accepted: 1, valid: 1, warning: 0, issues: 0 }], rowCount: 1 }
          : { rows: [], rowCount: 1 });
        return result as QueryResult<Row>;
      } });
    },
  };
  return { database, calls };
}
describe("repository SQL contract", () => {
  it("uses database-generated relationships and parameter-only source values", async () => {
    const { database, calls } = mockDatabase();
    const input = await syntheticResult();
    const plan = preparePersistencePlan({ results: [input] });
    const receipt = await createPersistenceRepository(database).persistNewAttempt(plan);
    expect(receipt.batch_id).toBe(batchId);
    const insert = calls.find(call => call.sql.startsWith("INSERT INTO public.financial_records"))!;
    expect(insert.values![0]).toBe(batchId);
    expect(insert.values).toContain(input.normalized[0].source_amount);
    expect(insert.values).toContain("00017");
    for (const call of calls) expect(call.sql).not.toContain(input.normalized[0].source_row_id);
    expect(calls.at(-1)).toMatchObject({ sql: expect.stringContaining("status = 'ACTIVE'"), values: [batchId] });
  });
  it.each([
    ["missing UUID", (sql: string) => sql.startsWith("INSERT INTO public.ingestion_batches") ? { rows: [], rowCount: 0 } : undefined],
    ["invalid database identity", (sql: string) => sql.startsWith("INSERT INTO public.financial_records") ? { rows: [{ id: "source-row-id" }], rowCount: 1 } : undefined],
    ["missing lifecycle update", (sql: string) => sql.startsWith("UPDATE") ? { rows: [], rowCount: 0 } : undefined],
  ])("fails safely on %s", async (_, change) => {
    const { database } = mockDatabase(change);
    await expect(createPersistenceRepository(database).persistNewAttempt(preparePersistencePlan({ results: [await syntheticResult()] }))).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
  });
});
