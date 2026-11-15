-- REVIEW ONLY / NOT EXECUTED. Exact group/main identity must be attested separately.
-- Run only with separately approved inspection access after approved installation.
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SELECT current_database(),current_user,session_user,s.ssl,s.version AS tls_version
 FROM pg_stat_ssl s WHERE s.pid=pg_backend_pid();
SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication
 FROM pg_roles WHERE rolname IN ('fingence_ai06_website_login','fingence_ai06_website_runtime');
SELECT member.rolname AS member,granted.rolname AS granted_role,m.admin_option
 FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
 JOIN pg_roles granted ON granted.oid=m.roleid
 WHERE member.rolname IN ('fingence_ai06_website_login','fingence_ai06_website_runtime');
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,c.relacl,
 has_table_privilege('fingence_ai06_website_login',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS forbidden_table_right,
 has_any_column_privilege('fingence_ai06_website_login',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') AS forbidden_column_right
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='fingence_gpt_website' AND c.relkind IN ('r','p');
SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid,true) AS definition
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='fingence_gpt_website' AND NOT t.tgisinternal;
SELECT p.proname,p.prosecdef,p.proconfig,p.proacl,pg_get_userbyid(p.proowner) AS owner,
 pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='fingence_gpt_website';
SELECT c.relname,k.conname,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k
 JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_gpt_website';
ROLLBACK;
