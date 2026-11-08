-- Additive LOCAL-only M5 account lifecycle and enrollment. Never apply automatically to hosted Supabase.
-- Declarative statements only (no BEGIN/COMMIT or procedural bodies): the installer runs one at a time.
-- The audit action CHECK is widened by installM5Schema from the TypeScript allowlist, not duplicated here.
CREATE SCHEMA IF NOT EXISTS fingence_m5;
REVOKE ALL ON SCHEMA fingence_m5 FROM PUBLIC, anon, authenticated;
-- A row means the account cannot sign in or resolve a session. Absence is the original active state,
-- so OS-local provisioning paths need no backfill. Membership activation remains a separate state.
CREATE TABLE IF NOT EXISTS fingence_m5.account_suspensions (
 user_id uuid PRIMARY KEY REFERENCES fingence_m2.users(id),
 suspended_by uuid REFERENCES fingence_m2.users(id),
 suspended_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Single-use enrollment codes. Only the SHA-256 of the 256-bit code is stored.
CREATE TABLE IF NOT EXISTS fingence_m5.invitations (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES fingence_m2.organizations(id),
 email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 200),
 role text NOT NULL CHECK (role IN ('Finance','Technical (Management)','Admin')),
 issuer text NOT NULL CHECK (issuer IN ('ADMIN','OS_BOOTSTRAP','OS_RECOVERY')),
 created_by uuid REFERENCES fingence_m2.users(id),
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','ACCEPTED','REVOKED')),
 accepted_user_id uuid REFERENCES fingence_m2.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 CHECK ((issuer = 'ADMIN') = (created_by IS NOT NULL)),
 CHECK (issuer = 'ADMIN' OR role = 'Admin'),
 CHECK ((state = 'ACCEPTED') = (accepted_user_id IS NOT NULL)),
 CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS m5_one_pending_invitation ON fingence_m5.invitations(organization_id, email) WHERE state = 'PENDING';
ALTER TABLE fingence_m5.account_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_m5.invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_m5 FROM PUBLIC, anon, authenticated;
