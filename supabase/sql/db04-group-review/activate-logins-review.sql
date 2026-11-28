-- REVIEW ONLY: execute AFTER separately approved masked password provisioning.
-- No password is present here. Does not reset or change any existing application login.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $activation$ DECLARE login_name text;parent_name text;r record; BEGIN
 IF current_database()<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole)) THEN
  RAISE EXCEPTION 'INSTALL_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 FOREACH login_name IN ARRAY ARRAY['db04_group_test_runtime','db04_group_test_broker'] LOOP
  parent_name=CASE WHEN login_name='db04_group_test_runtime' THEN 'fingence_db04_group_runtime' ELSE 'fingence_db04_group_broker' END;
  SELECT * INTO r FROM pg_roles WHERE rolname=login_name;
  IF r.oid IS NULL OR r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
   OR r.rolconnlimit<>(CASE WHEN login_name='db04_group_test_runtime' THEN 4 ELSE 2 END)
   OR (SELECT count(*) FROM pg_auth_members WHERE member=r.oid)<>1
   OR NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid WHERE m.member=r.oid AND p.rolname=parent_name AND NOT m.admin_option) THEN
   RAISE EXCEPTION 'RESTRICTED_LOGIN_DRIFT' USING ERRCODE='42501'; END IF;
 END LOOP;
END $activation$;
ALTER ROLE db04_group_test_runtime LOGIN;
ALTER ROLE db04_group_test_broker LOGIN;
COMMIT;
