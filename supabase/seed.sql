-- SYNTHETIC ONLY. Run explicitly against a personal development database.
BEGIN;
INSERT INTO public.ingestion_batches (id, ingestion_batch_id, schema_version, ruleset_version, status, rows_received, valid_count, warning_count)
VALUES ('10000000-0000-4000-8000-000000000001','synthetic-db-batch-001','0.1','0.1','ACTIVE',2,1,1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.financial_records (id,batch_id,ingestion_batch_id,transaction_date,posting_date,canonical_date,canonical_date_basis,
 reference,source_transaction_id,account_code,account_id,entity_id,description,source_amount,balance,monetary_basis,currency,currency_basis,
 ingestion_status,source_system,source_file,source_row_number,source_row_id,file_sha256,ingested_at)
VALUES
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-db-batch-001','2026-09-01','2026-09-03','2026-09-03','POSTING_DATE',
 '00017','00042','00100','00008','00009','Synthetic exact decimal','-9007199254740993.1','123.4567890123456789','source_signed_amount','MYR','SOURCE',
 'VALID','Synthetic','synthetic-db.csv',2,repeat('a',64)||':0:2',repeat('a',64),'2026-10-02T00:00:00.000Z'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','synthetic-db-batch-001','2026-09-04',NULL,'2026-09-04','TRANSACTION_DATE',
 NULL,'00043','00100','00008','00009','Synthetic missing reference','0.1234567890123456789',NULL,'source_signed_amount','MYR','SOURCE',
 'WARNING','Synthetic','synthetic-db.csv',3,repeat('a',64)||':0:3',repeat('a',64),'2026-10-02T00:00:00.000Z')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.validation_issues (id,financial_record_id,issue_ordinal,rule,category,severity,field,source_column,original_value,message)
VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',0,'MISSING_REFERENCE','business','WARNING','reference','reference','null'::jsonb,'Reference is missing.')
ON CONFLICT (id) DO NOTHING;
COMMIT;
