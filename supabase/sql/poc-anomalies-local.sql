-- Additive LOCAL-only PoC anomaly review (issue #31). Never apply automatically to hosted Supabase.
-- Declarative statements only (no BEGIN/COMMIT or procedural bodies): the installer runs one at a time.
CREATE SCHEMA IF NOT EXISTS fingence_poc;
REVOKE ALL ON SCHEMA fingence_poc FROM PUBLIC, anon, authenticated;
-- A Finance-uploaded synthetic source file, kept byte-exact; rows and candidates are derived on read.
CREATE TABLE IF NOT EXISTS fingence_poc.anomaly_sources (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES fingence_m2.organizations(id),
 uploaded_by uuid NOT NULL REFERENCES fingence_m2.users(id),
 file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 120),
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 layout text NOT NULL CHECK (layout IN ('NORMALIZED_TRANSACTIONS','BANK_STATEMENT')),
 row_count integer NOT NULL CHECK (row_count > 0),
 content bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (organization_id, sha256)
);
-- Explicit Finance review decisions. No row means OPEN; nothing is cleared automatically.
CREATE TABLE IF NOT EXISTS fingence_poc.anomaly_reviews (
 source_id uuid NOT NULL REFERENCES fingence_poc.anomaly_sources(id),
 row_id text NOT NULL CHECK (length(row_id) BETWEEN 1 AND 64),
 state text NOT NULL CHECK (state IN ('OPEN','EXPLAINED','ESCALATED')),
 version integer NOT NULL CHECK (version > 0),
 decided_by uuid NOT NULL REFERENCES fingence_m2.users(id),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (source_id, row_id)
);
ALTER TABLE fingence_poc.anomaly_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_poc.anomaly_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_poc FROM PUBLIC, anon, authenticated;
