-- Local additive verification snapshots. No approved assignment policy exists.
BEGIN;
CREATE TABLE fingence_reconciliation.proposal_verifications (
 organization_id uuid NOT NULL,processing_id text NOT NULL,
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 policy_version text NOT NULL CHECK(policy_version='db04-independent-proposals/1'),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 outcome text NOT NULL CHECK(outcome='UNRESOLVED'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
 CHECK(jsonb_array_length(jsonb_path_query_array(evidence,'$[*] ? (@.outcome == "UNRESOLVED")'))=jsonb_array_length(evidence)),
 PRIMARY KEY(organization_id,processing_id,snapshot_sha256,policy_version),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_m2.memberships(user_id,organization_id)
);
ALTER TABLE fingence_reconciliation.proposal_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_reconciliation.proposal_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_scope ON fingence_reconciliation.proposal_verifications
 USING(organization_id=fingence_reconciliation.authorized_organization())
 WITH CHECK(organization_id=fingence_reconciliation.authorized_organization());
CREATE POLICY actor_binding ON fingence_reconciliation.proposal_verifications AS RESTRICTIVE FOR INSERT
 WITH CHECK(created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.proposal_verifications
 FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable();
REVOKE ALL ON fingence_reconciliation.proposal_verifications FROM PUBLIC;
GRANT SELECT,INSERT ON fingence_reconciliation.proposal_verifications TO fingence_reconciliation_runtime;
COMMIT;
