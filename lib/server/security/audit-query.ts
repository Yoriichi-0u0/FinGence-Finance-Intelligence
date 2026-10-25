import "server-only";
import type { TransactionDatabase } from "../db/postgres";
import { PersistenceError } from "../persistence/contracts";

export interface StoredSecurityAuditEvent {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  organization_id: string | null;
  action: string;
  outcome: "success" | "denied" | "failure";
  target_type: string | null;
  target_id: string | null;
  request_id: string | null;
  approval_id: string | null;
  attempt_outcome: "CONFIRMED_COMMITTED" | "CONFIRMED_NOT_COMMITTED" | "UNRESOLVED" | null;
}

/** Internal operator read path. Application users must use a separately authorized API. */
export async function listRecentSecurityAuditEvents(database: TransactionDatabase, limit = 50): Promise<StoredSecurityAuditEvent[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new PersistenceError("INVALID_INPUT");
  return database.transaction(async connection => {
    const result = await connection.query<StoredSecurityAuditEvent>(
      `SELECT id::text, occurred_at::text, actor_id, organization_id, action, outcome,
              target_type, target_id, request_id, approval_id, attempt_outcome
       FROM public.security_audit_events
       ORDER BY occurred_at DESC, id DESC
       LIMIT $1`, [limit]);
    return result.rows;
  }, { isolationLevel: "READ COMMITTED" });
}