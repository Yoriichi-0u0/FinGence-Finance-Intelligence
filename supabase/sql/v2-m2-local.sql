-- Additive LOCAL development schema; never apply to hosted Supabase automatically.
CREATE SCHEMA IF NOT EXISTS fingence_m2;
REVOKE ALL ON SCHEMA fingence_m2 FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS fingence_m2.organizations(id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS fingence_m2.users(id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS fingence_m2.memberships(
 user_id uuid REFERENCES fingence_m2.users, organization_id uuid REFERENCES fingence_m2.organizations,
 role text NOT NULL CHECK(role IN ('Finance','Technical (Management)','Admin')),
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(user_id,organization_id));
CREATE TABLE IF NOT EXISTS fingence_m2.sessions(
 token_hash text PRIMARY KEY, user_id uuid NOT NULL, organization_id uuid NOT NULL,
 expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false, membership_version integer NOT NULL,
 FOREIGN KEY(user_id,organization_id) REFERENCES fingence_m2.memberships);
CREATE TABLE IF NOT EXISTS fingence_m2.jobs(
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES fingence_m2.organizations,
 user_id uuid NOT NULL REFERENCES fingence_m2.users,
 state text NOT NULL CHECK(state IN ('RESERVED','PROCESSING','COMPLETED','FAILED','UNCERTAIN','CANCELLED')),
 stages jsonb NOT NULL DEFAULT '[]', failure_code text, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS m2_attempt_tenant ON fingence_v2_local.attempts(id,tenant_id);
CREATE TABLE IF NOT EXISTS fingence_m2.batch_owners(
 attempt_id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES fingence_m2.organizations,
 user_id uuid NOT NULL REFERENCES fingence_m2.users,
 FOREIGN KEY(attempt_id,organization_id) REFERENCES fingence_v2_local.attempts(id,tenant_id));
ALTER TABLE fingence_m2.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m2.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m2.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m2.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m2.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m2.batch_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_m2 FROM PUBLIC, anon, authenticated;
