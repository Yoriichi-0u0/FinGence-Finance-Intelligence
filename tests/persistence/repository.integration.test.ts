import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { createPostgresDatabase, serverPoolConfig, transactionDatabase, type TransactionDatabase } from "../../lib/server/db/postgres";
import { createPersistenceRepository } from "../../lib/server/persistence/repository";
import { preparePersistencePlan } from "../../lib/server/persistence/map";
import { createPersistenceService } from "../../lib/server/persistence/service";
import { runPhase2File } from "../../lib/server/cli/phase2";
import { clone, header, syntheticResult, validRow } from "./fixtures";

let local: PGlite, socket: PGLiteSocketServer, database: TransactionDatabase;
beforeAll(async () => {
  local = await PGlite.create();
  await local.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await local.exec(readFileSync(new URL("../../supabase/sql/phase1-clean-setup.sql", import.meta.url), "utf8"));
  socket = new PGLiteSocketServer({ db: local, host: "127.0.0.1", port: 0, maxConnections: 1 });
  await socket.start();
  database = createPostgresDatabase({ SUPABASE_DATABASE_URL: `postgres://postgres@${socket.getServerConn()}/postgres?sslmode=disable` });
}, 30_000);
beforeEach(async () => {
  // A destroyed pg client may release the pool before the server observes TCP
  // close. With maxConnections=1, reusing the next pool immediately is racy on
  // Linux. Isolate each test and await the actual socket state, never retry a write.
  await database?.close();
  await vi.waitFor(() => expect(socket.getStats().activeConnections).toBe(0));
  await local.exec("TRUNCATE public.validation_issues, public.financial_records, public.ingestion_batches;");
  database = createPostgresDatabase({ SUPABASE_DATABASE_URL: `postgres://postgres@${socket.getServerConn()}/postgres?sslmode=disable` });
});
afterAll(async () => {
  await database?.close();
  await socket?.stop();
  await local?.close();
});
async function assertEmpty() {
  const result = await local.query<{ batches: number; records: number; issues: number }>(
    "SELECT (SELECT count(*)::int FROM public.ingestion_batches) AS batches, (SELECT count(*)::int FROM public.financial_records) AS records, (SELECT count(*)::int FROM public.validation_issues) AS issues");
  expect(result.rows[0]).toEqual({ batches: 0, records: 0, issues: 0 });
}
async function persist(input?: Awaited<ReturnType<typeof syntheticResult>>) {
  const result = input ?? await syntheticResult();
  return createPersistenceService(createPersistenceRepository(database)).persistNewAttempt({ intent: "NEW_ATTEMPT_NO_RETRY", results: [result] });
}

