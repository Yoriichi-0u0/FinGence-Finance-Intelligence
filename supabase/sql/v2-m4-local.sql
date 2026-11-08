-- Additive disposable LOCAL schema. No automatic hosted application.
CREATE SCHEMA IF NOT EXISTS fingence_m4;
REVOKE ALL ON SCHEMA fingence_m4 FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS fingence_m4.inferences (
 operation_id uuid PRIMARY KEY REFERENCES fingence_m2.jobs(id),
 organization_id uuid NOT NULL REFERENCES fingence_m2.organizations(id),
 user_id uuid NOT NULL REFERENCES fingence_m2.users(id),
 execution_id uuid NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 prompt_hash text NOT NULL CHECK(prompt_hash ~ '^[a-f0-9]{64}$'),
 policy_hash text NOT NULL CHECK(policy_hash ~ '^[a-f0-9]{64}$'),
 prompt_revision text NOT NULL,
 origin text NOT NULL CHECK(origin IN ('RECORDED_TEST','LIVE_GROQ')),
 state text NOT NULL CHECK(state IN ('DISPATCHING','COMPLETED','NOT_EXECUTED','UNKNOWN')),
 authorization_id uuid,
 reservation_id uuid,
 proposal jsonb,
 receipt jsonb,
 verification_allowed boolean NOT NULL DEFAULT false,
 reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(origin<>'LIVE_GROQ' OR authorization_id IS NOT NULL)
);
ALTER TABLE fingence_m4.inferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_m4 FROM PUBLIC, anon, authenticated;
