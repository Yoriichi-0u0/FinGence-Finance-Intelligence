import "server-only";
import type { SecurityRole, TrustedPrincipal } from "./authorization";

/** Backend-resolved data scope. Never construct this from request JSON. */
export interface TransactionAccess {
  readonly subjectId: string;
  readonly organizationId: string;
  readonly scopeVersion: string;
  readonly batchIds: readonly string[];
}
export interface BackendTrustedPrincipal {
  readonly subjectId: string;
  readonly organizationId: string;
  readonly role: "Admin" | "Analyst" | "Reviewer";
}
/** Adapt backend role labels after its auth owner has verified identity and membership. */
export function adaptTrustedPrincipal(value: unknown): TrustedPrincipal | null {
  const input = safeRecord(value, ["subjectId", "organizationId", "role"]);
  if (!input || Object.keys(input).length !== 3 || !validId(input.subjectId) || !validId(input.organizationId)) return null;
  const role = input.role === "Admin" ? "administrator" : input.role === "Analyst" ? "finance_analyst"
    : input.role === "Reviewer" ? "management_reviewer" : null;
  return role ? { subjectId: input.subjectId, organizationId: input.organizationId, role } : null;
}
export type TransactionCollectionAction = "transactions.list" | "transaction.read" | "batch.read";
export type TransactionCollectionDecision =
  | { readonly allowed: true; readonly action: "transactions.list" | "batch.read"; readonly auditRequired: true }
  | { readonly allowed: true; readonly action: "transaction.read"; readonly auditRequired: true; readonly requiresRecordAuthorization: true }
  | { readonly allowed: false; readonly action: TransactionCollectionAction; readonly code: "UNAUTHENTICATED" | "INVALID_CONTEXT" | "CROSS_ORGANIZATION" | "ROLE_DENIED" | "SCOPE_DENIED"; readonly auditRequired: true };

const idPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const validId = (value: unknown): value is string => typeof value === "string" && idPattern.test(value);
const roles: readonly SecurityRole[] = ["administrator", "finance_analyst", "management_reviewer"];
function safeRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(d => !("value" in d)) || Object.keys(descriptors).some(k => !allowedKeys.includes(k))) return null;
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function isPrincipal(value: unknown): value is TrustedPrincipal {
  const p = safeRecord(value, ["subjectId", "organizationId", "role"]);
  return !!p && Object.keys(p).length === 3 && validId(p.subjectId) && validId(p.organizationId)
    && typeof p.role === "string" && roles.includes(p.role as SecurityRole);
}
function isAccess(value: unknown): value is TransactionAccess {
  const s = safeRecord(value, ["subjectId", "organizationId", "scopeVersion", "batchIds"]);
  return !!s && Object.keys(s).length === 4 && validId(s.subjectId) && validId(s.organizationId)
    && validId(s.scopeVersion) && Array.isArray(s.batchIds) && s.batchIds.every(validId)
    && new Set(s.batchIds).size === s.batchIds.length;
}

/**
 * Checks collection/batch permissions and transaction batch scope. A transaction
 * read is only scope-checked here; callers must also pass its DB-resolved resource
 * to authorize() before querying/returning the transaction.
 */
export function authorizeTransactionAccess(
  principalInput: unknown,
  accessInput: unknown,
  action: TransactionCollectionAction,
  resourceId?: unknown,
  scopeBatchId?: unknown,
): TransactionCollectionDecision {
  if (principalInput === null || principalInput === undefined) return { allowed: false, action, code: "UNAUTHENTICATED", auditRequired: true };
  const shapeValid = action === "transactions.list"
    ? resourceId === undefined && scopeBatchId === undefined
    : action === "batch.read"
      ? validId(resourceId) && scopeBatchId === undefined
      : action === "transaction.read" && validId(resourceId) && validId(scopeBatchId);
  if (!isPrincipal(principalInput) || !isAccess(accessInput) || !shapeValid) {
    return { allowed: false, action, code: "INVALID_CONTEXT", auditRequired: true };
  }
  if (principalInput.subjectId !== accessInput.subjectId || principalInput.organizationId !== accessInput.organizationId) {
    return { allowed: false, action, code: "CROSS_ORGANIZATION", auditRequired: true };
  }
  if (action !== "transaction.read" && principalInput.role !== "finance_analyst") {
    return { allowed: false, action, code: "ROLE_DENIED", auditRequired: true };
  }
  const batchId = action === "transaction.read" ? scopeBatchId : action === "batch.read" ? resourceId : undefined;
  if (batchId !== undefined && !accessInput.batchIds.includes(batchId as string)) {
    return { allowed: false, action, code: "SCOPE_DENIED", auditRequired: true };
  }
  return action === "transaction.read"
    ? { allowed: true, action, auditRequired: true, requiresRecordAuthorization: true }
    : { allowed: true, action, auditRequired: true };
}
