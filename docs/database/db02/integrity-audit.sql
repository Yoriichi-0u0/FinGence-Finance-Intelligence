-- Read-only DB02 review query. Run only against an explicitly authorized database.
-- Counts are operational integrity evidence, never monetary aggregates.
WITH record_counts AS (
  SELECT batch_id, count(*) FILTER (WHERE ingestion_status='VALID') AS valid,
    count(*) FILTER (WHERE ingestion_status='WARNING') AS warning
  FROM public.financial_records GROUP BY batch_id
), issue_counts AS (
  SELECT financial_record_id, count(*) AS issues FROM public.validation_issues GROUP BY financial_record_id
), child_counts AS (
  SELECT persistence_attempt_id, count(*) AS children FROM public.ingestion_batches
  WHERE persistence_attempt_id IS NOT NULL GROUP BY persistence_attempt_id
)
SELECT 'batch_child_count_mismatch' AS invariant, count(*)::integer AS violations
FROM public.ingestion_batches b LEFT JOIN record_counts r ON r.batch_id=b.id
WHERE b.valid_count<>coalesce(r.valid,0) OR b.warning_count<>coalesce(r.warning,0)
UNION ALL
SELECT 'accepted_warning_mismatch', count(*)::integer FROM public.financial_records r
LEFT JOIN issue_counts i ON i.financial_record_id=r.id
WHERE (r.ingestion_status='VALID' AND coalesce(i.issues,0)<>0)
   OR (r.ingestion_status='WARNING' AND coalesce(i.issues,0)=0)
UNION ALL
SELECT 'attempt_child_count_mismatch', count(*)::integer FROM public.persistence_attempts a
LEFT JOIN child_counts b ON b.persistence_attempt_id=a.id WHERE a.dataset_count<>coalesce(b.children,0)
UNION ALL
SELECT 'record_batch_filename_mismatch', count(*)::integer FROM public.financial_records r
JOIN public.ingestion_batches b ON b.id=r.batch_id
WHERE b.source_file IS NOT NULL AND r.source_file IS DISTINCT FROM b.source_file
UNION ALL
SELECT 'issue_filename_mismatch', count(*)::integer FROM public.validation_issues i
JOIN public.financial_records r ON r.id=i.financial_record_id JOIN public.ingestion_batches b ON b.id=r.batch_id
WHERE (i.source_file IS NOT NULL AND i.source_file IS DISTINCT FROM r.source_file)
   OR (b.source_file IS NOT NULL AND i.source_file IS DISTINCT FROM b.source_file)
UNION ALL
SELECT 'rejected_in_accepted_storage', count(*)::integer FROM public.financial_records WHERE ingestion_status='REJECTED';
