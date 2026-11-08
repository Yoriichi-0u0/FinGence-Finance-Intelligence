import "server-only";
import type { SqlConnection } from "../db/postgres";
import { batchTimestamp, parseBatchId, parseBatchListFilters, projectBatchRow, type BatchItem, type BatchListFilters } from "./batch-contract";

export interface BatchAccess {
  readonly subjectId: string;
  readonly organizationId: string;
  readonly scopeVersion: string;
  /** Complete stored ownership scope for the requested operation, resolved by trusted code. */
  readonly batchIds: readonly string[];
}
export interface BatchPosition { readonly createdAt: string; readonly batchId: string }
export interface BatchCursorBinding {
  readonly collection: "ingestion_batches";
  readonly access: BatchAccess;
  readonly filters: Omit<BatchListFilters, "cursor">;
}
/** Internal adapter vocabulary, not additions to Jason's permission/audit enums. */
export type BatchOperation = "list" | "lookup";
export interface BatchAuditReceipt {
  readonly subjectId: string | null;
  readonly organizationId: string | null;
  readonly operation: BatchOperation;
  readonly outcome: "success" | "not_found" | "denied" | "failure";
  readonly resultCount: number;
}
export interface BatchQueryDependencies<Context> {
  readonly database: SqlConnection;
  /** Verify identity, membership, operation permission and stored ownership; null denies.
   * Never echo a caller's role/organization/ID as authorization. No default policy exists. */
  readonly resolveAccess: (context: Context, operation: BatchOperation) => Promise<BatchAccess | null>;
  readonly cursors: {
    readonly verify: (token: string, binding: BatchCursorBinding) => Promise<BatchPosition>;
    readonly issue: (position: BatchPosition, binding: BatchCursorBinding) => Promise<string>;
  };
  /** Acknowledge only after durable protected persistence; maps receipts to Jason-approved events. */
  readonly audit: (receipt: Readonly<BatchAuditReceipt>) => Promise<true>;
}
export class BatchQueryError extends Error {
  constructor(readonly code: "SECURITY_UNAVAILABLE" | "ACCESS_DENIED" | "INVALID_CURSOR" | "QUERY_FAILED" | "AUDIT_FAILED") {
    super("Batch query could not be completed"); this.name = "BatchQueryError";
  }
}
function snapshot(value: BatchAccess | null): BatchAccess {
  if (value === null) throw new BatchQueryError("ACCESS_DENIED");
  try {
    if (!value || ![value.subjectId, value.organizationId, value.scopeVersion].every(id => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id))
      || !Array.isArray(value.batchIds)) throw new Error();
    return Object.freeze({ subjectId: value.subjectId, organizationId: value.organizationId, scopeVersion: value.scopeVersion,
      batchIds: Object.freeze([...new Set(Array.from(value.batchIds, parseBatchId))].sort()) });
  } catch { throw new BatchQueryError("SECURITY_UNAVAILABLE"); }
}
function position(value: BatchPosition): BatchPosition {
  try { return Object.freeze({ createdAt: batchTimestamp(value.createdAt), batchId: parseBatchId(value.batchId) }); }
  catch { throw new BatchQueryError("INVALID_CURSOR"); }
}
const batchColumns = "id, ingestion_batch_id, persistence_attempt_id, status, created_at, completed_at, rows_received, valid_count, warning_count, rejected_count";
const projection = `b.id, b.ingestion_batch_id, b.persistence_attempt_id, b.status,
to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
to_char(b.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completed_at,
b.rows_received, b.valid_count, b.warning_count, b.rejected_count,
s.total_warning_issues::text, s.technical_warning_issues::text, s.business_warning_issues::text`;
// Issues have no batch FK: the real relationship is issue -> accepted record -> batch.
const summary = `CROSS JOIN LATERAL (
 SELECT count(*) AS total_warning_issues,
 count(*) FILTER (WHERE i.category = 'technical') AS technical_warning_issues,
 count(*) FILTER (WHERE i.category = 'business') AS business_warning_issues
 FROM public.validation_issues i JOIN public.financial_records r ON r.id = i.financial_record_id
 WHERE r.batch_id = b.id AND r.ingestion_status IN ('VALID', 'WARNING') AND i.severity = 'WARNING'
) s`;

