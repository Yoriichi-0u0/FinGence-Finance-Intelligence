-- REVIEW TEMPLATE ONLY, not a migration. Do not execute on a hosted target until
-- the exact personal project reference and this role/CONNECT change are approved.
-- Fail on an existing role; never overwrite credentials, memberships or grants.
BEGIN;
CREATE ROLE db04_catalog_inspector LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB
 NOCREATEROLE NOREPLICATION NOINHERIT CONNECTION LIMIT 1;
GRANT CONNECT ON DATABASE postgres TO db04_catalog_inspector;
ALTER ROLE db04_catalog_inspector SET default_transaction_read_only = on;
ALTER ROLE db04_catalog_inspector SET statement_timeout = '10s';
ALTER ROLE db04_catalog_inspector SET lock_timeout = '3s';
COMMIT;
-- No password is embedded. After separate approval, the owner must provision it
-- privately (for example psql's masked \password command), never SQL/chat/logs.
-- No private-schema USAGE, financial SELECT, runtime-role membership or auth grants.
