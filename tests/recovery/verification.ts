import { Pool } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const recoveryTables = ["persistence_attempts", "ingestion_batches", "financial_records", "validation_issues"] as const;
export async function snapshot(pool: Pool) {
  const data: Record<string, string[]> = {};
  for (const table of recoveryTables) {
    // Keep JSON as PostgreSQL text: parsing its NUMERIC tokens in JS would lose precision.
    data[table] = (await pool.query(`SELECT to_jsonb(r)::text row FROM public.${table} r ORDER BY id`)).rows.map(r => r.row);
  }
  const schema = {
    namespaces: (await pool.query("SELECT nspname,pg_get_userbyid(nspowner) owner,coalesce(nspacl,acldefault('n',nspowner))::text effective_acl FROM pg_namespace WHERE nspname='public' ORDER BY nspname")).rows,
    // pg_dump can restore an explicit default owner ACL as NULL. PostgreSQL's
    // acldefault resolves that representation; no grant/ownership is discarded.
    tables: (await pool.query(`SELECT c.relname,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity,
      coalesce(c.relacl,acldefault('r',c.relowner))::text effective_acl
      FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' ORDER BY c.relname`)).rows,
    columns: (await pool.query(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid) default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`)).rows,
    constraints: (await pool.query(`SELECT conrelid::regclass::text relation,conname,pg_get_constraintdef(oid) definition,
      convalidated,condeferrable,condeferred FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY relation,conname`)).rows,
    indexes: (await pool.query(`SELECT c.relname,pg_get_indexdef(i.indexrelid) definition,i.indisvalid,i.indisready
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace ORDER BY c.relname`)).rows,
    functions: (await pool.query(`SELECT proname,pg_get_functiondef(oid) definition,pg_get_userbyid(proowner) owner,proacl::text acl
      FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY proname`)).rows,
    triggers: (await pool.query(`SELECT tgrelid::regclass::text relation,tgname,pg_get_triggerdef(oid) definition,tgenabled
      FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) ORDER BY relation,tgname`)).rows,
    policies: (await pool.query("SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows,
    extensions: (await pool.query("SELECT extname,extversion,extnamespace::regnamespace::text schema,pg_get_userbyid(extowner) owner FROM pg_extension ORDER BY extname")).rows,
    roles: (await pool.query("SELECT rolname,rolsuper,rolcanlogin,rolreplication FROM pg_roles WHERE rolname IN ('db03_owner','anon','authenticated') ORDER BY rolname")).rows,
  };
  const audit = (await pool.query(readFileSync(new URL("../../docs/database/db02/integrity-audit.sql", import.meta.url), "utf8"))).rows;
  const orphans = (await pool.query(`SELECT
    (SELECT count(*)::int FROM public.financial_records r LEFT JOIN public.ingestion_batches b ON b.id=r.batch_id AND b.ingestion_batch_id=r.ingestion_batch_id WHERE b.id IS NULL) records,
    (SELECT count(*)::int FROM public.validation_issues i LEFT JOIN public.financial_records r ON r.id=i.financial_record_id WHERE r.id IS NULL) issues,
    (SELECT count(*)::int FROM public.ingestion_batches b LEFT JOIN public.persistence_attempts a ON a.id=b.persistence_attempt_id WHERE b.persistence_attempt_id IS NOT NULL AND a.id IS NULL) batches`)).rows[0];
  const aclStorage = (await pool.query("SELECT relname,relacl::text acl FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname")).rows;
  return { data, schema, audit, orphans, aclStorage };
}
export function snapshotEvidence(value: Awaited<ReturnType<typeof snapshot>>) {
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  return { tables: Object.fromEntries(recoveryTables.map(t => [t, { count: value.data[t].length, sha256: hash(value.data[t]) }])),
    schemaSHA256: hash(value.schema), audit: value.audit, orphans: value.orphans, aclStorage: value.aclStorage };
}
