import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import type { TransactionDatabase } from "../../lib/server/db/postgres";
import { syntheticResult, header, validRow } from "./fixtures";

describe("DB02 lifecycle and financial integrity on the migrated schema (PGlite)", () => {
  let db: PGlite;
  const database: TransactionDatabase = { close: async () => {}, transaction: work => db.transaction(tx => work({
    async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      const result = await tx.query<Row>(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
  })) };
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    for (const file of ["phase1-clean-setup.sql", "c3b1-grouped-persistence-upgrade.sql", "db02-001-warning-mutation-fence.sql"]) {
      await db.exec(readFileSync(new URL(`../../supabase/sql/${file}`, import.meta.url), "utf8"));
    }
  }, 30000);
  beforeEach(async () => { await db.exec("TRUNCATE public.validation_issues,public.financial_records,public.ingestion_batches,public.persistence_attempts;"); });
  afterAll(async () => { await db?.close(); });
  const writer = () => createGroupedPersistenceService(database);
  async function mixed() {
    return writer().persistGroupedAttempt({ attempt_id: randomUUID(), results: [await syntheticResult(
      `${header}\n${validRow}\n${validRow.replace("MYR", "MYRR")}\n${validRow.replace("2026-09-01", "invalid")}`)] });
  }
  async function recordIds() {
    return (await db.query<{ id: string; ingestion_status: string }>("SELECT id,ingestion_status FROM public.financial_records ORDER BY ingestion_status")).rows;
  }
  it("writer completes accepted and all-rejected children with exact counts and completion timestamps", async () => {
    const receipt = await mixed();
    const batch = (await db.query("SELECT status,rows_received,valid_count,warning_count,rejected_count,completed_at>=created_at completed FROM public.ingestion_batches")).rows[0];
    expect(batch).toEqual({ status: "ACTIVE", rows_received: 3, valid_count: 1, warning_count: 1, rejected_count: 1, completed: true });
    expect((await db.query("SELECT count(*)::int n FROM public.financial_records")).rows[0]).toEqual({ n: 2 });
    expect(await writer().investigateAttempt(receipt.attempt_id)).toMatchObject({ outcome: "CONFIRMED_COMMITTED" });
    const empty = await writer().persistGroupedAttempt({ attempt_id: randomUUID(), results: [await syntheticResult(`${header}\n${validRow.replace("2026-09-01", "invalid")}`)] });
    expect(empty.datasets[0]).toMatchObject({ status: "COMPLETED_EMPTY", accepted_record_count: 0 });
    expect((await db.query("SELECT completed_at IS NOT NULL complete FROM public.ingestion_batches WHERE id=$1", [empty.datasets[0].batch_id])).rows[0]).toEqual({ complete: true });
  });
  const statuses = ["PROCESSING", "ACTIVE", "SUPERSEDED", "FAILED", "COMPLETED_EMPTY"];
  it.each(statuses.flatMap(from => statuses.map(to => ({ from, to }))))("documents SQL permitting $from -> $to without declaring a business transition", async ({ from, to }) => {
    const id = randomUUID();
    await db.query(`INSERT INTO public.ingestion_batches(id,ingestion_batch_id,schema_version,ruleset_version,status,completed_at)
      VALUES($1,'synthetic-matrix','0.1','0.1',$2,clock_timestamp())`, [id, from]);
    expect((await db.query("UPDATE public.ingestion_batches SET status=$2 WHERE id=$1 RETURNING status", [id, to])).rows[0]).toEqual({ status: to });
  });
  it("rejects unknown status, invalid counts, completion before creation and nonempty COMPLETED_EMPTY", async () => {
    const batch = (await mixed()).datasets[0].batch_id;
    for (const sql of ["SET status='UNKNOWN'", "SET rows_received=0", "SET completed_at=created_at-interval '1 second'", "SET status='COMPLETED_EMPTY'"]) {
      await expect(db.query(`UPDATE public.ingestion_batches ${sql} WHERE id=$1`, [batch])).rejects.toMatchObject({ code: "23514" });
    }
    const empty = (await db.query("INSERT INTO public.ingestion_batches(ingestion_batch_id,schema_version,ruleset_version) VALUES('synthetic-new','0.1','0.1') RETURNING status,completed_at")).rows[0];
    expect(empty).toEqual({ status: "PROCESSING", completed_at: null });
  });
  it("demonstrates privileged child/count drift and attempt cardinality remain outside cross-table SQL enforcement", async () => {
    const receipt = await mixed();
    await db.query("UPDATE public.ingestion_batches SET rows_received=10,valid_count=8 WHERE id=$1", [receipt.datasets[0].batch_id]);
    expect((await db.query("SELECT valid_count FROM public.ingestion_batches")).rows[0]).toEqual({ valid_count: 8 });
    await db.query("UPDATE public.persistence_attempts SET dataset_count=2 WHERE id=$1", [receipt.attempt_id]);
    expect(await writer().investigateAttempt(receipt.attempt_id)).toMatchObject({ outcome: "UNRESOLVED" });
  });
  it("protects parent FKs, producer/batch association, filenames and paired group metadata", async () => {
    const receipt = await mixed(), records = await recordIds();
    for (const sql of ["DELETE FROM public.ingestion_batches", "DELETE FROM public.persistence_attempts"]) await expect(db.exec(sql)).rejects.toMatchObject({ code: "23001" });
    await expect(db.query("UPDATE public.financial_records SET ingestion_batch_id='another-producer' WHERE id=$1", [records[0].id])).rejects.toMatchObject({ code: "23503" });
    await expect(db.exec("UPDATE public.financial_records SET source_file='other.csv'")).rejects.toMatchObject({ code: "23514" });
    await expect(db.exec("UPDATE public.ingestion_batches SET source_file='other.csv'")).rejects.toMatchObject({ code: "23514" });
    await expect(db.exec("UPDATE public.validation_issues SET source_file='other.csv'")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE public.ingestion_batches SET dataset_id=NULL WHERE id=$1", [receipt.datasets[0].batch_id])).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects orphaned WARNING, issues on VALID, unsafe reassignment and record deletion with referenced issues", async () => {
    await mixed(); const records = await recordIds();
    const valid = records.find(r => r.ingestion_status === "VALID")!, warning = records.find(r => r.ingestion_status === "WARNING")!;
    await expect(db.query("UPDATE public.financial_records SET ingestion_status='WARNING' WHERE id=$1", [valid.id])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE public.financial_records SET ingestion_status='VALID' WHERE id=$1", [warning.id])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("DELETE FROM public.validation_issues WHERE financial_record_id=$1", [warning.id])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE public.validation_issues SET financial_record_id=$1", [valid.id])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("DELETE FROM public.financial_records WHERE id=$1", [warning.id])).rejects.toMatchObject({ code: "23001" });
    // Legitimate coherent removal in one transaction remains possible; batch totals are not recounted by SQL.
    await db.transaction(async tx => {
      await tx.query("DELETE FROM public.validation_issues WHERE financial_record_id=$1", [warning.id]);
      await tx.query("DELETE FROM public.financial_records WHERE id=$1", [warning.id]);
    });
    expect((await db.query("SELECT count(*)::int n FROM public.financial_records")).rows[0]).toEqual({ n: 1 });
  });
  it("preserves exact NUMERIC/NULL and enforces dates, monetary bases, accepted status and lineage shape", async () => {
    await mixed();
    expect((await db.query("SELECT source_amount::text,balance FROM public.financial_records LIMIT 1")).rows[0])
      .toEqual({ source_amount: "9007199254740993.123456789", balance: null });
    for (const sql of ["ingestion_status='REJECTED'", "canonical_date=canonical_date+1", "monetary_basis='debit_credit'", "source_amount='NaN'::numeric", "currency_basis=NULL", "source_row_number=0", "file_sha256='bad'"]) {
      await expect(db.exec(`UPDATE public.financial_records SET ${sql}`)).rejects.toMatchObject({ code: "23514" });
    }
    // Source coordinates are lineage, not a unique economic identity. No new deduplication constraint.
    await db.exec("UPDATE public.financial_records SET source_row_id='same-lineage',source_sheet=NULL");
    expect((await db.query("SELECT count(*)::int n FROM public.financial_records WHERE source_row_id='same-lineage'")).rows[0]).toEqual({ n: 2 });
  });
  it("rejects duplicate grouped identities before any attempt is stored; no global dataset-ID uniqueness is invented", async () => {
    const result = await syntheticResult();
    await expect(writer().persistGroupedAttempt({ attempt_id: randomUUID(), results: [result, result] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await db.query("SELECT count(*)::int n FROM public.persistence_attempts")).rows[0]).toEqual({ n: 0 });
    const other = await syntheticResult(undefined, {}, { batchId: "synthetic-other", ingestedAt: "2026-10-03T00:00:00Z" }, "other.csv");
    const receipt = await writer().persistGroupedAttempt({ attempt_id: randomUUID(), results: [result, other] });
    expect(receipt.datasets).toHaveLength(2);
  });
});
