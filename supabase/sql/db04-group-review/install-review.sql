-- REVIEW ONLY: group zmtdozblpvtjniehwjrw / postgres. Owner approval required.
-- Creates DB01/DB02 foundation plus isolated SYNTHETIC DB04; NOT real authentication.
-- One atomic transaction. Operator must verify exact host, TLS and owner before execution.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF current_database()<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole)) THEN
  RAISE EXCEPTION 'INSTALL_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p'))
 OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('fingence_reconciliation','fingence_db04_group_synthetic','fingence_m2','fingence_m3'))
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('fingence_db04_group_runtime','fingence_db04_group_broker','db04_group_test_runtime','db04_group_test_broker'))
 OR to_regprocedure('public.is_safe_source_file(text)') IS NOT NULL
 OR to_regprocedure('public.check_record_warning_consistency()') IS NOT NULL
 OR to_regprocedure('public.enforce_source_file_consistency()') IS NOT NULL
 OR to_regprocedure('public.serialize_warning_issue_mutation()') IS NOT NULL THEN
  RAISE EXCEPTION 'CATALOG_DRIFT_OR_CONFLICT' USING ERRCODE='55000'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))<>3 THEN
  RAISE EXCEPTION 'EXPECTED_SUPABASE_ROLES_MISSING' USING ERRCODE='55000'; END IF;
END $guard$;
-- Reuse: supabase/sql/phase1-clean-setup.sql
CREATE TABLE public.ingestion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file text,
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
  source_file text NOT NULL,
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
  source_file text,
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
-- Reuse: supabase/sql/c3b1-grouped-persistence-upgrade.sql
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
ALTER TABLE public.persistence_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.persistence_attempts FROM PUBLIC, anon, authenticated;
-- Reuse: supabase/sql/db02-001-warning-mutation-fence.sql
CREATE FUNCTION public.serialize_warning_issue_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE affected uuid[]; record_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN affected := ARRAY[NEW.financial_record_id];
  ELSIF TG_OP = 'DELETE' THEN affected := ARRAY[OLD.financial_record_id];
  ELSE affected := ARRAY[OLD.financial_record_id, NEW.financial_record_id]; END IF;
  FOR record_id IN SELECT DISTINCT x FROM unnest(affected) AS ids(x) ORDER BY x LOOP
    UPDATE public.financial_records SET ingestion_status = ingestion_status WHERE id = record_id;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER issue_00_warning_mutation_fence BEFORE INSERT OR UPDATE OR DELETE
ON public.validation_issues FOR EACH ROW EXECUTE FUNCTION public.serialize_warning_issue_mutation();
REVOKE ALL ON FUNCTION public.serialize_warning_issue_mutation() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.serialize_warning_issue_mutation() IS
  'Serializes warning evidence changes with record status changes; identical-value parent UPDATE prevents stale-snapshot write skew.';
CREATE ROLE fingence_db04_group_broker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA fingence_db04_group_synthetic;

