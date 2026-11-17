import "server-only";
import { createHash } from "node:crypto";
import { createPostgresDatabase, type SqlConnection, type TransactionDatabase } from "../db/postgres";
import { m2LocalEnabled, m2Runtime } from "../ai-ingestion/m2/runtime";
import { localSessionCookieName } from "../ai-ingestion/m2/session-cookie";
import { localAccessAllowed } from "../ai-ingestion/service";
import { createScopedReadService } from "./scoped-queries";
import { TransactionSecurityError } from "../security/transaction-guard";
import { adaptTrustedPrincipal } from "../security/transaction-access";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const localState = globalThis as typeof globalThis & { fingenceLocalTransactionReads?: ReturnType<typeof createRuntime> };
const tokenFrom = (request: Request) => {
  const name = localSessionCookieName();
  return request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
};
function assertLoopbackDatabase() {
  const value = process.env.SUPABASE_DATABASE_URL;
  if (!value) throw new Error("LOCAL_DATABASE_UNAVAILABLE");
  const url = new URL(value);
  if (!(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("LOCAL_DATABASE_UNAVAILABLE");
}
async function verifiedSession(request: Request) {
  const token = tokenFrom(request);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  try { return await (await m2Runtime()).identity.session(token); }
  catch { return null; }
}
function createRuntime() {
  assertLoopbackDatabase();
  const database = createPostgresDatabase();
  const readConnection: SqlConnection = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]) {
      return database.transaction(connection => connection.query<Row>(sql, values));
    },
  };
  const reads = createScopedReadService({
    readConnection,
    auditDatabase: database,
    cursorSecret: process.env.SECURITY_CURSOR_SECRET ?? "",
    async resolvePrincipal(request) {
      const session = await verifiedSession(request);
      if (!session) return null;
      const role = session.role === "Finance" ? "Analyst" : session.role === "Admin" ? "Admin"
        : session.role === "Technical (Management)" ? "Reviewer" : null;
      if (!role) return null;
      return adaptTrustedPrincipal({ subjectId: session.userId, organizationId: session.organizationId, role });
    },
    async resolveAccess(principal, request) {
      const session = await verifiedSession(request);
      if (!session || session.userId !== principal.subjectId || session.organizationId !== principal.organizationId) throw new Error("ACCESS_SCOPE_UNAVAILABLE");
      const result = await database.transaction(connection => connection.query<{ batch_id: string }>(
        `SELECT o.batch_id::text AS batch_id
         FROM public.transaction_batch_ownership o
         JOIN public.ingestion_batches b ON b.id=o.batch_id
         WHERE o.organization_id=$1::uuid
         ORDER BY o.batch_id`, [principal.organizationId]));
      const batchIds = result.rows.map(row => row.batch_id.toLowerCase());
      const scopeVersion = createHash("sha256").update(JSON.stringify({ membershipVersion: session.membershipVersion,
        organizationId: principal.organizationId, batchIds })).digest("hex");
      return { subjectId: principal.subjectId, organizationId: principal.organizationId, scopeVersion, batchIds };
    },
    async resolveTransactionScope(principal, transactionId) {
      const result = await database.transaction(connection => connection.query<{ organization_id: string; batch_id: string }>(
        `SELECT o.organization_id::text, r.batch_id::text
         FROM public.financial_records r
         JOIN public.transaction_batch_ownership o ON o.batch_id=r.batch_id
         WHERE r.id=$1::uuid AND r.ingestion_status IN ('VALID','WARNING')
         LIMIT 1`, [transactionId]));
      const row = result.rows[0];
      if (!row) return null;
      return { resource: { id: transactionId, type: "financial_record" as const, organizationId: row.organization_id }, batchId: row.batch_id };
    },
  });
  return { database, reads };
}

export function localTransactionReads(request: Request) {
  if (!m2LocalEnabled() || !localAccessAllowed(request)) throw new TransactionSecurityError(404, "NOT_FOUND");
  return localState.fingenceLocalTransactionReads ??= createRuntime();
}
/** Ownership for a C1 persistence call; resolve only from the current verified Finance session. */
export async function resolveLocalC1BatchOwner(request: Request) {
  if (!m2LocalEnabled() || !localAccessAllowed(request)) return null;
  const session = await verifiedSession(request);
  if (!session || session.role !== "Finance") return null;
  return adaptTrustedPrincipal({ subjectId: session.userId, organizationId: session.organizationId, role: "Analyst" });
}
export function transactionApiResponse(error: unknown): Response {
  if (error instanceof TransactionSecurityError) return Response.json({ error: "Unavailable or access denied." }, { status: error.status, headers });
  return Response.json({ error: "Transaction request could not be completed." }, { status: 503, headers });
}
export { headers as transactionApiHeaders };
