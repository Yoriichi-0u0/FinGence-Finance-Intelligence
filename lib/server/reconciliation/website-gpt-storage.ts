import 'server-only';
import {z} from 'zod';
import {Pool} from 'pg';
import {transactionDatabase,serverPoolConfig,type TransactionDatabase} from '../db/postgres';
import {WebsiteGPTError,gptDiagnosticReason,reportWebsiteGPT,websiteGPTConnectReason,websiteGPTSqlError} from './website-gpt-diagnostics';
import type {Owner,WebsiteGPTStore} from './website-job-gpt';
import {gptSuggestionOutcome,type GPTEvidenceView} from '../../gpt-evidence-view';

export const WEBSITE_GPT_STORAGE_CONTRACT='website-gpt/1';
const project='zmtdozblpvtjniehwjrw',login='fingence_ai06_website_login';
type Environment=Readonly<Record<string,string|undefined>>;
/** Dedicated credentials only. Never consult generic Supabase/service-role configuration. */
export function websiteGPTDatabaseEnvironment(env:Environment=process.env){
 if(env.FINGENCE_GPT_SUGGESTIONS!=='1')throw new WebsiteGPTError('GPT_STORAGE_DISABLED');
 if(env.FINGENCE_GPT_STORAGE!=='postgres')throw new WebsiteGPTError('GPT_BACKEND_UNAPPROVED');
 if(env.FINGENCE_GPT_STORAGE_APPROVAL!==WEBSITE_GPT_STORAGE_CONTRACT)throw new WebsiteGPTError('GPT_APPROVAL_REQUIRED');
 if(!env.FINGENCE_GPT_DATABASE_URL)throw new WebsiteGPTError('GPT_DATABASE_URL_MISSING');
 const database={SUPABASE_DATABASE_URL:env.FINGENCE_GPT_DATABASE_URL,SUPABASE_DATABASE_CA_CERT:env.FINGENCE_GPT_DATABASE_CA_CERT};
 let config;try{config=serverPoolConfig(database);}catch{throw new WebsiteGPTError('GPT_DATABASE_INVALID');}
 const direct=config.host===`db.${project}.supabase.co`&&config.port===5432&&config.user===login;
 const pooler=!!env.FINGENCE_GPT_APPROVED_POOLER_HOST&&config.host===env.FINGENCE_GPT_APPROVED_POOLER_HOST
  &&/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(config.host??'')&&[5432,6543].includes(config.port??0)&&config.user===`${login}.${project}`;
 if((!direct&&!pooler)||config.database!=='postgres'||!config.password||typeof config.ssl!=='object'||config.ssl?.rejectUnauthorized!==true)throw new WebsiteGPTError('GPT_RESTRICTED_CONNECTION_REQUIRED');
 return database;
}
export function websiteGPTStorageConfigured(diagnose=false){try{websiteGPTDatabaseEnvironment();return true;}catch(error){if(diagnose)reportWebsiteGPT('CONFIG',gptDiagnosticReason(error,'GPT_DATABASE_INVALID'));return false;}}
/** Storage/read verification must not activate model calls. Optional pilot binds the trusted member. */
export function websiteGPTGenerationAllowed(memberId?:string){
 if(process.env.FINGENCE_GPT_GENERATION!=='1'||!websiteGPTStorageConfigured())return false;
 const pilot=process.env.FINGENCE_GPT_PILOT_MEMBER_ID;
 return !pilot||z.uuid().safeParse(pilot).success&&pilot===memberId;
}

