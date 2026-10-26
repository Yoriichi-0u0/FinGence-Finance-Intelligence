import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { BATCH_STATUSES } from "../../lib/server/api/batch-contract";
import { createBatchQueryService } from "../../lib/server/api/batch-query";
import { transactionDatabase } from "../../lib/server/db/postgres";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import { header, syntheticResult, validRow } from "../persistence/fixtures";
import { access, attemptId, batchA, batchB, harness } from "./batch.fixtures";

describe("batch queries against the actual disposable schema and persistence writer", () => {
  let local: PGlite, socket: PGLiteSocketServer, pool: Pool;
  let acceptedBatch: string, emptyBatch: string;
  const manualIds = BATCH_STATUSES.map((_, n) => `50000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`);
  let allowed: string[];
  beforeAll(async () => {
    local = await PGlite.create();
    await local.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    for (const file of ["phase1-clean-setup.sql", "c3b1-grouped-persistence-upgrade.sql"]) {
      await local.exec(readFileSync(new URL(`../../supabase/sql/${file}`, import.meta.url), "utf8"));
    }
    socket = new PGLiteSocketServer({ db: local, host: "127.0.0.1", port: 0, maxConnections: 1 });
    await socket.start(); const url = new URL(`postgres://postgres@${socket.getServerConn()}/postgres`);
    pool = new Pool({ host: url.hostname, port: Number(url.port), user: "postgres", database: "postgres", max: 1,
      connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const mixed = await syntheticResult(`${header}\n${validRow}\n${validRow.replace("00017", "")}\n${validRow.replace("2026-09-01", "bad-date")}`);
    const rejected = await syntheticResult(`${header}\n${validRow.replace("2026-09-01", "bad-date")}`, {}, undefined, "synthetic-empty.csv");
    const receipt = await createGroupedPersistenceService(transactionDatabase(pool)).persistGroupedAttempt({ attempt_id: attemptId, results: [mixed, rejected] });
    acceptedBatch = receipt.datasets[0].batch_id; emptyBatch = receipt.datasets[1].batch_id;
    // Same timestamp down to the microsecond tests UUID tie-breaks; different microseconds test precision.
    await pool.query("UPDATE public.ingestion_batches SET created_at = '2026-09-01T00:00:00.000001Z'");
    for (const [index, status] of BATCH_STATUSES.entries()) {
      await pool.query(`INSERT INTO public.ingestion_batches
        (id, ingestion_batch_id, schema_version, ruleset_version, status, created_at, completed_at, rows_received, rejected_count, context)
        VALUES ($1, 'synthetic-legacy', '0.1', '0.1', $2, '2026-09-01T00:00:00.000002Z', $3, $4, $4, '{"secret":"hidden"}')`,
      [manualIds[index], status, status === "COMPLETED_EMPTY" ? "2026-09-01T00:00:01.000000Z" : null, status === "COMPLETED_EMPTY" ? 7 : 0]);
    }
    await pool.query(`INSERT INTO public.ingestion_batches (id, ingestion_batch_id, schema_version, ruleset_version)
      VALUES ($1, 'synthetic-outside-org', '0.1', '0.1')`, [batchB]);
    await pool.query(`INSERT INTO public.validation_issues
      (financial_record_id, issue_ordinal, rule, category, severity, field, original_value, message, source_file)
      SELECT id, 1, 'SECRET_RULE', 'technical', 'WARNING', 'SECRET_FIELD', '"SECRET_VALUE"', 'SECRET_MESSAGE', source_file
      FROM public.financial_records WHERE batch_id = $1 AND ingestion_status = 'WARNING'`, [acceptedBatch]);
    allowed = [...manualIds, acceptedBatch, emptyBatch];
  }, 30000);
  afterAll(async () => { await pool?.end(); await socket?.stop(); await local?.close(); });
  function setup() {
    const h = harness(); h.mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: allowed });
    return { ...h, service: createBatchQueryService({ ...h.dependencies, database: pool }) };
  }
  it("inspects actual column types, nullability and foreign-key relationships", async () => {
    const columns = await pool.query(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('ingestion_batches','validation_issues','persistence_attempts')`);
    const table = (name: string) => columns.rows.filter(row => row.table_name === name);
    expect(table("persistence_attempts").map(row => row.column_name).sort()).toEqual(["created_at", "dataset_count", "id"]);
    expect(table("ingestion_batches")).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_name: "persistence_attempt_id", data_type: "uuid", is_nullable: "YES" }),
      expect.objectContaining({ column_name: "completed_at", data_type: "timestamp with time zone", is_nullable: "YES" }),
      expect.objectContaining({ column_name: "rejected_count", data_type: "integer", is_nullable: "NO" }),
    ]));
    expect(table("validation_issues").map(row => row.column_name)).not.toContain("batch_id");
    expect(columns.rows.map(row => row.column_name)).not.toContain("organization_id");
    const foreignKeys = await pool.query(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
      FROM pg_constraint WHERE contype = 'f' AND conrelid IN ('public.ingestion_batches'::regclass, 'public.validation_issues'::regclass)`);
    expect(foreignKeys.rows).toEqual(expect.arrayContaining([
      { child: "ingestion_batches", parent: "persistence_attempts" }, { child: "validation_issues", parent: "financial_records" },
    ]));
  });
  it("reports the real writer's accepted/rejected counts and category-only issue summaries", async () => {
    const { service } = setup(); const item = await service.get(acceptedBatch, null);
    expect(item).toMatchObject({ status: "ACTIVE", rows_received: 3, valid_count: 1, warning_count: 1, rejected_count: 1, accepted_count: 2,
      persistence_attempt_id: attemptId, validation_summary: { total_warning_issues: 2, technical_warning_issues: 1, business_warning_issues: 1 } });
    expect(JSON.stringify(item)).not.toMatch(/SECRET|source_file|context|original_value|source_column|dataset_id|source_amount/);
  });
  it("keeps a grouped attempt separate from its COMPLETED_EMPTY child", async () => {
    const { service } = setup();
    expect(await service.get(emptyBatch, null)).toMatchObject({ batch_id: emptyBatch, persistence_attempt_id: attemptId,
      status: "COMPLETED_EMPTY", rows_received: 1, accepted_count: 0, rejected_count: 1, validation_summary: { total_warning_issues: 0 } });
    expect(await service.get(attemptId, null)).toBeNull();
    expect((await service.list(new URLSearchParams({ persistence_attempt_id: attemptId }), null)).items.map(item => item.batch_id).sort())
      .toEqual([acceptedBatch, emptyBatch].sort());
  });
  it.each(BATCH_STATUSES)("preserves status %s and nullable legacy metadata", async status => {
    const { service } = setup(); const items = (await service.list(new URLSearchParams({ status }), null)).items;
    expect(items.length).toBeGreaterThan(0); expect(items.every(item => item.status === status)).toBe(true);
    const legacy = items.find(item => item.batch_id === manualIds[BATCH_STATUSES.indexOf(status)])!;
    expect(legacy.persistence_attempt_id).toBeNull();
    if (status !== "COMPLETED_EMPTY") expect(legacy.completed_at).toBeNull();
  });
  it("paginates equal timestamps and microsecond differences without loss or duplicates", async () => {
    const { service } = setup(); const ids: string[] = []; let cursor: string | null = null;
    do {
      const filters = new URLSearchParams({ limit: "2" }); if (cursor) filters.set("cursor", cursor);
      const page = await service.list(filters, null); ids.push(...page.items.map(item => item.batch_id)); cursor = page.nextCursor;
    } while (cursor !== null);
    expect(ids).toEqual([...manualIds].sort().reverse().concat([acceptedBatch, emptyBatch].sort().reverse()));
    expect(new Set(ids).size).toBe(allowed.length);
  });
  it("ends an exact-full final page without issuing another cursor", async () => {
    const { service, mocks } = setup(); mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: manualIds.slice(0, 2) });
    const first = await service.list(new URLSearchParams({ limit: "1" }), null);
    expect(first.items.map(item => item.batch_id)).toEqual([manualIds[1]]); expect(first.nextCursor).not.toBeNull();
    const final = await service.list(new URLSearchParams({ limit: "1", cursor: first.nextCursor! }), null);
    expect(final.items.map(item => item.batch_id)).toEqual([manualIds[0]]); expect(final.nextCursor).toBeNull();
    expect(mocks.cursors.issue).toHaveBeenCalledOnce();
  });
  it("applies combined status/attempt filters throughout pagination", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const extraAttempt = "40000000-0000-4000-8000-000000000002";
      // Populate genuine ACTIVE children using the existing writer inside this rolled-back fixture transaction.
      const writer = createGroupedPersistenceService({ close: async () => {}, transaction: work => work(client) });
      const result = await writer.persistGroupedAttempt({ attempt_id: extraAttempt, results: [
        await syntheticResult(undefined, {}, undefined, "synthetic-filter-a.csv"),
        await syntheticResult(undefined, {}, undefined, "synthetic-filter-b.csv"),
      ] });
      const { dependencies, mocks } = setup();
      mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: [...allowed, ...result.datasets.map(item => item.batch_id)] });
      const service = createBatchQueryService({ ...dependencies, database: client });
      const filters = { limit: "1", status: "ACTIVE", persistence_attempt_id: extraAttempt };
      const first = await service.list(new URLSearchParams(filters), null);
      expect(first.items).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
      const final = await service.list(new URLSearchParams({ ...filters, cursor: first.nextCursor! }), null);
      expect(final.items).toHaveLength(1); expect(final.nextCursor).toBeNull();
      const items = [...first.items, ...final.items];
      expect(items.every(item => item.status === "ACTIVE" && item.persistence_attempt_id === extraAttempt)).toBe(true);
      expect(items.map(item => item.batch_id).sort()).toEqual(result.datasets.map(item => item.batch_id).sort());
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("keeps keyset anchors stable under non-UTC timezone and non-ISO DateStyle", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query("SET TIME ZONE 'Asia/Singapore'"); await client.query("SET DateStyle TO 'SQL, DMY'");
      const { dependencies } = setup(); const service = createBatchQueryService({ ...dependencies, database: client });
      const ids: string[] = []; let cursor: string | null = null;
      do {
        const filters = new URLSearchParams({ limit: "2" }); if (cursor) filters.set("cursor", cursor);
        const page = await service.list(filters, null); ids.push(...page.items.map(item => item.batch_id)); cursor = page.nextCursor;
      } while (cursor !== null);
      expect(ids).toEqual([...manualIds].sort().reverse().concat([acceptedBatch, emptyBatch].sort().reverse()));
      expect(new Set(ids).size).toBe(allowed.length);
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("does not leak other batches through attempt filtering, lookup or summaries", async () => {
    const { service, mocks } = setup(); mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: [emptyBatch] });
    expect(await service.get(acceptedBatch, null)).toBeNull(); expect(await service.get(batchB, null)).toBeNull();
    const page = await service.list(new URLSearchParams({ persistence_attempt_id: attemptId }), null);
    expect(page.items.map(item => item.batch_id)).toEqual([emptyBatch]);
    expect(page.items[0].validation_summary.total_warning_issues).toBe(0);
  });
  it("returns empty results and indistinguishable missing/unscoped lookup results", async () => {
    const { service, mocks } = setup(); mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: [batchA] });
    expect((await service.list(new URLSearchParams(), null)).items).toEqual([]);
    expect(await service.get(batchA, null)).toBeNull(); expect(await service.get(batchB, null)).toBeNull();
  });
  it("serializes timestamps in UTC with microseconds independently of DateStyle and session timezone", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query("SET DateStyle TO 'SQL, DMY'"); await client.query("SET TIME ZONE 'Asia/Singapore'");
      const { dependencies, mocks } = setup(); mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: allowed });
      const service = createBatchQueryService({ ...dependencies, database: client });
      expect(await service.get(acceptedBatch, null)).toMatchObject({ created_at: "2026-09-01T00:00:00.000001Z" });
      expect(await service.get(manualIds[0], null)).toMatchObject({ created_at: "2026-09-01T00:00:00.000002Z", completed_at: null });
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it.each(["subject", "organization", "scope", "batches", "status", "attempt", "limit", "token"])("rejects cursor replay after %s changes", async change => {
    const { service, mocks } = setup(); const first = await service.list(new URLSearchParams({ limit: "1" }), null);
    const filters = new URLSearchParams({ limit: "1", cursor: first.nextCursor! });
    const grant = { ...access, batchIds: allowed };
    if (change === "subject") grant.subjectId = "other";
    if (change === "organization") grant.organizationId = "other";
    if (change === "scope") grant.scopeVersion = "v2";
    if (change === "batches") grant.batchIds = [emptyBatch];
    if (change === "status") filters.set("status", "ACTIVE");
    if (change === "attempt") filters.set("persistence_attempt_id", attemptId);
    if (change === "limit") filters.set("limit", "2");
    if (change === "token") filters.set("cursor", first.nextCursor! + "tampered");
    mocks.resolveAccess.mockResolvedValue(grant);
    await expect(service.list(filters, null)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  it("reauthorizes every call and rejects revoked access", async () => {
    const { service, mocks } = setup(); await service.get(acceptedBatch, null); mocks.resolveAccess.mockResolvedValue(null);
    await expect(service.get(acceptedBatch, null)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
});
