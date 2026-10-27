import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import type { TransactionDatabase } from "../../lib/server/db/postgres";
import { recordApiSecurityEvent } from "../../lib/server/security/audit-api";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import { header, syntheticResult, validRow } from "../persistence/fixtures";

const source = (path: string) => readFileSync(new URL(`../../supabase/${path}`, import.meta.url), "utf8");
const migrations = ["sql/c3b1-grouped-persistence-upgrade.sql", "sql/db02-001-warning-mutation-fence.sql",
  "sql/phase3-security-audit-upgrade.sql", "sql/phase3-security-audit-api-events.sql"];

describe("local audit storage and clean/upgrade schema compatibility", () => {
  let clean: PGlite, upgraded: PGlite;
  beforeAll(async () => {
    clean = await PGlite.create(); upgraded = await PGlite.create();
    for (const db of [clean, upgraded]) await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await clean.exec(source("sql/phase1-clean-setup.sql"));
    await upgraded.exec(source("tests/fixtures/phase1-original-schema.sql"));
    await upgraded.exec(source("seed.sql"));
    await upgraded.exec(source("sql/phase1-source-file-upgrade.sql"));
    for (const db of [clean, upgraded]) for (const path of migrations) await db.exec(source(path));
  }, 30000);
  afterAll(async () => { await clean?.close(); await upgraded?.close(); });

  it("installs both paths with the same audit and DB02 definitions and preserves historical rows", async () => {
    const signature = `SELECT c.relname, c.relrowsecurity, string_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid,a.atttypmod), ',' ORDER BY a.attnum) columns
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname='public' AND c.relname='security_audit_events' AND a.attnum>0 AND NOT a.attisdropped GROUP BY c.relname,c.relrowsecurity`;
    expect((await clean.query(signature)).rows).toEqual((await upgraded.query(signature)).rows);
    for (const db of [clean, upgraded]) {
      expect((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='issue_00_warning_mutation_fence' AND NOT tgisinternal")).rows[0]).toEqual({ n: 1 });
      expect((await db.query("SELECT has_table_privilege('anon','public.security_audit_events','SELECT') a, has_table_privilege('authenticated','public.security_audit_events','INSERT') b")).rows[0]).toEqual({ a: false, b: false });
    }
    const historical = await upgraded.query<{ n: number }>("SELECT count(*)::int n FROM public.financial_records");
    expect(historical.rows[0].n).toBeGreaterThan(0);
  });

  it("denies client roles access to audit and financial tables", async () => {
    for (const role of ["anon", "authenticated"]) {
      await clean.exec(`SET ROLE ${role}`);
      try {
        await expect(clean.query("SELECT * FROM public.security_audit_events")).rejects.toMatchObject({ code: "42501" });
        await expect(clean.query("SELECT * FROM public.financial_records")).rejects.toMatchObject({ code: "42501" });
      } finally { await clean.exec("RESET ROLE"); }
    }
  });

  it("commits allowlisted audit events and rejects financial fields", async () => {
    const database: TransactionDatabase = { close: async () => {}, transaction: work => clean.transaction(tx => work({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      },
    })) };
    const event = { actorId: "synthetic-user", organizationId: "synthetic-org", action: "transactions.list", outcome: "success",
      targetType: "transaction_collection", targetId: "transactions", requestId: "synthetic-request", approvalId: null };
    await recordApiSecurityEvent(database, event);
    await expect(recordApiSecurityEvent(database, { ...event, source_amount: "secret-value" })).rejects.toThrow();
    const rows = (await clean.query("SELECT action,outcome FROM public.security_audit_events")).rows;
    expect(rows).toEqual([{ action: "transactions.list", outcome: "success" }]);
  });

  it("checks DB02's required trigger privileges with a restricted synthetic server role", async () => {
    const database: TransactionDatabase = { close: async () => {}, transaction: work => clean.transaction(tx => work({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      },
    })) };
    await createGroupedPersistenceService(database).persistGroupedAttempt({ attempt_id: randomUUID(),
      results: [await syntheticResult(`${header}\n${validRow.replace("MYR", "MYRR")}`)] });
    const row = (await clean.query<{ id: string; source_file: string }>("SELECT id,source_file FROM public.financial_records WHERE ingestion_status='WARNING'")).rows[0];
    // Test-only BYPASSRLS role: client roles retain no grants and no production role is configured.
    await clean.exec(`CREATE ROLE synthetic_warning_writer NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO synthetic_warning_writer;
      GRANT SELECT, UPDATE(ingestion_status) ON public.financial_records TO synthetic_warning_writer;
      GRANT SELECT, UPDATE(status) ON public.ingestion_batches TO synthetic_warning_writer;
      GRANT SELECT, INSERT ON public.validation_issues TO synthetic_warning_writer;
      GRANT EXECUTE ON FUNCTION public.is_safe_source_file(text) TO synthetic_warning_writer;`);
    await clean.exec("SET ROLE synthetic_warning_writer");
    try {
      await clean.query(`INSERT INTO public.validation_issues
        (financial_record_id,issue_ordinal,rule,category,severity,field,original_value,message,source_file)
        VALUES ($1,1,'SYNTHETIC','technical','WARNING','currency','null'::jsonb,'Synthetic only',$2)`, [row.id, row.source_file]);
      await expect(clean.query("UPDATE public.financial_records SET source_amount=0 WHERE id=$1", [row.id])).rejects.toMatchObject({ code: "42501" });
      await expect(clean.query("SELECT * FROM public.security_audit_events")).rejects.toMatchObject({ code: "42501" });
    } finally { await clean.exec("RESET ROLE"); }
    expect((await clean.query("SELECT count(*)::int n FROM public.validation_issues WHERE financial_record_id=$1", [row.id])).rows[0]).toEqual({ n: 2 });
  });
});