const nullable=z.string().max(1000).nullable();
const evidence=z.object({version:z.literal('gpt-evidence-view/1'),batchId:z.uuid(),processingId:z.string().regex(/^[a-f0-9]{8,64}$/),runs:z.array(z.object({
 evidenceId:z.string().regex(/^[a-f0-9]{64}$/),model:z.string().max(160),prompt:z.literal('website-job-gpt/1'),createdAt:z.iso.datetime(),
 bankSha256:z.string().regex(/^[a-f0-9]{64}$/),ledgerSha256:z.string().regex(/^[a-f0-9]{64}$/),outcome:z.literal('UNRESOLVED'),
 items:z.array(z.object({suggestionState:z.enum(['VERIFIED','NEEDS_REVIEW','NO_SUGGESTION']).optional(),type:z.enum(['SUGGESTION','ABSTENTION']),ordinal:z.number().int().min(0).max(99),bankId:nullable,ledgerId:nullable,recordId:nullable,
 bankReference:nullable,ledgerReference:nullable,explanation:z.string().max(2000),reasons:z.array(z.string().max(120)).max(16),verification:z.record(z.string(),z.unknown()),score:z.null(),outcome:z.literal('UNRESOLVED')}).strict()).max(100),
}).strict()).length(1)}).strict();
export function checkedWebsiteEvidence(value:unknown,jobId:string):GPTEvidenceView{
 const parsed=evidence.safeParse(value);if(!parsed.success)throw new WebsiteGPTError('GPT_EVIDENCE_INVALID');
 const result=parsed.data;if(result.runs.some(r=>r.items.some(i=>i.suggestionState!==undefined&&i.suggestionState!==gptSuggestionOutcome(i))))throw new WebsiteGPTError('GPT_EVIDENCE_INVALID');
 if(result.batchId!==jobId||Buffer.byteLength(JSON.stringify(result))>256000)throw new WebsiteGPTError('GPT_EVIDENCE_INVALID');
 return result;
}
/** No direct table privileges. The reviewed narrow SQL API revalidates session + stored job on every operation. */
export class PostgresWebsiteGPTStore implements WebsiteGPTStore{
 constructor(private readonly database:TransactionDatabase,private readonly tokenHash:string){if(!/^[a-f0-9]{64}$/.test(tokenHash))throw new WebsiteGPTError('GPT_SESSION_REQUIRED');}
 private async call(owner:Owner,action:string,payload:unknown=null,target:'operate'|'review'='operate'):Promise<unknown>{
  if(!z.uuid().safeParse(owner.jobId).success||!z.uuid().safeParse(owner.organizationId).success||!z.uuid().safeParse(owner.memberId).success)throw new WebsiteGPTError('GPT_SCOPE_INVALID');
  return this.database.transaction(async tx=>{
   const gate=await tx.query<{compatible:boolean}>(`WITH RECURSIVE identities AS (
    SELECT oid FROM pg_roles WHERE rolname IN (current_user,session_user)
   ), ancestors(oid) AS (SELECT oid FROM identities UNION SELECT m.roleid FROM pg_auth_members m JOIN ancestors a ON a.oid=m.member)
   SELECT current_user=session_user AND current_user='fingence_ai06_website_login'
    AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcanlogin)
    AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fingence_ai06_website_runtime' AND NOT rolcanlogin AND pg_has_role(current_user,oid,'USAGE'))
    AND NOT EXISTS(SELECT 1 FROM pg_roles r JOIN ancestors a ON a.oid=r.oid WHERE r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolname NOT IN ('fingence_ai06_website_login','fingence_ai06_website_runtime'))
    AND NOT has_schema_privilege(current_user,'public','CREATE')
    AND NOT has_schema_privilege(current_user,'fingence_gpt_website','CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('fingence_workspace','fingence_processing','fingence_ingestion','fingence_reconciliation','fingence_db04_group_synthetic')
      AND c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
    AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE (n.nspname IN ('fingence_workspace','fingence_processing','fingence_ingestion','fingence_reconciliation','fingence_db04_group_synthetic')
      OR n.nspname='public' AND p.proname LIKE 'fingence_%') AND has_schema_privilege(current_user,n.oid,'USAGE') AND has_function_privilege(current_user,p.oid,'EXECUTE'))
    AND (SELECT count(*)=3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)<>current_user
      AND NOT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_gpt_website' AND c.relname IN ('attempts','evidence','audit'))
    AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='fingence_gpt_website' AND p.proname='operate'
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog'] AND pg_get_functiondef(p.oid) LIKE '%website-gpt/1%'
      AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS compatible`).catch(error=>{const safe=websiteGPTSqlError(error);reportWebsiteGPT('RUNTIME',safe.reason);throw safe;});
   if(gate.rows.length!==1||gate.rows[0].compatible!==true){reportWebsiteGPT('RUNTIME','GPT_RUNTIME_DENIED');throw new WebsiteGPTError('GPT_RUNTIME_DENIED');}
   if(target==='review'){
    const contract=await tx.query<{compatible:boolean}>(`SELECT
     (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)<>current_user
      AND NOT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_gpt_website' AND c.relname IN ('reviews','review_audit'))
     AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='fingence_gpt_website'
      AND p.proname='review' AND pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job uuid, p_action text, p_payload jsonb'
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog'] AND pg_get_functiondef(p.oid) LIKE '%website-gpt-review/1%'
      AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS compatible`);
    if(contract.rows[0]?.compatible!==true)throw new WebsiteGPTError('GPT_RUNTIME_DENIED');
   }
   const sql=target==='review'?'SELECT fingence_gpt_website.review($1,$2::uuid,$3,$4::jsonb) AS result':'SELECT fingence_gpt_website.operate($1,$2::uuid,$3,$4::jsonb) AS result';
   const result=await tx.query<{result:unknown}>(sql,[this.tokenHash,owner.jobId,action,payload===null?null:JSON.stringify(payload)]).catch(error=>{const safe=websiteGPTSqlError(error);reportWebsiteGPT('OPERATE',safe.reason);throw safe;});
   if(result.rows.length!==1)throw new WebsiteGPTError('GPT_STORAGE_INVALID');
   const body=result.rows[0].result as {organizationId?:unknown;memberId?:unknown;value?:unknown}|null;
   if(!body||body.organizationId!==owner.organizationId||body.memberId!==owner.memberId)throw new WebsiteGPTError('GPT_SCOPE_DENIED');
   return body.value;
  });
 }
 async reviewOperation(owner:Owner,action:'READ'|'APPROVE'|'REJECT',payload:unknown=null){
  const evidence=await this.read(owner);
  const eligible=(ordinal:unknown)=>evidence?.runs[0].items.filter(i=>i.ordinal===ordinal&&i.verification.proposalPolicy==='website-unexplained/1'&&gptSuggestionOutcome(i)==='VERIFIED').length===1;
  if(action!=='READ'&&!eligible((payload as {ordinal?:unknown}|null)?.ordinal))throw new WebsiteGPTError('GPT_JOB_DENIED');
  const result=await this.call(owner,action,payload,'review');
  if(action==='READ'&&result&&typeof result==='object'&&'items' in result&&Array.isArray(result.items))return {...result,items:result.items.map(i=>({...i,canApprove:i.canApprove&&eligible(i.ordinal),canReject:i.canReject&&eligible(i.ordinal)}))};
  return result;
 }
 async claim(owner:Owner){const value=await this.call(owner,'CLAIM');if(typeof value!=='boolean')throw new WebsiteGPTError('GPT_CLAIM_INVALID');return value;}
 async audit(owner:Owner,action:'START'|'SAVE_INTENT'|'FAILED'|'READ'){if(await this.call(owner,action)!==true)throw new WebsiteGPTError('GPT_AUDIT_INVALID');}
 async save(owner:Owner,data:GPTEvidenceView){if(await this.call(owner,'SAVE',checkedWebsiteEvidence(data,owner.jobId))!==true)throw new WebsiteGPTError('GPT_SAVE_INVALID');}
 async read(owner:Owner){const value=await this.call(owner,'READ');return value===null?null:checkedWebsiteEvidence(value,owner.jobId);}
}
let database:TransactionDatabase|null=null;
/** Same shared transaction/TLS behavior, with AI06-only sanitized connection diagnostics. */
export function createWebsiteGPTDatabase(environment:Parameters<typeof serverPoolConfig>[0]):TransactionDatabase{
 const pool=new Pool(serverPoolConfig(environment));
 pool.on('error',()=>reportWebsiteGPT('POOL','DB_POOL_ERROR'));
 return transactionDatabase({connect:async()=>{try{return await pool.connect();}catch(error){reportWebsiteGPT('POOL',websiteGPTConnectReason(error));throw error;}},end:()=>pool.end()});
}
export function websiteGPTStorage(tokenHash:string):PostgresWebsiteGPTStore|null{
 try{
  const environment=websiteGPTDatabaseEnvironment();
  database??=createWebsiteGPTDatabase(environment);
  return new PostgresWebsiteGPTStore(database,tokenHash);
 }catch(error){reportWebsiteGPT('CONFIG',gptDiagnosticReason(error,'GPT_DATABASE_INVALID'));return null;}
}