REVOKE ALL ON SCHEMA fingence_db04_group_synthetic,fingence_db04_group_synthetic FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fingence_db04_group_synthetic.organizations(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE fingence_db04_group_synthetic.users(
 id uuid PRIMARY KEY,issuer text NOT NULL CHECK(issuer='urn:fingence:db04:group-synthetic:1'),
 subject uuid NOT NULL,suspended boolean NOT NULL DEFAULT false,UNIQUE(issuer,subject));
CREATE TABLE fingence_db04_group_synthetic.memberships(
 user_id uuid REFERENCES fingence_db04_group_synthetic.users,organization_id uuid REFERENCES fingence_db04_group_synthetic.organizations,
 role text NOT NULL CHECK(role IN ('Finance','Technical (Management)','Admin')),
 active boolean NOT NULL DEFAULT true,version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(user_id,organization_id));
CREATE TABLE fingence_db04_group_synthetic.organization_states(
 organization_id uuid PRIMARY KEY REFERENCES fingence_db04_group_synthetic.organizations,active boolean NOT NULL);
CREATE TABLE fingence_db04_group_synthetic.sessions(
 id uuid NOT NULL UNIQUE,token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL,organization_id uuid NOT NULL,upstream_session_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,
 membership_version integer NOT NULL,contract_version text NOT NULL CHECK(contract_version='group-synthetic-admission/1'),
 FOREIGN KEY(user_id,organization_id) REFERENCES fingence_db04_group_synthetic.memberships,
 UNIQUE(id,user_id,organization_id));
ALTER TABLE fingence_db04_group_synthetic.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_db04_group_synthetic.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_db04_group_synthetic.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_db04_group_synthetic.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_db04_group_synthetic.organization_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_db04_group_synthetic,fingence_db04_group_synthetic FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fingence_db04_group_synthetic.membership_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM id FROM fingence_db04_group_synthetic.users WHERE id=NEW.user_id FOR UPDATE;
 ELSIF TG_OP='DELETE' THEN
  PERFORM id FROM fingence_db04_group_synthetic.users WHERE id=OLD.user_id FOR UPDATE;
 ELSE
  PERFORM id FROM fingence_db04_group_synthetic.users WHERE id IN (OLD.user_id,NEW.user_id) ORDER BY id FOR UPDATE;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.active IS DISTINCT FROM OLD.active THEN NEW.version=OLD.version+1;
  ELSIF NEW.version<OLD.version THEN RAISE EXCEPTION 'membership version cannot decrease' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION fingence_db04_group_synthetic.membership_lifecycle() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER membership_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON fingence_db04_group_synthetic.memberships
 FOR EACH ROW EXECUTE FUNCTION fingence_db04_group_synthetic.membership_lifecycle();

CREATE FUNCTION fingence_db04_group_synthetic.issue_hosted_grant(hash text,lease_id uuid,iss text,sub uuid,sid uuid,deadline timestamptz)
RETURNS TABLE(user_id uuid,organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u record;m record;
BEGIN
 IF iss<>'urn:fingence:db04:group-synthetic:1'
  OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '30 seconds'
  OR hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM fingence_db04_group_synthetic.users x WHERE x.issuer=iss AND x.subject=sub AND NOT x.suspended FOR SHARE;
 IF u.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM fingence_db04_group_synthetic.memberships x JOIN fingence_db04_group_synthetic.organization_states o USING(organization_id)
  WHERE x.user_id=u.id AND x.role='Finance' AND x.active AND o.active)<>1 THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT x.* INTO m FROM fingence_db04_group_synthetic.memberships x JOIN fingence_db04_group_synthetic.organization_states o USING(organization_id)
  WHERE x.user_id=u.id AND x.role='Finance' AND x.active AND o.active FOR SHARE OF x,o;
 IF m.user_id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO fingence_db04_group_synthetic.sessions VALUES(lease_id,hash,u.id,m.organization_id,sid,deadline,false,m.version,'group-synthetic-admission/1');
 RETURN QUERY SELECT u.id::uuid,m.organization_id::uuid;
END $$;
CREATE FUNCTION fingence_db04_group_synthetic.revoke_hosted_grant(hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE fingence_db04_group_synthetic.sessions SET revoked=true WHERE token_hash=hash;
$$;
REVOKE ALL ON FUNCTION fingence_db04_group_synthetic.issue_hosted_grant(text,uuid,text,uuid,uuid,timestamptz),fingence_db04_group_synthetic.revoke_hosted_grant(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA fingence_db04_group_synthetic TO fingence_db04_group_broker;
GRANT EXECUTE ON FUNCTION fingence_db04_group_synthetic.issue_hosted_grant(text,uuid,text,uuid,uuid,timestamptz),fingence_db04_group_synthetic.revoke_hosted_grant(text) TO fingence_db04_group_broker;



CREATE SCHEMA fingence_reconciliation;
REVOKE ALL ON SCHEMA fingence_reconciliation FROM PUBLIC;
CREATE TABLE fingence_reconciliation.documents (
 organization_id uuid NOT NULL REFERENCES fingence_db04_group_synthetic.organizations,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK (kind IN ('BANK','LEDGER')),
 classification_method text NOT NULL CHECK (classification_method='REGISTERED_SYNTHETIC_EXACT_SCHEMA'),
 classification_version text NOT NULL CHECK (classification_version='cash-source-v1'),
 original_name text NOT NULL,
 byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 512000),
 PRIMARY KEY(organization_id,sha256), UNIQUE(organization_id,sha256,kind)
);
CREATE TABLE fingence_reconciliation.jobs (
 organization_id uuid NOT NULL REFERENCES fingence_db04_group_synthetic.organizations,
 processing_id text NOT NULL CHECK (processing_id ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES fingence_db04_group_synthetic.users,
 pipeline_version text NOT NULL,
 policy jsonb NOT NULL CHECK (jsonb_typeof(policy)='object'),
 status text NOT NULL CHECK (status IN ('COMPLETED','COMPLETED_WITH_EXCEPTIONS')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,processing_id),
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_db04_group_synthetic.memberships(user_id,organization_id)
);
CREATE TABLE fingence_reconciliation.job_sources (
 organization_id uuid NOT NULL, processing_id text NOT NULL, sha256 text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('BANK','LEDGER')),
 PRIMARY KEY(organization_id,processing_id,kind),
 UNIQUE(organization_id,processing_id,sha256,kind),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(organization_id,sha256,kind) REFERENCES fingence_reconciliation.documents(organization_id,sha256,kind)
);
CREATE TABLE fingence_reconciliation.transactions (
 organization_id uuid NOT NULL, processing_id text NOT NULL, sha256 text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('BANK','LEDGER')),
 record_id text NOT NULL CHECK (length(record_id)>0),
 source_row integer NOT NULL CHECK (source_row>=2),
 status text NOT NULL CHECK (status IN ('VALID','WARNING')),
 canonical_date date NOT NULL, transaction_date date, value_date date, posting_date date,
 date_basis text NOT NULL CHECK (date_basis IN ('VALUE_DATE','POSTING_DATE')),
 currency text NOT NULL CHECK (currency='MYR'),
 signed_amount numeric NOT NULL CHECK (signed_amount::text NOT IN ('NaN','Infinity','-Infinity')),
 original_amount text NOT NULL CHECK (original_amount ~ '^-?[0-9]{1,16}(\.[0-9]{1,2})?$' AND original_amount::numeric=signed_amount),
 reference text NOT NULL,
 evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
 PRIMARY KEY(organization_id,processing_id,kind,record_id),
 UNIQUE(organization_id,processing_id,kind,source_row),
 FOREIGN KEY(organization_id,processing_id,sha256,kind) REFERENCES fingence_reconciliation.job_sources(organization_id,processing_id,sha256,kind),
 CHECK (transaction_date IS NULL),
 CHECK ((kind='BANK' AND date_basis='VALUE_DATE' AND value_date IS NOT NULL AND canonical_date=value_date AND posting_date IS NULL)
 OR (kind='LEDGER' AND date_basis='POSTING_DATE' AND posting_date IS NOT NULL AND canonical_date=posting_date AND value_date IS NULL))
);
CREATE TABLE fingence_reconciliation.proposals (
 organization_id uuid NOT NULL, processing_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal>=0),
 bank_kind text NOT NULL DEFAULT 'BANK' CHECK (bank_kind='BANK'),
 ledger_kind text NOT NULL DEFAULT 'LEDGER' CHECK (ledger_kind='LEDGER'),
 bank_record_id text NOT NULL, ledger_record_id text NOT NULL,
 algorithm_version text NOT NULL CHECK (algorithm_version='cash-rules-v1'),
 proposal_type text NOT NULL CHECK (proposal_type='ONE_TO_ONE'),
 PRIMARY KEY(organization_id,processing_id,ordinal),
 UNIQUE(organization_id,processing_id,bank_record_id,ledger_record_id),
 FOREIGN KEY(organization_id,processing_id,bank_kind,bank_record_id) REFERENCES fingence_reconciliation.transactions(organization_id,processing_id,kind,record_id),
 FOREIGN KEY(organization_id,processing_id,ledger_kind,ledger_record_id) REFERENCES fingence_reconciliation.transactions(organization_id,processing_id,kind,record_id)
);
CREATE TABLE fingence_reconciliation.decisions (
 organization_id uuid NOT NULL, processing_id text NOT NULL, ordinal integer NOT NULL,
 policy_version text NOT NULL,
 decision text NOT NULL CHECK (decision IN ('VERIFIED_SUGGESTION','UNRESOLVED')),
 checks jsonb NOT NULL CHECK (jsonb_typeof(checks)='object'),
 CHECK(decision<>'VERIFIED_SUGGESTION' OR checks @> '{"SOURCE_IDENTITY":true,"SCOPE":true,"EXACT_AMOUNT":true,"CURRENCY":true,"DIRECTION":true,"CANONICAL_DATE_POLICY":true,"REFERENCE":true,"COUNTERPARTY":true,"UNIQUE_IDENTITY":true}'::jsonb),
 PRIMARY KEY(organization_id,processing_id,ordinal),
 FOREIGN KEY(organization_id,processing_id,ordinal) REFERENCES fingence_reconciliation.proposals
);
CREATE TABLE fingence_reconciliation.cases (
 organization_id uuid NOT NULL, processing_id text NOT NULL, ordinal integer NOT NULL,
 reason text NOT NULL, evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
 PRIMARY KEY(organization_id,processing_id,ordinal),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs
);
CREATE TABLE fingence_reconciliation.reviews (
 organization_id uuid NOT NULL, processing_id text NOT NULL, case_ordinal integer NOT NULL,
 version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('OPEN','INVESTIGATING','EXPLAINED','ESCALATED')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 600),
 actor_id uuid NOT NULL REFERENCES fingence_db04_group_synthetic.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,processing_id,case_ordinal,version),
 FOREIGN KEY(organization_id,processing_id,case_ordinal) REFERENCES fingence_reconciliation.cases,
 FOREIGN KEY(actor_id,organization_id) REFERENCES fingence_db04_group_synthetic.memberships(user_id,organization_id)
);
CREATE TABLE fingence_reconciliation.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES fingence_db04_group_synthetic.organizations,
 processing_id text NOT NULL, actor_id uuid NOT NULL REFERENCES fingence_db04_group_synthetic.users,
 action text NOT NULL CHECK(action IN ('PERSISTED','READ','REUSED','REVIEWED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(actor_id,organization_id) REFERENCES fingence_db04_group_synthetic.memberships(user_id,organization_id)
);
CREATE INDEX reconciliation_jobs_created ON fingence_reconciliation.jobs(organization_id,created_at);
CREATE INDEX reconciliation_audit_processing ON fingence_reconciliation.audit(organization_id,processing_id,id);



CREATE ROLE fingence_db04_group_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE FUNCTION fingence_reconciliation.principal()
RETURNS TABLE(user_id uuid, organization_id uuid)
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT s.user_id,s.organization_id FROM fingence_db04_group_synthetic.sessions s
 JOIN fingence_db04_group_synthetic.memberships m USING(user_id,organization_id)
 JOIN fingence_db04_group_synthetic.organization_states o USING(organization_id)
 WHERE s.token_hash=current_setting('fingence.reconciliation_token_hash',true)
 AND NOT s.revoked AND s.expires_at>clock_timestamp() AND m.active AND o.active
 AND m.role='Finance' AND m.version=s.membership_version
 FOR SHARE OF s,m,o
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.principal() FROM PUBLIC;
CREATE FUNCTION fingence_reconciliation.authorized_organization() RETURNS uuid
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT organization_id FROM fingence_reconciliation.principal()
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.authorized_organization() FROM PUBLIC;
CREATE FUNCTION fingence_reconciliation.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'immutable reconciliation evidence' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION fingence_reconciliation.immutable() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['documents','jobs','job_sources','transactions','proposals','decisions','cases','reviews','audit'] LOOP
  EXECUTE format('ALTER TABLE fingence_reconciliation.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE fingence_reconciliation.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY organization_scope ON fingence_reconciliation.%I USING (organization_id=fingence_reconciliation.authorized_organization()) WITH CHECK (organization_id=fingence_reconciliation.authorized_organization())',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.%I FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable()',t);
 END LOOP;
END $$;
CREATE POLICY actor_binding ON fingence_reconciliation.jobs AS RESTRICTIVE FOR INSERT
 WITH CHECK (created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE POLICY actor_binding ON fingence_reconciliation.reviews AS RESTRICTIVE FOR INSERT
 WITH CHECK (actor_id=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE POLICY actor_binding ON fingence_reconciliation.audit AS RESTRICTIVE FOR INSERT
 WITH CHECK (actor_id=(SELECT user_id FROM fingence_reconciliation.principal()));
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_reconciliation FROM PUBLIC;
GRANT USAGE ON SCHEMA fingence_reconciliation TO fingence_db04_group_runtime;
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA fingence_reconciliation TO fingence_db04_group_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA fingence_reconciliation TO fingence_db04_group_runtime;
GRANT EXECUTE ON FUNCTION fingence_reconciliation.principal(),fingence_reconciliation.authorized_organization() TO fingence_db04_group_runtime;



CREATE TABLE fingence_reconciliation.rankings (
 organization_id uuid NOT NULL, processing_id text NOT NULL,
 version text NOT NULL CHECK(version IN ('db04-fuzzy-proposals/1','db04-e5-proposals/1')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
 PRIMARY KEY(organization_id,processing_id,version),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_db04_group_synthetic.memberships(user_id,organization_id)
);
ALTER TABLE fingence_reconciliation.rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_reconciliation.rankings FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_scope ON fingence_reconciliation.rankings
 USING(organization_id=fingence_reconciliation.authorized_organization())
 WITH CHECK(organization_id=fingence_reconciliation.authorized_organization());
CREATE POLICY actor_binding ON fingence_reconciliation.rankings AS RESTRICTIVE FOR INSERT
 WITH CHECK(created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.rankings
 FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable();
REVOKE ALL ON fingence_reconciliation.rankings FROM PUBLIC;
GRANT SELECT,INSERT ON fingence_reconciliation.rankings TO fingence_db04_group_runtime;



CREATE TABLE fingence_reconciliation.proposal_verifications (
 organization_id uuid NOT NULL,processing_id text NOT NULL,
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 policy_version text NOT NULL CHECK(policy_version='db04-independent-proposals/1'),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 outcome text NOT NULL CHECK(outcome='UNRESOLVED'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
 CHECK(jsonb_array_length(jsonb_path_query_array(evidence,'$[*] ? (@.outcome == "UNRESOLVED")'))=jsonb_array_length(evidence)),
 PRIMARY KEY(organization_id,processing_id,snapshot_sha256,policy_version),
 FOREIGN KEY(organization_id,processing_id) REFERENCES fingence_reconciliation.jobs,
 FOREIGN KEY(created_by,organization_id) REFERENCES fingence_db04_group_synthetic.memberships(user_id,organization_id)
);
ALTER TABLE fingence_reconciliation.proposal_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE fingence_reconciliation.proposal_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_scope ON fingence_reconciliation.proposal_verifications
 USING(organization_id=fingence_reconciliation.authorized_organization())
 WITH CHECK(organization_id=fingence_reconciliation.authorized_organization());
CREATE POLICY actor_binding ON fingence_reconciliation.proposal_verifications AS RESTRICTIVE FOR INSERT
 WITH CHECK(created_by=(SELECT user_id FROM fingence_reconciliation.principal()));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fingence_reconciliation.proposal_verifications
 FOR EACH ROW EXECUTE FUNCTION fingence_reconciliation.immutable();
REVOKE ALL ON fingence_reconciliation.proposal_verifications FROM PUBLIC;
GRANT SELECT,INSERT ON fingence_reconciliation.proposal_verifications TO fingence_db04_group_runtime;



CREATE OR REPLACE FUNCTION fingence_reconciliation.principal()
RETURNS TABLE(user_id uuid,organization_id uuid)
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT s.user_id,s.organization_id FROM fingence_db04_group_synthetic.sessions s
 JOIN fingence_db04_group_synthetic.users u ON u.id=s.user_id
 JOIN fingence_db04_group_synthetic.memberships m USING(user_id,organization_id)
 JOIN fingence_db04_group_synthetic.organization_states o USING(organization_id)
 WHERE s.token_hash=current_setting('fingence.reconciliation_token_hash',true)
 AND NOT s.revoked AND s.expires_at>clock_timestamp() AND m.active AND o.active AND NOT u.suspended
 AND s.contract_version='group-synthetic-admission/1'
 AND u.issuer='urn:fingence:db04:group-synthetic:1'
 AND m.role='Finance' AND m.version=s.membership_version
 FOR SHARE OF s,u,m,o
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.principal() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION fingence_reconciliation.principal() TO fingence_db04_group_runtime;
CREATE FUNCTION fingence_reconciliation.current_grant_id() RETURNS uuid
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$
 SELECT s.id FROM fingence_db04_group_synthetic.sessions s
 JOIN fingence_reconciliation.principal() p USING(user_id,organization_id)
 WHERE s.token_hash=current_setting('fingence.reconciliation_token_hash',true)
$$;
REVOKE ALL ON FUNCTION fingence_reconciliation.current_grant_id() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION fingence_reconciliation.current_grant_id() TO fingence_db04_group_runtime;
ALTER TABLE fingence_reconciliation.audit ADD COLUMN session_grant_id uuid NOT NULL
 DEFAULT fingence_reconciliation.current_grant_id();
ALTER TABLE fingence_reconciliation.audit ADD CONSTRAINT audit_hosted_grant_identity
 FOREIGN KEY(session_grant_id,actor_id,organization_id) REFERENCES fingence_db04_group_synthetic.sessions(id,user_id,organization_id);
REVOKE ALL ON SCHEMA fingence_reconciliation FROM anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA fingence_reconciliation FROM anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fingence_reconciliation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fingence_reconciliation FROM PUBLIC,anon,authenticated,service_role;
-- Only newly created objects are changed. Default privileges and existing objects are untouched.
ALTER TABLE public.financial_records VALIDATE CONSTRAINT financial_records_source_file_safe;
REVOKE ALL ON public.ingestion_batches,public.financial_records,public.validation_issues,public.persistence_attempts FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.check_record_warning_consistency(),public.is_safe_source_file(text),public.enforce_source_file_consistency(),public.serialize_warning_issue_mutation() FROM PUBLIC,anon,authenticated,service_role;
DO $seal$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ingestion_batches','financial_records','validation_issues','persistence_attempts'] LOOP
  IF EXISTS(SELECT 1 FROM aclexplode(COALESCE((SELECT relacl FROM pg_class WHERE oid=to_regclass('public.'||t)),acldefault('r',(SELECT relowner FROM pg_class WHERE oid=to_regclass('public.'||t))))) a
    WHERE a.grantee<>(SELECT relowner FROM pg_class WHERE oid=to_regclass('public.'||t))) THEN
   RAISE EXCEPTION 'UNEXPECTED_NEW_FOUNDATION_GRANT' USING ERRCODE='42501'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
  WHERE n.nspname IN ('fingence_db04_group_synthetic','fingence_reconciliation') AND c.relkind IN ('r','S') AND a.grantee<>c.relowner
  AND NOT(n.nspname='fingence_reconciliation' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='fingence_db04_group_runtime')
    AND a.privilege_type IN ('SELECT','INSERT','USAGE'))) THEN
  RAISE EXCEPTION 'UNEXPECTED_NEW_DB04_GRANT' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE (n.nspname IN ('fingence_db04_group_synthetic','fingence_reconciliation') OR n.nspname='public' AND p.proname IN ('check_record_warning_consistency','is_safe_source_file','enforce_source_file_consistency','serialize_warning_issue_mutation'))
  AND a.grantee<>p.proowner AND NOT(
    n.nspname='fingence_reconciliation' AND p.proname IN ('principal','authorized_organization','current_grant_id') AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='fingence_db04_group_runtime')
    OR n.nspname='fingence_db04_group_synthetic' AND p.proname IN ('issue_hosted_grant','revoke_hosted_grant') AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='fingence_db04_group_broker'))) THEN
  RAISE EXCEPTION 'UNEXPECTED_NEW_FUNCTION_GRANT' USING ERRCODE='42501'; END IF;
END $seal$;
COMMIT;
