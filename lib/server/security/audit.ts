import "server-only";

export const SECURITY_AUDIT_ACTIONS = [
  "auth.sign_in",
  "auth.sign_in_failed",
  "ingestion.upload_attempt",
  "ingestion.validation_completed",
  "ingestion.persisted",
  "ingestion.rejected",
  "persistence_attempt.created",
  "persistence_attempt.investigated",
  "financial_record.read",
  "financial_record.changed",
  "financial_record.reconciled",
  "rejected_evidence.read",
  "report.generated",
  "report.read",
  "report.downloaded",
  "dashboard.read",
  "security_logs.read",
  "authorization.role_changed",
  "authorization.denied",
  "admin.exceptional_access",
  "admin.configuration_changed",
  "request.rate_limited",
] as const;
export type SecurityAuditAction = typeof SECURITY_AUDIT_ACTIONS[number];

export const SECURITY_AUDIT_TARGET_TYPES = [
  "ingestion_batch",
  "persistence_attempt",
  "financial_record",
  "rejected_evidence",
  "report",
  "organization_user",
  "organization_settings",
  "security_log",
  "auth_session",
] as const;
export type SecurityAuditTargetType = typeof SECURITY_AUDIT_TARGET_TYPES[number];

export interface SecurityAuditEvent {
  readonly occurredAt: string;
  readonly actorId: string | null;
  readonly organizationId: string | null;
  readonly action: SecurityAuditAction;
  readonly outcome: "success" | "denied" | "failure";
  readonly targetType: SecurityAuditTargetType | null;
  readonly targetId: string | null;
  readonly requestId: string | null;
  /** References the separately stored, access-controlled justification/approval. */
  readonly approvalId: string | null;
  /** Present only on an attempt-investigation event; contains no dataset contents. */
  readonly attemptOutcome?: "CONFIRMED_COMMITTED" | "CONFIRMED_NOT_COMMITTED" | "UNRESOLVED";
}

export class InvalidSecurityAuditEvent extends Error {
  readonly code = "INVALID_SECURITY_AUDIT_EVENT";
  constructor() {
    super("Invalid security audit event");
    this.name = "InvalidSecurityAuditEvent";
  }
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const optionalId = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && idPattern.test(value));
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

/**
 * Construct a small allowlisted audit record. Unknown keys (including financial
 * payloads, tokens, filenames, free-text messages, and SQL errors) are rejected.
 * The caller must send the returned event to a protected audit sink.
 */
export function createSecurityAuditEvent(inputValue: unknown): SecurityAuditEvent {
  const input = plainDataObject(inputValue);
  const allowedKeys = ["actorId", "organizationId", "action", "outcome", "targetType", "targetId", "requestId", "approvalId", "attemptOutcome"];
  if (!input || Object.keys(input).some(key => !allowedKeys.includes(key))) throw new InvalidSecurityAuditEvent();

  const actorId = input.actorId;
  const organizationId = input.organizationId;
  const action = input.action;
  const outcome = input.outcome;
  const targetType = input.targetType;
  const targetId = input.targetId;
  const requestId = input.requestId;
  const approvalId = input.approvalId;
  const attemptOutcome = input.attemptOutcome;
  if (!optionalId(actorId) || !optionalId(organizationId)
    || !has(SECURITY_AUDIT_ACTIONS, action)
    || !["success", "denied", "failure"].includes(outcome as string)
    || !(targetType === null || has(SECURITY_AUDIT_TARGET_TYPES, targetType))
    || !optionalId(targetId) || !optionalId(requestId) || !optionalId(approvalId)
    || ((targetType === null) !== (targetId === null))
    || (attemptOutcome !== undefined && !["CONFIRMED_COMMITTED", "CONFIRMED_NOT_COMMITTED", "UNRESOLVED"].includes(attemptOutcome as string))
    || (action === "persistence_attempt.investigated" && (targetType !== "persistence_attempt" || attemptOutcome === undefined))
    || (action === "persistence_attempt.created" && targetType !== "persistence_attempt")
    || (action !== "persistence_attempt.investigated" && attemptOutcome !== undefined)) {
    throw new InvalidSecurityAuditEvent();
  }

  return Object.freeze({
    occurredAt: new Date().toISOString(),
    actorId,
    organizationId,
    action,
    outcome: outcome as SecurityAuditEvent["outcome"],
    targetType,
    targetId,
    requestId,
    approvalId,
    ...(attemptOutcome === undefined ? {} : { attemptOutcome: attemptOutcome as SecurityAuditEvent["attemptOutcome"] }),
  });
}
