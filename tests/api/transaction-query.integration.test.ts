import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { createTransactionQueryService } from "../../lib/server/api/transaction-query";
import { access, batchA, batchB, harness } from "./transaction-query.fixtures";

describe("transaction query against disposable PostgreSQL/WASM through pg", () => {
  let local: PGlite, socket: PGLiteSocketServer, pool: Pool;
  const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  beforeAll(async () => {
    local = await PGlite.create();
    await local.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await local.exec(readFileSync(new URL("../../supabase/sql/phase1-clean-setup.sql", import.meta.url), "utf8"));
    await local.exec(readFileSync(new URL("../../supabase/sql/c3b1-grouped-persistence-upgrade.sql", import.meta.url), "utf8"));
    // Only a fresh in-memory database; no environment files or hosted connection.
    for (const batch of [batchA, batchB]) await local.query(`INSERT INTO public.ingestion_batches
      (id, ingestion_batch_id, schema_version, ruleset_version) VALUES ($1, 'synthetic-producer', '0.1', '0.1')`, [batch]);
    await local.exec("BEGIN");
    for (let n = 1; n <= 7; n++) {
      const day = n <= 3 ? "2026-09-03" : "2026-09-02";
      await local.query(`INSERT INTO public.financial_records
        (id, batch_id, ingestion_batch_id, source_row_id, source_file, canonical_date, transaction_date,
         posting_date, canonical_date_basis, reference, account_code, source_amount, debit, credit,
         derived_ledger_net, monetary_basis, entry_side, currency, currency_basis, ingestion_status,
         source_system, source_row_number, file_sha256, ingested_at)
        VALUES ($1, $2, 'synthetic-producer', $3, 'synthetic.csv', $4, $4, '2026-09-04',
          'TRANSACTION_DATE', '00042', '00100', $5, $6, $7, $8, $9, $10, $11, $12, $13,
          'Synthetic', $14, $15, '2026-09-05T00:00:00Z')`,
      [id(n), n === 7 ? batchB : batchA, `000${n}`, day,
        n === 5 ? null : n === 4 ? "125.50" : "9007199254740993.123456789",
        n === 5 ? "0.00" : null, n === 5 ? "125.50" : null, n === 5 ? "-125.50" : null,
        n === 5 ? "debit_credit" : n === 4 ? "source_amount_with_direction" : "source_signed_amount",
        n === 4 ? "DEBIT" : null, n === 6 ? null : n === 2 ? "MYRR" : "MYR",
        n === 6 ? null : "SOURCE", n === 2 ? "WARNING" : "VALID", n, "a".repeat(64)]);
    }
    await local.query(`INSERT INTO public.validation_issues
      (financial_record_id, issue_ordinal, rule, category, severity, field, original_value, message)
      VALUES ($1, 0, 'MALFORMED_CURRENCY', 'business', 'WARNING', 'currency', 'null', 'Synthetic warning')`, [id(2)]);
    await local.exec("COMMIT");
    socket = new PGLiteSocketServer({ db: local, host: "127.0.0.1", port: 0, maxConnections: 1 });
    await socket.start();
    const address = new URL(`postgres://postgres@${socket.getServerConn()}/postgres`);
    pool = new Pool({ host: address.hostname, port: Number(address.port), user: "postgres", database: "postgres", max: 1,
      connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  }, 30000);
  afterAll(async () => { await pool?.end(); await socket?.stop(); await local?.close(); });
  function setup() {
    const h = harness(); return { ...h, service: createTransactionQueryService({ ...h.dependencies, database: pool }) };
  }
  it("preserves ISO dates, NULLs and filtered keyset pages under SQL, DMY DateStyle", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Exercise both nullable source-date columns without changing shared fixtures.
      await client.query(`UPDATE public.financial_records SET transaction_date = NULL,
        canonical_date_basis = 'POSTING_DATE', posting_date = canonical_date WHERE id = $1`, [id(6)]);
      await client.query("UPDATE public.financial_records SET posting_date = NULL WHERE id = $1", [id(5)]);
      const { dependencies } = harness();
      const service = createTransactionQueryService({ ...dependencies, database: client });
      async function pages() {
        const items = [];
        let cursor: string | null = null;
        do {
          const query = new URLSearchParams({ limit: "2", date_from: "2026-09-02", date_to: "2026-09-03" });
          if (cursor !== null) query.set("cursor", cursor);
          const page = await service.list(query, null);
          items.push(...page.items); cursor = page.nextCursor;
        } while (cursor !== null);
        return items;
      }
      await client.query("SET DateStyle TO 'ISO, MDY'");
      const baseline = await pages();
      await client.query("SET DateStyle TO 'SQL, DMY'");
      expect((await client.query("SELECT DATE '2026-09-03'::text AS value")).rows[0].value).toBe("03/09/2026");
      const actual = await pages();
      expect(actual).toEqual(baseline);
      expect(actual.map(row => row.transaction_id)).toEqual([3, 2, 1, 6, 5, 4].map(id));
      expect(actual[0]).toMatchObject({ canonical_date: "2026-09-03", transaction_date: "2026-09-03", posting_date: "2026-09-04" });
      expect(actual.find(row => row.transaction_id === id(6))).toMatchObject({
        canonical_date: "2026-09-02", transaction_date: null, posting_date: "2026-09-02", canonical_date_basis: "POSTING_DATE" });
      expect(actual.find(row => row.transaction_id === id(5))).toMatchObject({ posting_date: null });
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("paginates equal dates with descending UUID tie-breaks without omissions or duplicates", async () => {
    const { service } = setup(); const ids: string[] = []; let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: "2" }); if (cursor) query.set("cursor", cursor);
      const page = await service.list(query, null); ids.push(...page.items.map(row => row.transaction_id)); cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual([3, 2, 1, 6, 5, 4].map(id)); expect(new Set(ids).size).toBe(6);
  });
  it.each([
    [{ date_from: "2026-09-03" }, [3, 2, 1]],
    [{ date_to: "2026-09-02" }, [6, 5, 4]],
    [{ date_from: "2026-09-03", date_to: "2026-09-03" }, [3, 2, 1]],
    [{ batch_id: batchA }, [3, 2, 1, 6, 5, 4]],
    [{ status: "WARNING" }, [2]],
    [{ status: "VALID", currency: "MYR", monetary_basis: "source_signed_amount" }, [3, 1]],
    [{ monetary_basis: "source_amount_with_direction" }, [4]],
    [{ monetary_basis: "debit_credit" }, [5]],
    [{ currency: "USD" }, []],
    [{ date_from: "2027-01-01" }, []],
  ] as const)("applies inclusive and combined filters: %o", async (filters, expected) => {
    const { service } = setup();
    const page = await service.list(new URLSearchParams(filters), null);
    expect(page.items.map(row => row.transaction_id)).toEqual(expected.map(id)); expect(page.nextCursor).toBeNull();
  });
  it("preserves exact NUMERIC text, NULLs, source identifiers, WARNING currency and direction", async () => {
    const { service } = setup(); const { items } = await service.list(new URLSearchParams(), null);
    expect(items[0]).toMatchObject({ source_amount: "9007199254740993.123456789", source_row_id: "0003",
      ingestion_batch_id: "synthetic-producer", reference: "00042", account_code: "00100", balance: null,
      debit: null, posting_date: "2026-09-04", canonical_date: "2026-09-03" });
    expect(items.find(row => row.transaction_id === id(2))).toMatchObject({ currency: "MYRR", ingestion_status: "WARNING" });
    expect(items.find(row => row.transaction_id === id(6))).toMatchObject({ currency: null, currency_basis: null });
    expect(items.find(row => row.transaction_id === id(4))).toMatchObject({ source_amount: "125.50", entry_side: "DEBIT", derived_ledger_net: null });
    expect(items.find(row => row.transaction_id === id(5))).toMatchObject({ debit: "0.00", credit: "125.50", derived_ledger_net: "-125.50", source_amount: null });
    expect(items[0]).not.toHaveProperty("source_file");
  });
  it.each(["subject", "organization", "scope", "batches", "filters", "limit", "token"])("rejects cursor replay after %s changes", async change => {
    const { service, mocks } = setup(); const first = await service.list(new URLSearchParams({ limit: "1" }), null);
    const query = new URLSearchParams({ limit: "1", cursor: first.nextCursor! });
    if (change === "subject") mocks.resolveAccess.mockResolvedValue({ ...access, subjectId: "other" });
    if (change === "organization") mocks.resolveAccess.mockResolvedValue({ ...access, organizationId: "other" });
    if (change === "scope") mocks.resolveAccess.mockResolvedValue({ ...access, scopeVersion: "v2" });
    if (change === "batches") mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: [batchB] });
    if (change === "filters") query.set("currency", "MYR");
    if (change === "limit") query.set("limit", "2");
    if (change === "token") query.set("cursor", first.nextCursor! + "tampered");
    await expect(service.list(query, null)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  it("reauthorizes each page and rejects revoked access", async () => {
    const { service, mocks } = setup(); const first = await service.list(new URLSearchParams({ limit: "1" }), null);
    mocks.resolveAccess.mockResolvedValue(null);
    await expect(service.list(new URLSearchParams({ limit: "1", cursor: first.nextCursor! }), null)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("requires organization scope even when the client knows another batch UUID", async () => {
    const { service } = setup(); await expect(service.list(new URLSearchParams({ batch_id: batchB }), null)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("schema itself rejects REJECTED financial records", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(client.query("UPDATE public.financial_records SET ingestion_status = 'REJECTED' WHERE id = $1", [id(1)])).rejects.toMatchObject({ code: "23514" });
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("narrows a trusted multi-batch scope using a batch filter", async () => {
    const { service, mocks } = setup(); mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: [batchA, batchB] });
    const page = await service.list(new URLSearchParams({ batch_id: batchB }), null);
    expect(page.items.map(row => row.transaction_id)).toEqual([id(7)]);
  });
});
