import "server-only";

export const SECURITY_ROLES = ["administrator", "finance_analyst", "management_reviewer"] as const;
export type SecurityRole = typeof SECURITY_ROLES[number];

export const SECURITY_ACTIONS = [
  "ingestion.upload",
  "ingestion.process",
  "persistence_attempt.create",
  "persistence_attempt.investigate",
  "financial_record.read",
  "financial_record.reconcile",
  "rejected_evidence.read",
  "report.generate",
  "report.read",
  "report.download",
  "dashboard.read",
  "organization_users.manage",
  "organization_roles.manage",
  "security_logs.read",
  "organization_settings.manage",
] as const;
export type SecurityAction = typeof SECURITY_ACTIONS[number];

export const SECURITY_RESOURCE_TYPES = [
  "ingestion_batch",
  "persistence_attempt",
  "financial_record",
  "rejected_evidence",
  "report",
  "dashboard",
  "organization_user",
  "security_log",
  "organization_settings",
] as const;
export type SecurityResourceType = typeof SECURITY_RESOURCE_TYPES[number];

export interface TrustedPrincipal {
  readonly subjectId: string;
  /** Resolve from verified server-side membership, never from a request body. */
  readonly organizationId: string;
  /** Resolve from the server-side role assignment, never from a browser claim alone. */
  readonly role: SecurityRole;
}

export interface ProtectedResource {
  /** Resolve from the server/database record before calling authorize(). */
  readonly organizationId: string;
  readonly type: SecurityResourceType;
  readonly id: string;
  /** Server-resolved publication state; required for dashboards and reports. */
  readonly approvalStatus?: "approved" | "draft";
  /** Server-resolved original creator; required for persistence attempts. */
  readonly ownerSubjectId?: string;
}

/**
 * A grant loaded and verified by a trusted approval service, not supplied by a caller.
 * Each grant is limited to one user, action, organization, and resource.
 */
export interface ExceptionalAccessApproval {
  readonly approvalId: string;
  readonly subjectId: string;
  readonly approvedBySubjectId: string;
  readonly organizationId: string;
  readonly action: "financial_record.read" | "rejected_evidence.read";
  readonly resourceType: "financial_record" | "rejected_evidence";
  readonly resourceId: string;
  readonly reason: string;
  readonly expiresAt: string;
}

export type AuthorizationDecision =
  | { readonly allowed: true; readonly code: "ROLE_PERMISSION"; readonly auditRequired: true }
  | {
      readonly allowed: true;
      readonly code: "APPROVED_ADMIN_EXCEPTION";
      readonly auditRequired: true;
      readonly approvalId: string;
    }
  | {
      readonly allowed: false;
  readonly code: "UNAUTHENTICATED" | "INVALID_CONTEXT" | "CROSS_ORGANIZATION" | "RESOURCE_ACTION_MISMATCH" | "RESOURCE_OWNER_MISMATCH" | "ROLE_DENIED";
      readonly auditRequired: true;
    };

const resourceForAction: Readonly<Record<SecurityAction, SecurityResourceType>> = {
  "ingestion.upload": "ingestion_batch",
  "ingestion.process": "ingestion_batch",
  "persistence_attempt.create": "persistence_attempt",
  "persistence_attempt.investigate": "persistence_attempt",
  "financial_record.read": "financial_record",
  "financial_record.reconcile": "financial_record",
  "rejected_evidence.read": "rejected_evidence",
  "report.generate": "report",
  "report.read": "report",
  "report.download": "report",
  "dashboard.read": "dashboard",
  "organization_users.manage": "organization_user",
  "organization_roles.manage": "organization_user",
  "security_logs.read": "security_log",
  "organization_settings.manage": "organization_settings",
};

const permissions: Readonly<Record<SecurityRole, readonly SecurityAction[]>> = {
  administrator: [
    "organization_users.manage",
    "organization_roles.manage",
    "security_logs.read",
    "organization_settings.manage",
  ],
  finance_analyst: [
    "ingestion.upload",
    "ingestion.process",
    "persistence_attempt.create",
    "persistence_attempt.investigate",
    "financial_record.read",
    "financial_record.reconcile",
    "rejected_evidence.read",
    "report.generate",
    "report.read",
    "report.download",
    "dashboard.read",
  ],
  management_reviewer: ["report.read", "dashboard.read"],
};

const idPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const has = <const Values extends readonly string[]>(values: Values, value: unknown): value is Values[number] =>
  typeof value === "string" && (values as readonly string[]).includes(value);

function plainDataObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => !("value" in descriptor))) return null;
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function validId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

function trustedPrincipal(value: unknown): TrustedPrincipal | null {
  const input = plainDataObject(value);
  if (!input || Object.keys(input).some(key => !["subjectId", "organizationId", "role"].includes(key))) return null;
  if (!validId(input.subjectId) || !validId(input.organizationId) || !has(SECURITY_ROLES, input.role)) return null;
  return { subjectId: input.subjectId, organizationId: input.organizationId, role: input.role };
}

