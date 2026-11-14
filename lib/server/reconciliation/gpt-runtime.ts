import 'server-only';
import type {PoolConfig} from 'pg';
import type {TransactionDatabase} from '../db/postgres';
export const GROUP_GPT_CONTRACT=Object.freeze({
 projectRef:'zmtdozblpvtjniehwjrw', branch:'main', schema:'fingence_reconciliation',
 runs:'gpt_runs', items:'gpt_items', runtime:'fingence_db04_group_runtime',
 issuer:'urn:fingence:db04:group-synthetic:1', admission:'group-synthetic-admission/1',
});
/** Validate trusted server configuration only. Does not connect or enable operations.
 * No generic environment lookup, pooler guessing, role switching or privileged fallback. */
export function assertGroupGPTConnection(config:PoolConfig){
 if(config.host!==`db.${GROUP_GPT_CONTRACT.projectRef}.supabase.co`||config.port!==5432||config.database!=='postgres'
  ||!config.user||['postgres','supabase_admin','service_role',GROUP_GPT_CONTRACT.runtime].includes(config.user)
  ||typeof config.ssl!=='object'||config.ssl===null||config.ssl.rejectUnauthorized!==true)
  throw Error('GROUP_GPT_RESTRICTED_CONNECTION_REQUIRED');
}
/** Same-connection catalog gate before every scoped transaction. The capability is
 * resolved by principal() inside that transaction; no caller-supplied tenant/actor.
 * Group synthetic admission is NOT Jason's Supabase JWT admission. */
export function groupGPTRuntimeDatabase(db:TransactionDatabase):TransactionDatabase{
 return {
  close:()=>db.close(),
  transaction:(work,options)=>db.transaction(async tx=>{
   const result=await tx.query<{compatible:boolean}>(`WITH RECURSIVE identities AS (
    SELECT oid,rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication FROM pg_roles WHERE rolname IN (current_user,session_user)
   ), ancestors(oid) AS (
    SELECT oid FROM identities UNION SELECT m.roleid FROM pg_auth_members m JOIN ancestors a ON a.oid=m.member
   ) SELECT
    current_user=session_user AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin)
    AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname='fingence_db04_group_runtime' AND NOT r.rolcanlogin
      AND pg_has_role(current_user,r.oid,'USAGE'))
    AND NOT EXISTS(SELECT 1 FROM pg_roles r JOIN ancestors a ON a.oid=r.oid
      WHERE r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
      OR r.rolname IN ('postgres','supabase_admin','service_role','fingence_db04_group_broker'))
    AND (SELECT count(*)=2 AND bool_and(c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity
      AND pg_get_userbyid(c.relowner)<>current_user
      AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
      AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE,REFERENCES'))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='fingence_reconciliation' AND c.relname IN ('gpt_runs','gpt_items'))
    AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='fingence_reconciliation' AND p.proname='principal' AND p.pronargs=0
      AND p.prosecdef AND 'search_path=pg_catalog'=ANY(p.proconfig)
      AND pg_get_functiondef(p.oid) LIKE '%fingence_db04_group_synthetic.memberships%'
      AND pg_get_functiondef(p.oid) LIKE '%group-synthetic-admission/1%'
      AND pg_get_functiondef(p.oid) LIKE '%urn:fingence:db04:group-synthetic:1%') AS compatible`);
   if(result.rows.length!==1||result.rows[0].compatible!==true)throw Error('GROUP_GPT_RUNTIME_CONTRACT_DENIED');
   return work(tx);
  },options),
 };
}
