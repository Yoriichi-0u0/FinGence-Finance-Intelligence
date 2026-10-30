import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createLocalSecurityFixture} from './backend-security.fixtures';
import {createLocalSessionSumService} from '../../lib/server/integration/local-session-sum';
import {createLocalFinancialReportService} from '../../lib/server/integration/local-financial-report';
import type {TransactionDatabase,SqlConnection,QueryResult} from '../../lib/server/db/postgres';

let f:Awaited<ReturnType<typeof createLocalSecurityFixture>>;
const orgA=randomUUID(),orgB=randomUUID(),userA=randomUUID(),userB=randomUUID();
const tokenA=randomBytes(32).toString('base64url'),tokenB=randomBytes(32).toString('base64url');
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
beforeAll(async()=>{
 f=await createLocalSecurityFixture();await f.local.exec(readFileSync('tests/fixtures/local-session-scope.sql','utf8'));
 for(const [org,user,token] of [[orgA,userA,tokenA],[orgB,userB,tokenB]]){
  await f.pool.query('INSERT INTO fingence_local_security_v1.memberships(subject_id,organization_id,role,active,scope_version) VALUES($1,$2,$3,true,1)',[user,org,'Finance']);
  await f.pool.query("INSERT INTO fingence_local_security_v1.sessions(token_hash,subject_id,organization_id,expires_at,revoked) VALUES($1,$2,$3,now()+interval '1 hour',false)",[digest(token),user,org]);
 }
 for(const batch of f.receipt.datasets)await f.pool.query('INSERT INTO fingence_local_security_v1.batch_owners(batch_id,organization_id) VALUES($1,$2)',[batch.batch_id,orgA]);
},30000);afterAll(async()=>{await f?.close();});
async function ids(){return (await f.pool.query("SELECT id::text FROM public.financial_records WHERE source_file='edge_cases.csv' AND reference IN ('E-001','E-002') AND ingestion_status='VALID' ORDER BY reference")).rows.map(r=>r.id as string);}
describe('local session and fenced synthetic financial sum',()=>{
 it('checks a hashed live session and commits a content-free audit with the exact result',async()=>{
  const before=(await f.pool.query('SELECT count(*)::int n FROM public.security_audit_events')).rows[0].n;
  const result=await createLocalSessionSumService(f.database).sum(tokenA,await ids(),'include');
  expect(result).toMatchObject({status:'AVAILABLE',total:'105.5',currency:'MYR',includedCount:2});
  const after=(await f.pool.query('SELECT count(*)::int n FROM public.security_audit_events')).rows[0].n;expect(after-before).toBe(1);
  const audit=await f.pool.query('SELECT * FROM public.security_audit_events ORDER BY occurred_at DESC LIMIT 1');expect(JSON.stringify(audit.rows)).not.toContain(tokenA);
 });
 it('denies another tenant and invalid or expired sessions without exposing a result',async()=>{
  const svc=createLocalSessionSumService(f.database), selection=await ids();
  expect(await svc.sum(tokenB,selection,'include')).toEqual({status:'DENIED'});
  expect(await svc.sum(randomBytes(32).toString('base64url'),selection,'include')).toEqual({status:'DENIED'});
  await f.pool.query("UPDATE fingence_local_security_v1.sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[digest(tokenA)]);
  try {expect(await svc.sum(tokenA,selection,'include')).toEqual({status:'DENIED'});} finally {await f.pool.query("UPDATE fingence_local_security_v1.sessions SET expires_at=now()+interval '1 hour' WHERE token_hash=$1",[digest(tokenA)]);}
 });
 it('denies inactive membership and the other finalized application roles',async()=>{
  const svc=createLocalSessionSumService(f.database),selection=await ids();
  try {
   for(const role of ['Technical (Management)','Admin']){await f.pool.query('UPDATE fingence_local_security_v1.memberships SET role=$1 WHERE subject_id=$2',[role,userA]);expect(await svc.sum(tokenA,selection,'include')).toEqual({status:'DENIED'});}
   await f.pool.query("UPDATE fingence_local_security_v1.memberships SET role='Finance',active=false WHERE subject_id=$1",[userA]);expect(await svc.sum(tokenA,selection,'include')).toEqual({status:'DENIED'});
  } finally {await f.pool.query("UPDATE fingence_local_security_v1.memberships SET role='Finance',active=true WHERE subject_id=$1",[userA]);}
 });
 it('exports and answers from the same authorized calculated value, without a model',async()=>{
  const service=createLocalFinancialReportService(createLocalSessionSumService(f.database));
  const result=await service.build(tokenA,await ids(),'include');
  expect(result.status).toBe('AVAILABLE');
  if(result.status!=='AVAILABLE')throw new Error('expected available');
  expect(result.answer).toMatchObject({origin:'DETERMINISTIC_ONLY',value:'105.5',currency:'MYR'});
  expect(JSON.parse(result.download)).toMatchObject({kind:'SOURCE_SIGNED_AMOUNT_SUM',total:'105.5',currency:'MYR',includedCount:2});
  expect(result.answer.sources).toEqual(JSON.parse(result.download).sources);
  expect(await service.build(tokenB,await ids(),'include')).toEqual({status:'DENIED'});
 });
 it.each(['membership','ownership'] as const)('withholds results when %s changes during calculation',async kind=>{
  const selection=await ids();let changed=false;
  const wrapped:TransactionDatabase={close:async()=>{},transaction:work=>f.database.transaction(async tx=>{
   const conn:SqlConnection={async query<Row extends Record<string,unknown>>(sql:string,values?:unknown[]):Promise<QueryResult<Row>>{
    const result=await tx.query<Row>(sql,values);
    if(!changed&&sql.includes('FROM public.financial_records r JOIN fingence_local_security_v1.batch_owners')){
     changed=true;
     if(kind==='membership')await tx.query('UPDATE fingence_local_security_v1.memberships SET active=false WHERE subject_id=$1',[userA]);
     else await tx.query('UPDATE fingence_local_security_v1.batch_owners SET organization_id=$1 WHERE batch_id=$2',[orgB,f.receipt.datasets[2].batch_id]);
    }
    return result;
   }};return work(conn);
  })};
  try {expect(await createLocalSessionSumService(wrapped).sum(tokenA,selection,'include')).toEqual({status:'DENIED'});expect(changed).toBe(true);}
  finally {await f.pool.query('UPDATE fingence_local_security_v1.memberships SET active=true WHERE subject_id=$1',[userA]);await f.pool.query('UPDATE fingence_local_security_v1.batch_owners SET organization_id=$1 WHERE batch_id=$2',[orgA,f.receipt.datasets[2].batch_id]);}
 });
 it('denies direct client-role reads of session, membership and owner tables',async()=>{
  await f.local.exec('SET ROLE anon');
  try {for(const table of ['sessions','memberships','batch_owners'])await expect(f.local.query(`SELECT * FROM fingence_local_security_v1.${table}`)).rejects.toMatchObject({code:'42501'});}
  finally {await f.local.exec('RESET ROLE');}
 });
 it('never releases financial values if the audit transaction cannot commit',async()=>{
  const bad:TransactionDatabase={close:async()=>{},transaction:work=>f.database.transaction(async tx=>{
   const conn:SqlConnection={async query<Row extends Record<string,unknown>>(sql:string,values?:unknown[]):Promise<QueryResult<Row>>{
    if(sql.includes('INSERT INTO public.security_audit_events'))throw new Error('private audit-store detail');
    return tx.query<Row>(sql,values);
   }};return work(conn);
  })};
  await expect(createLocalSessionSumService(bad).sum(tokenA,await ids(),'include')).rejects.toThrow('SECURITY_UNAVAILABLE');
 });

});
