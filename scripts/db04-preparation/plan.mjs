// Checksums only. No environment loading, database client or apply mode.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(process.argv.length>2)throw Error('NO_TARGET_OR_APPLY_ARGUMENTS_SUPPORTED');
const files=['db04-source-file-validation-review.sql','db02-001-warning-mutation-fence.sql','db04-hosted-identity-v1-review.sql','db04-001-reconciliation.sql','db04-002-reconciliation-security.sql','db04-003-ranking-evidence.sql','db04-004-proposal-verification.sql','db04-hosted-principal-v1-review.sql'];
console.log(JSON.stringify({version:'db04-combined-preparation/1',target:{projectRef:'fhipzomczevbpybezzxu',database:'postgres'},hostedExecutionAuthorized:false,
 blockers:['VERIFIED_HOSTED_BACKUP_RESTORE','EXPLICIT_LEGACY_VALIDATION_SCAN_APPROVAL','JASON_IDENTITY_AUTHORITY_AND_REVOCATION_SLA','APPROVED_SUBJECT_ORGANIZATION_MAPPING','SEPARATE_HOSTED_CHANGE_APPROVAL'],
 sequence:files.map((name,i)=>({order:i+1,name,sha256:createHash('sha256').update(readFileSync(new URL('../../supabase/sql/'+name,import.meta.url))).digest('hex')})),
 warnings:['Proposal identity is locally tested with a synthetic authority, not hosted Supabase Auth.','No schema reset, local password bootstrap, financial data repair or C1/V2 cash-contract cast.','Role/function owners and provider-managed default grants require deployment review.']},null,2));
