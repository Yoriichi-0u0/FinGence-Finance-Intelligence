// Produces review artifacts only. Never opens a database connection.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const source='901109b9057bfeb927367955bdc69d2e346a09e4';
const original=execFileSync('git',['show',`${source}:supabase/sql/db04-development/install-review.sql`],{encoding:'utf8'}).replaceAll('\r\n','\n');
const seed=execFileSync('git',['show',`${source}:supabase/sql/db04-development/synthetic-seed-review.sql`],{encoding:'utf8'}).replaceAll('\r\n','\n');
const sha=b=>createHash('sha256').update(b).digest('hex');
const names={identity:'fingence_db04_group_synthetic',runtime:'fingence_db04_group_runtime',broker:'fingence_db04_group_broker'};
const remap=text=>text.replaceAll('fingence_db04_dev_identity',names.identity).replaceAll('fingence_db04_dev_broker',names.broker)
 .replaceAll('fingence_reconciliation_runtime',names.runtime).replaceAll('db04_dev_runtime','db04_group_test_runtime').replaceAll('db04_dev_broker_login','db04_group_test_broker')
 .replaceAll('https://fhipzomczevbpybezzxu.supabase.co/auth/v1','urn:fingence:db04:group-synthetic:1').replaceAll('hosted-finance-admission/1','group-synthetic-admission/1')
 .replace(/CREATE FUNCTION fingence_reconciliation\.authorized_organization\(\) RETURNS uuid[\s\S]*?END \$\$;/,
  ()=>'CREATE FUNCTION fingence_reconciliation.authorized_organization() RETURNS uuid\nLANGUAGE sql SECURITY DEFINER VOLATILE SET search_path=pg_catalog AS $$\n SELECT organization_id FROM fingence_reconciliation.principal()\n$$;');
