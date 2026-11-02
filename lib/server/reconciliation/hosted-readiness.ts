import 'server-only';
import type {inspectReconciliationPrerequisites} from './preflight';
const identityColumns:Record<string,Record<string,string>>={
 'fingence_m2.organizations':{id:'uuid'},'fingence_m2.users':{id:'uuid'},
 'fingence_m2.memberships':{user_id:'uuid',organization_id:'uuid',role:'text',active:'boolean',version:'integer'},
 'fingence_m2.sessions':{token_hash:'text',user_id:'uuid',organization_id:'uuid',expires_at:'timestamp with time zone',revoked:'boolean',membership_version:'integer'},
 'fingence_m3.organization_states':{organization_id:'uuid',active:'boolean'},
};
export const HOSTED_IDENTITY_REQUIREMENTS=[
 'Verified issuer/audience/signature and subject mapping; no browser role claims',
 'Authoritative subject-to-organization membership and Finance permission mapping',
 'Expiry/revocation/suspension and transaction-consistent membership lifecycle',
 'Reviewed restricted runtime role and SECURITY DEFINER ownership/grants',
 'Approved audit/retention and hosted service-to-database identity boundary',
] as const;
/** Evidence-based diagnostic only. Local M2/M3 compatibility never approves Supabase Auth. */
export function assessHostedReadiness(report:Awaited<ReturnType<typeof inspectReconciliationPrerequisites>>) {
 const blockers:string[]=['HOSTED_IDENTITY_CONTRACT_REQUIRED','EXPLICIT_MIGRATION_APPROVAL_REQUIRED','VERIFIED_BACKUP_RESTORE_REQUIRED'];
 for(const name of report.foundationCompatibility.missingFoundationTables)blockers.push(`DB01_FOUNDATION_TABLE_ABSENT:${name}`);
 if(!report.foundationCompatibility.warningFenceEnabled)blockers.push('DB02_WARNING_FENCE_MISSING_OR_DISABLED');
 for(const c of report.foundation.constraints)if(c.validated===false)blockers.push(`FOUNDATION_CONSTRAINT_NOT_VALIDATED:${c.relation}.${c.name}`);
 for(const [relation,columns] of Object.entries(identityColumns))for(const [name,type] of Object.entries(columns)) {
  const found=report.columns.find(c=>`${c.table_schema}.${c.table_name}`===relation&&c.column_name===name);
  if(!found||found.data_type!==type)blockers.push(`IDENTITY_COLUMN_MISSING_OR_INCOMPATIBLE:${relation}.${name}`);
 }
 const required=['documents','jobs','job_sources','transactions','proposals','decisions','cases','reviews','audit','rankings','proposal_verifications'];
 for(const name of required){const t=report.tables.find(t=>t.name===name);if(!t)blockers.push(`DB04_OBJECT_ABSENT:${name}`);else if(!t.rls||!t.force_rls)blockers.push(`DB04_RLS_INCOMPATIBLE:${name}`);}
 const runtime=report.runtimeRole[0];if(!runtime||runtime.rolsuper||runtime.rolbypassrls||runtime.rolcanlogin||runtime.rolcreaterole||runtime.rolcreatedb)blockers.push('RUNTIME_ROLE_MISSING_OR_PRIVILEGED');
 for(const p of report.runtimePermissions)if(p.excess_mutation||!p.can_select||!p.can_insert)blockers.push(`RUNTIME_GRANT_INCOMPATIBLE:${p.relation}`);
 for(const name of ['principal','authorized_organization','immutable']) {
  const f=report.functions.find(f=>f.name===name);
  if(!f||f.security_definer!==(name!=='immutable')||!Array.isArray(f.configuration)||!f.configuration.includes('search_path=pg_catalog')||f.public_execute||f.owner==='fingence_reconciliation_runtime')blockers.push(`FUNCTION_SECURITY_REVIEW_REQUIRED:${name}`);
 }
 if(report.constraints.some(c=>c.validated===false))blockers.push('UNVALIDATED_CONSTRAINTS');
 return {version:'db04-hosted-readiness/1',hostedDeploymentAuthorized:false as const,blockers,identityRequirements:HOSTED_IDENTITY_REQUIREMENTS,
  localAuthentication:'M2/M3 opaque session-token hash and Finance membership; not Supabase Auth/JWT',
  extensionRequirement:'Built-in PostgreSQL SQL/PLpgSQL, numeric, JSONB, advisory locks; no extension installation required by DB04'};
}
