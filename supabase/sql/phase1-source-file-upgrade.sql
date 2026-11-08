-- Additive upgrade only: existing Phase 1 tables must already exist.
-- No backfill: NULL means unknown historical attempt/issue provenance.
BEGIN;
ALTER TABLE public.ingestion_batches ADD COLUMN source_file text;
ALTER TABLE public.validation_issues ADD COLUMN source_file text;
CREATE FUNCTION public.is_safe_source_file(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT length(value) BETWEEN 1 AND 255 AND length(btrim(value)) > 0
    AND value NOT IN ('.', '..') AND strpos(value, '/') = 0
    AND strpos(value, chr(92)) = 0 AND value !~ '[[:cntrl:]]'
    AND value !~ U&'[\007F-\009F]';
$$;
ALTER TABLE public.ingestion_batches ADD CONSTRAINT ingestion_batches_source_file_safe
  CHECK (source_file IS NULL OR public.is_safe_source_file(source_file));
ALTER TABLE public.validation_issues ADD CONSTRAINT validation_issues_source_file_safe
  CHECK (source_file IS NULL OR public.is_safe_source_file(source_file));
-- Preserve legacy record names verbatim; enforce safety on new/updated rows.
ALTER TABLE public.financial_records ADD CONSTRAINT financial_records_source_file_safe
  CHECK (public.is_safe_source_file(source_file)) NOT VALID;

CREATE FUNCTION public.enforce_source_file_consistency() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE parent_file text; batch_file text;
BEGIN
  IF TG_TABLE_NAME = 'ingestion_batches' THEN
    IF NEW.source_file IS DISTINCT FROM OLD.source_file AND EXISTS (
      SELECT 1 FROM public.financial_records WHERE batch_id = OLD.id) THEN
      RAISE EXCEPTION 'Batch filename cannot change after records exist' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'financial_records' THEN
    -- SHARE conflicts with parent UPDATE, preventing a check/update race.
    SELECT source_file INTO batch_file FROM public.ingestion_batches WHERE id = NEW.batch_id FOR SHARE;
    IF batch_file IS NOT NULL AND NEW.source_file IS DISTINCT FROM batch_file THEN
      RAISE EXCEPTION 'Record filename disagrees with batch' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
      SELECT 1 FROM public.validation_issues WHERE financial_record_id = OLD.id
        AND (source_file IS NOT NULL AND source_file IS DISTINCT FROM NEW.source_file
          OR batch_file IS NOT NULL AND source_file IS NULL)) THEN
      RAISE EXCEPTION 'Record filename disagrees with existing issues' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT source_file INTO parent_file
      FROM public.financial_records WHERE id = NEW.financial_record_id FOR SHARE;
    -- Use a separate lookup; never modify the incoming relationship.
    SELECT b.source_file INTO batch_file FROM public.ingestion_batches b
      JOIN public.financial_records r ON r.batch_id = b.id WHERE r.id = NEW.financial_record_id FOR SHARE OF b;
    IF (NEW.source_file IS NOT NULL AND NEW.source_file IS DISTINCT FROM parent_file)
      OR (batch_file IS NOT NULL AND NEW.source_file IS DISTINCT FROM batch_file) THEN
      RAISE EXCEPTION 'Issue filename disagrees with record/batch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER batch_source_file_consistency BEFORE UPDATE OF source_file ON public.ingestion_batches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_source_file_consistency();
CREATE TRIGGER record_source_file_consistency BEFORE INSERT OR UPDATE OF source_file, batch_id ON public.financial_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_source_file_consistency();
CREATE TRIGGER issue_source_file_consistency BEFORE INSERT OR UPDATE OF source_file, financial_record_id ON public.validation_issues
  FOR EACH ROW EXECUTE FUNCTION public.enforce_source_file_consistency();
REVOKE ALL ON FUNCTION public.is_safe_source_file(text), public.enforce_source_file_consistency() FROM PUBLIC, anon, authenticated;
COMMENT ON COLUMN public.ingestion_batches.source_file IS 'Authoritative safe basename for new persistence attempts; NULL for unknown historical provenance.';
COMMENT ON COLUMN public.validation_issues.source_file IS 'Same safe basename as the owning record and named batch; NULL for unknown historical provenance.';
COMMIT;
