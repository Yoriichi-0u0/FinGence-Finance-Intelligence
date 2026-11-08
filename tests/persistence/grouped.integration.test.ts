import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import { PersistenceError } from "../../lib/server/persistence/contracts";
import type { TransactionDatabase, SqlConnection, QueryResult } from "../../lib/server/db/postgres";
import { syntheticResult, header, clone } from "./fixtures";

let db: PGlite;
let transactions = 0;
const database: TransactionDatabase = {
  close: async () => {},
  async transaction(work) {
    transactions++;
    return db.transaction(async tx => work({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      },
    }));
  },
};
const service = createGroupedPersistenceService(database);
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await db.exec(readFileSync(new URL("../../supabase/sql/phase1-clean-setup.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../../supabase/sql/c3b1-grouped-persistence-upgrade.sql", import.meta.url), "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("TRUNCATE public.validation_issues, public.financial_records, public.ingestion_batches, public.persistence_attempts;");
  transactions = 0;
});
afterAll(async () => { await db?.close(); });
async function children() {
  return [await syntheticResult(), await syntheticResult(undefined, {},
    { batchId: "independent-producer", ingestedAt: "2026-10-03T00:00:00.000Z" }, "second.csv")];
}
async function zeroRowResult() {
  // Producer reader currently rejects header-only files. Exercise the internal
  // persistence boundary with an explicitly constructed consistent zero-row result.
  const result = await syntheticResult();
  result.dataset.rows = []; result.records = []; result.normalized = [];
  result.profile.rowCount = 0; result.profile.sampleRows = [];
  Object.assign(result.summary, { rowsReceived: 0, valid: 0, warning: 0, rejected: 0, accepted: 0 });
  return result;
}
async function counts() {
  return (await db.query("SELECT (SELECT count(*)::int FROM public.persistence_attempts) attempts, (SELECT count(*)::int FROM public.ingestion_batches) batches, (SELECT count(*)::int FROM public.financial_records) records")).rows[0];
}
function changedDatabase(change: (connection: SqlConnection) => SqlConnection): TransactionDatabase {
  return { close: async () => {}, transaction: work => database.transaction(connection => work(change(connection))) };
}
describe("C3-B1 internal grouped persistence", () => {
  it("stores independent children in one transaction and retains metadata without mutation", async () => {
    const results = await children(), before = clone(results), attempt_id = randomUUID();
    // Identical financial content can identify the same dataset: change the second fixture content.
    results[1] = await syntheticResult(`${header}\n2026-09-02,2026-09-03,2,R,ID,A,B,C,Synthetic,MYR`, {}, results[1].context, "second.csv");
    const snapshot = clone(results);
    const receipt = await service.persistGroupedAttempt({ attempt_id, results });
    expect(transactions).toBe(1);
    expect(receipt.datasets.map(row => row.ingestion_batch_id)).toEqual(results.map(row => row.context.batchId));
    expect(receipt.datasets.map(row => row.source_file)).toEqual(results.map(row => row.dataset.file.name));
    expect(new Set(receipt.datasets.map(row => row.batch_id)).size).toBe(2);
    expect(await counts()).toEqual({ attempts: 1, batches: 2, records: 2 });
    const rows = (await db.query<{ context: typeof results[0]; persistence_attempt_id: string }>("SELECT context, persistence_attempt_id FROM public.ingestion_batches ORDER BY source_file")).rows;
    expect(rows.every(row => row.persistence_attempt_id === attempt_id)).toBe(true);
    expect(rows[0].context.summary).toEqual(results[1].summary);
    expect(results).toEqual(snapshot);
    expect(before[0]).toEqual(results[0]);
    expect(await service.investigateAttempt(attempt_id)).toMatchObject({ outcome: "CONFIRMED_COMMITTED" });
  });
  it("persists mixed accepted and all-rejected children without fabricated records", async () => {
    const empty = await syntheticResult(`${header}\ninvalid,2026-09-03,nope,R,ID,A,B,C,Synthetic,MYR`, {},
      { batchId: "empty-batch", ingestedAt: "2026-10-03T00:00:00.000Z" }, "empty.csv");
    const receipt = await service.persistGroupedAttempt({ attempt_id: randomUUID(), results: [await syntheticResult(), empty] });
    expect(receipt.datasets[1]).toMatchObject({ status: "COMPLETED_EMPTY", ingestion_batch_id: "empty-batch", source_file: "empty.csv", accepted_record_count: 0 });
    const row = (await db.query("SELECT status, rejected_count, context FROM public.ingestion_batches WHERE id=$1", [receipt.datasets[1].batch_id])).rows[0];
    expect(row).toMatchObject({ status: "COMPLETED_EMPTY", rejected_count: 1, context: { summary: empty.summary } });
    expect(await counts()).toEqual({ attempts: 1, batches: 2, records: 1 });
  });
  it("persists a genuinely zero-row dataset with its producer context", async () => {
    const empty = await zeroRowResult();
    const receipt = await service.persistGroupedAttempt({ attempt_id: randomUUID(), results: [empty] });
    expect(receipt.datasets[0].status).toBe("COMPLETED_EMPTY");
    expect(await counts()).toEqual({ attempts: 1, batches: 1, records: 0 });
  });
  it("rolls back parent and earlier children when the second child fails", async () => {
    let inserts = 0;
    const failing = changedDatabase(connection => ({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>> {
        if (sql.startsWith("INSERT INTO public.ingestion_batches") && ++inserts === 2) throw new Error("synthetic");
        return connection.query<Row>(sql, values);
      },
    }));
    const results = [await syntheticResult(), await syntheticResult(`${header}\n2026-09-02,2026-09-03,2,R,ID,A,B,C,Synthetic,MYR`)];
    await expect(createGroupedPersistenceService(failing).persistGroupedAttempt({ attempt_id: randomUUID(), results })).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(await counts()).toEqual({ attempts: 0, batches: 0, records: 0 });
  });
  it("rejects duplicate attempt IDs, including changed payloads, without additional rows", async () => {
    const attempt_id = randomUUID(), results = [await syntheticResult()];
    await service.persistGroupedAttempt({ attempt_id, results });
    await expect(service.persistGroupedAttempt({ attempt_id: attempt_id.toUpperCase(), results: [await zeroRowResult()] })).rejects.toMatchObject({ code: "IDEMPOTENCY_UNSUPPORTED" });
    expect(await counts()).toEqual({ attempts: 1, batches: 1, records: 1 });
  });
  it("does not retry after lost acknowledgement and investigates the durable committed ID", async () => {
    const uncertain: TransactionDatabase = { close: async () => {}, async transaction(work) {
      await database.transaction(work);
      throw new PersistenceError("COMMIT_OUTCOME_UNKNOWN");
    } };
    const attempt_id = randomUUID();
    await expect(createGroupedPersistenceService(uncertain).persistGroupedAttempt({ attempt_id, results: [await syntheticResult()] })).rejects.toMatchObject({ code: "COMMIT_OUTCOME_UNKNOWN" });
    expect(transactions).toBe(1);
    expect(await service.investigateAttempt(attempt_id)).toMatchObject({ outcome: "CONFIRMED_COMMITTED" });
  });
  it("confirms absence only after obtaining the writer fence", async () => {
    expect(await service.investigateAttempt(randomUUID())).toMatchObject({ outcome: "CONFIRMED_NOT_COMMITTED" });
    const locked = changedDatabase(connection => ({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>> {
        if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: false }] as unknown as Row[], rowCount: 1 };
        return connection.query<Row>(sql, values);
      },
    }));
    expect(await createGroupedPersistenceService(locked).investigateAttempt(randomUUID())).toMatchObject({ outcome: "UNRESOLVED" });
    const unavailable: TransactionDatabase = { close: async () => {}, transaction: async () => { throw new Error("unavailable"); } };
    expect(await createGroupedPersistenceService(unavailable).investigateAttempt(randomUUID())).toMatchObject({ outcome: "UNRESOLVED" });
  });
  it("rejects repeated dataset identities before opening a transaction", async () => {
    const result = await syntheticResult();
    await expect(service.persistGroupedAttempt({ attempt_id: randomUUID(), results: [result, result] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(transactions).toBe(0);
  });
  it("preserves identical dataset content from independent producer batches", async () => {
    const receipt = await service.persistGroupedAttempt({ attempt_id: randomUUID(), results: await children() });
    expect(receipt.datasets).toHaveLength(2);
    expect(await counts()).toEqual({ attempts: 1, batches: 2, records: 2 });
  });
  it("returns unresolved on a replica/read-only connection or incomplete evidence", async () => {
    const replica = changedDatabase(connection => ({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>> {
        if (sql.includes("pg_is_in_recovery")) return { rows: [{ authoritative: false }] as unknown as Row[], rowCount: 1 };
        return connection.query<Row>(sql, values);
      },
    }));
    expect(await createGroupedPersistenceService(replica).investigateAttempt(randomUUID())).toMatchObject({ outcome: "UNRESOLVED" });
    const id = randomUUID();
    await db.query("INSERT INTO public.persistence_attempts(id,dataset_count) VALUES ($1,1)", [id]);
    expect(await service.investigateAttempt(id)).toMatchObject({ outcome: "UNRESOLVED" });
  });
  it("upgrades populated historical tables without changing their rows", async () => {
    const historical = await PGlite.create();
    try {
      await historical.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
      for (const path of ["../../supabase/tests/fixtures/phase1-original-schema.sql", "../../supabase/seed.sql", "../../supabase/sql/phase1-source-file-upgrade.sql"]) {
        await historical.exec(readFileSync(new URL(path, import.meta.url), "utf8"));
      }
      const before = (await historical.query("SELECT * FROM public.ingestion_batches ORDER BY id")).rows;
      await historical.exec(readFileSync(new URL("../../supabase/sql/c3b1-grouped-persistence-upgrade.sql", import.meta.url), "utf8"));
      const after = (await historical.query<Record<string, unknown>>("SELECT * FROM public.ingestion_batches ORDER BY id")).rows;
      expect(after.map(({ persistence_attempt_id, dataset_id, ...row }) => {
        expect(persistence_attempt_id).toBeNull(); expect(dataset_id).toBeNull(); return row;
      })).toEqual(before);
      expect((await historical.query<{ count: number }>("SELECT count(*)::int count FROM public.financial_records")).rows[0].count).toBe(2);
    } finally { await historical.close(); }
  });
});
