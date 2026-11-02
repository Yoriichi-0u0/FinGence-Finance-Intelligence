import 'server-only';
import type {SqlConnection} from '../db/postgres';
/** Approved public foundation metadata only: never financial/session/audit row contents. */
export const FOUNDATION_RELATIONS=['ingestion_batches','financial_records','validation_issues','persistence_attempts','security_audit_events'] as const;
export async function inspectFoundationCatalog(tx:SqlConnection) {
 const args=[[...FOUNDATION_RELATIONS]];
 const tables=(await tx.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS permissions
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relkind IN ('r','p') ORDER BY c.relname`,args)).rows;
 const columns=(await tx.query(`SELECT c.relname AS relation,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,args)).rows;
 const constraints=(await tx.query(`SELECT c.relname AS relation,x.conname AS name,x.contype AS type,x.convalidated AS validated,pg_get_constraintdef(x.oid) AS definition
  FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,x.conname`,args)).rows;
 const triggers=(await tx.query(`SELECT c.relname AS relation,t.tgname AS name,t.tgenabled AS enabled,p.proname AS function_name,pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,args)).rows;
 const functions=(await tx.query(`SELECT DISTINCT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,p.prosecdef AS security_definer,p.proconfig AS configuration,pg_get_userbyid(p.proowner) AS owner,p.proacl::text AS permissions,
  md5(pg_get_functiondef(p.oid)) AS definition_md5
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY p.proname`,args)).rows;
 const indexes=(await tx.query(`SELECT tablename AS relation,indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname`,args)).rows;
 const policies=(await tx.query(`SELECT tablename AS relation,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname`,args)).rows;
 return {tables,columns,constraints,triggers,functions,indexes,policies};
}
export function assessFoundationCompatibility(f:Awaited<ReturnType<typeof inspectFoundationCatalog>>) {
 const required=['ingestion_batches','financial_records','validation_issues','persistence_attempts'];
 const missing=required.filter(name=>!f.tables.some(t=>t.name===name));
 const numeric=f.columns.filter(c=>c.relation==='financial_records'&&typeof c.type==='string'&&/^numeric(?:\(|$)/.test(c.type));
 const money=['debit','credit','source_amount','derived_ledger_net','balance'].filter(name=>numeric.some(c=>c.name===name));
 return {version:'db01-db04-catalog-compatibility/1',observedFoundationTables:f.tables.map(t=>t.name),missingFoundationTables:missing,exactNumericColumns:money,numericDeclarations:numeric.map(c=>({name:c.name,type:c.type})),
  groupedPersistenceMarkers:{attemptTable:f.tables.some(t=>t.name==='persistence_attempts'),batchLink:f.columns.some(c=>c.relation==='ingestion_batches'&&c.name==='persistence_attempt_id')},
  warningFenceMarkers:{trigger:f.triggers.some(t=>t.name==='issue_00_warning_mutation_fence'),function:f.functions.some(t=>t.name==='serialize_warning_issue_mutation')},
  warningFenceEnabled:f.triggers.some(t=>t.name==='issue_00_warning_mutation_fence'&&['O','A'].includes(String(t.enabled))),
  db03Recovery:'NOT_PROVEN_BY_CATALOGS_REQUIRES_BACKUP_AND_RESTORE_EVIDENCE',
  migrationInstallation:'OBSERVED_MARKERS_ONLY_NOT_A_MIGRATION_LEDGER',
  c1ToDb04:{supported:false,missingContract:['TRUSTED_BANK_LEDGER_CLASSIFICATION','VALUE_DATE_PROVENANCE','ORGANIZATION_OWNERSHIP_BINDING']},
  cashSourceToDb04:'SUPPORTED_LOCAL_REGISTERED_SOURCE_PATH; HOSTED_NOT_VERIFIED',hostedWritesAuthorized:false};
}
