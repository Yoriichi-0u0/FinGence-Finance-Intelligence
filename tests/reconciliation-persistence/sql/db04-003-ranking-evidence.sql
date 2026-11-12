-- Additive local review only: rankings never update deterministic decisions.
BEGIN;
CREATE TABLE fingence_reconciliation.rankings (
 organization_id uuid NOT NULL, processing_id text NOT NULL,
 version text NOT NULL CHECK(version IN ('db04-fuzzy-proposals/1','db04-e5-proposals/1')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
 PRIMARY KEY(organization_id,processing_id,version),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_m2.memberships(user_id,organization_id)
);
ALTER TABLE fingence_reconciliation.rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_reconciliation.rankings FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_scope ON fingence_reconciliation.rankings
 USING(organization_id=fingence_reconciliation.authorized_organization())
 WITH CHECK(organization_id=fingence_reconciliation.authorized_organization());
CREATE POLICY actor_binding ON fingence_reconciliation.rankings AS RESTRICTIVE FOR INSERT
 WITH CHECK(created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.rankings
 FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable();
REVOKE ALL ON fingence_reconciliation.rankings FROM PUBLIC;
GRANT SELECT,INSERT ON fingence_reconciliation.rankings TO fingence_reconciliation_runtime;
COMMIT;