describe("repository with real PostgreSQL execution and pg wire protocol", () => {
  it("runs the physical CLI path locally and persists the basename in all three tables", async () => {
    const output: string[] = [];
    const receipt = await runPhase2File("tests/phase2_financial_input.csv", () => database, line => output.push(line));
    const rows = await local.query<{ batch_file: string; record_file: string; issue_file: string | null; ingestion_status: string }>(
      "SELECT b.source_file AS batch_file, r.source_file AS record_file, i.source_file AS issue_file, r.ingestion_status FROM public.ingestion_batches b JOIN public.financial_records r ON r.batch_id=b.id LEFT JOIN public.validation_issues i ON i.financial_record_id=r.id WHERE b.id=$1", [receipt.batch_id]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map(row => row.ingestion_status).sort()).toEqual(["VALID", "WARNING"]);
    for (const row of rows.rows) {
      expect(row.batch_file).toBe("phase2_financial_input.csv");
      expect(row.record_file).toBe(row.batch_file);
      if (row.ingestion_status === "WARNING") expect(row.issue_file).toBe(row.batch_file);
    }
    expect(output.join("\n")).toContain("REJECTED: 1");
    expect(output.at(-1)).toBe("\nSUCCESS");
  });
  it("rejects inconsistent provenance updates at every relationship", async () => {
    const result = await syntheticResult(`${header}\n2026-09-01,2026-09-03,-2,,,,,,,MYRR`);
    const receipt = await persist(result);
    for (const sql of [
      "UPDATE public.ingestion_batches SET source_file='other.csv'",
      "UPDATE public.ingestion_batches SET source_file=NULL",
      "UPDATE public.financial_records SET source_file='other.csv'",
      "UPDATE public.validation_issues SET source_file='other.csv'",
      "UPDATE public.validation_issues SET source_file=NULL",
    ]) await expect(local.exec(sql)).rejects.toMatchObject({ code: "23514" });
    expect((await local.query<{ source_file: string }>("SELECT source_file FROM public.ingestion_batches WHERE id=$1", [receipt.batch_id])).rows[0].source_file).toBe(result.dataset.file.name);
  });


  it("rejects inconsistent direct SQL record/issue inserts without partial writes", async () => {
    const result = await syntheticResult(`${header}\n2026-09-01,2026-09-03,-2,,,,,,,MYRR`);
    await persist(result);
    const columns = (await local.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='financial_records' AND column_name <> 'id' ORDER BY ordinal_position")).rows.map(row => row.column_name);
    // Catalog names from this exact local migration only; source values remain parameters.
    const selected = columns.map(column => column === "source_file" ? "$1" : column).join(", ");
    await expect(local.query(`INSERT INTO public.financial_records (${columns.join(", ")}) SELECT ${selected} FROM public.financial_records LIMIT 1`, ["other.csv"])).rejects.toMatchObject({ code: "23514" });
    await expect(local.query("INSERT INTO public.validation_issues (financial_record_id, issue_ordinal, rule, category, severity, field, source_column, original_value, message, source_file) SELECT financial_record_id, issue_ordinal + 100, rule, category, severity, field, source_column, original_value, message, $1 FROM public.validation_issues LIMIT 1", ["other.csv"])).rejects.toMatchObject({ code: "23514" });
    expect((await local.query<{ count: number }>("SELECT count(*)::int AS count FROM public.financial_records")).rows[0].count).toBe(1);
  });
  it("stores VALID rows with database UUIDs, exact NUMERIC, zeros, dates and all lineage without mutation", async () => {
    const result = await syntheticResult(undefined, { dateBasis: "posting_date" }), before = clone(result);
    const receipt = await persist(result);
    expect(receipt).toMatchObject({ outcome: "PERSISTED_NEW_ATTEMPT", ingestion_batch_id: result.context.batchId, accepted_record_count: 1, warning_count: 0 });
    expect(receipt.batch_id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await database.transaction(connection => connection.query("SELECT *, source_amount::text AS exact FROM public.financial_records WHERE batch_id = $1", [receipt.batch_id]));
    const row = rows.rows[0], expected = result.normalized[0];
    expect(row).toMatchObject({ batch_id: receipt.batch_id, source_amount: "9007199254740993.123456789", exact: "9007199254740993.123456789",
      reference: "00017", source_transaction_id: "00042", account_code: "00100", account_id: "00003", entity_id: "00004",
      transaction_date: "2026-09-01", posting_date: "2026-09-03", canonical_date: "2026-09-03", canonical_date_basis: "POSTING_DATE",
      source_row_id: expected.source_row_id, source_system: expected.source_system, source_file: expected.source_file,
      source_sheet: null, source_row_number: 2, file_sha256: expected.file_sha256, ingestion_batch_id: expected.ingestion_batch_id,
      ingestion_status: "VALID", debit: null, credit: null, balance: null, derived_ledger_net: null });
    expect(new Date(String(row.ingested_at)).toISOString()).toBe(expected.ingested_at);
    expect(row.id).not.toBe(row.source_row_id);
    expect(result).toEqual(before);
    const batch = (await local.query<Record<string, unknown>>("SELECT * FROM public.ingestion_batches WHERE id = $1", [receipt.batch_id])).rows[0];
    expect(batch).toMatchObject({ status: "ACTIVE", rows_received: 1, valid_count: 1, warning_count: 0, rejected_count: 0, supersedes_batch_id: null });
    expect(batch.completed_at).not.toBeNull();
  });
  it("stores WARNING relationships and ordered messages with JSON null/text/boolean/Excel evidence", async () => {
    const result = await syntheticResult(`${header}\n2026-09-01,2026-09-03,-2,,,,,,,MYRR`);
    const originals = [null, false, "00017", { kind: "excel_number" as const, value: "9007199254740993.10" }, { kind: "excel_date" as const, value: "2026-09-01T00:00:00.000Z" }];
    result.normalized[0].validation_messages = originals.map((originalValue, index) => ({ rule: `SYNTHETIC_${index}`, category: "technical",
      severity: "WARNING", field: "reference", sourceColumn: null, originalValue, message: "Synthetic only" }));
    result.records[0].issues = clone(result.normalized[0].validation_messages);
    const before = clone(result), receipt = await persist(result);
    expect(receipt.warning_count).toBe(1);
    const issues = await local.query<Record<string, unknown>>("SELECT i.*, r.batch_id FROM public.validation_issues i JOIN public.financial_records r ON r.id=i.financial_record_id ORDER BY issue_ordinal");
    expect(issues.rows.map(row => row.original_value)).toEqual(originals);
    expect(issues.rows.map(row => row.issue_ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(issues.rows.every(row => row.batch_id === receipt.batch_id && row.financial_record_id)).toBe(true);
    expect((await local.query<Record<string, unknown>>("SELECT source_amount::text AS amount FROM public.financial_records")).rows[0].amount).toBe("-2");
    expect(result).toEqual(before);
  });
  it("stores approved transformations and ledger representations exactly", async () => {
    const result = await syntheticResult("transaction_date,debit,credit,amount,balance,reference,description,currency\n2026-09-01,,9007199254740993.1,-99.123456789,0,R,Synthetic,MYR", { monetaryMode: "debit_credit", blankSideAsZero: true });
    await persist(result);
    const row = (await local.query<Record<string, unknown>>("SELECT debit::text, credit::text, derived_ledger_net::text, source_amount::text, balance::text, transformations FROM public.financial_records")).rows[0];
    expect(row).toEqual({ debit: "0", credit: "9007199254740993.1", derived_ledger_net: "-9007199254740993.1", source_amount: "-99.123456789", balance: "0", transformations: result.normalized[0].transformations });
  });
  it("excludes REJECTED records and verifies counts for multiple accepted rows", async () => {
    const result = await syntheticResult(`${header}\n${validRow}\n${validRow}\ninvalid,2026-09-03,nope,R,ID,A,B,C,Synthetic,MYR`);
    const receipt = await persist(result);
    expect(receipt).toMatchObject({ accepted_record_count: 2, warning_count: 1 });
    expect((await local.query<Record<string, unknown>>("SELECT rows_received, valid_count, warning_count, rejected_count FROM public.ingestion_batches")).rows[0]).toEqual({ rows_received: 3, valid_count: 1, warning_count: 1, rejected_count: 1 });
    expect((await local.query<Record<string, unknown>>("SELECT ingestion_status FROM public.financial_records")).rows.map(row => row.ingestion_status).sort()).toEqual(["VALID", "WARNING"]);
  });
  it("fails safely for all-rejected input while its activation policy remains OPEN", async () => {
    const result = await syntheticResult(`${header}\ninvalid,2026-09-03,nope,R,ID,A,B,C,Synthetic,MYR`);
    await expect(persist(result)).rejects.toMatchObject({ code: "EMPTY_ACCEPTED_BATCH_UNSUPPORTED" });
    await assertEmpty();
  });
  it("handles SQL-injection-shaped source values as literal parameters", async () => {
    const value = "synthetic'); DROP TABLE public.financial_records; --";
    const result = await syntheticResult(`${header}\n2026-09-01,2026-09-03,2,${value},ID,A,B,C,Synthetic,MYR`);
    await persist(result);
    expect((await local.query<Record<string, unknown>>("SELECT reference FROM public.financial_records")).rows[0].reference).toBe(value);
    expect((await local.query<Record<string, unknown>>("SELECT count(*)::int AS count FROM public.financial_records")).rows[0].count).toBe(1);
  });
  it.each(["public.ingestion_batches", "public.financial_records"])("rolls back injected failure after inserting %s", async table => {
    const injected: TransactionDatabase = {
      close: async () => {},
      transaction: work => database.transaction(connection => work({
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          const response = await connection.query<Row>(sql, values);
          if (sql.startsWith(`INSERT INTO ${table}`)) throw new Error("synthetic failure with private content");
          return response;
        },
      })),
    };
    await expect(createPersistenceRepository(injected).persistNewAttempt(preparePersistencePlan({ results: [await syntheticResult()] }))).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    await assertEmpty();
  });
  it("rolls back a real database error during warning insertion", async () => {
    const result = await syntheticResult(`${header}\n2026-09-01,2026-09-03,-2,,,,,,,MYRR`);
    const plan = preparePersistencePlan({ results: [result] });
    Object.assign(plan.datasets[0].records[0].validation_issues[0], { category: "invalid" });
    await expect(createPersistenceRepository(database).persistNewAttempt(plan)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    await assertEmpty();
  });
  it("rolls back real deferred warning constraints at COMMIT and returns no receipt", async () => {
    const result = await syntheticResult(`${header}\n2026-09-01,2026-09-03,-2,,,,,,,MYRR`);
    const plan = preparePersistencePlan({ results: [result] });
    plan.datasets[0].records[0].validation_issues = [];
    await expect(createPersistenceRepository(database).persistNewAttempt(plan)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    await assertEmpty();
  });
  it("rolls back count verification failures", async () => {
    const plan = preparePersistencePlan({ results: [await syntheticResult()] });
    plan.batch.rows_received = 2; plan.batch.valid_count = 2;
    await expect(createPersistenceRepository(database).persistNewAttempt(plan)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    await assertEmpty();
  });
  it("returns a safe unavailable error from a closed real pg pool", async () => {
    const closed = createPostgresDatabase({ SUPABASE_DATABASE_URL: `postgres://postgres@${socket.getServerConn()}/postgres?sslmode=disable` });
    await closed.close();
    await expect(createPersistenceService(createPersistenceRepository(closed)).persistNewAttempt({ intent: "NEW_ATTEMPT_NO_RETRY", results: [await syntheticResult()] })).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    await assertEmpty();
  });
  it("does not return success or retry after an actual COMMIT with lost acknowledgement", async () => {
    // Release the shared pool's connection so the single-connection local server can accept this pool.
    await database.close();
    const configuration = { SUPABASE_DATABASE_URL: `postgres://postgres@${socket.getServerConn()}/postgres?sslmode=disable` };
    const pool = new Pool(serverPoolConfig(configuration));
    const uncertain = transactionDatabase({
      end: () => pool.end(),
      async connect() {
        const client = await pool.connect();
        return {
          release: (destroy?: boolean) => client.release(destroy),
          async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
            const response = await client.query<Row>(sql, values);
            if (sql === "COMMIT") throw new Error("synthetic lost acknowledgement");
            return response;
          },
        };
      },
    });
    try {
      await expect(createPersistenceRepository(uncertain).persistNewAttempt(preparePersistencePlan({ results: [await syntheticResult()] }))).rejects.toMatchObject({ code: "COMMIT_OUTCOME_UNKNOWN" });
      // Unknown is not equivalent to rollback: the database really committed once.
      expect((await local.query<{ count: number }>("SELECT count(*)::int AS count FROM public.ingestion_batches")).rows[0].count).toBe(1);
      expect((await local.query<{ count: number }>("SELECT count(*)::int AS count FROM public.financial_records")).rows[0].count).toBe(1);
    } finally {
      await uncertain.close();
      database = createPostgresDatabase(configuration);
    }
  });
  it("does not allow repository REJECTED insertion", async () => {
    const plan = preparePersistencePlan({ results: [await syntheticResult()] });
    Object.assign(plan.datasets[0].records[0].financial_record, { ingestion_status: "REJECTED" });
    await expect(createPersistenceRepository(database).persistNewAttempt(plan)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    await assertEmpty();
  });
  it("preserves historical attempts and never automatically supersedes them", async () => {
    const result = await syntheticResult();
    const a = await persist(result), b = await persist(result);
    expect(a.batch_id).not.toBe(b.batch_id);
    expect((await local.query<Record<string, unknown>>("SELECT status, supersedes_batch_id FROM public.ingestion_batches")).rows).toEqual([
      { status: "ACTIVE", supersedes_batch_id: null }, { status: "ACTIVE", supersedes_batch_id: null },
    ]);
    // Two explicitly new attempts are history, NOT retry/idempotency protection.
  });
  it.each(["anon", "authenticated"])("keeps RLS and client denial for %s", async role => {
    await persist();
    expect((await local.query<Record<string, unknown>>("SELECT count(*)::int AS count FROM pg_policies WHERE tablename IN ('ingestion_batches','financial_records','validation_issues')")).rows[0].count).toBe(0);
    for (const table of ["ingestion_batches", "financial_records", "validation_issues"]) {
      await local.exec(`SET ROLE ${role};`);
      try {
        await expect(local.query<Record<string, unknown>>(`SELECT * FROM public.${table}`)).rejects.toMatchObject({ code: "42501" });
        await expect(local.query<Record<string, unknown>>(`INSERT INTO public.${table} DEFAULT VALUES`)).rejects.toMatchObject({ code: "42501" });
      } finally { await local.exec("RESET ROLE;"); }
    }
    await local.exec(`BEGIN; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON public.ingestion_batches, public.financial_records, public.validation_issues TO ${role}; SET ROLE ${role};`);
    try {
      for (const table of ["ingestion_batches", "financial_records", "validation_issues"]) expect((await local.query<Record<string, unknown>>(`SELECT * FROM public.${table}`)).rows).toEqual([]);
    } finally { await local.exec("RESET ROLE; ROLLBACK;"); }
    expect((await local.query<Record<string, unknown>>("SELECT relrowsecurity FROM pg_class WHERE oid IN ('public.ingestion_batches'::regclass,'public.financial_records'::regclass,'public.validation_issues'::regclass)")).rows.every(row => row.relrowsecurity)).toBe(true);
  });
});
