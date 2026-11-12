-- LOCAL REVIEW ONLY. Migration owner must differ from runtime. Never run on hosted FYP A.
BEGIN;
CREATE ROLE fingence_reconciliation_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
-- The scoped claim is a SHA256 of an authenticated local session token, not a tenant GUC.
-- A restricted role cannot choose an organization by changing a setting.
CREATE FUNCTION fingence_reconciliation.principal()
RETURNS TABLE(user_id uuid, organization_id uuid)
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT s.user_id,s.organization_id FROM fingence_m2.sessions s
 JOIN fingence_m2.memberships m USING(user_id,organization_id)
 JOIN fingence_m3.organization_states o USING(organization_id)
 WHERE s.token_hash=current_setting('fingence.reconciliation_token_hash',true)
 AND NOT s.revoked AND s.expires_at>clock_timestamp() AND m.active AND o.active
 AND m.role='Finance' AND m.version=s.membership_version
 FOR SHARE OF s,m,o
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.principal() FROM PUBLIC;
-- M5 suspension is optional on legacy M2/M3; enforce it when installed.
CREATE FUNCTION fingence_reconciliation.authorized_organization() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
DECLARE p record; suspended boolean;
BEGIN
 SELECT * INTO p FROM fingence_reconciliation.principal();
 IF p.organization_id IS NULL THEN RETURN NULL; END IF;
 IF to_regclass('fingence_m5.account_suspensions') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM fingence_m5.account_suspensions WHERE user_id=$1)' INTO suspended USING p.user_id;
  IF suspended THEN RETURN NULL; END IF;
 END IF;
 RETURN p.organization_id;
END $$;
REVOKE ALL ON FUNCTION fingence_reconciliation.authorized_organization() FROM PUBLIC;
CREATE FUNCTION fingence_reconciliation.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'immutable reconciliation evidence' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION fingence_reconciliation.immutable() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['documents','jobs','job_sources','transactions','proposals','decisions','cases','reviews','audit'] LOOP
  EXECUTE format('ALTER TABLE fingence_reconciliation.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE fingence_reconciliation.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY organization_scope ON fingence_reconciliation.%I USING (organization_id=fingence_reconciliation.authorized_organization()) WITH CHECK (organization_id=fingence_reconciliation.authorized_organization())',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.%I FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable()',t);
 END LOOP;
END $$;
CREATE POLICY actor_binding ON fingence_reconciliation.jobs AS RESTRICTIVE FOR INSERT
 WITH CHECK (created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE POLICY actor_binding ON fingence_reconciliation.reviews AS RESTRICTIVE FOR INSERT
 WITH CHECK (actor_id=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE POLICY actor_binding ON fingence_reconciliation.audit AS RESTRICTIVE FOR INSERT
 WITH CHECK (actor_id=(SELECT user_id FROM fingence_reconciliation.principal()));
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_reconciliation FROM PUBLIC;
GRANT USAGE ON SCHEMA fingence_reconciliation TO fingence_reconciliation_runtime;
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA fingence_reconciliation TO fingence_reconciliation_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA fingence_reconciliation TO fingence_reconciliation_runtime;
GRANT EXECUTE ON FUNCTION fingence_reconciliation.principal(),fingence_reconciliation.authorized_organization() TO fingence_reconciliation_runtime;
COMMIT;
