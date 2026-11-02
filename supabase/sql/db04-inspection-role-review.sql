-- REVIEW TEMPLATE ONLY, not a migration. Do not execute on a hosted target until
-- the exact personal project reference and this role/CONNECT change are approved.
-- Fail on an existing role; never overwrite credentials, memberships or grants.
-- Target: personal FYP A, project fhipzomczevbpybezzxu, database postgres.
BEGIN;
CREATE ROLE db04_catalog_inspector LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB
 NOCREATEROLE NOREPLICATION NOINHERIT CONNECTION LIMIT 1;
GRANT CONNECT ON DATABASE postgres TO db04_catalog_inspector;
ALTER ROLE db04_catalog_inspector SET default_transaction_read_only = on;
ALTER ROLE db04_catalog_inspector SET statement_timeout = '10s';
ALTER ROLE db04_catalog_inspector SET lock_timeout = '3s';
-- PUBLIC privileges also apply to new roles. Refuse unsafe existing grants;
-- do not repair them or revoke access from other users as part of this proposal.
DO $inspection_guard$
BEGIN
 IF EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','f')
   AND n.nspname NOT IN ('pg_catalog','information_schema')
   AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
   AND (pg_catalog.has_table_privilege('db04_catalog_inspector',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR pg_catalog.has_any_column_privilege('db04_catalog_inspector',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
 ) OR EXISTS (
  SELECT 1 FROM pg_catalog.pg_namespace n
  WHERE n.nspname NOT IN ('pg_catalog','information_schema')
   AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
   AND pg_catalog.has_schema_privilege('db04_catalog_inspector',n.oid,'CREATE')
 ) OR EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND p.prorettype NOT IN ('pg_catalog.trigger'::pg_catalog.regtype,'pg_catalog.event_trigger'::pg_catalog.regtype)
   AND n.nspname NOT IN ('pg_catalog','information_schema')
   AND pg_catalog.has_schema_privilege('db04_catalog_inspector',n.oid,'USAGE')
   AND pg_catalog.has_function_privilege('db04_catalog_inspector',p.oid,'EXECUTE')
 ) THEN
  RAISE EXCEPTION 'INSPECTION_ROLE_UNSAFE_PUBLIC_PRIVILEGES' USING ERRCODE='42501';
 END IF;
END
$inspection_guard$;
COMMIT;
-- No password is embedded. After separate approval, the owner must provision it
-- privately (for example psql's masked \password command), never SQL/chat/logs.
-- No private-schema USAGE, financial SELECT, runtime-role membership or auth grants.
