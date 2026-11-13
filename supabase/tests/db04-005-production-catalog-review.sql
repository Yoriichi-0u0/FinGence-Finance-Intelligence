-- REVIEW ONLY / NOT EXECUTED. Requires separate approval for catalog access.
-- Declared target: Group Supabase FinGence-Production / main / fingence_reconciliation.
-- The project display name and branch CANNOT be proven by current_database().
-- Operator must independently attest target/project/branch before opening a session.
-- Catalog metadata only: no financial/Auth/session rows, no user routine invocation,
-- no role switching, DDL, DML, EXPLAIN ANALYZE, temp objects, or exports.
-- Run the entire file in one session only after read-only access approval.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- 01. Version/session context; not evidence of the Supabase project/branch identity.
SELECT current_database() AS database_name, current_user AS inspecting_role,
 session_user AS session_role, version() AS server_version,
 current_setting('server_version_num') AS server_version_num,
 current_setting('transaction_read_only') AS transaction_read_only,
 current_setting('transaction_isolation') AS isolation,
 current_setting('search_path') AS search_path;

-- Feature/signature metadata only; existence is not semantic/runtime certification.
WITH expected(signature) AS (VALUES ('pg_catalog.aclexplode(aclitem[])'),
 ('pg_catalog.jsonb_path_exists(jsonb,jsonpath,jsonb,boolean)'),
 ('pg_catalog.jsonb_array_length(jsonb)'))
SELECT signature,to_regprocedure(signature) AS resolved_builtin FROM expected ORDER BY signature;

-- 02. Expected 11 baseline tables. Report missing/wrong relkind; never repair them.
WITH expected(name) AS (VALUES ('documents'),('jobs'),('job_sources'),('transactions'),
 ('proposals'),('decisions'),('cases'),('reviews'),('audit'),('rankings'),('proposal_verifications'))
SELECT e.name AS expected_table, c.oid IS NOT NULL AS present, c.relkind,
 pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity,
 c.relacl::text AS explicit_acl
FROM expected e LEFT JOIN pg_namespace n ON n.nspname='fingence_reconciliation'
LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.name
ORDER BY e.name;
SELECT c.relkind, count(*) AS catalog_object_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='fingence_reconciliation' GROUP BY c.relkind ORDER BY c.relkind;

-- 03. All target schema relations (also reveals unexpected extra tables/name collisions).
SELECT n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner,
 c.relrowsecurity, c.relforcerowsecurity, c.relacl::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='fingence_reconciliation' ORDER BY c.relkind,c.relname;

-- 04. Membership/auth dependency existence; no SELECT from these relations.
WITH expected(name) AS (VALUES ('fingence_m2.organizations'),('fingence_m2.users'),
 ('fingence_m2.memberships'),('fingence_m2.sessions'),('fingence_m3.organization_states'),
 ('fingence_m5.account_suspensions'))
SELECT name, to_regclass(name) AS relation FROM expected ORDER BY name;

-- 05. Exact column types/nullability/defaults, including extra audit NOT NULL fields.
-- auth schema is inventoried structurally only. No users, claims, hashes or tokens are read.
SELECT n.nspname, c.relname, a.attnum, a.attname,
 format_type(a.atttypid,a.atttypmod) AS data_type, a.attnotnull,
 a.attidentity, a.attgenerated, a.attcollation,
 pg_get_expr(d.adbin,d.adrelid) AS default_expression
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attnum>0 AND NOT a.attisdropped AND
 (n.nspname='fingence_reconciliation'
 OR (n.nspname='fingence_m2' AND c.relname IN ('organizations','users','memberships','sessions'))
 OR (n.nspname='fingence_m3' AND c.relname='organization_states')
 OR (n.nspname='fingence_m5' AND c.relname='account_suspensions')
 OR (n.nspname='auth' AND c.relname IN ('users','sessions')))
ORDER BY n.nspname,c.relname,a.attnum;

-- 06. Exact constraints and inbound/outbound FK edges. Validation/deferral matter.
SELECT n.nspname AS schema_name,c.relname AS table_name,k.conname,k.contype,
 k.convalidated,k.condeferrable,k.condeferred,
 rn.nspname AS referenced_schema,rc.relname AS referenced_table,
 pg_get_constraintdef(k.oid,true) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_class rc ON rc.oid=k.confrelid
LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
WHERE n.nspname='fingence_reconciliation' OR rn.nspname='fingence_reconciliation'
 OR (n.nspname='fingence_m2' AND c.relname IN ('organizations','users','memberships','sessions'))
ORDER BY n.nspname,c.relname,k.conname;

-- 07. Valid/immediate referenced keys. Includes indexes not represented as PK/UNIQUE constraints.
SELECT n.nspname,c.relname,ic.relname AS index_name,i.indisprimary,i.indisunique,
 i.indisvalid,i.indisready,i.indimmediate,pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid
WHERE n.nspname='fingence_reconciliation' OR (n.nspname='fingence_m2' AND c.relname='memberships')
ORDER BY n.nspname,c.relname,ic.relname;

