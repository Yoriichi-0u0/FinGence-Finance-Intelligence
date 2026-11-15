import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const poolState=vi.hoisted(()=>({error:null as unknown}));
vi.mock('pg',async original=>{const actual=await original<typeof import('pg')>();return {...actual,Pool:class{
 on(){return this;} async connect(){throw poolState.error;} async end(){}
}};});
import {PostgresWebsiteGPTStore,createWebsiteGPTDatabase,websiteGPTDatabaseEnvironment,websiteGPTStorageConfigured} from '../../lib/server/reconciliation/website-gpt-storage';
import {WebsiteGPTError,reportWebsiteGPT,websiteGPTSqlError} from '../../lib/server/reconciliation/website-gpt-diagnostics';
import {readWebsiteJobSuggestions,saveWebsiteJobSuggestions,type Owner,type WebsiteGPTStore} from '../../lib/server/reconciliation/website-job-gpt';
import {PersistenceError} from '../../lib/server/persistence/contracts';
import type {SqlConnection,TransactionDatabase} from '../../lib/server/db/postgres';
import type {Caller} from '../../lib/server/workspace/session';
import {GET} from '../../app/api/reconciliation/website-gpt-evidence/route';
import {GET as legacyGET} from '../../app/api/reconciliation/gpt-evidence/route';
import {caller} from '../../lib/server/workspace/session';
import type {ProcessingContext} from '../../lib/demo/pipeline';
import {GPTSuggestionsView,loadGPTEvidence} from '../../components/reconciliation/gpt-suggestions';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const owner:Owner={organizationId:'00000000-0000-4000-8000-000000000001',memberId:'00000000-0000-4000-8000-000000000002',jobId:'00000000-0000-4000-8000-000000000003'},hash='a'.repeat(64);
const environment={FINGENCE_GPT_SUGGESTIONS:'1',FINGENCE_GPT_STORAGE:'postgres',FINGENCE_GPT_STORAGE_APPROVAL:'website-gpt/1',FINGENCE_GPT_DATABASE_URL:'postgresql://fingence_ai06_website_login:synthetic@db.zmtdozblpvtjniehwjrw.supabase.co:5432/postgres?sslmode=verify-full'};
const verify=async():Promise<Caller>=>({kind:'SIGNED_IN',tokenHash:hash,principal:{sessionId:'synthetic',memberId:owner.memberId,email:'synthetic@example.invalid',role:'FINANCE',organization:{id:owner.organizationId,name:'Synthetic'},processing:{paused:false,reason:null,since:null},ai:{enabled:true,since:null}}});
const request=(query=`jobId=${owner.jobId}`)=>new Request(`http://localhost/?${query}`);
const backend=():WebsiteGPTStore=>({claim:async()=>true,audit:async()=>{},save:async()=>{},read:async()=>null});
let logs:ReturnType<typeof vi.spyOn>;
beforeEach(()=>{logs=vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
function dbFixture(){
 const state={gate:true,gateError:null as unknown,sqlError:null as unknown,rows:[{result:{organizationId:owner.organizationId,memberId:owner.memberId,value:null}}] as Record<string,unknown>[]};
 const query=vi.fn(async(sql:string)=>{if(sql.includes('AS compatible')){if(state.gateError)throw state.gateError;return {rows:[{compatible:state.gate}],rowCount:1};}if(state.sqlError)throw state.sqlError;return {rows:state.rows,rowCount:state.rows.length};});
 const database:TransactionDatabase={transaction:async<T>(work:(tx:SqlConnection)=>Promise<T>)=>work({query} as unknown as SqlConnection),close:async()=>{}};
 return {state,query,store:new PostgresWebsiteGPTStore(database,hash)};
}
it.each([
 [{FINGENCE_GPT_SUGGESTIONS:'0'},'GPT_STORAGE_DISABLED'],
 [{FINGENCE_GPT_STORAGE:'other'},'GPT_BACKEND_UNAPPROVED'],
 [{FINGENCE_GPT_STORAGE_APPROVAL:''},'GPT_APPROVAL_REQUIRED'],
 [{FINGENCE_GPT_DATABASE_URL:''},'GPT_DATABASE_URL_MISSING'],
 [{FINGENCE_GPT_DATABASE_URL:'private-invalid-value'},'GPT_DATABASE_INVALID'],
 [{FINGENCE_GPT_DATABASE_URL:environment.FINGENCE_GPT_DATABASE_URL.replace('verify-full','disable')},'GPT_DATABASE_INVALID'],
 [{FINGENCE_GPT_DATABASE_CA_CERT:'private-invalid-certificate'},'GPT_DATABASE_INVALID'],
 [{FINGENCE_GPT_DATABASE_URL:environment.FINGENCE_GPT_DATABASE_URL.replace('zmtdozblpvtjniehwjrw','unrelated')},'GPT_RESTRICTED_CONNECTION_REQUIRED'],
] as const)('diagnoses rejected config without logging values: %j',async(overrides,reason)=>{
 for(const [key,value]of Object.entries({...environment,...overrides}))vi.stubEnv(key,value);
 expect(()=>websiteGPTDatabaseEnvironment()).toThrow(reason);expect(websiteGPTStorageConfigured(true)).toBe(false);
 const response=await GET(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'GPT_UNAVAILABLE'});
 expect(logs.mock.calls.flat().join(' ')).toContain(reason);expect(logs.mock.calls.flat().join(' ')).not.toContain('private-invalid');expect(logs.mock.calls.flat().join(' ')).not.toContain('synthetic@');
});
it.each(['null','session-unavailable','session-throws','factory-null','factory-throws','read-throws'] as const)('traces the reader 503 path: %s',async mode=>{
 const store=backend();let check=verify;let selected:Parameters<typeof readWebsiteJobSuggestions>[1]['store']=store;
 if(mode==='null')selected=null;if(mode==='session-unavailable')check=async()=>({kind:'UNAVAILABLE'});if(mode==='session-throws')check=async()=>{throw Error('PRIVATE_AUTH_DATA');};
 if(mode==='factory-null')selected=()=>null;if(mode==='factory-throws')selected=()=>{throw Error('PRIVATE_CONFIGURATION');};if(mode==='read-throws')store.read=async()=>{throw Error('PRIVATE_SQL_AND_SECRET');};
 const response=await readWebsiteJobSuggestions(request(),{store:selected,verify:check});expect(response.status).toBe(503);expect(await response.text()).not.toContain('PRIVATE');expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE');
});
it.each(['-'.repeat(36),'jobId=bad','jobId=a&organizationId=b','jobId=a&jobId=b'])('rejects malformed requests before lookup: %s',async query=>{
 const check=vi.fn(verify);const response=await readWebsiteJobSuggestions(request(query.startsWith('jobId=')?query:`jobId=${query}`),{store:backend(),verify:check});expect(response.status).toBe(400);expect(check).not.toHaveBeenCalled();
});
it.each(['DATABASE_UNAVAILABLE','PERSISTENCE_FAILED','COMMIT_OUTCOME_UNKNOWN','ROLLBACK_UNCONFIRMED'] as const)('keeps %s opaque and fail closed',async code=>{
 const store=backend();store.read=async()=>{throw new PersistenceError(code);};const r=await readWebsiteJobSuggestions(request(),{store,verify});expect(r.status).toBe(503);expect(await r.json()).toEqual({code:'GPT_UNAVAILABLE'});expect(JSON.stringify(logs.mock.calls)).toContain(code);
});
it.each([
 ['42501','AI06 job denied','GPT_JOB_DENIED',404],['42501','AI06 ingestion scope denied','GPT_JOB_DENIED',404],
 ['42501','AI06 session ended','GPT_SESSION_DENIED',401],['42501','AI06 membership denied','GPT_SESSION_DENIED',401],
 ['42501','PRIVATE_PERMISSION_DETAIL','GPT_SQL_ACCESS_DENIED',503],['42P01','PRIVATE_TABLE','GPT_SQL_CONTRACT_MISSING',503],
 ['42883','PRIVATE_FUNCTION','GPT_SQL_CONTRACT_MISSING',503],['23505','PRIVATE_ID','GPT_SQL_DUPLICATE',503],['P0001','PRIVATE_AUDIT_ERROR','GPT_SQL_FAILED',503],
])('maps SQL %s/%s to a safe response',async(code,message,reason,status)=>{
 const f=dbFixture();f.state.sqlError={code,message};expect(websiteGPTSqlError(f.state.sqlError).reason).toBe(reason);
 const response=await readWebsiteJobSuggestions(request(),{store:f.store,verify});expect(response.status).toBe(status);expect(await response.text()).not.toContain(message);expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE');
});
it.each(['denied','gate-query','missing-response','scope','invalid-evidence'] as const)('traces runtime/result validation failures: %s',async mode=>{
 const f=dbFixture();if(mode==='denied')f.state.gate=false;if(mode==='gate-query')f.state.gateError={code:'42P01',message:'PRIVATE_CATALOG'};
 if(mode==='missing-response')f.state.rows=[];if(mode==='scope')f.state.rows=[{result:{organizationId:'other',memberId:owner.memberId,value:null}}];
 if(mode==='invalid-evidence')f.state.rows=[{result:{organizationId:owner.organizationId,memberId:owner.memberId,value:{private:'PRIVATE_EVIDENCE'}}}];
 const response=await readWebsiteJobSuggestions(request(),{store:f.store,verify});expect(response.status).toBe(503);expect(await response.text()).not.toContain('PRIVATE');expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE');
});
it.each([
 ['ERR_TLS_CERT_ALTNAME_INVALID','DB_TLS_FAILED'],['CERT_HAS_EXPIRED','DB_TLS_FAILED'],['SELF_SIGNED_CERT_IN_CHAIN','DB_TLS_FAILED'],
 ['28P01','DB_AUTH_FAILED'],['28000','DB_AUTH_FAILED'],['ENOTFOUND','DB_NETWORK_FAILED'],['ECONNREFUSED','DB_NETWORK_FAILED'],['ETIMEDOUT','DB_NETWORK_FAILED'],['UNKNOWN_PRIVATE_CODE','DB_CONNECT_FAILED'],
])('diagnoses connect failure %s without unsafe details',async(code,reason)=>{
 poolState.error={code,message:'PRIVATE_PASSWORD_URL_AND_SQL'};const db=createWebsiteGPTDatabase({SUPABASE_DATABASE_URL:environment.FINGENCE_GPT_DATABASE_URL});
 try{const response=await readWebsiteJobSuggestions(request(),{store:new PostgresWebsiteGPTStore(db,hash),verify});expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'GPT_UNAVAILABLE'});expect(JSON.stringify(logs.mock.calls)).toContain(reason);expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE');}finally{await db.close();}
});
it('keeps absence distinct from outages and keeps diagnostics schema strictly allowlisted',async()=>{
 expect((await readWebsiteJobSuggestions(request(),{store:backend(),verify})).status).toBe(404);
 for(const kind of ['ANONYMOUS','ENDED'] as const)expect((await readWebsiteJobSuggestions(request(),{store:backend(),verify:async()=>({kind})})).status).toBe(401);
 reportWebsiteGPT('READ','READ_FAILED');const event=JSON.parse(String(logs.mock.calls.at(-1)![0]));expect(Object.keys(event)).toEqual(['event','stage','reason']);
 const count=logs.mock.calls.length;reportWebsiteGPT('READ','PRIVATE' as never);expect(logs.mock.calls.length).toBe(count);
 expect(new WebsiteGPTError('GPT_JOB_DENIED')).toBeInstanceOf(PersistenceError);
});
it.each(['http','malformed-json','network'] as const)('reproduces workspace RPC %s failure using the real caller',async mode=>{
 const response=await readWebsiteJobSuggestions(new Request(request().url,{headers:{cookie:`fingence_session=${'X'.repeat(43)}`}}),{store:backend(),verify:headers=>caller(headers,{url:'https://synthetic.invalid',key:'synthetic-only'},async()=>{
  if(mode==='network')throw Error('PRIVATE_AUTH_NETWORK');return mode==='http'?Response.json({private:'PRIVATE_RPC_ERROR'},{status:500}):new Response('not json');
 })});expect(response.status).toBe(503);expect(JSON.stringify(logs.mock.calls)).toContain('SESSION_SERVICE_UNAVAILABLE');expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE');
});
it.each(['gateway','key3','budget'] as const)('diagnoses generation readiness %s without a provider call or evidence read outage',async mode=>{
 for(const [key,value]of Object.entries(environment))vi.stubEnv(key,value);
 vi.stubEnv('FINGENCE_GPT_GENERATION','1');vi.stubEnv('FINGENCE_GPT_PILOT_MEMBER_ID',owner.memberId);vi.stubEnv('FINGENCE_AI_GATEWAY',mode==='gateway'?'0':'1');vi.stubEnv('GROQ_API_KEY3',mode==='key3'?'':'synthetic-three');
 vi.stubEnv('VERCEL','1');for(const key of Object.keys(process.env))if(/FINGENCE_AI_BUDGET_REST_(URL|TOKEN)$|UPSTASH_REDIS_REST_(URL|TOKEN)$|KV_REST_API_(URL|TOKEN)$/.test(key))vi.stubEnv(key,'');
 await saveWebsiteJobSuggestions({} as ProcessingContext,owner,'synthetic',hash);
 expect(JSON.stringify(logs.mock.calls)).toContain(mode==='gateway'?'GPT_GATEWAY_DISABLED':mode==='key3'?'GPT_KEY3_MISSING':'GPT_BUDGET_UNAVAILABLE');
 expect((await readWebsiteJobSuggestions(request(),{store:backend(),verify})).status).toBe(404);
});
it('keeps the separate DB04 endpoint deliberately disabled and renders generic UI without inventing the cause',async()=>{
 expect((await legacyGET(new Request('http://localhost/?batchId=synthetic'))).status).toBe(503);
 expect(await loadGPTEvidence(owner.jobId,new AbortController().signal,async()=>new Response('',{status:503}),true)).toEqual({status:'unavailable'});
 const html=renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'unavailable'}}));expect(html).toContain('contact your administrator');expect(html).not.toContain('saved database batch are required');
});
