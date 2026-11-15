-- REVIEW ONLY / NOT EXECUTED. Separate owner approval required.
-- Run ONLY after ai06-website-gpt-storage-review.sql has been approved/applied.
-- No password in this file. Owner provisions SCRAM credentials privately afterward.
-- Fail on an existing login; inspect its permissions instead of reusing it blindly.
BEGIN;
CREATE ROLE fingence_ai06_website_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO fingence_ai06_website_login;
GRANT fingence_ai06_website_runtime TO fingence_ai06_website_login;
ALTER ROLE fingence_ai06_website_login SET statement_timeout='10s';
ALTER ROLE fingence_ai06_website_login SET lock_timeout='3s';
ALTER ROLE fingence_ai06_website_login SET idle_in_transaction_session_timeout='10s';
COMMIT;
