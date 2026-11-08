-- Requires migration and synthetic seed. All test writes are rolled back.
BEGIN;
DO $$
DECLARE r public.financial_records; n integer; t text;
BEGIN
 SELECT * INTO STRICT r FROM public.financial_records WHERE id='20000000-0000-4000-8000-000000000001';
 IF r.source_amount <> '-9007199254740993.1'::numeric OR r.balance <> '123.4567890123456789'::numeric THEN RAISE EXCEPTION 'Exact decimal storage failed'; END IF;
 IF r.reference <> '00017' OR r.source_transaction_id <> '00042' OR r.account_code <> '00100' OR r.account_id <> '00008' OR r.entity_id <> '00009' THEN RAISE EXCEPTION 'Leading zeros lost'; END IF;
 IF r.transaction_date <> DATE '2026-09-01' OR r.posting_date <> DATE '2026-09-03' OR r.canonical_date <> r.posting_date THEN RAISE EXCEPTION 'Dates lost'; END IF;
 IF r.source_sheet IS NOT NULL OR r.source_row_id <> repeat('a',64)||':0:2' OR r.ingested_at <> TIMESTAMPTZ '2026-10-02T00:00:00Z' THEN RAISE EXCEPTION 'Lineage lost'; END IF;
 SELECT count(*) INTO n FROM public.financial_records f JOIN public.ingestion_batches b ON (b.id,b.ingestion_batch_id)=(f.batch_id,f.ingestion_batch_id) WHERE b.id='10000000-0000-4000-8000-000000000001';
 IF n <> 2 THEN RAISE EXCEPTION 'Batch relationship failed'; END IF;
 SELECT count(*) INTO n FROM public.validation_issues v JOIN public.financial_records f ON f.id=v.financial_record_id WHERE f.id='20000000-0000-4000-8000-000000000002' AND f.ingestion_status='WARNING' AND v.rule='MISSING_REFERENCE' AND v.original_value='null'::jsonb;
 IF n <> 1 THEN RAISE EXCEPTION 'Warning relationship failed'; END IF;
 FOR t IN SELECT unnest(ARRAY['ingestion_batches','financial_records','validation_issues']) LOOP
   IF NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND c.relname=t AND c.relrowsecurity) THEN RAISE EXCEPTION 'RLS missing on %',t; END IF;
   IF EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename=t) THEN RAISE EXCEPTION 'Unexpected policy on %',t; END IF;
   IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='id' AND data_type='uuid') THEN RAISE EXCEPTION 'UUID missing'; END IF;
   IF has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Client privilege found'; END IF;
 END LOOP;
 SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema='public' AND table_name='financial_records' AND column_name IN ('debit','credit','source_amount','derived_ledger_net','balance') AND data_type='numeric' AND numeric_precision IS NULL;
 IF n <> 5 THEN RAISE EXCEPTION 'Monetary types incorrect'; END IF;
END $$;
DO $$ BEGIN
 BEGIN UPDATE public.financial_records SET ingestion_status='REJECTED' WHERE id='20000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'REJECTED accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.financial_records SET canonical_date='2026-09-02' WHERE id='20000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'Date fallback accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.financial_records SET ingestion_batch_id='wrong' WHERE id='20000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'Mismatched batch accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN UPDATE public.financial_records SET source_amount='NaN' WHERE id='20000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'NaN accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.ingestion_batches SET status='UNKNOWN' WHERE id='10000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'Invalid lifecycle accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.ingestion_batches SET rows_received=3 WHERE id='10000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'Bad counts accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.validation_issues SET original_value='{"value":"1"}' WHERE id='30000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'Malformed evidence accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.validation_issues SET severity='REJECTED' WHERE id='30000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'Rejected issue accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM public.ingestion_batches WHERE id='10000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'History deleted'; EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN NULL; END;
 BEGIN
   DELETE FROM public.validation_issues WHERE id='30000000-0000-4000-8000-000000000001';
   SET CONSTRAINTS ALL IMMEDIATE;
   RAISE EXCEPTION 'Warning metadata lost';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE public.financial_records SET ingestion_status='WARNING' WHERE id='20000000-0000-4000-8000-000000000001';
   SET CONSTRAINTS ALL IMMEDIATE;
   RAISE EXCEPTION 'Warning without issue accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- Confirm JSON evidence representations retain their original type.
UPDATE public.validation_issues SET original_value='{"kind":"excel_number","value":"0001.25"}' WHERE id='30000000-0000-4000-8000-000000000001';
UPDATE public.validation_issues SET original_value='false' WHERE id='30000000-0000-4000-8000-000000000001';
UPDATE public.validation_issues SET original_value='"00017"' WHERE id='30000000-0000-4000-8000-000000000001';
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
