-- PROPOSED READ-ONLY DIAGNOSTIC, NOT EXECUTED OR AUTHORIZED BY ROLE-CREATION APPROVAL.
-- Personal FYP A fhipzomczevbpybezzxu / postgres only.
-- Needs separate approval to use owner for this narrow ACL diagnostic, never as
-- a substitute for the restricted DB01--DB04 catalog inspector.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
WITH schemas AS (
 SELECT n.oid,n.nspname,n.nspowner,n.nspacl
 FROM pg_catalog.pg_namespace n
 WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
), relations AS (
 SELECT c.oid,c.relname,c.relowner,c.relacl,n.nspname
 FROM pg_catalog.pg_class c JOIN schemas n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m','f')
), findings AS (
 SELECT 'PUBLIC_RELATION_PRIVILEGE'::text AS category,r.nspname AS schema_name,
  r.relname::text AS object_name,NULL::text AS column_name,a.privilege_type
 FROM relations r CROSS JOIN LATERAL
  pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
 WHERE a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
 UNION ALL
 SELECT 'PUBLIC_COLUMN_PRIVILEGE',r.nspname,r.relname::text,c.attname::text,a.privilege_type
 FROM relations r JOIN pg_catalog.pg_attribute c ON c.attrelid=r.oid
 CROSS JOIN LATERAL pg_catalog.aclexplode(c.attacl) a
 WHERE c.attnum>0 AND NOT c.attisdropped AND a.grantee=0
  AND a.privilege_type IN ('SELECT','INSERT','UPDATE','REFERENCES')
 UNION ALL
 SELECT 'PUBLIC_SCHEMA_CREATE',n.nspname,n.nspname::text,NULL::text,a.privilege_type
 FROM schemas n CROSS JOIN LATERAL
  pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
 WHERE a.grantee=0 AND a.privilege_type='CREATE'
 UNION ALL
 SELECT 'PUBLIC_ELEVATED_FUNCTION',n.nspname,
  p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',NULL::text,a.privilege_type
 FROM pg_catalog.pg_proc p JOIN schemas n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 WHERE p.prosecdef AND a.grantee=0 AND a.privilege_type='EXECUTE'
  AND p.prorettype NOT IN ('pg_catalog.trigger'::pg_catalog.regtype,'pg_catalog.event_trigger'::pg_catalog.regtype)
  AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) s
   WHERE s.grantee=0 AND s.privilege_type='USAGE')
)
SELECT category,schema_name,object_name,column_name,privilege_type
FROM findings ORDER BY category,schema_name,object_name,column_name,privilege_type;
COMMIT;
