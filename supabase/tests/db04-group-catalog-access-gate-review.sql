-- REVIEW ONLY / NOT EXECUTED. Run as the separately provisioned inspector, not owner/runtime.
-- First attest exact GROUP project + main branch and verify client TLS certificate/hostname.
-- Catalog-only phase gate. STOP unless every returned identity/privilege boolean is true.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SELECT current_database()='postgres' AS expected_database,
 current_user='db04_group_catalog_inspector' AS expected_current_role,
 session_user='db04_group_catalog_inspector' AS expected_login_role,
 current_setting('transaction_read_only')='on' AS read_only_transaction,
 current_setting('transaction_isolation')='repeatable read' AS repeatable_read,
 current_setting('search_path')='pg_catalog' AS safe_search_path,
 r.rolcanlogin AS login_enabled,NOT r.rolinherit AS no_inherit,r.rolconnlimit=1 AS one_connection_limit,
 current_setting('server_version') AS observed_version
FROM pg_roles r WHERE r.rolname=current_user;
SELECT r.rolname,
 NOT(r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication) AS safe_flags,
 NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS no_memberships,
 has_database_privilege(r.oid,current_database(),'CONNECT') AS can_connect,
 NOT has_database_privilege(r.oid,current_database(),'CREATE,TEMPORARY') AS no_database_creation_or_temp,
 NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datdba=r.oid) AS owns_no_database,
 NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid) AS owns_no_schema,
 NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid) AS owns_no_relation,
 NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.proowner=r.oid) AS owns_no_routine,
 NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
  AND has_schema_privilege(r.oid,n.oid,'CREATE')) AS no_user_schema_create,
 NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
  AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS no_user_relation_rights,
 NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')) AS no_user_sequence_rights,
 NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND p.prokind IN ('f','p') AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype,'pg_catalog.event_trigger'::regtype)
  AND has_schema_privilege(r.oid,n.oid,'USAGE')
  AND has_function_privilege(r.oid,p.oid,'EXECUTE')) AS no_callable_user_routines
FROM pg_roles r WHERE r.rolname='db04_group_catalog_inspector';
-- Own backend TLS metadata only; no pg_monitor/statistics-role grant is requested.
-- With a pooler this reports the database-side hop, not proof of the client/pooler certificate.
SELECT ssl,version,cipher,bits FROM pg_stat_ssl WHERE pid=pg_backend_pid();
ROLLBACK;