function protectedResource(value: unknown): ProtectedResource | null {
  const input = plainDataObject(value);
  if (!input || Object.keys(input).some(key => !["organizationId", "type", "id", "approvalStatus", "ownerSubjectId"].includes(key))) return null;
  if (!validId(input.organizationId) || !validId(input.id) || !has(SECURITY_RESOURCE_TYPES, input.type)) return null;
  if (input.type === "report" || input.type === "dashboard") {
    if (input.approvalStatus !== "approved" && input.approvalStatus !== "draft") return null;
  } else if (input.approvalStatus !== undefined) return null;
  if (input.type === "persistence_attempt") {
    if (!validId(input.ownerSubjectId)) return null;
  } else if (input.ownerSubjectId !== undefined) return null;
  return {
    organizationId: input.organizationId,
    id: input.id,
    type: input.type,
    ...(input.approvalStatus === undefined ? {} : { approvalStatus: input.approvalStatus }),
    ...(input.ownerSubjectId === undefined ? {} : { ownerSubjectId: input.ownerSubjectId }),
  };
}

function verifiedApproval(value: unknown): ExceptionalAccessApproval | null {
  if (value === undefined) return null;
  const input = plainDataObject(value);
  const keys = ["approvalId", "subjectId", "approvedBySubjectId", "organizationId", "action", "resourceType", "resourceId", "reason", "expiresAt"];
  if (!input || Object.keys(input).some(key => !keys.includes(key)) || Object.keys(input).length !== keys.length) return null;
  if (!validId(input.approvalId) || !validId(input.subjectId) || !validId(input.approvedBySubjectId)
    || !validId(input.organizationId) || !validId(input.resourceId)) return null;
  if (input.action !== "financial_record.read" && input.action !== "rejected_evidence.read") return null;
  if (input.resourceType !== "financial_record" && input.resourceType !== "rejected_evidence") return null;
  if (typeof input.reason !== "string" || input.reason.trim().length === 0 || input.reason.length > 500
    // Reject control characters in approval reasons.
    || /[\u0000-\u001f\u007f]/.test(input.reason)) return null;
  if (typeof input.expiresAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.expiresAt)
    || !Number.isFinite(Date.parse(input.expiresAt))) return null;
  return input as unknown as ExceptionalAccessApproval;
}

/**
 * Evaluate authorization using server-verified identity/membership and a resource
 * resolved by the server. This function does not verify Supabase tokens or persist grants.
 */
export function authorize(
  principalInput: unknown,
  actionInput: unknown,
  resourceInput: unknown,
  approvalInput?: unknown,
): AuthorizationDecision {
  if (principalInput === null || principalInput === undefined) {
    return { allowed: false, code: "UNAUTHENTICATED", auditRequired: true };
  }
  const principal = trustedPrincipal(principalInput);
  const resource = protectedResource(resourceInput);
  if (!principal || !resource || !has(SECURITY_ACTIONS, actionInput)) {
    return { allowed: false, code: "INVALID_CONTEXT", auditRequired: true };
  }
  if (resource.organizationId !== principal.organizationId) {
    return { allowed: false, code: "CROSS_ORGANIZATION", auditRequired: true };
  }
  if (resourceForAction[actionInput] !== resource.type) {
    return { allowed: false, code: "RESOURCE_ACTION_MISMATCH", auditRequired: true };
  }
  if ((actionInput === "persistence_attempt.create" || actionInput === "persistence_attempt.investigate")
    && resource.ownerSubjectId !== principal.subjectId) {
    return { allowed: false, code: "RESOURCE_OWNER_MISMATCH", auditRequired: true };
  }
  if (principal.role === "management_reviewer"
    && (actionInput === "report.read" || actionInput === "dashboard.read")
    && resource.approvalStatus !== "approved") {
    return { allowed: false, code: "ROLE_DENIED", auditRequired: true };
  }

  if (permissions[principal.role].includes(actionInput)) {
    return { allowed: true, code: "ROLE_PERMISSION", auditRequired: true };
  }

  if (principal.role === "administrator"
    && (actionInput === "financial_record.read" || actionInput === "rejected_evidence.read")) {
    const approval = verifiedApproval(approvalInput);
    const expiry = approval ? Date.parse(approval.expiresAt) : Number.NaN;
    if (approval
      && approval.subjectId === principal.subjectId
      && approval.approvedBySubjectId !== principal.subjectId
      && approval.organizationId === principal.organizationId
      && approval.action === actionInput
      && approval.resourceType === resource.type
      && approval.resourceId === resource.id
      && expiry > Date.now()) {
      return { allowed: true, code: "APPROVED_ADMIN_EXCEPTION", auditRequired: true, approvalId: approval.approvalId };
    }
  }

  return { allowed: false, code: "ROLE_DENIED", auditRequired: true };
}
