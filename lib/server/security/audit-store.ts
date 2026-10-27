import "server-only";
import type { SqlConnection } from "../db/postgres";
import { createSecurityAuditEvent } from "./audit";

/** Persist one validated, content-free event on the caller's transaction. */
export async function persistSecurityAuditEvent(connection: SqlConnection, input: unknown): Promise<void> {
  const event = createSecurityAuditEvent(input);
  const result = await connection.query(
    `INSERT INTO public.security_audit_events
      (occurred_at, actor_id, organization_id, action, outcome, target_type, target_id, request_id, approval_id, attempt_outcome)
     VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [event.occurredAt, event.actorId, event.organizationId, event.action, event.outcome,
      event.targetType, event.targetId, event.requestId, event.approvalId, event.attemptOutcome ?? null],
  );
  if (result.rowCount !== 1) throw new Error("Security audit event was not stored");
}