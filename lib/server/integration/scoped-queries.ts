import "server-only";
import { parseBatchId } from "../api/batch-contract";
import { createBatchQueryService } from "../api/batch-query";
import { parseTransactionId } from "../api/transaction-contract";
import { createTransactionDetailQueryService } from "../api/transaction-detail-query";
import { createTransactionQueryService, TransactionQueryError } from "../api/transaction-query";
import type { SqlConnection, TransactionDatabase } from "../db/postgres";
import { recordApiSecurityEvent } from "../security/audit-api";
import { createTransactionSecurityGuard, TransactionSecurityError, type AuthorizedTransactionRequest, type TransactionSecurityGuardDependencies } from "../security/transaction-guard";
import { createBatchCursorAdapter, createTransactionCursorAdapter } from "./query-cursors";

export interface ScopedReadDependencies extends Omit<TransactionSecurityGuardDependencies, "database" | "resolveTransactionScope"> {
  /** Must release each read before resolving; never pass a checked-out transaction client. */
  readonly readConnection: SqlConnection;
  readonly auditDatabase: TransactionDatabase;
  readonly resolveTransactionScope: NonNullable<TransactionSecurityGuardDependencies["resolveTransactionScope"]>;
  /** Server-provided key, not a request or browser value. */
  readonly cursorSecret: string;
}

type Outcome = "success" | "denied" | "failure" | "not_found";

/**
 * Internal composition only. Authentication, membership and stored ownership resolvers
 * must be supplied by their owners; there are no development-user defaults or HTTP routes.
 */
export function createScopedReadService(deps: ScopedReadDependencies) {
  if (!deps || typeof deps.readConnection?.query !== "function" || typeof deps.auditDatabase?.transaction !== "function"
    || typeof deps.resolvePrincipal !== "function" || typeof deps.resolveAccess !== "function"
    || typeof deps.resolveTransactionScope !== "function" || typeof deps.cursorSecret !== "string"
    || Buffer.byteLength(deps.cursorSecret, "utf8") < 32) throw new Error("Scoped read dependencies are unavailable");
  const guard = createTransactionSecurityGuard({ database: deps.auditDatabase, resolvePrincipal: deps.resolvePrincipal,
    resolveAccess: deps.resolveAccess, resolveTransactionScope: deps.resolveTransactionScope });

  function snapshot(context: AuthorizedTransactionRequest): AuthorizedTransactionRequest {
    return Object.freeze({ ...context, principal: Object.freeze({ ...context.principal }),
      access: Object.freeze({ ...context.access, batchIds: Object.freeze([...context.access.batchIds]) }) });
  }

  async function audit(context: AuthorizedTransactionRequest, action: "transactions.list" | "transaction.read" | "batch.read",
    targetId: string, outcome: Outcome): Promise<true> {
    await recordApiSecurityEvent(deps.auditDatabase, {
      actorId: context.principal.subjectId, organizationId: context.principal.organizationId, action,
      outcome: outcome === "not_found" ? "denied" : outcome,
      targetType: action === "transactions.list" ? "transaction_collection" : action === "transaction.read" ? "financial_record" : "ingestion_batch",
      targetId, requestId: context.requestId, approvalId: context.approvalId,
    });
    return true;
  }

  return {
    async listTransactions(parameters: URLSearchParams, request: Request) {
      // The guard owns auditing of authentication/scope failures; do not catch it below.
      const context = snapshot(await guard.authorizeRequest(request, "transactions.list"));
      let auditAttempted = false;
      const acknowledge = async (outcome: Outcome) => { auditAttempted = true; return audit(context, "transactions.list", "transactions", outcome); };
      const query = createTransactionQueryService<AuthorizedTransactionRequest>({
        database: deps.readConnection, resolveAccess: async authorized => authorized.access,
        cursors: createTransactionCursorAdapter(context.principal, deps.cursorSecret),
        auditRead: async () => acknowledge("success"),
      });
      try { return await query.list(parameters, context); }
      catch (error) {
        if (!auditAttempted) {
          try { await acknowledge(error instanceof TransactionQueryError && error.code === "ACCESS_DENIED" ? "denied" : "failure"); }
          catch { throw new TransactionQueryError("AUDIT_FAILED"); }
        }
        throw error;
      }
    },

    async getTransaction(id: string, request: Request) {
      const target = parseTransactionId(id);
      let authorized: AuthorizedTransactionRequest;
      try { authorized = await guard.authorizeRequest(request, "transaction.read", target); }
      catch (error) {
        // A role denial for an existing record must be indistinguishable from a
        // missing/out-of-scope record. The guard has already durably audited it.
        if (error instanceof TransactionSecurityError && (error.status === 403 || error.status === 404)) {
          throw new TransactionSecurityError(404, "RESOURCE_NOT_FOUND");
        }
        throw error;
      }
      const context = snapshot(authorized);
      const query = createTransactionDetailQueryService<AuthorizedTransactionRequest>({
        database: deps.readConnection, resolveAccess: async authorized => authorized.access,
        audit: async receipt => audit(context, "transaction.read", target, receipt.outcome),
      });
      const result = await query.get(target, context);
      if (result === null) throw new TransactionSecurityError(404, "RESOURCE_NOT_FOUND");
      return result;
    },

    async getBatch(id: string, request: Request) {
      const target = parseBatchId(id);
      let authorized: AuthorizedTransactionRequest;
      try { authorized = await guard.authorizeRequest(request, "batch.read", target); }
      catch (error) {
        if (error instanceof TransactionSecurityError && error.status === 404) throw new TransactionSecurityError(404, "RESOURCE_NOT_FOUND");
        throw error;
      }
      const context = snapshot(authorized);
      const query = createBatchQueryService<AuthorizedTransactionRequest>({
        database: deps.readConnection, resolveAccess: async authorized => authorized.access,
        cursors: createBatchCursorAdapter(context.principal, deps.cursorSecret),
        audit: async receipt => audit(context, "batch.read", target, receipt.outcome),
      });
      const result = await query.get(target, context);
      if (result === null) throw new TransactionSecurityError(404, "RESOURCE_NOT_FOUND");
      return result;
    },
  };
}
