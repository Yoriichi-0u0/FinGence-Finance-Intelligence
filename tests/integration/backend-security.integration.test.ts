import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createScopedReadService } from "../../lib/server/integration/scoped-queries";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import { PersistenceError } from "../../lib/server/persistence/contracts";
import type { SqlConnection, TransactionDatabase } from "../../lib/server/db/postgres";
import { header, syntheticResult, validRow } from "../persistence/fixtures";
import { createLocalSecurityFixture } from "./backend-security.fixtures";

const secret = "synthetic-cursor-secret-at-least-32-bytes-long";
const missing = "10000000-0000-4000-8000-000000000099";
type Fixture = Awaited<ReturnType<typeof createLocalSecurityFixture>>;

describe("stable producer, grouped persistence, scoped reads and protected audit (local PGlite)", () => {
  let f: Fixture;
  beforeAll(async () => { f = await createLocalSecurityFixture(); }, 30000);
  afterAll(async () => { await f?.close(); });
  beforeEach(async () => { await f.pool.query("TRUNCATE public.security_audit_events"); });

  function service(overrides: Partial<Parameters<typeof createScopedReadService>[0]> = {}) {
    return createScopedReadService({ readConnection: f.pool, auditDatabase: f.database, resolvePrincipal: f.resolvePrincipal,
      resolveAccess: f.resolveAccess, resolveTransactionScope: f.resolveTransactionScope, cursorSecret: secret, ...overrides });
  }
  async function events() {
    return (await f.pool.query(`SELECT actor_id,organization_id,action,outcome,target_type,target_id,request_id,approval_id
      FROM public.security_audit_events ORDER BY id`)).rows;
  }
  async function recordId() {
    return (await f.pool.query("SELECT id::text FROM public.financial_records ORDER BY id LIMIT 1")).rows[0].id as string;
  }

  it("persists the 26 actual source rows as one attempt, three batches and 23 accepted records", async () => {
    const counts = (await f.pool.query(`SELECT (SELECT count(*)::int FROM public.persistence_attempts) attempts,
      (SELECT count(*)::int FROM public.ingestion_batches) batches,
      (SELECT sum(rows_received)::int FROM public.ingestion_batches) received,
      (SELECT sum(valid_count)::int FROM public.ingestion_batches) valid,
      (SELECT sum(warning_count)::int FROM public.ingestion_batches) warning,
      (SELECT sum(rejected_count)::int FROM public.ingestion_batches) rejected,
      (SELECT count(*)::int FROM public.financial_records) accepted,
      (SELECT count(*)::int FROM public.validation_issues) issues,
      (SELECT count(*)::int FROM public.financial_records WHERE ingestion_status='REJECTED') rejected_records`)).rows[0];
    expect(counts).toEqual({ attempts: 1, batches: 3, received: 26, valid: 20, warning: 3, rejected: 3, accepted: 23, issues: 3, rejected_records: 0 });
    expect(f.receipt.datasets.map(d => [d.ingestion_batch_id, d.source_file])).toEqual(f.results.map(r => [r.context.batchId, r.dataset.file.name]));
    const stored = await f.pool.query(`SELECT source_row_id,source_file,source_sheet,source_row_number,file_sha256,ingestion_batch_id,
      transaction_date::text,posting_date::text,canonical_date::text,canonical_date_basis,source_amount::text,debit::text,credit::text,
      reference,source_transaction_id,account_code,monetary_basis,currency,currency_basis,ingestion_status FROM public.financial_records`);
    const original = f.results.flatMap(result => result.normalized);
    expect(stored.rows).toHaveLength(original.length);
    for (const row of stored.rows) {
      const source = original.find(value => value.source_row_id === row.source_row_id && value.ingestion_batch_id === row.ingestion_batch_id)!;
      expect(source).toBeDefined();
      for (const key of ["source_file", "source_sheet", "source_row_number", "file_sha256", "transaction_date", "posting_date", "canonical_date", "canonical_date_basis", "source_amount", "debit", "credit", "reference", "source_transaction_id", "account_code", "monetary_basis", "currency", "currency_basis", "ingestion_status"] as const) {
        expect(row[key], key).toEqual(source[key]);
      }
    }
    const issues = (await f.pool.query(`SELECT r.source_row_id,r.ingestion_batch_id,i.rule,i.category,i.severity,i.field,
      i.source_column,i.original_value,i.message FROM public.validation_issues i
      JOIN public.financial_records r ON r.id=i.financial_record_id`)).rows;
    for (const issue of issues) {
      const source = original.find(row => row.source_row_id === issue.source_row_id && row.ingestion_batch_id === issue.ingestion_batch_id)!;
      expect(source.validation_messages.some(message => message.rule === issue.rule && message.category === issue.category
        && message.severity === issue.severity && message.field === issue.field && message.sourceColumn === issue.source_column
        && message.message === issue.message && JSON.stringify(message.originalValue) === JSON.stringify(issue.original_value))).toBe(true);
    }
  });

  it("returns scoped list, detail and batch data only after one durable content-free audit per read", async () => {
    const api = service(), req = f.request("session-a");
    const page = await api.listTransactions(new URLSearchParams({ limit: "100" }), req);
    expect(page.items).toHaveLength(23);
    expect(page.items.filter(row => row.ingestion_status === "WARNING")).toHaveLength(3);
    const detail = await api.getTransaction(page.items[0].transaction_id, req);
    const batch = await api.getBatch(page.items[0].batch_id, req);
    expect(detail).toEqual(page.items[0]);
    expect(batch?.batch_id).toBe(page.items[0].batch_id);
    const audit = await events();
    expect(audit.map(row => [row.action, row.outcome])).toEqual([["transactions.list", "success"], ["transaction.read", "success"], ["batch.read", "success"]]);
    expect(audit.every(row => row.actor_id === "analyst-a" && row.organization_id === "org-a" && row.request_id)).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/source_amount|description|password|SELECT|token|source_file/i);
  }, 10000);

  it("uses the real signed cursor across pages without duplicates and enforces filter and scope binding", async () => {
    const api = service(), req = f.request("session-a");
    const first = await api.listTransactions(new URLSearchParams({ limit: "2" }), req);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
    const second = await api.listTransactions(new URLSearchParams({ limit: "2", cursor: first.nextCursor! }), req);
    expect(new Set([...first.items, ...second.items].map(row => row.transaction_id)).size).toBe(4);
    await expect(api.listTransactions(new URLSearchParams({ limit: "2", cursor: first.nextCursor!, currency: "MYR" }), req)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await f.pool.query("UPDATE test_security.membership SET scope_version='v2' WHERE subject_id='analyst-a'");
    try { await expect(api.listTransactions(new URLSearchParams({ limit: "2", cursor: first.nextCursor! }), req)).rejects.toMatchObject({ code: "INVALID_CURSOR" }); }
    finally { await f.pool.query("UPDATE test_security.membership SET scope_version='v1' WHERE subject_id='analyst-a'"); }
  });

  it.each([[undefined, 401], ["expired", 401], ["revoked", 401], ["reviewer", 403], ["admin", 403]] as const)("denies %s without a financial response", async (session, status) => {
    await expect(service().listTransactions(new URLSearchParams(), f.request(session))).rejects.toMatchObject({ status });
    expect((await events()).map(row => row.outcome)).toEqual(["denied"]);
  });

  it("does not reveal whether cross-organization or nonexistent records and batches exist", async () => {
    const api = service(), req = f.request("session-b"), id = await recordId();
    for (const target of [id, missing]) await expect(api.getTransaction(target, req)).rejects.toMatchObject({ status: 404 });
    for (const target of [f.receipt.datasets[0].batch_id, missing]) await expect(api.getBatch(target, req)).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
    expect((await events()).map(row => row.outcome)).toEqual(["denied", "denied", "denied", "denied"]);
    expect((await api.listTransactions(new URLSearchParams(), req)).items).toEqual([]);
  });

  it("ignores caller-supplied organization and role claims", async () => {
    const forged = new Request("http://127.0.0.1/internal", { headers: {
      "x-synthetic-session": "session-b", "x-organization-id": "org-a", "x-role": "finance_analyst",
    } });
    expect((await service().listTransactions(new URLSearchParams(), forged)).items).toEqual([]);
    await expect(service().getTransaction(await recordId(), forged)).rejects.toMatchObject({ status: 404 });
    expect((await events()).every(row => row.organization_id === "org-b")).toBe(true);
  });

  it.each(["reviewer", "admin"])("does not reveal record existence to an unauthorized %s", async session => {
    const api = service(), req = f.request(session), id = await recordId();
    for (const target of [id, missing]) await expect(api.getTransaction(target, req)).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
    expect((await events()).map(row => row.outcome)).toEqual(["denied", "denied"]);
  });

  it("keeps admin exceptions bound to an independently approved exact record", async () => {
    const id = await recordId();
    const api = service({ resolveTransactionScope: async (principal, target) => {
      const scope = await f.resolveTransactionScope(principal, target);
      return scope ? { ...scope, approval: { approvalId: "approval-1", subjectId: "admin-a", approvedBySubjectId: "approver-a",
        organizationId: "org-a", action: "financial_record.read", resourceType: "financial_record", resourceId: id,
        reason: "Synthetic incident", expiresAt: new Date(Date.now() + 60000).toISOString() } } : null;
    } });
    expect((await api.getTransaction(id, f.request("admin"))).transaction_id).toBe(id);
    expect((await events())[0]).toMatchObject({ action: "transaction.read", outcome: "success", approval_id: "approval-1" });
    const other = (await f.pool.query("SELECT id::text FROM public.financial_records WHERE id <> $1 ORDER BY id LIMIT 1", [id])).rows[0].id;
    await expect(api.getTransaction(other, f.request("admin"))).rejects.toMatchObject({ status: 404 });
  });

  it("does not duplicate audits for query failure, invalid cursor or out-of-scope filter", async () => {
    const broken: SqlConnection = { async query() { throw new Error("sensitive database error"); } };
    await expect(service({ readConnection: broken }).listTransactions(new URLSearchParams(), f.request("session-a"))).rejects.toMatchObject({ code: "QUERY_FAILED" });
    await expect(service().listTransactions(new URLSearchParams({ cursor: "invalid" }), f.request("session-a"))).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(service().listTransactions(new URLSearchParams({ batch_id: missing }), f.request("session-a"))).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    const audit = await events();
    expect(audit.map(row => row.outcome)).toEqual(["failure", "failure", "denied"]);
    expect(JSON.stringify(audit)).not.toContain("sensitive database error");
  });

  it("fails closed when audit acknowledgement fails and never retries the write", async () => {
    let attempts = 0;
    const failedAudit: TransactionDatabase = { async transaction() { attempts++; throw new PersistenceError("COMMIT_OUTCOME_UNKNOWN"); }, async close() {} };
    await expect(service({ auditDatabase: failedAudit }).listTransactions(new URLSearchParams(), f.request("session-a"))).rejects.toMatchObject({ code: "AUDIT_FAILED" });
    expect(attempts).toBe(1);
    expect(await events()).toEqual([]);
  });

  it("withholds detail and batch data when their success audit cannot commit", async () => {
    let attempts = 0;
    const failedAudit: TransactionDatabase = { async transaction() { attempts++; throw new PersistenceError("COMMIT_OUTCOME_UNKNOWN"); }, async close() {} };
    await expect(service({ auditDatabase: failedAudit }).getTransaction(await recordId(), f.request("session-a"))).rejects.toMatchObject({ code: "AUDIT_FAILED" });
    await expect(service({ auditDatabase: failedAudit }).getBatch(f.receipt.datasets[0].batch_id, f.request("session-a"))).rejects.toMatchObject({ code: "AUDIT_FAILED" });
    expect(attempts).toBe(2);
    expect(await events()).toEqual([]);
  });

  it("fails closed and avoids duplicate events for detail and batch query failures", async () => {
    const broken: SqlConnection = { async query() { throw new Error("private query failure"); } };
    const id = await recordId();
    await expect(service({ readConnection: broken }).getTransaction(id, f.request("session-a"))).rejects.toMatchObject({ code: "QUERY_FAILED" });
    await expect(service({ readConnection: broken }).getBatch(f.receipt.datasets[0].batch_id, f.request("session-a"))).rejects.toMatchObject({ code: "QUERY_FAILED" });
    expect((await events()).map(row => [row.action, row.outcome])).toEqual([["transaction.read", "failure"], ["batch.read", "failure"]]);
  });

  it("uses a one-connection pool without retaining a read lease during audit", async () => {
    const result = await service().listTransactions(new URLSearchParams({ limit: "1" }), f.request("session-a"));
    expect(result.items).toHaveLength(1);
    expect((await events()).map(row => row.outcome)).toEqual(["success"]);
  }, 5000);

  it("preserves large exact decimals and leading-zero identifiers through the actual writer and scoped query", async () => {
    const result = await syntheticResult();
    const receipt = await f.writer.persistGroupedAttempt({ attempt_id: randomUUID(), results: [result] });
    const batch = receipt.datasets[0].batch_id;
    await f.pool.query("INSERT INTO test_security.ownership VALUES ($1, 'org-a')", [batch]);
    try {
      const page = await service().listTransactions(new URLSearchParams({ batch_id: batch }), f.request("session-a"));
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ source_amount: "9007199254740993.123456789", reference: "00017", source_transaction_id: "00042",
        account_code: "00100", transaction_date: "2026-09-01", posting_date: "2026-09-03", monetary_basis: "source_signed_amount" });
    } finally { await f.pool.query("DELETE FROM test_security.ownership WHERE batch_id=$1", [batch]); }
  });

  it("stores approved ledger blank-side provenance without fabricating query fields", async () => {
    const result = await syntheticResult("transaction_date,debit,credit,reference,description,currency\n2026-09-01,,12,R,Synthetic,MYR",
      { monetaryMode: "debit_credit", blankSideAsZero: true });
    const receipt = await f.writer.persistGroupedAttempt({ attempt_id: randomUUID(), results: [result] });
    const batch = receipt.datasets[0].batch_id;
    const stored = (await f.pool.query("SELECT transformations FROM public.financial_records WHERE batch_id=$1", [batch])).rows[0];
    expect(stored.transformations).toEqual(result.normalized[0].transformations);
    expect(stored.transformations).toEqual([{ field: "debit", source_column: "debit", original_value: "", normalized_value: "0", rule: "APPROVED_BLANK_SIDE_ZERO" }]);
    await f.pool.query("INSERT INTO test_security.ownership VALUES ($1, 'org-a')", [batch]);
    try {
      const row = (await service().listTransactions(new URLSearchParams({ batch_id: batch }), f.request("session-a"))).items[0];
      expect(row).toMatchObject({ debit: "0", credit: "12", monetary_basis: "debit_credit" });
      expect(row).not.toHaveProperty("transformations"); // The selected read DTO intentionally omits full provenance.
    } finally { await f.pool.query("DELETE FROM test_security.ownership WHERE batch_id=$1", [batch]); }
  });

  it("retains COMPLETED_EMPTY, fresh attempts and duplicate-attempt protection without supersession", async () => {
    const empty = await syntheticResult(`${header}\n${validRow.replace("2026-09-01", "bad-date")}`);
    const emptyReceipt = await f.writer.persistGroupedAttempt({ attempt_id: randomUUID(), results: [empty] });
    expect(emptyReceipt.datasets[0]).toMatchObject({ status: "COMPLETED_EMPTY", accepted_record_count: 0 });
    const emptyBatch = emptyReceipt.datasets[0].batch_id;
    await f.pool.query("INSERT INTO test_security.ownership VALUES ($1, 'org-a')", [emptyBatch]);
    try { expect(await service().getBatch(emptyBatch, f.request("session-a"))).toMatchObject({ status: "COMPLETED_EMPTY", accepted_count: 0 }); }
    finally { await f.pool.query("DELETE FROM test_security.ownership WHERE batch_id=$1", [emptyBatch]); }
    const retryId = randomUUID();
    const reprocessed = structuredClone(f.results[0]);
    // Use the genuine C2 wrapper below rather than changing canonical data or batch context by hand.
    const { ingestDatasetRun } = await import("../../lib/ingestion");
    const rerun = ingestDatasetRun(reprocessed.dataset, reprocessed.mapping, reprocessed.options, { idFactory: () => retryId, now: () => new Date("2026-10-16T00:00:00Z") });
    const attemptId = randomUUID();
    const second = await f.writer.persistGroupedAttempt({ attempt_id: attemptId, results: [rerun] });
    expect(second.datasets[0].ingestion_batch_id).toBe(retryId);
    expect(rerun.normalized.map(row => row.source_row_id)).toEqual(reprocessed.normalized.map(row => row.source_row_id));
    await expect(f.writer.persistGroupedAttempt({ attempt_id: attemptId, results: [rerun] })).rejects.toThrow();
    expect((await f.pool.query("SELECT status FROM public.ingestion_batches WHERE id=$1", [f.receipt.datasets[0].batch_id])).rows[0].status).toBe("ACTIVE");
  });

  it("rolls back every child when a later batch fails", async () => {
    let batches = 0;
    const failing: TransactionDatabase = { close: async () => {}, transaction: (work, options) => f.database.transaction(connection => work({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (/INSERT INTO public\.ingestion_batches/.test(sql) && ++batches === 2) throw new Error("injected synthetic failure");
        return connection.query<Row>(sql, values);
      },
    }), options) };
    const id = randomUUID();
    await expect(createGroupedPersistenceService(failing).persistGroupedAttempt({ attempt_id: id, results: f.results })).rejects.toThrow();
    // The production adapter intentionally destroys a connection after an unclassified
    // error; inspect the same disposable database directly, without reconnecting it.
    expect((await f.local.query<{ n: number }>("SELECT count(*)::int n FROM public.persistence_attempts WHERE id=$1", [id])).rows[0].n).toBe(0);
    expect((await f.local.query<{ n: number }>("SELECT count(*)::int n FROM public.ingestion_batches WHERE persistence_attempt_id=$1", [id])).rows[0].n).toBe(0);
  });
});
