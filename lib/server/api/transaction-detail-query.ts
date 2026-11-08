import "server-only";
import type { SqlConnection } from "../db/postgres";
import { parseTransactionId, projectTransactionRow, type TransactionListItem } from "./transaction-contract";
import type { TransactionAccess } from "./transaction-query";
import { TRANSACTION_ROW_SELECTION } from "./transaction-selection";

export interface TransactionDetailAuditReceipt {
  readonly subjectId: string | null;
  readonly organizationId: string | null;
  readonly transactionId: string;
  readonly outcome: "success" | "not_found" | "denied" | "failure";
  readonly recordCount: 0 | 1;
}
export interface TransactionDetailDependencies<Context> {
  readonly database: SqlConnection;
  /** Verify identity, detail-read permission and stored ownership for this selector.
   * The UUID is untrusted input, not authority. Null is identity/operation denial;
   * missing/out-of-scope targets must instead yield an excluding (possibly empty) scope.
   * Sharing the grant's shape with list reads does not share or invent permissions. */
  readonly resolveAccess: (context: Context, transactionId: string) => Promise<TransactionAccess | null>;
  /** Literal true only after protected durable persistence; no financial payload is supplied. */
  readonly audit: (receipt: Readonly<TransactionDetailAuditReceipt>) => Promise<true>;
}
export class TransactionDetailQueryError extends Error {
  constructor(readonly code: "SECURITY_UNAVAILABLE" | "ACCESS_DENIED" | "QUERY_FAILED" | "AUDIT_FAILED") {
    super("Transaction detail query could not be completed"); this.name = "TransactionDetailQueryError";
  }
}
function snapshot(value: TransactionAccess | null): TransactionAccess {
  if (value === null) throw new TransactionDetailQueryError("ACCESS_DENIED");
  try {
    if (!value || ![value.subjectId, value.organizationId, value.scopeVersion].every(id => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id))
      || !Array.isArray(value.batchIds)) throw new Error();
    return Object.freeze({ subjectId: value.subjectId, organizationId: value.organizationId, scopeVersion: value.scopeVersion,
      batchIds: Object.freeze([...new Set(Array.from(value.batchIds, parseTransactionId))].sort()) });
  } catch { throw new TransactionDetailQueryError("SECURITY_UNAVAILABLE"); }
}

/** Internal single-record lookup. No HTTP transport, pool or security-policy defaults. */
export function createTransactionDetailQueryService<Context>(dependencies?: TransactionDetailDependencies<Context>) {
  return {
    async get(id: unknown, context: Context): Promise<TransactionListItem | null> {
      const transactionId = parseTransactionId(id);
      if (!dependencies || typeof dependencies.database?.query !== "function"
        || typeof dependencies.resolveAccess !== "function" || typeof dependencies.audit !== "function") {
        throw new TransactionDetailQueryError("SECURITY_UNAVAILABLE");
      }
      let access: TransactionAccess | null = null;
      let item: TransactionListItem | null = null;
      let failure: TransactionDetailQueryError | undefined;
      try {
        try { access = snapshot(await dependencies.resolveAccess(context, transactionId)); }
        catch (error) { throw error instanceof TransactionDetailQueryError ? error : new TransactionDetailQueryError("SECURITY_UNAVAILABLE"); }
        if (access.batchIds.length > 0) {
          const result = await dependencies.database.query(`SELECT ${TRANSACTION_ROW_SELECTION}
FROM public.financial_records r
WHERE r.id = $1::uuid AND r.batch_id = ANY($2::uuid[]) AND r.ingestion_status IN ('VALID', 'WARNING')
LIMIT 2`, [transactionId, access.batchIds]);
          // PK guarantees one row; reject a broken adapter returning multiple/different/unscoped rows.
          if (result.rows.length > 1) throw new Error();
          item = result.rows.length === 0 ? null : projectTransactionRow(result.rows[0]);
          if (item !== null && (item.transaction_id.toLowerCase() !== transactionId || !access.batchIds.includes(item.batch_id.toLowerCase()))) throw new Error();
        }
      } catch (error) {
        item = null;
        failure = error instanceof TransactionDetailQueryError ? error : new TransactionDetailQueryError("QUERY_FAILED");
      }
      try {
        if (await dependencies.audit(Object.freeze({ subjectId: access?.subjectId ?? null,
          organizationId: access?.organizationId ?? null, transactionId,
          outcome: failure ? failure.code === "ACCESS_DENIED" ? "denied" : "failure" : item === null ? "not_found" : "success",
          recordCount: item === null ? 0 : 1 })) !== true) throw new Error();
      } catch { throw new TransactionDetailQueryError("AUDIT_FAILED"); }
      if (failure) throw failure;
      return item;
    },
  };
}
