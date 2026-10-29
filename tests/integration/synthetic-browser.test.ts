import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const auditFailure=vi.hoisted(()=>({enabled:false,calls:0}));
vi.mock('../../lib/server/security/audit-store',async importOriginal=>{const original=await importOriginal<typeof import('../../lib/server/security/audit-store')>();return {...original,persistSecurityAuditEvent:async (...args:Parameters<typeof original.persistSecurityAuditEvent>)=>{if(auditFailure.enabled)throw new Error('audit unavailable');auditFailure.calls++;return original.persistSecurityAuditEvent(...args);}};});
import {GET,POST} from '../../app/api/ai-ingestion/synthetic-financial/route';
import {syntheticBrowserRuntime} from '../../lib/server/integration/synthetic-browser';
import {localTenant} from '../../lib/server/ai-ingestion/v2-i1/local-auth';
let generation='';
const bootstrap='a'.repeat(64),origin='http://localhost:3150',base='/api/ai-ingestion/synthetic-financial';
vi.stubEnv('NODE_ENV','development');vi.stubEnv('FINGENCE_AI_LOCAL','1');vi.stubEnv('FINGENCE_V2_I1_LOCAL','1');vi.stubEnv('FINGENCE_V2_I1_TOKEN',bootstrap);vi.stubEnv('VERCEL','');
function req(path:string,cookie='',method='GET'){return new Request(origin+base+path,{method,headers:{cookie,origin}});}
function upload(file:string,id:string,cookie:string){const form=new FormData();form.append('file',new File([readFileSync('public/samples/ingestion/'+file)],file));return new Request(origin+base,{method:'POST',headers:{cookie,origin,'x-fingence-operation':id,'x-fingence-generation':generation},body:form});}
async function login(){const r=await POST(new Request(origin+base+'?action=login',{method:'POST',headers:{origin,authorization:`Bearer ${bootstrap}`}}));expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toContain('HttpOnly');expect(r.headers.get('set-cookie')).toContain('SameSite=Strict');generation=(await r.json()).generation;return r.headers.get('set-cookie')!.split(';')[0];}
const tenant=localTenant(new Request(origin,{headers:{origin,authorization:`Bearer ${bootstrap}`}}))!;
afterAll(async()=>{await (await syntheticBrowserRuntime(tenant)).close();vi.unstubAllEnvs();});
describe('session-backed local synthetic browser',()=>{
 it('requires a session, preserves CSV/report/answer values and audits before delivery',async()=>{
  expect((await GET(req('?batch='+randomUUID()))).status).toBe(404);
  const cookie=await login(),id=randomUUID();const posted=await POST(upload('edge_cases.csv',id,cookie));expect(posted.status).toBe(200);const created=await posted.json();
  expect((await POST(upload('edge_cases.csv',id,cookie))).status).not.toBe(200);
  expect(await (await GET(req('?operation='+id,cookie))).json()).toEqual({state:'COMMITTED',batchId:created.batchId,sourceFile:'edge_cases.csv'});
  const before=auditFailure.calls;const result=await GET(req('?batch='+created.batchId,cookie));expect(result.status).toBe(200);const data=await result.json();expect(auditFailure.calls-before).toBe(1);
  expect(data.batch).toMatchObject({rows_received:8,valid_count:2,warning_count:3,rejected_count:3});expect(data.records).toHaveLength(5);
  const report=JSON.parse(data.report);expect(report).toMatchObject({total:'105.5',currency:'MYR',includedCount:2,excludedWarnings:3,publicationEligible:false});expect(data.answer.value).toBe(report.total);expect(data.answer.sources).toEqual(report.sources);
  auditFailure.enabled=true;expect((await GET(req('?batch='+created.batchId,cookie))).status).toBe(404);const failedId=randomUUID();expect((await POST(upload('edge_cases.csv',failedId,cookie))).status).toBe(503);auditFailure.enabled=false;
  expect(await (await GET(req('?operation='+failedId,cookie))).json()).toEqual({state:'UNKNOWN'});
  const blocked=req('?action=retire',cookie,'POST');blocked.headers.set('x-fingence-operation',failedId);blocked.headers.set('x-fingence-generation',generation);blocked.headers.set('x-fingence-operation-generation',generation);
  expect(await (await POST(blocked)).json()).toEqual({state:'UNKNOWN'});
  expect((await POST(upload('edge_cases.csv',failedId,cookie))).status).not.toBe(200);
  const next=await (await POST(upload('edge_cases.csv',randomUUID(),cookie))).json();expect(next.batchId).not.toBe(created.batchId);
  const bank=await (await POST(upload('bank_statement.xlsx',randomUUID(),cookie))).json();const bankData=await (await GET(req('?batch='+bank.batchId,cookie))).json();expect(bankData.batch.valid_count).toBe(8);expect(bankData.report).toBeNull();
  expect((await GET(req('?batch='+created.batchId,'fingence_demo_session='+'b'.repeat(43)))).status).toBe(404);
 },30000);
 it('denies expired and revoked sessions and pushes acknowledged revocation',async()=>{
  const runtime=await syntheticBrowserRuntime(tenant),cookie=await login(),token=cookie.split('=')[1];
  const events=await GET(req('?action=events',cookie));expect(events.status).toBe(200);const reader=events.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: active');
  await runtime.revoke(token);expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: revoked');await reader.cancel();
  expect((await GET(req('?batch='+randomUUID(),cookie))).status).toBe(404);
  const expired=await runtime.createSession(1);await new Promise(resolve=>setTimeout(resolve,15));expect((await GET(req('?batch='+randomUUID(),'fingence_demo_session='+expired.token))).status).toBe(404);
  await expect(syntheticBrowserRuntime(randomUUID())).rejects.toThrow('DENIED');
 });
 it('fences delayed uploads and explicitly retires absent or previous-generation references',async()=>{
  const cookie=await login();const session=await (await GET(req('?action=session',cookie))).json();
  expect(session.generation).toMatch(/^[0-9a-f-]{36}$/);
  const id=randomUUID(),previousGeneration=randomUUID();
  const retired=await GET(req('?operation='+id+'&generation='+previousGeneration,cookie));
  expect(await retired.json()).toEqual({state:'RETIRED_GENERATION',operationId:id,generation:previousGeneration,currentGeneration:session.generation});
  const late=upload('edge_cases.csv',id,cookie);late.headers.set('x-fingence-generation',previousGeneration);
  expect((await POST(late)).status).not.toBe(200);
  const absent=randomUUID();expect(await (await GET(req('?operation='+absent+'&generation='+session.generation,cookie))).json()).toMatchObject({state:'NOT_REGISTERED'});
  const retire=req('?action=retire',cookie,'POST');retire.headers.set('x-fingence-operation',absent);retire.headers.set('x-fingence-generation',session.generation);retire.headers.set('x-fingence-operation-generation',session.generation);
  expect(await (await POST(retire)).json()).toEqual({state:'RETIRED',operationId:absent,generation:session.generation,currentGeneration:session.generation});
  const delayed=upload('edge_cases.csv',absent,cookie);delayed.headers.set('x-fingence-generation',session.generation);
  expect((await POST(delayed)).status).not.toBe(200);
  const legacy=randomUUID(),legacyRetire=req('?action=retire',cookie,'POST');legacyRetire.headers.set('x-fingence-operation',legacy);legacyRetire.headers.set('x-fingence-generation',session.generation);
  expect(await (await POST(legacyRetire)).json()).toEqual({state:'RETIRED',operationId:legacy,generation:null,currentGeneration:session.generation});
  const legacyDelayed=upload('edge_cases.csv',legacy,cookie);expect((await POST(legacyDelayed)).status).not.toBe(200);
  const invalid=req('?action=retire','fingence_demo_session='+'b'.repeat(43),'POST');invalid.headers.set('x-fingence-operation',randomUUID());invalid.headers.set('x-fingence-generation',session.generation);
  expect((await POST(invalid)).status).toBe(404);
 });
 it('recovers committed processing after lost or undecodable responses without a second write',async()=>{
  const cookie=await login(),id=randomUUID();
  // Do not consume the successful processing response; keep the pending identity.
  const lost=await POST(upload('edge_cases.csv',id,cookie));expect(lost.status).toBe(200);
  const recovered=await (await GET(req('?operation='+id+'&generation='+generation,cookie))).json();expect(recovered.state).toBe('COMMITTED');
  const data=await (await GET(req('?batch='+recovered.batchId,cookie))).json();expect(data.calculation.value).toBe('105.5');
  await expect(new Response('{"batchId":').json()).rejects.toThrow();
  expect(await (await GET(req('?operation='+id+'&generation='+generation,cookie))).json()).toEqual(recovered);
  expect((await POST(upload('edge_cases.csv',id,cookie))).status).not.toBe(200);
  const retire=req('?action=retire',cookie,'POST');retire.headers.set('x-fingence-operation',id);retire.headers.set('x-fingence-generation',generation);retire.headers.set('x-fingence-operation-generation',generation);
  expect(await (await POST(retire)).json()).toEqual(recovered);
 });
 it('rejects cross-origin mutations, invalid bootstrap and hosted access',async()=>{
  expect((await POST(new Request(origin+base+'?action=login',{method:'POST',headers:{origin:'http://malicious.example',authorization:`Bearer ${bootstrap}`}}))).status).toBe(404);
  expect((await POST(new Request(origin+base+'?action=login',{method:'POST',headers:{origin,authorization:'Bearer '+'b'.repeat(64)}}))).status).toBe(404);
  vi.stubEnv('VERCEL','1');expect((await GET(req('?action=session'))).status).toBe(404);vi.stubEnv('VERCEL','');
 });
});
