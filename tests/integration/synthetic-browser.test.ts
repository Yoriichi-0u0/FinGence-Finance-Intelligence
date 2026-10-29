import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const auditFailure=vi.hoisted(()=>({enabled:false}));
vi.mock('../../lib/server/security/audit-store',async importOriginal=>{
 const original=await importOriginal<typeof import('../../lib/server/security/audit-store')>();
 return {...original,persistSecurityAuditEvent:async (...args:Parameters<typeof original.persistSecurityAuditEvent>)=>{if(auditFailure.enabled)throw new Error('audit unavailable');return original.persistSecurityAuditEvent(...args);}};
});
import {GET,POST} from '../../app/api/ai-ingestion/synthetic-financial/route';
const token='a'.repeat(64), origin='http://localhost:3150';
vi.stubEnv('NODE_ENV','development');vi.stubEnv('FINGENCE_AI_LOCAL','1');vi.stubEnv('FINGENCE_V2_I1_LOCAL','1');vi.stubEnv('FINGENCE_V2_I1_TOKEN',token);vi.stubEnv('VERCEL','');
afterAll(()=>vi.unstubAllEnvs());
function request(path:string,auth=token){return new Request(origin+path,{headers:{authorization:`Bearer ${auth}`,origin}});}
function upload(bytes:Uint8Array,id:string,auth=token){const form=new FormData();form.append('file',new File([Uint8Array.from(bytes)],'sample.csv'));return new Request(origin+'/api/ai-ingestion/synthetic-financial',{method:'POST',headers:{authorization:`Bearer ${auth}`,origin,'x-fingence-operation':id},body:form});}
describe('local synthetic browser path',()=>{
 it('processes real source bytes, stores accepted rows, calculates and returns matching report and answer',async()=>{
  const id=randomUUID(),bytes=readFileSync('public/samples/ingestion/edge_cases.csv');
  const posted=await POST(upload(bytes,id));expect(posted.status).toBe(200);const created=await posted.json();
  const replay=await POST(upload(bytes,id));expect(replay.status).not.toBe(200);
  const lookup=await GET(request(`/api/ai-ingestion/synthetic-financial?operation=${id}`));expect(await lookup.json()).toEqual({state:'COMMITTED',batchId:created.batchId,sourceFile:'edge_cases.csv'});
  const response=await GET(request(`/api/ai-ingestion/synthetic-financial?batch=${created.batchId}`));expect(response.status).toBe(200);const data=await response.json();
  expect(data.batch).toMatchObject({rows_received:8,valid_count:2,warning_count:3,rejected_count:3});expect(data.records).toHaveLength(5);
  const report=JSON.parse(data.report);expect(report).toMatchObject({total:'105.5',currency:'MYR',includedCount:2,excludedWarnings:3,publicationEligible:false});expect(data.calculation.value).toBe(report.total);expect(data.answer.value).toBe(report.total);expect(data.answer.sources).toEqual(report.sources);
  expect((await GET(request(`/api/ai-ingestion/synthetic-financial?batch=${created.batchId}`,'b'.repeat(64)))).status).toBe(404);
  auditFailure.enabled=true;expect((await GET(request(`/api/ai-ingestion/synthetic-financial?batch=${created.batchId}`))).status).toBe(404);auditFailure.enabled=false;
  const failedId=randomUUID();auditFailure.enabled=true;expect((await POST(upload(bytes,failedId))).status).toBe(503);auditFailure.enabled=false;
  const failedLookup=await GET(request(`/api/ai-ingestion/synthetic-financial?operation=${failedId}`));expect(await failedLookup.json()).toEqual({state:'UNKNOWN'});
  vi.stubEnv('FINGENCE_V2_I1_TOKEN','b'.repeat(64));expect((await GET(request(`/api/ai-ingestion/synthetic-financial?batch=${created.batchId}`,'b'.repeat(64)))).status).toBe(404);vi.stubEnv('FINGENCE_V2_I1_TOKEN',token);
  const reprocessed=await POST(upload(bytes,randomUUID()));expect(reprocessed.status).toBe(200);const next=await reprocessed.json();expect(next.batchId).not.toBe(created.batchId);
  const updated=await GET(request(`/api/ai-ingestion/synthetic-financial?batch=${next.batchId}`));const updatedData=await updated.json();expect(updatedData.calculation.value).toBe('105.5');expect(updatedData.batch.id).toBe(next.batchId);
 },30000);
 it('rejects unsupported sample bytes and is unavailable in hosted mode',async()=>{
  expect((await POST(upload(Buffer.from('not a registered sample'),randomUUID()))).status).not.toBe(200);
  const cross=new Request(origin+'/api/ai-ingestion/synthetic-financial?batch='+randomUUID(),{headers:{authorization:`Bearer ${token}`,origin:'http://malicious.example'}});expect((await GET(cross)).status).toBe(404);
  vi.stubEnv('VERCEL','1');expect((await GET(request('/api/ai-ingestion/synthetic-financial?batch='+randomUUID()))).status).toBe(404);vi.stubEnv('VERCEL','');
 });
});
