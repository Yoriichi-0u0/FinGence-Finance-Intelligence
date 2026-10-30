-- Additive LOCAL-only organization lifecycle metadata. Never apply automatically to hosted Supabase.
CREATE SCHEMA IF NOT EXISTS fingence_m3;
REVOKE ALL ON SCHEMA fingence_m3 FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS fingence_m3.organization_states (
 organization_id uuid PRIMARY KEY REFERENCES fingence_m2.organizations(id),
 active boolean NOT NULL DEFAULT true
);
ALTER TABLE fingence_m3.organization_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_m3 FROM PUBLIC,anon,authenticated;
INSERT INTO fingence_m3.organization_states(organization_id) SELECT id FROM fingence_m2.organizations ON CONFLICT DO NOTHING;