-- 08. All RLS policy expressions/roles; restrictive vs permissive and command scope.
SELECT n.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,
 ARRAY(SELECT CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END
  FROM unnest(p.polroles) x) AS policy_roles,
 pg_get_expr(p.polqual,p.polrelid) AS using_expression,
 pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('fingence_reconciliation','fingence_m2','fingence_m3','fingence_m5','auth')
ORDER BY n.nspname,c.relname,p.polname;

-- 09. User AND internal triggers; audit INSERT triggers and FK-internal effects must be reviewed.
SELECT n.nspname,c.relname,t.tgname,t.tgenabled,t.tgisinternal,
 t.tgdeferrable,t.tginitdeferred,t.tgconstraint,
 fn.nspname AS function_schema,p.proname AS function_name,
 pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace fn ON fn.oid=p.pronamespace
WHERE n.nspname='fingence_reconciliation'
 OR (n.nspname='fingence_m2' AND c.relname='memberships')
 OR (n.nspname='public' AND c.relname IN ('ingestion_batches','financial_records','validation_issues','persistence_attempts'))
ORDER BY n.nspname,c.relname,t.tgisinternal,t.tgname;

-- 10. Required signatures plus any existing same-name overloads (no function is executed).
WITH expected(signature) AS (VALUES ('fingence_reconciliation.principal()'),
 ('fingence_reconciliation.authorized_organization()'),('fingence_reconciliation.immutable()'),
 ('fingence_reconciliation.current_grant_id()'))
SELECT signature,to_regprocedure(signature) AS resolved_function FROM expected ORDER BY signature;
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 pg_get_function_result(p.oid) AS result,pg_get_userbyid(p.proowner) AS owner,
 l.lanname,p.prosecdef,p.provolatile,p.proleakproof,p.proconfig,p.proacl::text,
 pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='fingence_reconciliation' AND p.prokind='f'
 AND p.proname IN ('principal','authorized_organization','immutable','current_grant_id','gpt_complete','gpt_audit')
ORDER BY p.proname,arguments;

-- 11. Dependency metadata is partial for PL/pgSQL/dynamic SQL: Jason must review bodies/source too.
SELECT p.oid::regprocedure::text AS routine,d.deptype,
 pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) AS referenced_object
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid
WHERE n.nspname='fingence_reconciliation'
 AND p.proname IN ('principal','authorized_organization','immutable','current_grant_id')
ORDER BY routine,referenced_object;

-- 12. Role capability metadata ONLY. Deliberately omit passwords, rolconfig and credentials.
SELECT oid,rolname,rolsuper,rolbypassrls,rolcanlogin,rolinherit,rolcreaterole,rolcreatedb,rolreplication
FROM pg_roles ORDER BY rolname;
SELECT parent.rolname AS granted_role,child.rolname AS member_role,
 m.admin_option,to_jsonb(m)->>'inherit_option' AS inherit_option_if_supported,
 to_jsonb(m)->>'set_option' AS set_option_if_supported
FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
JOIN pg_roles child ON child.oid=m.member ORDER BY parent.rolname,child.rolname;

-- 13. Transitive runtime memberships/capability paths; missing runtime yields no rows.
WITH RECURSIVE paths AS (
 SELECT r.oid AS root,r.oid AS role_oid,ARRAY[r.oid] AS visited,0 AS depth
 FROM pg_roles r WHERE r.rolname='fingence_reconciliation_runtime'
 UNION ALL
 SELECT p.root,m.roleid,p.visited||m.roleid,p.depth+1
 FROM paths p JOIN pg_auth_members m ON m.member=p.role_oid
 WHERE NOT m.roleid=ANY(p.visited)
)
SELECT r.rolname AS runtime_ancestor,p.depth,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb
FROM paths p JOIN pg_roles r ON r.oid=p.role_oid ORDER BY p.depth,r.rolname;

-- 14. Schema ACLs and current inspector capabilities. Inspection identity is not automatically a deploy identity.
SELECT n.nspname,pg_get_userbyid(n.nspowner) AS owner,n.nspacl::text,
 has_schema_privilege(current_user,n.oid,'USAGE') AS inspector_usage,
 has_schema_privilege(current_user,n.oid,'CREATE') AS inspector_create
FROM pg_namespace n WHERE n.nspname IN ('fingence_reconciliation','fingence_m2','fingence_m3','fingence_m5','auth')
ORDER BY n.nspname;

-- 15. Table/column/function ACLs, including PUBLIC and grant options; metadata only.
SELECT n.nspname,c.relname,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
 pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
WHERE n.nspname='fingence_reconciliation' ORDER BY c.relname,grantee,a.privilege_type;
SELECT n.nspname,c.relname,x.attname,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
 a.privilege_type,a.is_grantable
FROM pg_attribute x JOIN pg_class c ON c.oid=x.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(x.attacl) a
WHERE n.nspname='fingence_reconciliation' AND x.attnum>0 AND NOT x.attisdropped
ORDER BY c.relname,x.attnum,grantee,a.privilege_type;
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
 a.privilege_type,a.is_grantable
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f'::"char",p.proowner))) a
WHERE n.nspname='fingence_reconciliation' ORDER BY p.proname,arguments,grantee;

