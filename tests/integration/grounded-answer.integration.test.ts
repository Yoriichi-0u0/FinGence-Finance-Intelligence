import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createLocalSecurityFixture } from './backend-security.fixtures';
import { createGroundedAnswerService } from '../../lib/server/integration/grounded-answer';

let fixture: Awaited<ReturnType<typeof createLocalSecurityFixture>>;
beforeAll(async()=>{fixture=await createLocalSecurityFixture();},30000);
afterAll(async()=>{await fixture?.close();});
function deps(){return {readConnection:fixture.pool,auditDatabase:fixture.database,resolvePrincipal:fixture.resolvePrincipal,resolveAccess:fixture.resolveAccess,resolveTransactionScope:fixture.resolveTransactionScope,cursorSecret:'synthetic-cursor-secret-at-least-32-bytes-long'};}
async function transactionId(){return (await fixture.pool.query('SELECT id::text FROM public.financial_records WHERE source_amount IS NOT NULL ORDER BY id LIMIT 1')).rows[0].id as string;}
describe('local grounded-answer orchestration',()=>{
 it('returns unavailable without a model and makes no financial claim',async()=>{
  const answer=await createGroundedAnswerService(deps()).answer(await transactionId(),fixture.request('session-a'),'What was the source amount?');
  expect(answer).toEqual({status:'UNAVAILABLE',reason:'MODEL_NOT_CONFIGURED'});
 });
 it('releases only exact source-linked claims after audited scope checks',async()=>{
  const propose=vi.fn(async(input:{evidence:{source_amount:string|null}})=>({claims:[{field:'source_amount',value:input.evidence.source_amount}]}));
  const result=await createGroundedAnswerService(deps(),{propose}).answer(await transactionId(),fixture.request('session-a'),'What was the source amount?');
  expect(result.status).toBe('VERIFIED_SOURCE_CLAIMS');
  if(result.status==='VERIFIED_SOURCE_CLAIMS'){expect(result.claims[0].field).toBe('source_amount');expect(result.sourceRowId).toBeTruthy();expect(result.claims[0].value).toBeTruthy();}
  expect(propose).toHaveBeenCalledTimes(1);
 });
 it('returns unsupported for fabricated figures or free-text conclusions',async()=>{
  const id=await transactionId();
  for(const proposal of [{claims:[{field:'source_amount',value:'999999.01'}]},{answer:'Profit rose 999%',claims:[]}]){
   const result=await createGroundedAnswerService(deps(),{propose:async()=>proposal}).answer(id,fixture.request('session-a'),'Summarize');
   expect(result).toEqual({status:'UNSUPPORTED',reason:'UNVERIFIED_CLAIM'});
  }
 });
 it('denies cross-organization access before model invocation',async()=>{
  const propose=vi.fn();await expect(createGroundedAnswerService(deps(),{propose}).answer(await transactionId(),fixture.request('session-b'),'Show amount')).rejects.toMatchObject({status:404});
  expect(propose).not.toHaveBeenCalled();
 });
 it('blocks model invocation and disclosure when durable audit fails',async()=>{
  const propose=vi.fn();const broken={close:async()=>{},transaction:async()=>{throw new Error('private details');}};
  await expect(createGroundedAnswerService({...deps(),auditDatabase:broken},{propose}).answer(await transactionId(),fixture.request('session-a'),'Show amount')).rejects.toThrow();
  expect(propose).not.toHaveBeenCalled();
 });
 it('returns a sanitized unavailable state on model failure',async()=>{
  const result=await createGroundedAnswerService(deps(),{propose:async()=>{throw new Error('private provider detail');}}).answer(await transactionId(),fixture.request('session-a'),'Show amount');
  expect(result).toEqual({status:'UNAVAILABLE',reason:'MODEL_FAILURE'});
 });
 it('does not release a claim if membership is revoked during proposal generation',async()=>{
  const id=await transactionId();
  try {
   const adapter={propose:async(input:{evidence:{source_amount:string|null}})=>{
    await fixture.pool.query("UPDATE test_security.membership SET active=false WHERE subject_id='analyst-a'");
    return {claims:[{field:'source_amount',value:input.evidence.source_amount}]};
   }};
   await expect(createGroundedAnswerService(deps(),adapter).answer(id,fixture.request('session-a'),'Show amount')).rejects.toThrow();
  } finally {await fixture.pool.query("UPDATE test_security.membership SET active=true WHERE subject_id='analyst-a'");}
 });
});
