import "server-only";
import type { TransactionDatabase } from "../../db/postgres";
import { createV2Persistence } from "./persistence";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validOperationId(id: string | null): id is string { return id !== null && uuid.test(id); }
export function operations(database: TransactionDatabase) {
  return {
    async claim(id: string, tenant: string): Promise<boolean> {
      return database.transaction(async tx => (await tx.query(
        "INSERT INTO fingence_v2_local.operations(id,tenant_id,state) VALUES ($1,$2,'PROCESSING') ON CONFLICT DO NOTHING RETURNING id", [id, tenant])).rowCount === 1);
    },
    async fail(id: string, tenant: string, code: string, uncertain: boolean): Promise<void> {
      await database.transaction(async tx => { await tx.query("UPDATE fingence_v2_local.operations SET state=$3,failure_code=$4 WHERE id=$1 AND tenant_id=$2 AND state='PROCESSING'", [id, tenant, uncertain ? "UNCERTAIN" : "FAILED", code]); });
    },
    async lookup(id: string, tenant: string) {
      const row = await database.transaction(async tx => (await tx.query<{ state: string; failure_code: string | null }>(
        "SELECT state,failure_code FROM fingence_v2_local.operations WHERE id=$1 AND tenant_id=$2", [id, tenant])).rows[0]);
      if (!row) return { outcome: "UNRESOLVED" as const };
      const batch = await createV2Persistence(database).get(id, tenant);
      if (batch) return { outcome: "CONFIRMED_COMMITTED" as const, batch };
      if (row.state === "FAILED") return { outcome: "KNOWN_FAILURE" as const, code: row.failure_code };
      if (row.state === "CANCELLED") return { outcome: "CONFIRMED_NOT_COMMITTED" as const };
      if (row.state === "UNCERTAIN") {
        const outcome = await createV2Persistence(database).investigate(id, tenant);
        if (outcome === "CONFIRMED_NOT_COMMITTED") return { outcome, code: row.failure_code };
        if (outcome === "CONFIRMED_COMMITTED") {
          const saved = await createV2Persistence(database).get(id, tenant);
          if (saved) return { outcome, batch: saved };
        }
      }
      return { outcome: "UNRESOLVED" as const, ...(row.failure_code ? { code: row.failure_code } : {}) };
    },
    // A tombstone is inserted only if no execution has claimed this identity. A late POST can never claim it.
    async cancelUnclaimed(id: string, tenant: string) {
      await database.transaction(async tx => { await tx.query("INSERT INTO fingence_v2_local.operations(id,tenant_id,state) VALUES ($1,$2,'CANCELLED') ON CONFLICT DO NOTHING", [id, tenant]); });
      return this.lookup(id, tenant);
    },
  };
}
