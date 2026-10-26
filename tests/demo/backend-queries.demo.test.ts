import { expect, it, vi } from "vitest";
// Standard test-runtime package mock, as in the existing API integration tests.
// Mandatory authorization, cursor and audit interfaces below are still exercised.
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { transactionDatabase, type SqlConnection } from "../../lib/server/db/postgres";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import { parseTransactionListFilters } from "../../lib/server/api/transaction-contract";
import { createTransactionQueryService, type TransactionCursorBinding, type TransactionPosition } from "../../lib/server/api/transaction-query";
import { parseBatchId, parseBatchListFilters } from "../../lib/server/api/batch-contract";
import { createBatchQueryService, type BatchCursorBinding, type BatchPosition } from "../../lib/server/api/batch-query";
import { header, syntheticResult } from "../persistence/fixtures";

const verbose = process.env.FINGENCE_QUERY_DEMO_VERBOSE === "1";
function present(lines: readonly string[]) {
  if (process.env.FINGENCE_QUERY_DEMO_PRESENTATION !== "1") return;
  for (const line of lines) console.log(`FINGENCE_DEMO> ${line}`);
}
function show(stage: string, data?: unknown) {
  if (!verbose) return;
  console.log(`\n[${stage}]${data === undefined ? "" : "\n" + (typeof data === "string" ? data : JSON.stringify(data, null, 2))}`);
}
/** LOCAL TEST ONLY. Opaque registry checks bindings, but implements no cryptography/expiry. */
function testCursors<Position, Binding>(domain: string) {
  const entries = new Map<string, { position: Position; binding: string }>();
  return {
    async issue(position: Position, binding: Binding) {
      const token = `demo_${domain}_${entries.size + 1}`;
      entries.set(token, { position, binding: JSON.stringify(binding) });
      show("CURSOR ISSUE - TEST REGISTRY ONLY", { token, anchor: position }); return token;
    },
    async verify(token: string, binding: Binding) {
      const entry = entries.get(token);
      if (!entry || entry.binding !== JSON.stringify(binding)) throw new Error("Invalid synthetic cursor");
      show("CURSOR VERIFY - TEST REGISTRY ONLY", { token, bindingMatched: true, anchor: entry.position });
      return entry.position;
    },
  };
}

