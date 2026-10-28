-- Disposable local databases only. Experimental V2, not a production migration.
CREATE SCHEMA fingence_v2_local;
REVOKE ALL ON SCHEMA fingence_v2_local FROM PUBLIC, anon, authenticated;
CREATE TABLE fingence_v2_local.attempts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, job_id uuid NOT NULL, execution_id uuid NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  outcome_count integer NOT NULL CHECK (outcome_count >= 0),
  publication_eligible boolean NOT NULL DEFAULT false CHECK (publication_eligible = false),
  batch jsonb NOT NULL CHECK (jsonb_typeof(batch) = 'object'),
  CHECK (COALESCE(batch->>'version' = 'verified-document-batch-v1' AND batch->'publicationEligible' = 'false'::jsonb
    AND batch #>> '{source,sha256}' = source_sha256 AND lower(batch->>'tenantId') = tenant_id::text
    AND lower(batch->>'attemptId') = id::text AND lower(batch->>'jobId') = job_id::text
    AND lower(batch->>'executionId') = execution_id::text, false)),
  UNIQUE (tenant_id, job_id, execution_id)
);
CREATE TABLE fingence_v2_local.outcomes (
  attempt_id uuid NOT NULL REFERENCES fingence_v2_local.attempts(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  outcome text NOT NULL CHECK (outcome IN ('VALID','WARNING','REJECTED','UNRESOLVED')),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  PRIMARY KEY (attempt_id, ordinal)
);
ALTER TABLE fingence_v2_local.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_v2_local.outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_v2_local FROM PUBLIC, anon, authenticated;
