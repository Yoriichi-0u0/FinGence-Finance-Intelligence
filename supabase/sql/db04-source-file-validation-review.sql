-- PROPOSAL ONLY. Explicit approval must include scanning existing source_file
-- values. No financial SELECT/export, cleanup, backfill or constraint weakening.
-- Target personal FYP A fhipzomczevbpybezzxu / postgres.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.financial_records VALIDATE CONSTRAINT financial_records_source_file_safe;
COMMIT;
-- On failure/timeout: ROLLBACK and stop. Never automatically update/delete rows,
-- drop the constraint or retry. Existing rows and NOT VALID state are preserved.
