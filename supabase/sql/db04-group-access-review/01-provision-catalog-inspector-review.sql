-- REVIEW ONLY. NOT EXECUTED. Authorized GROUP OWNER procedure, never an agent fallback.
-- Target must first be attested: FinGence-Production / zmtdozblpvtjniehwjrw / main / postgres.
-- Project/branch cannot be proven by the database name. Stop on any mismatch.
-- Creates ONE new NOLOGIN role and CONNECT grant; no password, membership or private grants.
-- Fail on an existing role; do not adopt, repair or reset it. No existing objects/ACLs changed.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $target$ BEGIN
 IF current_database()<>'postgres' THEN RAISE EXCEPTION 'WRONG_DATABASE'; END IF;
END $target$;
CREATE ROLE db04_group_catalog_inspector NOLOGIN NOSUPERUSER NOBYPASSRLS
 NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT CONNECTION LIMIT 1;
GRANT CONNECT ON DATABASE postgres TO db04_group_catalog_inspector;
ALTER ROLE db04_group_catalog_inspector SET default_transaction_read_only=on;
ALTER ROLE db04_group_catalog_inspector SET search_path=pg_catalog;
ALTER ROLE db04_group_catalog_inspector SET statement_timeout='15s';
ALTER ROLE db04_group_catalog_inspector SET lock_timeout='2s';
ALTER ROLE db04_group_catalog_inspector SET idle_in_transaction_session_timeout='30s';
-- NOINHERIT/read-only defaults are not denial controls. Effective PUBLIC rights count.
-- No exceptions for monitoring views, application helpers or extension routines.
-- If any unsafe inherited capability exists, roll back; NEVER revoke shared grants here.
DO $guard$
DECLARE c record;
BEGIN
 SELECT * INTO STRICT c FROM (
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
FROM pg_roles r WHERE r.rolname='db04_group_catalog_inspector'
 ) checked;
 IF NOT(c.safe_flags AND c.no_memberships AND c.can_connect AND c.no_database_creation_or_temp
  AND c.owns_no_database AND c.owns_no_schema AND c.owns_no_relation AND c.owns_no_routine
  AND c.no_user_schema_create AND c.no_user_relation_rights AND c.no_user_sequence_rights
  AND c.no_callable_user_routines) THEN
  RAISE EXCEPTION 'CATALOG_INSPECTOR_UNSAFE_EFFECTIVE_PRIVILEGES' USING ERRCODE='42501';
 END IF;
END $guard$;
COMMIT;
-- Remains NOLOGIN. Separate owner-approved private password/activation procedure is in the report.
-- Never paste passwords or password verifiers into this SQL, chat or SQL Editor history.
