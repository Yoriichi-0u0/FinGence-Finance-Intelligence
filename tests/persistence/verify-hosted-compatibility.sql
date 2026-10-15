-- READ ONLY: application schema metadata only; no financial rows or secrets.
WITH app_tables AS (
  SELECT c.oid, c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname IN ('ingestion_batches', 'financial_records', 'validation_issues')
), columns AS (
  SELECT t.relname, a.attname, a.attnum,
    format_type(a.atttypid, a.atttypmod) AS type_name,
    a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS default_expression
  FROM app_tables t JOIN pg_attribute a ON a.attrelid = t.oid
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
), constraints AS (
  SELECT t.relname, c.conname, pg_get_constraintdef(c.oid, true) AS definition
  -- PG18 catalogs NOT NULL as constraints; nullability is already compared in columns.
  FROM app_tables t JOIN pg_constraint c ON c.conrelid = t.oid WHERE c.contype <> 'n'
), indexes AS (
  SELECT t.relname, c.relname AS index_name, pg_get_indexdef(i.indexrelid) AS definition
  FROM app_tables t JOIN pg_index i ON i.indrelid = t.oid JOIN pg_class c ON c.oid = i.indexrelid
), triggers AS (
  SELECT t.relname, tr.tgname, pg_get_triggerdef(tr.oid, true) AS definition
  FROM app_tables t JOIN pg_trigger tr ON tr.tgrelid = t.oid WHERE NOT tr.tgisinternal
)
SELECT
  (SELECT count(*)::integer FROM app_tables) AS table_count,
  (SELECT count(*)::integer FROM columns) AS column_count,
  (SELECT count(*)::integer FROM columns WHERE attname = 'source_file') AS source_file_column_count,
  (SELECT count(*)::integer FROM indexes) AS index_count,
  (SELECT count(*)::integer FROM triggers) AS trigger_count,
  (SELECT bool_and(relrowsecurity) FROM app_tables) AS rls_enabled,
  (SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('ingestion_batches', 'financial_records', 'validation_issues')) AS policy_count,
  NOT EXISTS (SELECT 1 FROM app_tables t CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role_name)
    WHERE has_table_privilege(r.role_name, t.oid, 'SELECT') OR has_table_privilege(r.role_name, t.oid, 'INSERT')
      OR has_table_privilege(r.role_name, t.oid, 'UPDATE') OR has_table_privilege(r.role_name, t.oid, 'DELETE')) AS client_privileges_denied,
  (SELECT md5(string_agg(relname || '|' || attname || '|' || type_name || '|' || attnotnull::text || '|' || default_expression, E'\n' ORDER BY relname, attnum)) FROM columns) AS columns_md5,
  -- Compare storage semantics independently of intentional physical column order.
  (SELECT md5(string_agg(relname || '|' || attname || '|' || type_name || '|' || attnotnull::text || '|' || default_expression, E'\n' ORDER BY relname, attname)) FROM columns) AS column_semantics_md5,
  (SELECT md5(string_agg(relname || '|' || conname || '|' || definition, E'\n' ORDER BY relname, conname)) FROM constraints) AS constraints_md5,
  (SELECT md5(string_agg(relname || '|' || index_name || '|' || definition, E'\n' ORDER BY relname, index_name)) FROM indexes) AS indexes_md5,
  (SELECT md5(string_agg(relname || '|' || tgname || '|' || definition, E'\n' ORDER BY relname, tgname)) FROM triggers) AS triggers_md5,
  -- Formatting-only comparison; the function source is also reviewed when hashes differ.
  md5(regexp_replace(pg_get_functiondef('public.check_record_warning_consistency()'::regprocedure), '[[:space:]]+', ' ', 'g')) AS warning_function_md5;
