import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import type { TransactionDatabase } from "../../lib/server/db/postgres";
import { consultationResults } from "./fixtures";

describe("real producer → Celester grouped persistence, disposable database only", () => {
  it("atomically stores 1 attempt, 3 distinct child batches, 23 accepted records and 3 warning issues", async () => {
    const db = await PGlite.create();
    try {
      await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
      for (const file of ["phase1-clean-setup.sql", "c3b1-grouped-persistence-upgrade.sql"]) {
        await db.exec(readFileSync(new URL("../../supabase/sql/" + file, import.meta.url), "utf8"));
      }
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
      const results = await consultationResults();
      const before = structuredClone(results);
      // Allocate before entering the transaction; retain on an uncertain outcome.
      const attempt_id = randomUUID();
      const receipt = await createGroupedPersistenceService(database).persistGroupedAttempt({ attempt_id, results });
      expect(transactions).toBe(1);
      expect(receipt.attempt_id).toBe(attempt_id);
      expect(receipt.datasets).toHaveLength(3);
      expect(receipt.datasets.map(r => r.source_file)).toEqual(results.map(r => r.dataset.file.name));
      expect(receipt.datasets.map(r => r.ingestion_batch_id)).toEqual(results.map(r => r.context.batchId));
      expect(new Set(receipt.datasets.map(r => r.batch_id)).size).toBe(3);
      const count = (await db.query(`SELECT
        (SELECT count(*)::int FROM public.persistence_attempts) attempts,
        (SELECT count(*)::int FROM public.ingestion_batches) batches,
        (SELECT sum(rows_received)::int FROM public.ingestion_batches) received,
        (SELECT sum(valid_count)::int FROM public.ingestion_batches) valid,
        (SELECT sum(warning_count)::int FROM public.ingestion_batches) warning,
        (SELECT sum(rejected_count)::int FROM public.ingestion_batches) rejected,
        (SELECT count(*)::int FROM public.financial_records) financial_records,
        (SELECT count(*)::int FROM public.validation_issues) warning_issues,
        (SELECT count(*)::int FROM public.financial_records WHERE ingestion_status='REJECTED') rejected_financial_records`)).rows[0];
      expect(count).toEqual({ attempts: 1, batches: 3, received: 26, valid: 20, warning: 3, rejected: 3, financial_records: 23, warning_issues: 3, rejected_financial_records: 0 });
      expect(results).toEqual(before);
      // Counts and IDs only: do not print complete transaction contents.
      console.log("SYNTHETIC / LOCAL-ONLY grouped persistence:", JSON.stringify({ attempt_id, counts: count, child_batches: receipt.datasets.map(d => ({ batch_id: d.batch_id, producer_batch: d.ingestion_batch_id, source_file: d.source_file, status: d.status })) }));
    } finally { await db.close(); }
  }, 30000);
});
