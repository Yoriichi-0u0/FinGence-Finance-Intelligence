import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { transactionDatabase } from "../../lib/server/db/postgres";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import type { SecurityRole, TrustedPrincipal } from "../../lib/server/security/authorization";
import type { TransactionResourceScope } from "../../lib/server/security/transaction-guard";
import { consultationResults } from "./fixtures";

/** Test-only identity and ownership tables. They are not an authentication implementation. */
export async function createLocalSecurityFixture() {
  const local = await PGlite.create();
  await local.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const file of ["phase1-clean-setup.sql", "c3b1-grouped-persistence-upgrade.sql", "db02-001-warning-mutation-fence.sql", "phase3-security-audit-upgrade.sql", "phase3-security-audit-api-events.sql"]) {
    await local.exec(readFileSync(new URL(`../../supabase/sql/${file}`, import.meta.url), "utf8"));
  }
  await local.exec(`CREATE SCHEMA test_security;
    CREATE TABLE test_security.membership(subject_id text, organization_id text, role text, active boolean, scope_version text, PRIMARY KEY(subject_id,organization_id));
    CREATE TABLE test_security.session(session_id text PRIMARY KEY, subject_id text, organization_id text, active boolean);
    CREATE TABLE test_security.ownership(batch_id uuid PRIMARY KEY REFERENCES public.ingestion_batches(id), organization_id text NOT NULL);
    INSERT INTO test_security.membership VALUES
      ('analyst-a','org-a','finance_analyst',true,'v1'), ('analyst-b','org-b','finance_analyst',true,'v1'),
      ('reviewer-a','org-a','management_reviewer',true,'v1'), ('admin-a','org-a','administrator',true,'v1'),
      ('revoked-a','org-a','finance_analyst',false,'v1');
    INSERT INTO test_security.session VALUES
      ('session-a','analyst-a','org-a',true), ('session-b','analyst-b','org-b',true),
      ('reviewer','reviewer-a','org-a',true), ('admin','admin-a','org-a',true),
      ('revoked','revoked-a','org-a',true), ('expired','analyst-a','org-a',false);`);
  const socket = new PGLiteSocketServer({ db: local, host: "127.0.0.1", port: 0, maxConnections: 1 });
  await socket.start();
  const endpoint = new URL(`postgres://postgres@${socket.getServerConn()}/postgres`);
  const pool = new Pool({ host: endpoint.hostname, port: Number(endpoint.port), user: "postgres", database: "postgres", max: 1,
    connectionTimeoutMillis: 1200, statement_timeout: 10000 });
  const database = transactionDatabase(pool);
  const writer = createGroupedPersistenceService(database);
  const results = await consultationResults();
  const receipt = await writer.persistGroupedAttempt({ attempt_id: randomUUID(), results });
  for (const child of receipt.datasets) await pool.query("INSERT INTO test_security.ownership VALUES ($1, 'org-a')", [child.batch_id]);

  async function resolvePrincipal(request: Request): Promise<TrustedPrincipal | null> {
    const token = request.headers.get("x-synthetic-session");
    if (!token) return null;
    const result = await pool.query(`SELECT m.subject_id,m.organization_id,m.role
      FROM test_security.session s JOIN test_security.membership m USING(subject_id,organization_id)
      WHERE s.session_id=$1 AND s.active AND m.active`, [token]);
    const row = result.rows[0];
    return row ? { subjectId: row.subject_id, organizationId: row.organization_id, role: row.role as SecurityRole } : null;
  }
  async function resolveAccess(principal: TrustedPrincipal) {
    const membership = await pool.query("SELECT scope_version FROM test_security.membership WHERE subject_id=$1 AND organization_id=$2 AND active", [principal.subjectId, principal.organizationId]);
    if (membership.rows.length !== 1) throw new Error("membership unavailable");
    const scope = await pool.query("SELECT batch_id::text FROM test_security.ownership WHERE organization_id=$1 ORDER BY batch_id", [principal.organizationId]);
    return { subjectId: principal.subjectId, organizationId: principal.organizationId, scopeVersion: membership.rows[0].scope_version,
      batchIds: scope.rows.map(row => row.batch_id as string) };
  }
  async function resolveTransactionScope(principal: TrustedPrincipal, id: string): Promise<TransactionResourceScope | null> {
    const result = await pool.query(`SELECT r.id::text,r.batch_id::text,o.organization_id FROM public.financial_records r
      JOIN test_security.ownership o ON o.batch_id=r.batch_id WHERE r.id=$1::uuid AND o.organization_id=$2`, [id, principal.organizationId]);
    const row = result.rows[0];
    return row ? { batchId: row.batch_id, resource: { type: "financial_record", id: row.id, organizationId: row.organization_id } } : null;
  }
  const request = (session?: string) => new Request("http://127.0.0.1/internal", { headers: session ? { "x-synthetic-session": session } : {} });
  return { local, pool, database, writer, results, receipt, resolvePrincipal, resolveAccess, resolveTransactionScope, request,
    close: async () => { await pool.end(); await socket.stop(); await local.close(); } };
}
