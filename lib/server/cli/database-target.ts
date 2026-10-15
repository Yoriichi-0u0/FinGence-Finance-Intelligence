import "server-only";
import type { PoolConfig } from "pg";

/** Explicit, project-bound consent for this internal CLI; never permits arbitrary remote targets. */
export function assertPhase2DatabaseTarget(config: PoolConfig, environment: Readonly<Record<string, string | undefined>>) {
  if (["localhost", "127.0.0.1", "::1"].includes(config.host ?? "")) return;
  const reference = environment.FINSIGHT_PHASE2_FYP_A_PROJECT_REF;
  if (environment.FINSIGHT_PHASE2_ALLOW_HOSTED_FYP_A === "YES"
    && reference && /^[a-z0-9]{20}$/.test(reference)
    && config.host === `db.${reference}.supabase.co`
    && config.port === 5432 && config.database === "postgres" && config.user === "postgres"
    && typeof config.ssl === "object" && config.ssl !== null && config.ssl.rejectUnauthorized === true) return;
  const error = new Error("Hosted execution requires explicit FYP A authorization and a matching verified-TLS Direct target.");
  Object.assign(error, { code: "LOCAL_DATABASE_REQUIRED" });
  throw error;
}
