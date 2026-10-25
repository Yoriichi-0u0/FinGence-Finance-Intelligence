import "server-only";
import type { PoolConfig } from "pg";
import { listRecentSecurityAuditEvents, type StoredSecurityAuditEvent } from "../security/audit-query";
import type { TransactionDatabase } from "../db/postgres";

export function parseAuditLimit(args: readonly string[]): number {
  if (args.length === 0) return 50;
  if (args.length !== 1 || !/^--limit=\d+$/.test(args[0])) throw new Error("INVALID_ARGUMENTS");
  const limit = Number(args[0].slice("--limit=".length));
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("INVALID_ARGUMENTS");
  return limit;
}

/** Read-only operational access is restricted to a local database target. */
export function assertLocalAuditTarget(config: PoolConfig): void {
  if (["localhost", "127.0.0.1", "::1"].includes(config.host ?? "")) return;
  const error = new Error("The audit reader is local-only. Hosted audit access requires a reviewed authenticated API.");
  Object.assign(error, { code: "LOCAL_DATABASE_REQUIRED" });
  throw error;
}

export async function readSecurityAuditLog(
  database: TransactionDatabase,
  limit: number,
  print: (line: string) => void,
): Promise<readonly StoredSecurityAuditEvent[]> {
  const events = await listRecentSecurityAuditEvents(database, limit);
  print(JSON.stringify(events, null, 2));
  return events;
}