import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createLocalSecurityFixture } from './backend-security.fixtures';
import { createGroundedEvidenceService } from '../../lib/server/integration/grounded-evidence';
let f:Awaited<ReturnType<typeof createLocalSecurityFixture>>;
beforeAll(async()=>{f=await createLocalSecurityFixture();},30000);afterAll(async()=>{await f?.close();});
function service(){return createGroundedEvidenceService({readConnection:f.pool,auditDatabase:f.database,resolvePrincipal:f.resolvePrincipal,resolveAccess:f.resolveAccess,resolveTransactionScope:f.resolveTransactionScope,cursorSecret:'synthetic-cursor-secret-at-least-32-bytes-long'});}
describe('server-only scoped answer evidence',()=>{
 it('verifies a source-linked exact monetary claim after real scoped read and durable audit',async()=>{
  const row=(await service().retrieve((await f.pool.query('SELECT id::text FROM public.financial_records WHERE source_amount IS NOT NULL ORDER BY id LIMIT 1')).rows[0].id,f.request('session-a')));
  const before=(await f.pool.query('SELECT count(*)::int AS n FROM public.security_audit_events')).rows[0].n;
  const answer=await service().verify(row.transaction_id,f.request('session-a'),{claims:[{field:'source_amount',value:row.source_amount}]});
  const after=(await f.pool.query('SELECT count(*)::int AS n FROM public.security_audit_events')).rows[0].n;expect(after-before).toBe(1);
  expect(answer.claims[0].value).toBe(row.source_amount);expect(answer.sourceRowId).toBe(row.source_row_id);expect(answer.origin).toBe('VERIFIED_SOURCE_CLAIMS');
 });
 it('rejects invented numbers, arbitrary prose and fields',async()=>{
  const id=(await f.pool.query('SELECT id::text FROM public.financial_records WHERE source_amount IS NOT NULL ORDER BY id LIMIT 1')).rows[0].id;
  await expect(service().verify(id,f.request('session-a'),{claims:[{field:'source_amount',value:'999999999.99'}]})).rejects.toThrow('UNSUPPORTED_CLAIM');
  await expect(service().verify(id,f.request('session-a'),{answer:'invented revenue',claims:[]})).rejects.toThrow('INVALID_PROPOSAL');
  await expect(service().verify(id,f.request('session-a'),{claims:[{field:'derived_ledger_net',value:'0'}]})).rejects.toThrow('INVALID_PROPOSAL');
 });
 it('denies cross-organization access before any financial response',async()=>{
  const id=(await f.pool.query('SELECT id::text FROM public.financial_records ORDER BY id LIMIT 1')).rows[0].id;
  await expect(service().retrieve(id,f.request('session-b'))).rejects.toMatchObject({status:404});
 });
});

it('never releases evidence if durable audit acknowledgement fails',async()=>{
 const id=(await f.pool.query('SELECT id::text FROM public.financial_records ORDER BY id LIMIT 1')).rows[0].id;
 const broken={close:async()=>{},transaction:async()=>{throw new Error('private database detail');}};
 const api=createGroundedEvidenceService({readConnection:f.pool,auditDatabase:broken,resolvePrincipal:f.resolvePrincipal,resolveAccess:f.resolveAccess,resolveTransactionScope:f.resolveTransactionScope,cursorSecret:'synthetic-cursor-secret-at-least-32-bytes-long'});
 await expect(api.retrieve(id,f.request('session-a'))).rejects.toThrow();
});