export function createBatchQueryService<Context>(dependencies?: BatchQueryDependencies<Context>) {
  function ready(): BatchQueryDependencies<Context> {
    if (!dependencies || typeof dependencies.database?.query !== "function" || typeof dependencies.resolveAccess !== "function"
      || typeof dependencies.audit !== "function" || typeof dependencies.cursors?.verify !== "function" || typeof dependencies.cursors?.issue !== "function") {
      throw new BatchQueryError("SECURITY_UNAVAILABLE");
    }
    return dependencies;
  }
  // After request validation, all outcomes pass the mandatory audit acknowledgement gate.
  async function run<T>(context: Context, operation: BatchOperation, work: (deps: BatchQueryDependencies<Context>, access: BatchAccess) => Promise<{
    value: T; resultCount: number; outcome?: "not_found";
  }>): Promise<T> {
    const deps = ready();
    let access: BatchAccess | null = null;
    let result: { value: T; resultCount: number; outcome?: "not_found" } | undefined;
    let failure: BatchQueryError | undefined;
    try {
      try { access = snapshot(await deps.resolveAccess(context, operation)); }
      catch (error) { throw error instanceof BatchQueryError ? error : new BatchQueryError("SECURITY_UNAVAILABLE"); }
      result = await work(deps, access);
    } catch (error) { failure = error instanceof BatchQueryError ? error : new BatchQueryError("QUERY_FAILED"); }
    try {
      if (await deps.audit(Object.freeze({ subjectId: access?.subjectId ?? null, organizationId: access?.organizationId ?? null,
        operation, outcome: failure ? failure.code === "ACCESS_DENIED" ? "denied" : "failure" : result?.outcome ?? "success",
        resultCount: result?.resultCount ?? 0 })) !== true) throw new Error();
    } catch { throw new BatchQueryError("AUDIT_FAILED"); }
    if (failure) throw failure;
    return result!.value;
  }
  async function query(deps: BatchQueryDependencies<Context>, access: BatchAccess, where: string[], values: unknown[], limit: number) {
    values.push(limit);
    const sql = `WITH scoped_page AS (
 SELECT ${batchColumns} FROM public.ingestion_batches
 WHERE id = ANY($1::uuid[])${where.length ? " AND " + where.join(" AND ") : ""}
 ORDER BY created_at DESC, id DESC LIMIT $${values.length}::integer
)
SELECT ${projection} FROM scoped_page b ${summary} ORDER BY b.created_at DESC, b.id DESC`;
    try {
      const result = await deps.database.query(sql, values);
      if (result.rows.length > limit) throw new Error();
      const items = result.rows.map(projectBatchRow);
      if (items.some(item => !access.batchIds.includes(item.batch_id))) throw new Error();
      return items;
    } catch { throw new BatchQueryError("QUERY_FAILED"); }
  }
  return {
    async list(parameters: URLSearchParams, context: Context): Promise<Readonly<{ items: readonly BatchItem[]; nextCursor: string | null }>> {
      const filters = parseBatchListFilters(parameters);
      return run(context, "list", async (deps, access) => {
        const { cursor, ...boundFilters } = filters;
        const binding: BatchCursorBinding = Object.freeze({ collection: "ingestion_batches", access, filters: Object.freeze(boundFilters) });
        let anchor: BatchPosition | null = null;
        if (cursor !== null) {
          try { anchor = position(await deps.cursors.verify(cursor, binding)); }
          catch { throw new BatchQueryError("INVALID_CURSOR"); }
        }
        const values: unknown[] = [access.batchIds], where: string[] = [];
        const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
        if (filters.status !== null) where.push(`status = ${bind(filters.status)}`);
        if (filters.persistenceAttemptId !== null) where.push(`persistence_attempt_id = ${bind(filters.persistenceAttemptId)}::uuid`);
        if (anchor !== null) where.push(`(created_at, id) < (${bind(anchor.createdAt)}::timestamptz, ${bind(anchor.batchId)}::uuid)`);
        const rows = access.batchIds.length === 0 ? [] : await query(deps, access, where, values, filters.limit + 1);
        const items = rows.slice(0, filters.limit);
        let nextCursor: string | null = null;
        if (rows.length > filters.limit) {
          const last = items[items.length - 1];
          try {
            nextCursor = await deps.cursors.issue(Object.freeze({ createdAt: last.created_at, batchId: last.batch_id }), binding);
            if (typeof nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(nextCursor)) throw new Error();
          } catch { throw new BatchQueryError("INVALID_CURSOR"); }
        }
        return { value: Object.freeze({ items: Object.freeze(items), nextCursor }), resultCount: items.length };
      });
    },
    async get(id: unknown, context: Context): Promise<BatchItem | null> {
      const batchId = parseBatchId(id);
      return run(context, "lookup", async (deps, access) => {
        const rows = access.batchIds.includes(batchId) ? await query(deps, access, ["id = $2::uuid"], [access.batchIds, batchId], 1) : [];
        if (rows.some(row => row.batch_id !== batchId)) throw new BatchQueryError("QUERY_FAILED");
        return { value: rows[0] ?? null, resultCount: rows.length, outcome: rows.length === 0 ? "not_found" : undefined };
      });
    },
  };
}
