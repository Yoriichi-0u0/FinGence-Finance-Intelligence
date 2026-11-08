-- DB02-001. Additive, one-time upgrade after the source-file/grouped foundation.
-- Local verification only; hosted application requires separate reviewed approval.
BEGIN;
CREATE FUNCTION public.serialize_warning_issue_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE affected uuid[]; record_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN affected := ARRAY[NEW.financial_record_id];
  ELSIF TG_OP = 'DELETE' THEN affected := ARRAY[OLD.financial_record_id];
  ELSE affected := ARRAY[OLD.financial_record_id, NEW.financial_record_id]; END IF;
  -- Sort both sides of a reassignment; ordinary multi-record transaction deadlocks
  -- remain possible and must be handled as failed transactions, never auto-retried.
  FOR record_id IN SELECT DISTINCT x FROM unnest(affected) AS ids(x) ORDER BY x LOOP
    -- A real tuple version (with identical values) is required, not just a row lock:
    -- REPEATABLE READ must reject a stale competing mutation with SQLSTATE 40001.
    -- This queues the existing deferred record check; that function never writes,
    -- so there is no recursive mutation cycle. No financial value is transformed.
    UPDATE public.financial_records SET ingestion_status = ingestion_status WHERE id = record_id;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
-- Run before the existing issue_source_file_consistency trigger takes SHARE locks.
CREATE TRIGGER issue_00_warning_mutation_fence BEFORE INSERT OR UPDATE OR DELETE
ON public.validation_issues FOR EACH ROW EXECUTE FUNCTION public.serialize_warning_issue_mutation();
REVOKE ALL ON FUNCTION public.serialize_warning_issue_mutation() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.serialize_warning_issue_mutation() IS
  'Serializes warning evidence changes with record status changes; identical-value parent UPDATE prevents stale-snapshot write skew.';
COMMIT;
