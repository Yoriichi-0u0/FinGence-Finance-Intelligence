BEGIN;
CREATE TABLE public.ingestion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_batch_id text NOT NULL CHECK (length(btrim(ingestion_batch_id)) > 0),
  schema_version text NOT NULL CHECK (schema_version = '0.1'),
  ruleset_version text NOT NULL CHECK (ruleset_version = '0.1'),
  status text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','ACTIVE','SUPERSEDED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  supersedes_batch_id uuid REFERENCES public.ingestion_batches(id) ON DELETE RESTRICT,
  rows_received integer NOT NULL DEFAULT 0 CHECK (rows_received >= 0),
  valid_count integer NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  CHECK (rows_received = valid_count + warning_count + rejected_count),
  CHECK (supersedes_batch_id IS NULL OR supersedes_batch_id <> id),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  UNIQUE (id, ingestion_batch_id)
);
CREATE TABLE public.financial_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  ingestion_batch_id text NOT NULL,
  transaction_date date,
  posting_date date,
  canonical_date date NOT NULL,
  canonical_date_basis text NOT NULL CHECK (canonical_date_basis IN ('TRANSACTION_DATE','POSTING_DATE')),
  reference text,
  source_transaction_id text,
  account_code text,
  account_id text,
  entity_id text,
  description text,
  counterparty text,
  debit numeric,
  credit numeric,
  source_amount numeric,
  derived_ledger_net numeric,
  balance numeric,
  entry_side text CHECK (entry_side IN ('DEBIT','CREDIT')),
  monetary_basis text NOT NULL CHECK (monetary_basis IN ('source_signed_amount','source_amount_with_direction','debit_credit')),
  currency text,
  currency_basis text CHECK (currency_basis IN ('SOURCE','DATASET_DEFAULT')),
  transformations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transformations) = 'array'),
  ingestion_status text NOT NULL CHECK (ingestion_status IN ('VALID','WARNING')),
  source_system text NOT NULL,
  source_file text NOT NULL,
  source_sheet text,
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  source_row_id text NOT NULL,
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  ingested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (batch_id, ingestion_batch_id) REFERENCES public.ingestion_batches(id, ingestion_batch_id) ON DELETE RESTRICT,
  CHECK ((canonical_date_basis = 'TRANSACTION_DATE' AND transaction_date IS NOT NULL AND canonical_date = transaction_date)
      OR (canonical_date_basis = 'POSTING_DATE' AND posting_date IS NOT NULL AND canonical_date = posting_date)),
  CHECK ((monetary_basis = 'debit_credit' AND debit IS NOT NULL AND credit IS NOT NULL AND derived_ledger_net IS NOT NULL AND derived_ledger_net = debit - credit)
      OR (monetary_basis IN ('source_signed_amount','source_amount_with_direction') AND source_amount IS NOT NULL AND derived_ledger_net IS NULL)),
  CHECK (monetary_basis <> 'source_amount_with_direction' OR (entry_side IS NOT NULL AND source_amount >= 0)),
  CHECK ((currency IS NULL AND currency_basis IS NULL) OR (currency IS NOT NULL AND currency_basis IS NOT NULL)),
  CHECK (debit IS NULL OR debit::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (credit IS NULL OR credit::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (source_amount IS NULL OR source_amount::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (derived_ledger_net IS NULL OR derived_ledger_net::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (balance IS NULL OR balance::text NOT IN ('NaN','Infinity','-Infinity'))
);
CREATE TABLE public.validation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_record_id uuid NOT NULL REFERENCES public.financial_records(id) ON DELETE RESTRICT,
  issue_ordinal integer NOT NULL CHECK (issue_ordinal >= 0),
  rule text NOT NULL,
  category text NOT NULL CHECK (category IN ('technical','business')),
  severity text NOT NULL CHECK (severity = 'WARNING'),
  field text NOT NULL,
  source_column text,
  original_value jsonb NOT NULL,
  message text NOT NULL,
  UNIQUE (financial_record_id, issue_ordinal),
  CHECK (COALESCE(jsonb_typeof(original_value) IN ('string','boolean','null') OR
    (jsonb_typeof(original_value) = 'object' AND original_value->>'kind' IN ('excel_date','excel_number')
      AND original_value ? 'value' AND jsonb_typeof(original_value->'value') = 'string'), false))
);
-- Deferred checks allow parent and issue writes in either order within one transaction.
CREATE FUNCTION public.check_record_warning_consistency() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE record_id uuid; record_status text; issue_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'financial_records' THEN record_id := COALESCE(NEW.id, OLD.id);
  ELSE record_id := COALESCE(NEW.financial_record_id, OLD.financial_record_id); END IF;
  SELECT ingestion_status INTO record_status FROM public.financial_records WHERE id = record_id;
  SELECT count(*) INTO issue_count FROM public.validation_issues WHERE financial_record_id = record_id;
  IF (record_status = 'VALID' AND issue_count <> 0) OR (record_status = 'WARNING' AND issue_count = 0) THEN
    RAISE EXCEPTION 'Accepted status and warning issues disagree' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'validation_issues' AND TG_OP = 'UPDATE' THEN
  IF OLD.financial_record_id <> NEW.financial_record_id THEN
    SELECT ingestion_status INTO record_status FROM public.financial_records WHERE id = OLD.financial_record_id;
    SELECT count(*) INTO issue_count FROM public.validation_issues WHERE financial_record_id = OLD.financial_record_id;
    IF record_status = 'WARNING' AND issue_count = 0 THEN
      RAISE EXCEPTION 'Warning record must retain issues' USING ERRCODE = '23514';
    END IF;
  END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER record_warning_consistency AFTER INSERT OR UPDATE ON public.financial_records
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_record_warning_consistency();
CREATE CONSTRAINT TRIGGER issue_warning_consistency AFTER INSERT OR UPDATE OR DELETE ON public.validation_issues
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_record_warning_consistency();
CREATE INDEX ingestion_batches_source_id_idx ON public.ingestion_batches(ingestion_batch_id);
CREATE INDEX financial_records_batch_idx ON public.financial_records(batch_id);
CREATE INDEX financial_records_lineage_idx ON public.financial_records(file_sha256, source_sheet, source_row_number);
CREATE INDEX financial_records_source_row_idx ON public.financial_records(source_row_id);
CREATE INDEX financial_records_date_idx ON public.financial_records(canonical_date);
CREATE INDEX financial_records_source_transaction_idx ON public.financial_records(source_system, source_transaction_id) WHERE source_transaction_id IS NOT NULL;
ALTER TABLE public.ingestion_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validation_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ingestion_batches, public.financial_records, public.validation_issues FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_record_warning_consistency() FROM PUBLIC, anon, authenticated;
COMMENT ON COLUMN public.financial_records.source_row_id IS 'File/sheet/row lineage only; neither persistent identity nor economic uniqueness.';
COMMENT ON COLUMN public.financial_records.source_amount IS 'Exact source representation; no currency conversion or universal cash-flow sign.';
COMMENT ON TABLE public.validation_issues IS 'Ordered CanonicalTransaction.validation_messages; sourceColumn maps to source_column, originalValue to original_value.';
COMMENT ON COLUMN public.ingestion_batches.ingestion_batch_id IS 'Producer context preserved; intentionally nonunique across database persistence attempts.';
COMMIT;
