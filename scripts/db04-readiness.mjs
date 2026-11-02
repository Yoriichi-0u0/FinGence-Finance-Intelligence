import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const files=['v2-verified-document-local.sql','v2-m2-local.sql','v2-m3-local.sql','db04-001-reconciliation.sql','db04-002-reconciliation-security.sql','db04-003-ranking-evidence.sql','db04-004-proposal-verification.sql'];
const foundationFiles=['phase1-clean-setup.sql','phase1-source-file-upgrade.sql','c3b1-grouped-persistence-upgrade.sql','db02-001-warning-mutation-fence.sql','phase3-security-audit-upgrade.sql','phase3-security-audit-api-events.sql'];
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL){const candidate=new URL(s+'.ts',c.parentURL);if(existsSync(candidate))return next(candidate.href,c);}return next(s,c);},load(url,c,next){if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,c);}});
let db;
try {
 const mode=process.argv[2]??'plan';
 if(mode==='plan') {
  const checksum=name=>createHash('sha256').update(readFileSync(new URL('../supabase/sql/'+name,import.meta.url))).digest('hex');
  console.log(JSON.stringify({version:'db04-readiness/1',intendedProject:'Owner personal FYP A development; exact reference not inferred',teamProjectAccess:'FORBIDDEN',foundationReferences:foundationFiles.map(name=>({name,sha256:checksum(name),execution:'REFERENCE_ONLY_NOT_AN_EXECUTION_SEQUENCE'})),db03Recovery:'NO_NEW_SQL_MIGRATION; BACKUP_AND_RESTORE_EVIDENCE_REQUIRED',migrations:files.map((name,order)=>({order:order+1,name,sha256:checksum(name),purpose:name.startsWith('db04-')?'ADDITIVE_SQL_REQUIRES_TARGET_REVIEW_AND_APPROVAL':'LOCAL_DEPENDENCY_REFERENCE_NOT_APPROVED_HOSTED'})),hostedDeploymentAuthorized:false,blockers:['VERIFIED_TARGET_CATALOG_REQUIRED','HOSTED_IDENTITY_CONTRACT_REQUIRED','EXPLICIT_HOSTED_CHANGE_APPROVAL_REQUIRED','VERIFIED_BACKUP_AND_RESTORE_REQUIRED'],warning:'Do not replay foundation clean/upgrade alternatives or local M2/M3 authentication on a populated hosted database.'},null,2));
 }else if(mode==='inspect') {
  if(!process.env.DB04_INSPECTION_DATABASE_URL)throw Error('DEDICATED_INSPECTION_CONNECTION_REQUIRED');
  const {serverPoolConfig,createPostgresDatabase}=await import('../lib/server/db/postgres.ts');
  const {assertInspectionTarget}=await import('../lib/server/reconciliation/inspection-target.ts');
  const {inspectWithRestrictedIdentity}=await import('../lib/server/reconciliation/preflight.ts');
  const {assessHostedReadiness}=await import('../lib/server/reconciliation/hosted-readiness.ts');
  const env={SUPABASE_DATABASE_URL:process.env.DB04_INSPECTION_DATABASE_URL,SUPABASE_DATABASE_CA_CERT:process.env.DB04_INSPECTION_CA_CERT};
  const target=assertInspectionTarget(serverPoolConfig(env),process.env);
  db=createPostgresDatabase(env);
  const report=await inspectWithRestrictedIdentity(db,{database:target.database,role:target.role});
  console.log(JSON.stringify({version:'db04-readiness/1',target,report,readiness:assessHostedReadiness(report),hostedDeploymentAuthorized:false},null,2));
 }else throw Error('PLAN_OR_INSPECT_REQUIRED');
}catch(error){const allowed=['DEDICATED_INSPECTION_CONNECTION_REQUIRED','DEDICATED_INSPECTION_IDENTITY_REQUIRED','EXPLICIT_FYP_A_READ_ONLY_APPROVAL_REQUIRED','READ_ONLY_INSPECTION_IDENTITY_REQUIRED','PLAN_OR_INSPECT_REQUIRED'];console.log(JSON.stringify({status:'BLOCKED',reason:allowed.includes(error?.message)?error.message:'PREFLIGHT_FAILED'}));process.exitCode=2;}
finally{if(db)try{await db.close();}catch{process.exitCode=2;}}