const body=text=>text.split('\n').filter(l=>!/^\s*--/.test(l)&&!/^\s*(BEGIN;|COMMIT;)\s*$/.test(l)).join('\n').trim();
const foundations=['phase1-clean-setup.sql','c3b1-grouped-persistence-upgrade.sql','db02-001-warning-mutation-fence.sql'];
const inputs=foundations.map(file=>({file:`supabase/sql/${file}`,text:readFileSync(`supabase/sql/${file}`,'utf8').replaceAll('\r\n','\n')}));
const guard=`DO $guard$ BEGIN
 IF current_database()<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole)) THEN
  RAISE EXCEPTION 'INSTALL_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p'))
 OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('fingence_reconciliation','${names.identity}','fingence_m2','fingence_m3'))
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('${names.runtime}','${names.broker}','db04_group_test_runtime','db04_group_test_broker'))
 OR to_regprocedure('public.is_safe_source_file(text)') IS NOT NULL
 OR to_regprocedure('public.check_record_warning_consistency()') IS NOT NULL
 OR to_regprocedure('public.enforce_source_file_consistency()') IS NOT NULL
 OR to_regprocedure('public.serialize_warning_issue_mutation()') IS NOT NULL THEN
  RAISE EXCEPTION 'CATALOG_DRIFT_OR_CONFLICT' USING ERRCODE='55000'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))<>3 THEN
  RAISE EXCEPTION 'EXPECTED_SUPABASE_ROLES_MISSING' USING ERRCODE='55000'; END IF;
END $guard$;`;
const seal=`-- Only newly created objects are changed. Default privileges and existing objects are untouched.
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
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::\"char\" ELSE 'r'::\"char\" END,c.relowner))) a
  WHERE n.nspname IN ('${names.identity}','fingence_reconciliation') AND c.relkind IN ('r','S') AND a.grantee<>c.relowner
  AND NOT(n.nspname='fingence_reconciliation' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='${names.runtime}')
    AND a.privilege_type IN ('SELECT','INSERT','USAGE'))) THEN
  RAISE EXCEPTION 'UNEXPECTED_NEW_DB04_GRANT' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE (n.nspname IN ('${names.identity}','fingence_reconciliation') OR n.nspname='public' AND p.proname IN ('check_record_warning_consistency','is_safe_source_file','enforce_source_file_consistency','serialize_warning_issue_mutation'))
  AND a.grantee<>p.proowner AND NOT(
    n.nspname='fingence_reconciliation' AND p.proname IN ('principal','authorized_organization','current_grant_id') AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='${names.runtime}')
    OR n.nspname='${names.identity}' AND p.proname IN ('issue_hosted_grant','revoke_hosted_grant') AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='${names.broker}'))) THEN
  RAISE EXCEPTION 'UNEXPECTED_NEW_FUNCTION_GRANT' USING ERRCODE='42501'; END IF;
END $seal$;`;
const install=`-- REVIEW ONLY: group zmtdozblpvtjniehwjrw / postgres. Owner approval required.
-- Creates DB01/DB02 foundation plus isolated SYNTHETIC DB04; NOT real authentication.
-- One atomic transaction. Operator must verify exact host, TLS and owner before execution.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
${guard}
${inputs.map(i=>`-- Reuse: ${i.file}\n${body(i.text)}`).join('\n')}
${body(remap(original))}
${seal}
COMMIT;
`;
const syntheticSeed=`-- REVIEW ONLY: synthetic fixtures and disabled test logins, not Production users.
-- Separate approval and private password/LOGIN provisioning required before hosted testing.
BEGIN;
${body(remap(seed)).replaceAll(' LOGIN NOSUPERUSER',' NOLOGIN NOSUPERUSER')}
COMMIT;
`;
const activate=`-- REVIEW ONLY: execute AFTER separately approved masked password provisioning.
-- No password is present here. Does not reset or change any existing application login.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $activation$ DECLARE login_name text;parent_name text;r record; BEGIN
 IF current_database()<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole)) THEN
  RAISE EXCEPTION 'INSTALL_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 FOREACH login_name IN ARRAY ARRAY['db04_group_test_runtime','db04_group_test_broker'] LOOP
  parent_name=CASE WHEN login_name='db04_group_test_runtime' THEN '${names.runtime}' ELSE '${names.broker}' END;
  SELECT * INTO r FROM pg_roles WHERE rolname=login_name;
  IF r.oid IS NULL OR r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
   OR r.rolconnlimit<>(CASE WHEN login_name='db04_group_test_runtime' THEN 4 ELSE 2 END)
   OR (SELECT count(*) FROM pg_auth_members WHERE member=r.oid)<>1
   OR NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid WHERE m.member=r.oid AND p.rolname=parent_name AND NOT m.admin_option) THEN
   RAISE EXCEPTION 'RESTRICTED_LOGIN_DRIFT' USING ERRCODE='42501'; END IF;
 END LOOP;
END $activation$;
ALTER ROLE db04_group_test_runtime LOGIN;
ALTER ROLE db04_group_test_broker LOGIN;
COMMIT;
`;
const root='supabase/sql/db04-group-review';mkdirSync(root,{recursive:true});
writeFileSync(`${root}/install-review.sql`,install);writeFileSync(`${root}/synthetic-seed-review.sql`,syntheticSeed);
writeFileSync(`${root}/activate-logins-review.sql`,activate);
const manifest={version:'db01-db04-group-review/1',target:{project:'FinGence-Production',projectRef:'zmtdozblpvtjniehwjrw',database:'postgres'},
 approval:'NOT_AUTHORIZED_FOR_HOSTED_EXECUTION',reportedCatalog:{publicTables:0,reconciliation:false,m2:false,m3:false,independentlyCheckedHere:false},
 source,inputs:[...inputs.map(i=>({file:i.file,sha256:sha(i.text)})),{file:'supabase/sql/db04-development/install-review.sql',commit:source,sha256:sha(original)},{file:'supabase/sql/db04-development/synthetic-seed-review.sql',commit:source,sha256:sha(seed)}],
 sql:[{file:`${root}/install-review.sql`,sha256:sha(install)},{file:`${root}/synthetic-seed-review.sql`,sha256:sha(syntheticSeed)},{file:`${root}/activate-logins-review.sql`,sha256:sha(activate)}],
 objects:{publicTables:['ingestion_batches','financial_records','validation_issues','persistence_attempts'],schemas:['fingence_reconciliation',names.identity],roles:[names.runtime,names.broker,'db04_group_test_runtime','db04_group_test_broker']},
 limits:['No real authentication or general C1/V2 cash bridge','Public foundation runtime remains disabled pending team ownership policies','Hosted server version/access/recovery and approval unverified','No automatic installer or hosted execution']};
writeFileSync('docs/integration/db04-group-deployment-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({prepared:true,sql:manifest.sql,hostedExecution:false}));
