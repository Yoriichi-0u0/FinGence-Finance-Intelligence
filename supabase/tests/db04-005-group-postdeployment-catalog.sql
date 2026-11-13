-- PREPARED POST-DEPLOYMENT CATALOG CHECKS. NOT EXECUTED.
-- Target: FinGence-Production / zmtdozblpvtjniehwjrw / main.
-- Run only after separate migration execution approval and an acknowledged COMMIT.
-- No application-row reads or user routine invocation.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';

-- Expected totals against observed pre-005 baseline: 13 tables, 31 FKs, 20 indexes,
-- 16 noninternal triggers, 19 policies. Recheck drift rather than accepting counts alone.
SELECT
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_reconciliation' AND c.relkind='r') AS tables_expected_13,
 (SELECT count(*) FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='fingence_reconciliation' AND k.contype='f') AS foreign_keys_expected_31,
 (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_reconciliation') AS indexes_expected_20,
 (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_reconciliation' AND NOT t.tgisinternal) AS user_triggers_expected_16,
 (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_reconciliation') AS policies_expected_19;

WITH expected(name) AS (VALUES('gpt_runs'),('gpt_items'))
SELECT e.name,c.oid IS NOT NULL AS present,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text
FROM expected e LEFT JOIN pg_namespace n ON n.nspname='fingence_reconciliation'
LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.name ORDER BY e.name;
SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_expression
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE n.nspname='fingence_reconciliation' AND c.relname IN ('gpt_runs','gpt_items') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum;

-- Exactly 8 new FKs; run actor FK must target group-synthetic memberships.
-- All outcomes/checks must remain UNRESOLVED and assignment-policy-not-approved.
SELECT c.relname,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid,true) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='fingence_reconciliation' AND c.relname IN ('gpt_runs','gpt_items') ORDER BY c.relname,k.contype,k.conname;
SELECT c.relname,ic.relname AS index_name,i.indisprimary,i.indisunique,i.indisvalid,i.indisready,i.indimmediate,pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid
WHERE n.nspname='fingence_reconciliation' AND c.relname IN ('gpt_runs','gpt_items') ORDER BY c.relname,ic.relname;
SELECT c.relname,t.tgname,t.tgisinternal,t.tgenabled,t.tgdeferrable,t.tginitdeferred,pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='fingence_reconciliation' AND c.relname IN ('gpt_runs','gpt_items') ORDER BY c.relname,t.tgisinternal,t.tgname;
SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='fingence_reconciliation' AND c.relname IN ('gpt_runs','gpt_items') ORDER BY c.relname,p.polname;
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,pg_get_function_result(p.oid) AS result,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner,p.proacl::text,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='fingence_reconciliation' AND p.proname IN ('gpt_complete','gpt_audit') ORDER BY p.proname;

-- Runtime: SELECT/INSERT only. All other named roles: no table/column rights.
SELECT r.rolname,c.relname,
 has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
 has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
 has_table_privilege(r.oid,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excess_rights,
 has_any_column_privilege(r.oid,c.oid,'SELECT') AS any_column_select,
 has_any_column_privilege(r.oid,c.oid,'INSERT') AS any_column_insert,
 has_any_column_privilege(r.oid,c.oid,'UPDATE,REFERENCES') AS any_column_excess
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='fingence_reconciliation' AND c.relname IN ('gpt_runs','gpt_items')
 AND r.rolname IN ('fingence_db04_group_runtime','db04_group_test_runtime','fingence_db04_group_broker','db04_group_test_broker','anon','authenticated','service_role')
ORDER BY r.rolname,c.relname;
SELECT c.relname,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
WHERE n.nspname='fingence_reconciliation' AND c.relname IN ('gpt_runs','gpt_items') ORDER BY c.relname,grantee,a.privilege_type;
SELECT p.proname,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f'::"char",p.proowner))) a
WHERE n.nspname='fingence_reconciliation' AND p.proname IN ('gpt_complete','gpt_audit') ORDER BY p.proname,grantee;

-- Reinspect existing audit and helper contracts WITHOUT invoking them.
SELECT c.relname,a.attname,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_expression
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE n.nspname='fingence_reconciliation' AND c.relname='audit' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum;
SELECT p.proname,p.prosecdef,p.proconfig,p.proacl::text,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='fingence_reconciliation' AND p.proname IN ('principal','authorized_organization','current_grant_id','immutable') ORDER BY p.proname;
ROLLBACK;