-- 16. Effective table rights for runtime, its members, owners and known managed roles.
WITH candidates AS (
 SELECT r.oid,r.rolname FROM pg_roles r
 WHERE r.rolname IN ('fingence_reconciliation_runtime','anon','authenticated','service_role',current_user)
 OR EXISTS(SELECT 1 FROM pg_roles runtime WHERE runtime.rolname='fingence_reconciliation_runtime' AND pg_has_role(r.oid,runtime.oid,'MEMBER'))
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_reconciliation' AND c.relowner=r.oid)
)
SELECT r.rolname,n.nspname,c.relname,
 has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
 has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
 has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
 has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,
 has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate,
 has_table_privilege(r.oid,c.oid,'REFERENCES') AS can_reference,
 has_any_column_privilege(r.oid,c.oid,'SELECT') AS any_column_select,
 has_any_column_privilege(r.oid,c.oid,'INSERT') AS any_column_insert
FROM candidates r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='fingence_reconciliation' AND c.relkind IN ('r','p','v','m','f')
ORDER BY r.rolname,c.relname;

-- 16b. Referenced membership-key privileges and effective auth-helper/schema privileges.
SELECT r.rolname,has_schema_privilege(r.oid,n.oid,'USAGE') AS schema_usage,
 has_schema_privilege(r.oid,n.oid,'CREATE') AS schema_create,n.nspname
FROM pg_roles r CROSS JOIN pg_namespace n
WHERE r.rolname IN ('fingence_reconciliation_runtime',current_user)
 AND n.nspname IN ('fingence_reconciliation','fingence_m2') ORDER BY r.rolname,n.nspname;
SELECT r.rolname,has_table_privilege(r.oid,c.oid,'REFERENCES') AS can_reference_membership,
 has_table_privilege(r.oid,c.oid,'SELECT') AS can_select_membership
FROM pg_roles r JOIN pg_namespace n ON n.nspname='fingence_m2'
JOIN pg_class c ON c.relnamespace=n.oid AND c.relname='memberships'
WHERE r.rolname IN ('fingence_reconciliation_runtime',current_user) ORDER BY r.rolname;
SELECT r.rolname,p.oid::regprocedure::text AS routine,
 has_function_privilege(r.oid,p.oid,'EXECUTE') AS can_execute
FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE r.rolname IN ('fingence_reconciliation_runtime','anon','authenticated','service_role',current_user)
 AND n.nspname='fingence_reconciliation'
 AND p.proname IN ('principal','authorized_organization','immutable','current_grant_id')
ORDER BY r.rolname,routine;

-- 17. Audit identity-sequence privilege dependencies; no nextval/currval calls.
SELECT n.nspname,c.relname,r.rolname,
 has_sequence_privilege(r.oid,c.oid,'USAGE') AS can_use,
 has_sequence_privilege(r.oid,c.oid,'SELECT') AS can_read,
 has_sequence_privilege(r.oid,c.oid,'UPDATE') AS can_advance
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN pg_roles r WHERE c.relkind='S' AND n.nspname='fingence_reconciliation'
 AND r.rolname IN ('fingence_reconciliation_runtime','anon','authenticated','service_role')
ORDER BY c.relname,r.rolname;

-- 18. Managed default privileges. 005 must seal new-object grants without changing defaults.
SELECT pg_get_userbyid(d.defaclrole) AS creating_role,
 CASE WHEN d.defaclnamespace=0 THEN '<all schemas>' ELSE n.nspname END AS schema_scope,
 d.defaclobjtype,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
 a.privilege_type,a.is_grantable
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclnamespace=0 OR n.nspname='fingence_reconciliation'
ORDER BY creating_role,schema_scope,d.defaclobjtype,grantee,a.privilege_type;

-- 19. DDL event triggers could have effects beyond the additive SQL; inspect, do not invoke.
SELECT e.evtname,e.evtevent,e.evtenabled,e.evttags,
 pg_get_userbyid(e.evtowner) AS owner,e.evtfoid::regprocedure::text AS routine
FROM pg_event_trigger e ORDER BY e.evtname;

-- 20. New-object collision inventory, including auto-named indexes and overloaded routines.
SELECT 'RELATION' AS kind,n.nspname,c.relname AS name,c.relkind::text AS detail
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='fingence_reconciliation' AND (c.relname LIKE 'gpt_runs%' OR c.relname LIKE 'gpt_items%')
UNION ALL
SELECT 'ROUTINE',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='fingence_reconciliation' AND p.proname IN ('gpt_complete','gpt_audit')
UNION ALL
SELECT 'TYPE',n.nspname,t.typname,t.typtype::text
FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname='fingence_reconciliation' AND t.typname IN ('gpt_runs','gpt_items','_gpt_runs','_gpt_items')
ORDER BY kind,name,detail;

-- 21. Neighboring-team object inventory for comparison (no data or routine bodies).
SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner,
 c.relacl::text,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='public' AND c.relname IN ('ingestion_batches','financial_records','validation_issues','persistence_attempts'))
 OR n.nspname='auth' ORDER BY n.nspname,c.relname;

-- End without persisting session settings or transactional changes.
ROLLBACK;
