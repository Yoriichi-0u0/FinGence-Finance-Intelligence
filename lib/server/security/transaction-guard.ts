import "server-only";
import { randomUUID } from "node:crypto";
import type { TransactionDatabase } from "../db/postgres";
import { authorize, type ExceptionalAccessApproval, type ProtectedResource, type TrustedPrincipal } from "./authorization";
import { auditRead } from "./audit-api";
import { authorizeTransactionAccess, type TransactionAccess, type TransactionCollectionAction } from "./transaction-access";

export class TransactionSecurityError extends Error {
  constructor(readonly status: 401 | 403 | 404 | 503, readonly code: string) {
    super(code);
    this.name = "TransactionSecurityError";
  }
}
export interface AuthorizedTransactionRequest {
  readonly principal: TrustedPrincipal;
  readonly access: TransactionAccess;
  readonly requestId: string;
  readonly approvalId: string | null;
}
export interface TransactionResourceScope {
  /** Resolved from the database by the backend owner, never from request data. */
  readonly resource: ProtectedResource;
  readonly batchId: string;
  /** Optional grant loaded and verified by the trusted approval owner. */
  readonly approval?: ExceptionalAccessApproval;
}
export interface TransactionSecurityGuardDependencies {
  readonly database: TransactionDatabase;
  /** Must verify the session/token and active organization membership. No request claims. */
  readonly resolvePrincipal: (request: Request) => Promise<TrustedPrincipal | null>;
  /** Must load the user's current ownership/access scope from trusted backend data. */
  readonly resolveAccess: (principal: TrustedPrincipal, request: Request) => Promise<TransactionAccess>;
  /** Required for single-record reads; performs an ownership lookup without returning record data. */
  readonly resolveTransactionScope?: (principal: TrustedPrincipal, transactionId: string) => Promise<TransactionResourceScope | null>;
}

function auditTarget(action: TransactionCollectionAction, resourceId: unknown): { targetType: string | null; targetId: string | null } {
  if (action === "transactions.list") return { targetType: "transaction_collection", targetId: "transactions" };
  if (typeof resourceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(resourceId)) return { targetType: null, targetId: null };
  return action === "batch.read"
    ? { targetType: "ingestion_batch", targetId: resourceId }
    : { targetType: "financial_record", targetId: resourceId };
}

/** Route-facing guard. The auth and ownership providers are supplied by their owners. */
export function createTransactionSecurityGuard(dependencies: TransactionSecurityGuardDependencies) {
  return {
    async authorizeRequest(request: Request, action: TransactionCollectionAction, resourceId?: unknown): Promise<AuthorizedTransactionRequest> {
      const requestId = randomUUID();
      let principal: TrustedPrincipal | null;
      try { principal = await dependencies.resolvePrincipal(request); }
      catch {
        await auditRead(dependencies.database, { actorId: null, organizationId: null, action, outcome: "failure",
          ...auditTarget(action, resourceId), requestId, approvalId: null });
        throw new TransactionSecurityError(503, "AUTHENTICATION_UNAVAILABLE");
      }
      if (!principal) {
        await auditRead(dependencies.database, { actorId: null, organizationId: null, action, outcome: "denied",
          ...auditTarget(action, resourceId), requestId, approvalId: null });
        throw new TransactionSecurityError(401, "UNAUTHENTICATED");
      }

      let access: TransactionAccess;
      try { access = await dependencies.resolveAccess(principal, request); }
      catch {
        await auditRead(dependencies.database, { actorId: principal.subjectId, organizationId: principal.organizationId, action, outcome: "failure",
          ...auditTarget(action, resourceId), requestId, approvalId: null });
        throw new TransactionSecurityError(503, "ACCESS_SCOPE_UNAVAILABLE");
      }

      let resourceScope: TransactionResourceScope | null = null;
      if (action === "transaction.read") {
        if (typeof resourceId !== "string" || !dependencies.resolveTransactionScope) {
          await auditRead(dependencies.database, { actorId: principal.subjectId, organizationId: principal.organizationId, action, outcome: "failure",
            ...auditTarget(action, resourceId), requestId, approvalId: null });
          throw new TransactionSecurityError(503, "TRANSACTION_SCOPE_LOOKUP_UNAVAILABLE");
        }
        try { resourceScope = await dependencies.resolveTransactionScope(principal, resourceId); }
        catch {
          await auditRead(dependencies.database, { actorId: principal.subjectId, organizationId: principal.organizationId, action, outcome: "failure",
            ...auditTarget(action, resourceId), requestId, approvalId: null });
          throw new TransactionSecurityError(503, "TRANSACTION_SCOPE_LOOKUP_UNAVAILABLE");
        }
        if (!resourceScope || resourceScope.resource.id !== resourceId || resourceScope.resource.type !== "financial_record") {
          await auditRead(dependencies.database, { actorId: principal.subjectId, organizationId: principal.organizationId, action, outcome: "denied",
            ...auditTarget(action, resourceId), requestId, approvalId: null });
          throw new TransactionSecurityError(404, "RESOURCE_NOT_FOUND");
        }
      }

      const decision = authorizeTransactionAccess(principal, access, action, resourceId,
        action === "transaction.read" ? resourceScope?.batchId : undefined);
      if (!decision.allowed) {
        await auditRead(dependencies.database, { actorId: principal.subjectId, organizationId: principal.organizationId, action, outcome: "denied",
          ...auditTarget(action, resourceId), requestId, approvalId: null });
        const status = decision.code === "CROSS_ORGANIZATION" || decision.code === "SCOPE_DENIED" ? 404
          : decision.code === "UNAUTHENTICATED" ? 401 : 403;
        throw new TransactionSecurityError(status, decision.code);
      }

      let approvalId: string | null = null;
      if (action === "transaction.read" && resourceScope) {
        const recordDecision = authorize(principal, "financial_record.read", resourceScope.resource, resourceScope.approval);
        if (!recordDecision.allowed) {
          await auditRead(dependencies.database, { actorId: principal.subjectId, organizationId: principal.organizationId, action, outcome: "denied",
            ...auditTarget(action, resourceId), requestId, approvalId: null });
          throw new TransactionSecurityError(403, recordDecision.code);
        }
        if (recordDecision.code === "APPROVED_ADMIN_EXCEPTION") approvalId = recordDecision.approvalId;
      }
      return Object.freeze({ principal, access, requestId, approvalId });
    },
  };
}
