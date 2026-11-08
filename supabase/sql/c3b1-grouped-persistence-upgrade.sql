-- One-time additive upgrade after the Phase 1 source-file foundation.
-- Hosted execution requires separate approval. Historical rows are unchanged.
BEGIN;
CREATE TABLE public.persistence_attempts (
  id uuid PRIMARY KEY,
  dataset_count integer NOT NULL CHECK (dataset_count > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ingestion_batches
  ADD COLUMN persistence_attempt_id uuid REFERENCES public.persistence_attempts(id) ON DELETE RESTRICT,
  ADD COLUMN dataset_id text;
ALTER TABLE public.ingestion_batches DROP CONSTRAINT ingestion_batches_status_check;
ALTER TABLE public.ingestion_batches ADD CONSTRAINT ingestion_batches_status_check
  CHECK (status IN ('PROCESSING', 'ACTIVE', 'SUPERSEDED', 'FAILED', 'COMPLETED_EMPTY'));
ALTER TABLE public.ingestion_batches ADD CONSTRAINT completed_empty_counts
  CHECK (status <> 'COMPLETED_EMPTY' OR (valid_count = 0 AND warning_count = 0 AND completed_at IS NOT NULL));
ALTER TABLE public.ingestion_batches ADD CONSTRAINT grouped_dataset_identity
  CHECK ((persistence_attempt_id IS NULL AND dataset_id IS NULL)
    OR (persistence_attempt_id IS NOT NULL AND dataset_id IS NOT NULL AND length(btrim(dataset_id)) > 0));
ALTER TABLE public.ingestion_batches ADD CONSTRAINT grouped_dataset_unique
  UNIQUE (persistence_attempt_id, ingestion_batch_id, dataset_id, source_file);
-- Apply the existing server-only storage policy to the new internal table.
ALTER TABLE public.persistence_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.persistence_attempts FROM PUBLIC, anon, authenticated;
COMMIT;
