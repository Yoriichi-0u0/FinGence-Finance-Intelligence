import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
vi.mock('server-only',()=>({}));
import {PostgresWebsiteGPTStore,websiteGPTDatabaseEnvironment,websiteGPTStorageConfigured,websiteGPTGenerationAllowed,checkedWebsiteEvidence} from '../../lib/server/reconciliation/website-gpt-storage';
import {readWebsiteJobSuggestions,generateWebsiteJobGPT,type Owner} from '../../lib/server/reconciliation/website-job-gpt';
import {PersistenceError} from '../../lib/server/persistence/contracts';
import type {TransactionDatabase,SqlConnection} from '../../lib/server/db/postgres';
import type {GPTEvidenceView} from '../../lib/gpt-evidence-view';
import type {ProcessingContext} from '../../lib/demo/pipeline';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GPTSuggestionsView} from '../../components/reconciliation/gpt-suggestions';

const owner:Owner={organizationId:'00000000-0000-4000-8000-000000000001',memberId:'00000000-0000-4000-8000-000000000002',jobId:'00000000-0000-4000-8000-000000000003'};
const tokenHash='a'.repeat(64);
const environment={FINGENCE_GPT_SUGGESTIONS:'1',FINGENCE_GPT_STORAGE:'postgres',FINGENCE_GPT_STORAGE_APPROVAL:'website-gpt/1',FINGENCE_GPT_DATABASE_URL:'postgresql://fingence_ai06_website_login:synthetic@db.zmtdozblpvtjniehwjrw.supabase.co:5432/postgres?sslmode=verify-full'};
const data:GPTEvidenceView={version:'gpt-evidence-view/1',batchId:owner.jobId,processingId:'b'.repeat(64),runs:[{evidenceId:'c'.repeat(64),model:'openai/gpt-oss-120b',prompt:'website-job-gpt/1',createdAt:'2026-11-15T00:00:00.000Z',bankSha256:'d'.repeat(64),ledgerSha256:'e'.repeat(64),outcome:'UNRESOLVED',items:[{type:'ABSTENTION',ordinal:0,bankId:null,ledgerId:null,recordId:'SYNTHETIC-BANK',bankReference:null,ledgerReference:null,explanation:'No pair proposed.',reasons:['NO_PAIR_PROPOSED'],verification:{},score:null,outcome:'UNRESOLVED'}]}]};
function fixture(){
 const state={compatible:true,value:true as unknown,fail:false,memberId:owner.memberId,commits:0,rollbacks:0};
 const query=vi.fn(async(sql:string)=>{if(sql.includes('AS compatible'))return {rows:[{compatible:state.compatible}],rowCount:1};if(state.fail)throw Error('private audit failure');return {rows:[{result:{organizationId:owner.organizationId,memberId:state.memberId,value:state.value}}],rowCount:1};});
 const transaction=async<T>(work:(tx:SqlConnection)=>Promise<T>)=>{try{const result=await work({query} as unknown as SqlConnection);state.commits++;return result;}catch(e){state.rollbacks++;throw e;}};
 const database={transaction,close:vi.fn(async()=>{})} satisfies TransactionDatabase;
 return {state,query,database,store:new PostgresWebsiteGPTStore(database,tokenHash)};
}
afterEach(()=>vi.unstubAllEnvs());
it('accepts only explicitly approved dedicated group configuration, including an approved pooler',()=>{
 expect(websiteGPTDatabaseEnvironment(environment).SUPABASE_DATABASE_URL).toBe(environment.FINGENCE_GPT_DATABASE_URL);
 expect(websiteGPTDatabaseEnvironment({...environment,VERCEL:'1'})).toBeDefined();
 const pooler={...environment,FINGENCE_GPT_APPROVED_POOLER_HOST:'aws-0-approved.pooler.supabase.com',FINGENCE_GPT_DATABASE_URL:'postgresql://fingence_ai06_website_login.zmtdozblpvtjniehwjrw:synthetic@aws-0-approved.pooler.supabase.com:6543/postgres?sslmode=verify-full'};
 expect(websiteGPTDatabaseEnvironment(pooler)).toBeDefined();
 expect(()=>websiteGPTDatabaseEnvironment({...pooler,FINGENCE_GPT_APPROVED_POOLER_HOST:undefined})).toThrow();
 for(const url of [environment.FINGENCE_GPT_DATABASE_URL.replace('fingence_ai06_website_login','postgres'),environment.FINGENCE_GPT_DATABASE_URL.replace('zmtdozblpvtjniehwjrw','unrelated'),environment.FINGENCE_GPT_DATABASE_URL.replace('verify-full','disable')])expect(()=>websiteGPTDatabaseEnvironment({...environment,FINGENCE_GPT_DATABASE_URL:url})).toThrow();
});
it('does not use generic/service credentials or a flag alone; remains disabled without approval',()=>{
 expect(()=>websiteGPTDatabaseEnvironment({...environment,FINGENCE_GPT_DATABASE_URL:undefined,SUPABASE_DATABASE_URL:environment.FINGENCE_GPT_DATABASE_URL})).toThrow();
 expect(()=>websiteGPTDatabaseEnvironment({...environment,FINGENCE_GPT_STORAGE_APPROVAL:undefined})).toThrow();
 vi.stubEnv('FINGENCE_GPT_STORAGE_APPROVAL','');expect(websiteGPTStorageConfigured()).toBe(false);
});
it('separates verified storage access from live generation and confines an approved pilot to its trusted member',()=>{
 for(const [key,value] of Object.entries(environment))vi.stubEnv(key,value);
 vi.stubEnv('FINGENCE_GPT_GENERATION','0');expect(websiteGPTStorageConfigured()).toBe(true);expect(websiteGPTGenerationAllowed(owner.memberId)).toBe(false);
 vi.stubEnv('FINGENCE_GPT_GENERATION','1');vi.stubEnv('FINGENCE_GPT_PILOT_MEMBER_ID',owner.memberId);
 expect(websiteGPTGenerationAllowed(owner.memberId)).toBe(true);expect(websiteGPTGenerationAllowed('other')).toBe(false);
 vi.stubEnv('FINGENCE_GPT_PILOT_MEMBER_ID','invalid');expect(websiteGPTGenerationAllowed(owner.memberId)).toBe(false);
});
it('binds the session hash and job only, using the reviewed SQL API and a checked transaction',async()=>{
 const f=fixture();expect(await f.store.claim(owner)).toBe(true);expect(f.query.mock.calls).toHaveLength(2);
 const calls=f.query.mock.calls as unknown as [string,unknown[]][];
 expect(calls[1][0]).toBe('SELECT fingence_gpt_website.operate($1,$2::uuid,$3,$4::jsonb) AS result');
 expect(calls[1][1]).toEqual([tokenHash,owner.jobId,'CLAIM',null]);expect(f.state.commits).toBe(1);
});
it('fails closed before calling the API when runtime permissions/RLS cannot be verified',async()=>{
 const f=fixture();f.state.compatible=false;await expect(f.store.claim(owner)).rejects.toThrow('GPT_RUNTIME_DENIED');expect(f.query).toHaveBeenCalledTimes(1);expect(f.state.rollbacks).toBe(1);
});
it('rejects crossed user/tenant scope and never returns evidence on an audit failure',async()=>{
 const f=fixture();f.state.memberId='other';await expect(f.store.claim(owner)).rejects.toThrow('GPT_SCOPE_DENIED');expect(f.state.commits).toBe(0);
 f.state.memberId=owner.memberId;f.state.fail=true;await expect(f.store.read(owner)).rejects.toThrow('GPT_SQL_FAILED');
});
it('returns duplicate claims without redispatch and uses one atomic SAVE call for evidence and audit',async()=>{
 const f=fixture();f.state.value=false;expect(await f.store.claim(owner)).toBe(false);f.query.mockClear();f.state.value=true;
 await f.store.save(owner,data);expect(f.query).toHaveBeenCalledTimes(2);
 expect((f.query.mock.calls as unknown as [string,unknown[]][])[1][1]).toEqual([tokenHash,owner.jobId,'SAVE',JSON.stringify(data)]);
});
it('strictly validates saved evidence and unresolved status before writes and after reads',async()=>{
 const f=fixture();f.state.value=data;expect(await f.store.read(owner)).toEqual(data);
 const modified=structuredClone(data);(modified.runs[0] as {outcome:string}).outcome='APPROVED';
 expect(()=>checkedWebsiteEvidence(modified,owner.jobId)).toThrow();await expect(f.store.save(owner,modified)).rejects.toThrow();
 f.state.value=modified;await expect(f.store.read(owner)).rejects.toThrow();
 expect(()=>checkedWebsiteEvidence(data,'00000000-0000-4000-8000-000000000099')).toThrow();
});
it('rejects false save/audit acknowledgements and malformed session or job identifiers',async()=>{
 const f=fixture();f.state.value=false;
 await expect(f.store.save(owner,data)).rejects.toThrow('GPT_SAVE_INVALID');await expect(f.store.audit(owner,'START')).rejects.toThrow('GPT_AUDIT_INVALID');
 expect(()=>new PostgresWebsiteGPTStore(f.database,'not-a-session-hash')).toThrow('GPT_SESSION_REQUIRED');
 f.query.mockClear();await expect(f.store.claim({...owner,jobId:'untrusted'})).rejects.toThrow('GPT_SCOPE_INVALID');expect(f.query).not.toHaveBeenCalled();
});
it('injects only verified session hashes into request-scoped storage; no financial response on auth failure',async()=>{
 const f=fixture();f.state.value=data;const factory=vi.fn(()=>f.store);
 const verify=async()=>({kind:'SIGNED_IN' as const,tokenHash,principal:{sessionId:'s',memberId:owner.memberId,email:'synthetic@example.invalid',role:'FINANCE' as const,organization:{id:owner.organizationId,name:'Synthetic'},processing:{paused:false,reason:null,since:null},ai:{enabled:true,since:null}}});
 const request=new Request(`http://localhost/?jobId=${owner.jobId}`);
 expect((await readWebsiteJobSuggestions(request,{store:factory,verify})).status).toBe(200);expect(factory).toHaveBeenCalledWith(tokenHash);
 factory.mockClear();expect((await readWebsiteJobSuggestions(request,{store:factory,verify:async()=>({kind:'ENDED'})})).status).toBe(401);expect(factory).not.toHaveBeenCalled();
});
it('never audits/retries after an uncertain persistence commit',async()=>{
 const store={claim:vi.fn(async()=>true),audit:vi.fn(async(owner:Owner,action:string)=>{void owner;void action;}),save:vi.fn(async()=>{throw new PersistenceError('COMMIT_OUTCOME_UNKNOWN');}),read:vi.fn(async()=>null)};
 const source={businessId:'synthetic',currency:'MYR',sha256:'d'.repeat(64),rows:[]};
 const context={job:{id:owner.jobId},runner:'BACKEND_JOB_RUNNER',status:'COMPLETED',processingId:'b'.repeat(64),outputs:{bank:source,ledger:source,reconciliation:{results:[]}}} as unknown as ProcessingContext;
 await expect(generateWebsiteJobGPT(context,owner,'synthetic',{store})).rejects.toMatchObject({code:'COMMIT_OUTCOME_UNKNOWN'});
 expect(store.audit.mock.calls.map(c=>c[1])).toEqual(['START','SAVE_INTENT']);expect(store.save).toHaveBeenCalledTimes(1);
});
it('runs generation -> mocked durable Supabase API -> authorized retrieval -> existing UI without filesystem storage',async()=>{
 const f=fixture();let saved:unknown=null,claimed=false;
 f.query.mockImplementation(async(sql:string,...args:unknown[])=>{
  if(sql.includes('AS compatible'))return {rows:[{compatible:true}],rowCount:1};
  const params=args[0] as unknown[],action=params[2];let value:unknown=true;
  if(action==='CLAIM'){value=!claimed;claimed=true;}
  if(action==='SAVE')saved=JSON.parse(params[3] as string);
  if(action==='READ')value=saved;
  return {rows:[{result:{organizationId:owner.organizationId,memberId:owner.memberId,value}}],rowCount:1};
 });
 const row={recordId:'BANK-1',date:'2026-11-01',currency:'MYR',signedCents:'100',reference:'SYNTHETIC'};
 const context={job:{id:owner.jobId},runner:'BACKEND_JOB_RUNNER',status:'COMPLETED_WITH_EXCEPTIONS',processingId:data.processingId,outputs:{
 bank:{businessId:'synthetic',currency:'MYR',sha256:'d'.repeat(64),rows:[row]},ledger:{businessId:'synthetic',currency:'MYR',sha256:'e'.repeat(64),rows:[{...row,recordId:'LEDGER-1'}]},
 reconciliation:{results:[{status:'AMOUNT_MISMATCH_REVIEW',bankRecordId:'BANK-1',ledgerRecordIds:['LEDGER-1']}]}}} as unknown as ProcessingContext;
 const complete=vi.fn(async()=>({content:{suggestions:[{bankId:'BANK-1',ledgerId:'LEDGER-1'}],abstentions:[]},receipt:{model:'openai/gpt-oss-120b',provider:'GROQ' as const,requestId:'mock',mode:'LIVE' as const,latencyMs:1,inputTokens:1,outputTokens:1,estimatedUsd:0}}));
 const admission=async()=>({admitted:true as const,reservedMicros:1,settle:async()=>{}});
 await generateWebsiteJobGPT(context,owner,'synthetic',{store:f.store,complete,admission});
 await generateWebsiteJobGPT(context,owner,'synthetic',{store:f.store,complete,admission});expect(complete).toHaveBeenCalledTimes(1);
 const result=await f.store.read(owner);expect(result!.runs[0].items[0].reasons).toEqual(['PAIR_CHECKS_PASSED']);
 expect(renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'ready',data:result!}}))).toContain('UNRESOLVED');
 expect(f.query.mock.calls.every(c=>c[0].includes('AS compatible')||c[0].startsWith('SELECT fingence_gpt_website.operate'))).toBe(true);
});
it('review-only SQL is additive, atomic, forced-RLS, immutable and execute-only',()=>{
 const sql=readFileSync('supabase/sql/ai06-website-gpt-storage-review.sql','utf8');
 expect(sql).toMatch(/BEGIN;/);expect(sql.trim()).toMatch(/COMMIT;$/);expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(3);
 expect(sql.match(/BEFORE UPDATE OR DELETE OR TRUNCATE/g)).toHaveLength(3);
 expect(sql).toContain('fingence_workspace.actor(p_token_hash)');expect(sql).toContain('ON CONFLICT(job_id) DO NOTHING');
 expect(sql).toContain("event='SAVED'");expect(sql).toContain('SECURITY DEFINER SET search_path=pg_catalog');
 expect(sql).not.toMatch(/ALTER TABLE (?:fingence_workspace|fingence_processing|fingence_ingestion|fingence_reconciliation)\./);
 expect(sql).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL)/);expect(sql).not.toMatch(/PASSWORD|CREATE ROLE .* LOGIN /);
});
