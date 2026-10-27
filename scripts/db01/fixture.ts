/** Fixed-seed integer PRNG. Monetary literals stay SQL NUMERIC, never JS numbers. */
export const SEED = 20261027;
export const batchId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const recordId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function fixtureSql(size: number): string {
  if (![1000, 10000, 100000].includes(size)) throw new Error('Unsupported fixture size');
  let state = SEED;
  const rows: string[] = [];
  for (let n = 1; n <= size; n++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    rows.push(`(${n},${state % 365})`);
  }
  return `BEGIN;
CREATE TEMP TABLE seed_rows(n integer, day integer) ON COMMIT DROP;
INSERT INTO seed_rows VALUES ${rows.join(',')};
INSERT INTO public.ingestion_batches(id,ingestion_batch_id,source_file,schema_version,ruleset_version,status,created_at,completed_at,rows_received,valid_count,warning_count)
SELECT ('10000000-0000-4000-8000-'||lpad(b::text,12,'0'))::uuid,'synthetic-'||b,'synthetic-'||b||'.csv','0.1','0.1','ACTIVE',
'2026-01-01'::timestamptz + b * interval '1 microsecond','2026-10-01'::timestamptz,count(*)::int,
count(*) FILTER(WHERE n%5<>0)::int,count(*) FILTER(WHERE n%5=0)::int
FROM (SELECT n,1+(n-1)%1000 b FROM seed_rows) x GROUP BY b;
INSERT INTO public.financial_records(id,batch_id,ingestion_batch_id,source_file,transaction_date,posting_date,canonical_date,canonical_date_basis,
source_amount,debit,credit,derived_ledger_net,entry_side,monetary_basis,currency,currency_basis,ingestion_status,source_system,source_row_number,source_row_id,file_sha256,ingested_at)
SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
('10000000-0000-4000-8000-'||lpad((1+(n-1)%1000)::text,12,'0'))::uuid,
'synthetic-'||(1+(n-1)%1000),'synthetic-'||(1+(n-1)%1000)||'.csv',
CASE WHEN n%2=0 THEN '2026-01-01'::date+day END,'2026-01-01'::date+day,'2026-01-01'::date+day,
CASE WHEN n%2=0 THEN 'TRANSACTION_DATE' ELSE 'POSTING_DATE' END,
CASE WHEN n%3<>0 THEN 9007199254740993.123456789::numeric END,
CASE WHEN n%3=0 THEN 9007199254740993.123456789::numeric END,
CASE WHEN n%3=0 THEN 2.000000001::numeric END,
CASE WHEN n%3=0 THEN 9007199254740991.123456788::numeric END,
CASE WHEN n%3=1 THEN 'DEBIT' END,
CASE n%3 WHEN 0 THEN 'debit_credit' WHEN 1 THEN 'source_amount_with_direction' ELSE 'source_signed_amount' END,
CASE n%4 WHEN 0 THEN NULL WHEN 1 THEN 'MYR' WHEN 2 THEN 'USD' ELSE 'SGD' END,
CASE WHEN n%4<>0 THEN 'SOURCE' END,
CASE WHEN n%5=0 THEN 'WARNING' ELSE 'VALID' END,'DB01_SYNTHETIC',n,'synthetic-row-'||n,repeat('a',64),'2026-10-01'::timestamptz FROM seed_rows;
INSERT INTO public.validation_issues(financial_record_id,source_file,issue_ordinal,rule,category,severity,field,original_value,message)
SELECT id,source_file,0,'SYNTHETIC_REVIEW',CASE WHEN source_row_number%10=0 THEN 'technical' ELSE 'business' END,'WARNING','reference','null'::jsonb,'Synthetic review warning'
FROM public.financial_records WHERE ingestion_status='WARNING';
COMMIT; ANALYZE;`;
}