it("demonstrates actual transaction and batch queries on disposable SYNTHETIC data", async () => {
  present(["FinGence Phase 6A-6C: backend query demonstration", "LOCAL ONLY | Synthetic data | Test-only security | No public HTTP routes"]);
  show("FINGENCE PHASE 6A-6C - LOCAL QUERY DEMONSTRATION", {
    data: "SYNTHETIC ONLY - no client records, no environment credentials, no hosted database",
    transport: "Internal service calls, NOT public HTTP endpoints",
    security: "Injected TEST ONLY scope/cursor/audit dependencies; NOT Jason's production security",
    ordering: "Request -> validation -> scope -> parameterized SQL -> DTO/audit gate -> returned response",
  });
  let local: PGlite | undefined, socket: PGLiteSocketServer | undefined, pool: Pool | undefined;
  try {
    local = await PGlite.create();
    await local.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    for (const file of ["phase1-clean-setup.sql", "c3b1-grouped-persistence-upgrade.sql"]) {
      await local.exec(readFileSync(new URL(`../../supabase/sql/${file}`, import.meta.url), "utf8"));
    }
    socket = new PGLiteSocketServer({ db: local, host: "127.0.0.1", port: 0, maxConnections: 1 });
    await socket.start(); const address = new URL(`postgres://postgres@${socket.getServerConn()}/postgres`);
    expect(address.hostname).toBe("127.0.0.1");
    pool = new Pool({ host: "127.0.0.1", port: Number(address.port), user: "postgres", password: "", database: "postgres",
      ssl: false, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const a = "2026-09-03,2026-09-04,9007199254740993.123456789,00017,00042,00100,00003,00004,SYNTHETIC demo A,MYR";
    const b = "2026-09-03,,125.50,00018,00043,00100,,,SYNTHETIC demo B,MYR";
    const c = "2026-09-02,,0.00,00019,00044,00100,,,SYNTHETIC demo C,MYR";
    const warning = "2026-09-02,,40.00,,00045,00100,,,SYNTHETIC missing reference,MYR";
    const rejected = "bad-date,,20.00,00020,00046,00100,,,SYNTHETIC rejected,MYR";
    const fixture = await syntheticResult([header, a, b, c, warning, a, rejected].join("\n"), {},
      { batchId: "synthetic-demo-main", ingestedAt: "2026-09-05T00:00:00.000Z" }, "synthetic-demo.csv");
    const empty = await syntheticResult([header, rejected].join("\n"), {},
      { batchId: "synthetic-demo-empty", ingestedAt: "2026-09-05T00:00:00.000Z" }, "synthetic-demo-empty.csv");
    expect(fixture.summary).toMatchObject({ rowsReceived: 6, valid: 3, warning: 2, rejected: 1 });
    const receipt = await createGroupedPersistenceService(transactionDatabase(pool)).persistGroupedAttempt({
      attempt_id: "60000000-0000-4000-8000-000000000001", results: [fixture, empty],
    });
    const mainBatch = receipt.datasets[0].batch_id, emptyBatch = receipt.datasets[1].batch_id;
    show("LOCAL FIXTURE READY - setup only; this is not the persistence presentation", {
      engine: "Fresh in-memory PostgreSQL/WASM with actual pg wire queries on an ephemeral loopback port",
      mainBatch, emptyBatch, received: 6, valid: 3, warning: 2, rejected: 1,
      rejectedEvidence: "Counts retained; rejected financial rows are not stored",
    });

    let sqlCalls = 0, auditCalls = 0;
    const stages: string[] = [];
    const database: SqlConnection = {
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        sqlCalls++; stages.push("sql");
        show("SQL QUERY - actual unchanged service SQL", sql);
        show("BOUND PARAMETERS - SYNTHETIC ONLY, values are not concatenated into SQL", values);
        const result = await pool!.query<Row>(sql, values);
        show("SQL RESULT", { rowsFetched: result.rows.length, next: "Service validates allowlisted DTOs; audit acknowledgement is required before release" });
        return { rows: result.rows, rowCount: result.rowCount };
      },
    };
    const context = Object.freeze({ marker: "LOCAL_SYNTHETIC_DEMO" });
    const scope = Object.freeze({ subjectId: "synthetic-demo-actor", organizationId: "synthetic-demo-org",
      scopeVersion: "demo-v1", batchIds: Object.freeze([mainBatch, emptyBatch]) });
    async function resolveAccess(caller: unknown, operation = "transaction list") {
      stages.push("scope");
      if (caller !== context) return null;
      show("AUTHORIZED SCOPE - TEST ONLY, fixed fixture scope; no real identity/membership verification", { operation, ...scope });
      return scope;
    }
    async function acknowledge(event: unknown): Promise<true> {
      stages.push("audit"); auditCalls++;
      show("AUDIT ACKNOWLEDGEMENT - TEST ONLY, before response release", {
        receipt: event, acknowledged: true, durableProductionSink: "NOT IMPLEMENTED - Jason's responsibility",
      });
      return true;
    }
    const transactions = createTransactionQueryService({ database, resolveAccess,
      cursors: testCursors<TransactionPosition, TransactionCursorBinding>("transactions"), auditRead: acknowledge });
    const batches = createBatchQueryService({ database, resolveAccess,
      cursors: testCursors<BatchPosition, BatchCursorBinding>("batches"), audit: acknowledge });
    async function transactionPage(query: URLSearchParams, label: string) {
      show(`REQUEST - ${label} (internal transactions.list, not HTTP)`, Object.fromEntries(query));
      show("VALIDATION - same contract parser used inside the service", parseTransactionListFilters(query));
      stages.length = 0;
      const page = await transactions.list(query, context);
      expect(stages).toEqual(["scope", "sql", "audit"]);
      show(`RETURNED TRANSACTION RESPONSE - ${label} - SYNTHETIC DTOs`, page);
      return page;
    }
    const filters = { date_from: "2026-09-02", date_to: "2026-09-03", status: "VALID", limit: "2" };
    present(["[1/5] Request", `Dates: ${filters.date_from} to ${filters.date_to}`, `Status: ${filters.status} | Page size: ${filters.limit}`]);
    const first = await transactionPage(new URLSearchParams(filters), "PAGE 1");
    expect(first.items).toHaveLength(2); expect(first.nextCursor).not.toBeNull();
    const exact = first.items.find(item => item.reference === "00017")!;
    expect(exact.source_amount).toBe("9007199254740993.123456789"); expect(typeof exact.source_amount).toBe("string");
    expect(exact.debit).toBeNull(); expect(exact.credit).toBeNull(); expect(exact.balance).toBeNull();
    expect(first.items.find(item => item.reference === "00018")!.posting_date).toBeNull();
    present(["[2/5] Validation / SQL", "Filters validated by the existing contract and query service.",
      "Access restricted to the fixed synthetic authorized scope.", "Parameterized SQL executed against disposable PostgreSQL-compatible storage.",
      "Mandatory test audit acknowledgement received before response release."]);
    const second = await transactionPage(new URLSearchParams({ ...filters, cursor: first.nextCursor! }), "PAGE 2");
    expect(second.items).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect(second.items[0]).toMatchObject({ canonical_date: "2026-09-02", source_amount: "0", reference: "00019" });
    expect(new Set([...first.items, ...second.items].map(item => item.transaction_id)).size).toBe(3);
    show("KEYSET EXPLANATION", "Page 2 uses the verified test cursor's last canonical date + UUID with a strict tuple < comparison, not OFFSET. Equal-date UUID ordering is stable.");

    const warnings = await transactionPage(new URLSearchParams({ ...filters, status: "WARNING", limit: "10" }), "WARNING RECORDS REMAIN ACCEPTED");
    expect(warnings.items).toHaveLength(2); expect(warnings.items.every(item => item.ingestion_status === "WARNING")).toBe(true);
    expect(warnings.items.some(item => item.reference === null)).toBe(true);
    present(["[3/5] Transaction results", `Page 1: ${first.items.length} records | Page 2: ${second.items.length} record | End of results`,
      `Exact amount (string): "${exact.source_amount}"`, `Unavailable debit / credit / balance: ${exact.debit} / ${exact.credit} / ${exact.balance}`,
      `Optional posting date: ${first.items.find(item => item.reference === "00018")!.posting_date}`,
      `Page 2 amount (string): "${second.items[0].source_amount}" | Zero remains distinct from NULL`,
      `WARNING records also accepted: ${warnings.items.length} | REJECTED records excluded`]);

    const batchRequest = new URLSearchParams({ persistence_attempt_id: receipt.attempt_id, limit: "10" });
    show("REQUEST - internal batches.list", Object.fromEntries(batchRequest));
    show("VALIDATION - batch filter contract", parseBatchListFilters(batchRequest));
    stages.length = 0; const listed = await batches.list(batchRequest, context);
    expect(stages).toEqual(["scope", "sql", "audit"]);
    expect(listed.items).toHaveLength(2); show("RETURNED BATCH LIST - SYNTHETIC DTOs", listed);
    show("REQUEST - internal batches.get", { batch_id: mainBatch });
    show("VALIDATION - batch ID contract", { batch_id: parseBatchId(mainBatch) });
    stages.length = 0; const batch = await batches.get(mainBatch, context);
    expect(stages).toEqual(["scope", "sql", "audit"]);
    expect(batch).toMatchObject({ status: "ACTIVE", rows_received: 6, valid_count: 3, warning_count: 2,
      rejected_count: 1, accepted_count: 5, validation_summary: { total_warning_issues: 2, technical_warning_issues: 1, business_warning_issues: 1 } });
    show("RETURNED BATCH LOOKUP - SYNTHETIC DTO", batch);
    expect(listed.items.find(item => item.batch_id === emptyBatch)).toMatchObject({ status: "COMPLETED_EMPTY", accepted_count: 0, rejected_count: 1 });
    const emptyResult = listed.items.find(item => item.batch_id === emptyBatch)!;
    present(["[4/5] Batch results", `${batch!.status}: received ${batch!.rows_received} | accepted ${batch!.accepted_count} (${batch!.valid_count} VALID + ${batch!.warning_count} WARNING) | rejected ${batch!.rejected_count}`,
      `Warning issues: ${batch!.validation_summary.total_warning_issues} (${batch!.validation_summary.technical_warning_issues} technical + ${batch!.validation_summary.business_warning_issues} business)`,
      `${emptyResult.status}: accepted ${emptyResult.accepted_count} | rejected ${emptyResult.rejected_count}`]);
    show("BATCH EXPLANATION", "ACTIVE has 5 accepted = 3 VALID + 2 WARNING; 1 REJECTED is counted but never returned as a financial record. COMPLETED_EMPTY has zero accepted records, not necessarily zero received. Warning summaries count persisted issues only. The attempt UUID groups two distinct batches.");

    const queriesBefore = sqlCalls;
    await expect(createTransactionQueryService().list(new URLSearchParams(), context)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" });
    await expect(transactions.list(new URLSearchParams(), { marker: "FABRICATED" })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(sqlCalls).toBe(queriesBefore);
    show("SECURITY GUARD CHECK - no SQL executed", "Missing mandatory dependencies and an unrecognized test context fail closed. This is a synthetic dependency demonstration, not authentication or RBAC verification.");
    expect(sqlCalls).toBe(5); expect(auditCalls).toBe(5);
    present(["[5/5] Final verification", "Keyset pagination: no duplicates | Missing security dependencies/context: fail closed",
      `Actual read queries: ${sqlCalls} | Test audit acknowledgements: ${auditCalls}`]);
    show("DEMO COMPLETE", { actualReadQueries: sqlCalls, testAuditAcknowledgements: auditCalls,
      verified: "Exact decimal strings, NULLs, two keyset pages, accepted warnings, safe batch counts and summaries",
      remaining: "Production authentication/ownership, policies, secure expiring cursors and durable audit infrastructure belong to Jason; no public endpoints exist" });
  } finally {
    try { await pool?.end(); }
    finally {
      try { await socket?.stop(); }
      finally { await local?.close(); }
    }
    show("CLEANUP", "Loopback socket closed; disposable in-memory database discarded. No hosted service or persisted client data was used.");
    present(["Cleanup complete: local socket closed; disposable database discarded."]);
  }
}, 30000);
