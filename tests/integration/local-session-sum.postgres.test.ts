import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {Pool} from 'pg';
import {transactionDatabase,type QueryResult,type TransactionDatabase} from '../../lib/server/db/postgres';
import {createGroupedPersistenceService} from '../../lib/server/persistence/grouped';
import {createLocalSessionSumService} from '../../lib/server/integration/local-session-sum';
import {consultationResults} from './fixtures';
const bin=process.env.FINGENCE_TEST_PG_BIN??'/opt/homebrew/opt/postgresql@18/bin';
const exe=(name:string)=>join(bin,name+(process.platform==='win32'?'.exe':''));
const available=existsSync(exe('initdb'))&&existsSync(exe('pg_ctl'));
describe.skipIf(!available)('native PostgreSQL session and financial calculation fencing',()=>{
 let folder:string,port:number,pool:Pool,database:TransactionDatabase,batch:string,ids:string[];
 let started=false;const org=randomUUID(),other=randomUUID(),user=randomUUID(),token=randomBytes(32).toString('base64url');
 const hash=createHash('sha256').update(token).digest('hex');
 const makePool=()=>new Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',max:4,connectionTimeoutMillis:3000,statement_timeout:5000});
 const control=(...args:string[])=>execFileSync(exe('pg_ctl'),['-D',folder,...args],{timeout:30000,stdio:'ignore'});
 beforeAll(async()=>{
  folder=mkdtempSync(join(tmpdir(),'fingence-scope-pg-'));
  execFileSync(exe('initdb'),['-D',folder,'-U','postgres','-A','trust','--no-locale','-E','UTF8'],{timeout:30000,stdio:'ignore'});
  const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
  control('-l',join(folder,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start');started=true;pool=makePool();database=transactionDatabase(pool);
  await pool.query('CREATE ROLE anon;CREATE ROLE authenticated;');
  for(const f of ['phase1-clean-setup.sql','c3b1-grouped-persistence-upgrade.sql','db02-001-warning-mutation-fence.sql','phase3-security-audit-upgrade.sql','phase3-security-audit-api-events.sql','local-synthetic-browser.sql'])await pool.query(readFileSync('supabase/sql/'+f,'utf8'));
  const receipt=await createGroupedPersistenceService(database).persistGroupedAttempt({attempt_id:randomUUID(),results:await consultationResults()});
  batch=receipt.datasets[2].batch_id;
  await pool.query("INSERT INTO fingence_local_security_v1.memberships VALUES($1,$2,'Finance',true,1)",[user,org]);
  await pool.query("INSERT INTO fingence_local_security_v1.sessions VALUES($1,$2,$3,now()+interval '1 hour',false)",[hash,user,org]);
  await pool.query('INSERT INTO fingence_local_security_v1.batch_owners VALUES($1,$2)',[batch,org]);
  ids=(await pool.query("SELECT id::text FROM public.financial_records WHERE batch_id=$1 AND reference IN ('E-001','E-002') AND ingestion_status='VALID' ORDER BY reference",[batch])).rows.map(r=>r.id);
 },60000);
 beforeEach(async()=>{
  await pool.query("UPDATE fingence_local_security_v1.memberships SET active=true,role='Finance'");await pool.query("UPDATE fingence_local_security_v1.sessions SET revoked=false,expires_at=now()+interval '1 hour'");await pool.query('UPDATE fingence_local_security_v1.batch_owners SET organization_id=$1',[org]);
  await pool.query("UPDATE public.financial_records SET source_amount=125.5 WHERE id=$1",[ids[0]]);
 });
 afterAll(async()=>{await pool?.end();if(started)control('-m','fast','-w','stop');if(folder&&folder.startsWith(join(tmpdir(),'fingence-scope-pg-')))rmSync(folder,{recursive:true});},30000);
 function paused(){let signal!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>signal=r),resume=new Promise<void>(r=>release=r);let held=false;
  const wrapped:TransactionDatabase={close:async()=>{},transaction:work=>database.transaction(tx=>work({async query<Row extends Record<string,unknown>>(sql:string,values?:unknown[]):Promise<QueryResult<Row>>{const r=await tx.query<Row>(sql,values);if(!held&&sql.includes('FROM public.financial_records r JOIN')){held=true;signal();await resume;}return r;}}))};return {wrapped,reached,release};
 }
 const changes={
  session:{sql:'UPDATE fingence_local_security_v1.sessions SET revoked=true WHERE token_hash=$1',values:[hash]},
  membership:{sql:'UPDATE fingence_local_security_v1.memberships SET active=false WHERE subject_id=$1',values:[user]},
  role:{sql:"UPDATE fingence_local_security_v1.memberships SET role='Admin' WHERE subject_id=$1",values:[user]},
  ownership:{sql:'UPDATE fingence_local_security_v1.batch_owners SET organization_id=$1 WHERE batch_id=$2',values:[] as string[]},
  amount:{sql:'UPDATE public.financial_records SET source_amount=126.5 WHERE id=$1',values:[null as unknown as string]},
 };
 it.each(['session','membership','role','ownership','amount'] as const)('serializes concurrent %s changes and denies or refreshes the next read',async kind=>{
  const latch=paused(),client=await pool.connect();let change:Promise<unknown>|undefined;
  const sum=createLocalSessionSumService(latch.wrapped).sum(token,ids,'exclude');
  try{
   await Promise.race([latch.reached,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('pause timeout')),3000))]);
   const pid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   const item=changes[kind];const values=kind==='ownership'?[other,batch]:kind==='amount'?[ids[0]]:item.values;
   change=client.query(item.sql,values);let waiting=false;const end=Date.now()+2000;
   while(Date.now()<end){const state=await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);if(state.rows[0]?.wait_event_type==='Lock'){waiting=true;break;}await new Promise(r=>setTimeout(r,15));}
   expect(waiting).toBe(true);latch.release();expect(await sum).toMatchObject({status:'AVAILABLE',total:'105.5'});await change;
   const next=await createLocalSessionSumService(database).sum(token,ids,'exclude');expect(next).toMatchObject(kind==='amount'?{status:'AVAILABLE',total:'106.5'}:{status:'DENIED'});
  }finally{latch.release();await Promise.allSettled([sum,...(change?[change]:[])]);client.release();}
 });
 it('withholds results and rolls back the audit transaction on SQL failure',async()=>{
  const before=(await pool.query('SELECT count(*)::int n FROM public.security_audit_events')).rows[0].n;
  const broken:TransactionDatabase={close:async()=>{},transaction:work=>database.transaction(tx=>work({query:async(sql,values)=>{if(sql.includes('INSERT INTO public.security_audit_events'))await tx.query('SELECT 1/0');return tx.query(sql,values);}}))};
  await expect(createLocalSessionSumService(broken).sum(token,ids,'exclude')).rejects.toThrow('SECURITY_UNAVAILABLE');
  expect((await pool.query('SELECT count(*)::int n FROM public.security_audit_events')).rows[0].n).toBe(before);
 });
 it('withholds results after a committed audit loses its acknowledgement and performs no retry',async()=>{
  let commits=0;const before=(await pool.query('SELECT count(*)::int n FROM public.security_audit_events')).rows[0].n;
  const uncertain=transactionDatabase({end:async()=>{},connect:async()=>{const c=await pool.connect();return {release:(destroy?:boolean)=>c.release(destroy),async query<Row extends Record<string,unknown>>(sql:string,values?:unknown[]):Promise<QueryResult<Row>>{const r=await c.query<Row>(sql,values);if(sql==='COMMIT'){commits++;throw Object.assign(new Error('lost acknowledgement'),{code:'08006'});}return r;}};}});
  await expect(createLocalSessionSumService(uncertain).sum(token,ids,'exclude')).rejects.toThrow('SECURITY_UNAVAILABLE');expect(commits).toBe(1);
  expect((await pool.query('SELECT count(*)::int n FROM public.security_audit_events')).rows[0].n).toBe(before+1);
 });
 it('retains revoked-session denial across a database crash and restart',async()=>{
  await pool.query('UPDATE fingence_local_security_v1.sessions SET revoked=true WHERE token_hash=$1',[hash]);await pool.end();control('-m','immediate','-w','stop');started=false;
  control('-l',join(folder,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start');started=true;pool=makePool();database=transactionDatabase(pool);
  expect(await createLocalSessionSumService(database).sum(token,ids,'exclude')).toEqual({status:'DENIED'});
 });
});
