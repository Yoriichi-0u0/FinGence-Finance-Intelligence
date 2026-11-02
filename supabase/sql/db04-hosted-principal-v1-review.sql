-- PROPOSAL ONLY. Run after proposed hosted identity + DB04 001,002,003,004.
-- Replaces only the local-session principal; never map a JWT or browser tenant GUC.
BEGIN;
CREATE OR REPLACE FUNCTION fingence_reconciliation.principal()
RETURNS TABLE(user_id uuid,organization_id uuid)
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT s.user_id,s.organization_id FROM fingence_m2.sessions s
 JOIN fingence_m2.users u ON u.id=s.user_id
 JOIN fingence_m2.memberships m USING(user_id,organization_id)
 JOIN fingence_m3.organization_states o USING(organization_id)
 WHERE s.token_hash=current_setting('fingence.reconciliation_token_hash',true)
 AND NOT s.revoked AND s.expires_at>clock_timestamp() AND m.active AND o.active AND NOT u.suspended
 AND s.contract_version='hosted-finance-admission/1'
 AND u.issuer='https://fhipzomczevbpybezzxu.supabase.co/auth/v1'
 AND m.role='Finance' AND m.version=s.membership_version
 FOR SHARE OF s,u,m,o
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.principal() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION fingence_reconciliation.principal() TO fingence_reconciliation_runtime;
CREATE FUNCTION fingence_reconciliation.current_grant_id() RETURNS uuid
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT s.id FROM fingence_m2.sessions s
 JOIN fingence_reconciliation.principal() p USING(user_id,organization_id)
 WHERE s.token_hash=current_setting('fingence.reconciliation_token_hash',true)
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.current_grant_id() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION fingence_reconciliation.current_grant_id() TO fingence_reconciliation_runtime;
ALTER TABLE fingence_reconciliation.audit ADD COLUMN session_grant_id uuid NOT NULL
 DEFAULT fingence_reconciliation.current_grant_id();
ALTER TABLE fingence_reconciliation.audit ADD CONSTRAINT audit_hosted_grant_identity
 FOREIGN KEY(session_grant_id,actor_id,organization_id) REFERENCES fingence_m2.sessions(id,user_id,organization_id);
-- Seal only newly created DB04 objects against hosted default grants. No public
-- financial route is enabled between migrations or before independent review.
REVOKE ALL ON SCHEMA fingence_reconciliation FROM anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_reconciliation FROM anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fingence_reconciliation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fingence_reconciliation FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
