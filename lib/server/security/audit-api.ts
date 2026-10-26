import "server-only";
import type { TransactionDatabase } from "../db/postgres";
import { persistSecurityAuditEvent } from "./audit-store";
/** Commit an API audit event before the caller sends its response. */
export async function recordApiSecurityEvent(database: TransactionDatabase, input: unknown): Promise<void> {
  await database.transaction(connection => persistSecurityAuditEvent(connection, input), { isolationLevel: "READ COMMITTED" });
}
/** Hold read results until the success event commits; log query failures before rethrowing. */
export async function runAuditedRead<T>(options: {
  readonly database: TransactionDatabase;
  readonly event: Readonly<Record<string, unknown>>;
  readonly read: () => Promise<T>;
}): Promise<T> {
  let result: T;
  try { result = await options.read(); }
  catch (error) {
    await recordApiSecurityEvent(options.database, { ...options.event, outcome: "failure" });
    throw error;
  }
  await recordApiSecurityEvent(options.database, { ...options.event, outcome: "success" });
  return result;
}

/** Compatibility name for API routes that audit a read before returning its response. */
export const auditRead = recordApiSecurityEvent;

