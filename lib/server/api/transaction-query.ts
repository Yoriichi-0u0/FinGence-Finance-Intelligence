import "server-only";
import type { SqlConnection } from "../db/postgres";
import { parseTransactionListFilters, projectTransactionRow, type TransactionListFilters, type TransactionListItem } from "./transaction-contract";

/** Supplied by trusted server composition, never deserialized from a request. */
export interface TransactionAccess {
  readonly subjectId: string;
  readonly organizationId: string;
  /** Changes when the authorized scope changes; must also be bound into cursors. */
  readonly scopeVersion: string;
  /** Complete server-resolved scope for this collection read, including lifecycle policy. */
  readonly batchIds: readonly string[];
}
export interface TransactionPosition {
  readonly canonicalDate: string;
  readonly transactionId: string;
}
export interface TransactionCursorBinding {
  readonly access: TransactionAccess;
  readonly filters: Omit<TransactionListFilters, "cursor">;
}
export interface TransactionQueryDependencies<Context> {
  readonly database: SqlConnection;
  /** Verify identity, active membership, collection permission and stored ownership.
   * Return null on denial. This adapter owns auditing of its own access decisions.
   * Never authorize a collection using a fabricated financial_record resource ID. */
  readonly resolveAccess: (context: Context) => Promise<TransactionAccess | null>;
  readonly cursors: {
    /** Verify integrity, expiry and the entire binding; reject mismatches. */
    readonly verify: (token: string, binding: TransactionCursorBinding) => Promise<TransactionPosition>;
    readonly issue: (position: TransactionPosition, binding: TransactionCursorBinding) => Promise<string>;
  };
  /** Resolve only after durable protected persistence; false/undefined is not acknowledgement.
   * Adapter maps this internal receipt to the agreed security-audit action/target.
   * Receives no filters, cursor, financial payload or raw database errors. */
  readonly auditRead: (event: Readonly<{ subjectId: string; organizationId: string; recordCount: number }>) => Promise<true>;
}
export class TransactionQueryError extends Error {
  constructor(readonly code: "SECURITY_UNAVAILABLE" | "ACCESS_DENIED" | "INVALID_CURSOR" | "QUERY_FAILED" | "AUDIT_FAILED") {
    super("Transaction query could not be completed");
    this.name = "TransactionQueryError";
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const tokenPattern = /^[A-Za-z0-9_-]{1,512}$/;
function accessSnapshot(value: TransactionAccess | null): TransactionAccess {
  if (value === null) throw new TransactionQueryError("ACCESS_DENIED");
  if (!value || ![value.subjectId, value.organizationId, value.scopeVersion].every(v => typeof v === "string" && identifier.test(v))
    || !Array.isArray(value.batchIds) || !Array.from(value.batchIds).every(v => typeof v === "string" && uuid.test(v))) {
    throw new TransactionQueryError("SECURITY_UNAVAILABLE");
  }
  return Object.freeze({ subjectId: value.subjectId, organizationId: value.organizationId,
    scopeVersion: value.scopeVersion, batchIds: Object.freeze([...new Set(value.batchIds.map(id => id.toLowerCase()))].sort()) });
}
function positionSnapshot(value: TransactionPosition): TransactionPosition {
  try {
    if (!value || typeof value.transactionId !== "string" || !uuid.test(value.transactionId)
      || typeof value.canonicalDate !== "string") throw new Error();
    parseTransactionListFilters(new URLSearchParams({ date_from: value.canonicalDate }));
    return Object.freeze({ canonicalDate: value.canonicalDate, transactionId: value.transactionId.toLowerCase() });
  } catch { throw new TransactionQueryError("INVALID_CURSOR"); }
}
const columns = ["id", "batch_id", "ingestion_batch_id", "source_row_id", "canonical_date",
  "transaction_date", "posting_date", "canonical_date_basis", "reference", "source_transaction_id",
  "description", "account_code", "monetary_basis", "debit", "credit", "source_amount", "entry_side",
  "derived_ledger_net", "balance", "currency", "currency_basis", "ingestion_status"] as const;
const dateColumns = new Set<string>(["canonical_date", "transaction_date", "posting_date"]);
const textColumns = new Set<string>(["debit", "credit", "source_amount", "derived_ledger_net", "balance"]);
// Format only the projection: to_char preserves NULL and does not depend on DateStyle.
// WHERE, ORDER BY and keyset comparisons continue to use native date columns.
const selection = columns.map(column => `${dateColumns.has(column)
  ? `to_char(r.${column}, 'YYYY-MM-DD')`
  : `r.${column}${textColumns.has(column) ? "::text" : ""}`} AS ${column}`).join(", ");

/** Internal only. No credentials, pool construction, policy defaults or HTTP transport. */
export function createTransactionQueryService<Context>(dependencies?: TransactionQueryDependencies<Context>) {
  return {
    async list(parameters: URLSearchParams, context: Context): Promise<Readonly<{
      items: readonly TransactionListItem[]; nextCursor: string | null;
    }>> {
      // Validate dependencies on every call; a missing adapter can never mean unscoped access.
      if (!dependencies || typeof dependencies.database?.query !== "function"
        || typeof dependencies.resolveAccess !== "function" || typeof dependencies.auditRead !== "function"
        || typeof dependencies.cursors?.verify !== "function" || typeof dependencies.cursors?.issue !== "function") {
        throw new TransactionQueryError("SECURITY_UNAVAILABLE");
      }
      const filters = parseTransactionListFilters(parameters);
      let access: TransactionAccess;
      try { access = accessSnapshot(await dependencies.resolveAccess(context)); }
      catch (error) {
        if (error instanceof TransactionQueryError) throw error;
        throw new TransactionQueryError("SECURITY_UNAVAILABLE");
      }
      const { cursor, ...boundFilters } = filters;
      const binding = Object.freeze({ access, filters: Object.freeze(boundFilters) });
      let position: TransactionPosition | null = null;
      if (cursor !== null) {
        try { position = positionSnapshot(await dependencies.cursors.verify(cursor, binding)); }
        catch { throw new TransactionQueryError("INVALID_CURSOR"); }
      }
      let items: TransactionListItem[] = [];
      let hasMore = false;
      // A caller-supplied batch can narrow a verified scope, never expand it.
      if (filters.batchId !== null && !access.batchIds.includes(filters.batchId.toLowerCase())) {
        throw new TransactionQueryError("ACCESS_DENIED");
      }
      if (access.batchIds.length > 0) {
        const values: unknown[] = [access.batchIds];
        const where = ["r.batch_id = ANY($1::uuid[])", "r.ingestion_status IN ('VALID', 'WARNING')"];
        const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
        if (filters.dateFrom !== null) where.push(`r.canonical_date >= ${bind(filters.dateFrom)}::date`);
        if (filters.dateTo !== null) where.push(`r.canonical_date <= ${bind(filters.dateTo)}::date`);
        if (filters.batchId !== null) where.push(`r.batch_id = ${bind(filters.batchId)}::uuid`);
        if (filters.status !== null) where.push(`r.ingestion_status = ${bind(filters.status)}`);
        if (filters.currency !== null) where.push(`r.currency = ${bind(filters.currency)}`);
        if (filters.monetaryBasis !== null) where.push(`r.monetary_basis = ${bind(filters.monetaryBasis)}`);
        if (position !== null) where.push(`(r.canonical_date, r.id) < (${bind(position.canonicalDate)}::date, ${bind(position.transactionId)}::uuid)`);
        const limit = bind(filters.limit + 1);
        try {
          const result = await dependencies.database.query(`SELECT ${selection} FROM public.financial_records r
WHERE ${where.join(" AND ")} ORDER BY r.canonical_date DESC, r.id DESC LIMIT ${limit}::integer`, values);
          if (result.rows.length > filters.limit + 1) throw new Error();
          // Validate even the lookahead row; a broken adapter must never leak rejected/unscoped rows.
          const projected = result.rows.map(projectTransactionRow);
          if (projected.some(row => !access.batchIds.includes(row.batch_id.toLowerCase()))) throw new Error();
          hasMore = projected.length > filters.limit;
          items = projected.slice(0, filters.limit);
        } catch { throw new TransactionQueryError("QUERY_FAILED"); }
      }
      let nextCursor: string | null = null;
      if (hasMore) {
        const last = items[items.length - 1];
        try {
          nextCursor = await dependencies.cursors.issue(Object.freeze({ canonicalDate: last.canonical_date, transactionId: last.transaction_id }), binding);
          if (typeof nextCursor !== "string" || !tokenPattern.test(nextCursor)) throw new Error();
        } catch { throw new TransactionQueryError("INVALID_CURSOR"); }
      }
      try {
        if (await dependencies.auditRead(Object.freeze({ subjectId: access.subjectId,
          organizationId: access.organizationId, recordCount: items.length })) !== true) throw new Error();
      } catch { throw new TransactionQueryError("AUDIT_FAILED"); }
      return Object.freeze({ items: Object.freeze(items), nextCursor });
    },
  };
}
