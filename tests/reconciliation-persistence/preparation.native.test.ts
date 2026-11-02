import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {RecoveryLab,verifyArchive} from '../../scripts/db04-preparation/recovery-lab.mjs';
import {snapshotCombined} from '../../scripts/db04-preparation/snapshot.mjs';
import {transactionDatabase,type TransactionDatabase} from '../../lib/server/db/postgres';
import {createHostedAdmission,HOSTED_ISSUER,type HostedAuthority} from '../../lib/server/reconciliation/hosted-identity';
import {createFinancialProcessingService} from '../../lib/server/reconciliation/service';
import {createTrustedIngestionService,TRUSTED_INGESTION_VERSION} from '../../lib/server/reconciliation/trusted-ingestion';
import {normalizeCashSource} from '../../lib/server/poc-reconciliation/normalize';
import {LocalE5Provider} from '../../lib/server/reconciliation/ai03/model-loader';
import {financialViews} from '../../lib/server/reconciliation/financial-views';
import {createGroupedPersistenceService} from '../../lib/server/persistence/grouped';
import {syntheticResult,header,validRow} from '../persistence/fixtures';
const available=existsSync('C:/Program Files/PostgreSQL/18/bin/initdb.exe');
const org='00000000-0000-4000-8000-000000000001',otherOrg='00000000-0000-4000-8000-000000000002';
const user='00000000-0000-4000-8000-000000000003',otherUser='00000000-0000-4000-8000-000000000004';
const subject='00000000-0000-4000-8000-000000000005',otherSubject='00000000-0000-4000-8000-000000000006';
const bank={bytes:readFileSync(new URL('./fixtures/bank.csv',import.meta.url)),filename:'bank.csv'};
const ledger={bytes:readFileSync(new URL('./fixtures/ledger.csv',import.meta.url)),filename:'ledger.csv'};
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const registry={bank:digest(bank.bytes),ledger:digest(ledger.bytes)};
(available?describe:describe.skip)('combined preparation: SYNTHETIC identity authority, native recovery and DB01--DB04',()=>{
 let lab:RecoveryLab,cluster:Awaited<ReturnType<RecoveryLab['createCluster']>>,owner:Pool,broker:TransactionDatabase,runtime:TransactionDatabase,failed=false;
 const recoveryEvidence:Record<string,unknown>={localSyntheticOnly:true,hostedBackupVerified:false,authority:'SYNTHETIC_TEST_AUTHORITY'};
 const authority=(sub=subject):HostedAuthority=>({kind:'SYNTHETIC_TEST_AUTHORITY',verify:async()=>({issuer:HOSTED_ISSUER,audience:'authenticated',subject:sub,sessionId:randomUUID(),expiresAt:Date.now()+60000}),session:async({subject,sessionId})=>({subject,sessionId,active:true,suspended:false,checkedAt:Date.now()})});
 const admission=(a=authority())=>createHostedAdmission(a,broker);
 const service=()=>createFinancialProcessingService(runtime,registry);
 const run=<T>(f:(token:string)=>Promise<T>,a=authority())=>admission(a).withFinance('synthetic-authority-token',f);
 beforeAll(async()=>{
  lab=new RecoveryLab();cluster=await lab.createCluster('source');owner=await lab.pool(cluster);
  await owner.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role');
  for(const f of ['phase1-clean-setup.sql','c3b1-grouped-persistence-upgrade.sql','db02-001-warning-mutation-fence.sql'])await owner.query(readFileSync('supabase/sql/'+f,'utf8'));
  // Model hostile-to-least-privilege managed defaults on NEW objects only.
  await owner.query('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO service_role; ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO anon,authenticated,service_role');
  for(const f of ['db04-hosted-identity-v1-review.sql','db04-001-reconciliation.sql','db04-002-reconciliation-security.sql','db04-003-ranking-evidence.sql','db04-004-proposal-verification.sql','db04-hosted-principal-v1-review.sql'])await owner.query(readFileSync('supabase/sql/'+f,'utf8'));
  await owner.query('CREATE ROLE prep_runtime LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE fingence_reconciliation_runtime; CREATE ROLE prep_broker LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE fingence_identity_broker');
  await owner.query("INSERT INTO fingence_m2.organizations VALUES($1,'synthetic'),($2,'other')",[org,otherOrg]);
  await owner.query('INSERT INTO fingence_m3.organization_states VALUES($1,true),($2,true)',[org,otherOrg]);
  await owner.query('INSERT INTO fingence_m2.users(id,issuer,subject) VALUES($1,$2,$3),($4,$2,$5)',[user,HOSTED_ISSUER,subject,otherUser,otherSubject]);
  await owner.query("INSERT INTO fingence_m2.memberships VALUES($1,$2,'Finance',true,1),($3,$4,'Finance',true,1)",[user,org,otherUser,otherOrg]);
  const pool=(name:string)=>{const p=new Pool({host:'127.0.0.1',port:cluster.port,database:'postgres',user:name,max:4});p.on('error',()=>{});return transactionDatabase(p);};
  broker=pool('prep_broker');runtime=pool('prep_runtime');
 },60000);
 beforeEach(async()=>{
  await owner.query('UPDATE fingence_m2.users SET suspended=false');
  await owner.query("UPDATE fingence_m2.memberships SET active=true,role='Finance'");
  await owner.query('UPDATE fingence_m3.organization_states SET active=true');
 });
 afterEach(context=>{if(context.task.result?.state==='fail')failed=true;});
 afterAll(async()=>{await runtime?.close();await broker?.close();if(lab){recoveryEvidence.cleanup=await lab.cleanup(!failed);recoveryEvidence.testsFailed=failed;writeFileSync('outputs/db04-ai06/combined-recovery-summary.json',JSON.stringify(recoveryEvidence,null,2)+'\n');}},30000);

 it('reuses source verification, DB04, fuzzy/real E5, independent evidence and five-view read models',async()=>{
  const pipeline=createTrustedIngestionService(runtime,registry);
  const input={version:TRUSTED_INGESTION_VERSION,contract:'cash-source-v1' as const,documents:[{document:bank,verified:normalizeCashSource(bank.bytes,'bank',bank.filename)},{document:ledger,verified:normalizeCashSource(ledger.bytes,'ledger',ledger.filename)}]};
  const provider=process.env.DB04_E5_SMOKE==='1'?new LocalE5Provider(resolve('../ai03-runtime'),resolve('../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78')):undefined;
  const result=await run(token=>pipeline.process(token,input,provider));
  expect(result.supported).toBe(true);if(!result.supported)throw Error();
  expect(result.context.transactions).toHaveLength(2);expect(result.context.proposalVerifications).toHaveLength(1);
  const views=financialViews({version:'db04-processing-read/1',processingId:result.processingId,...result.context},result.processingId);
  expect(views.cashMovement.net).toBe('6380.53');expect(views.report.sources).toEqual(views.sources);
  expect(views.forecast.forecast.status).toBe('UNAVAILABLE');
  expect(views.aiProposals.approvedTransactions).toBe(0);
  expect(await run(t=>service().persist(t,bank,ledger))).toMatchObject({processingId:result.processingId,reused:true});
  await expect(run(t=>service().get(t,result.processingId),authority(otherSubject))).rejects.toThrow();
  expect((await owner.query('SELECT count(*)::int n FROM fingence_reconciliation.audit WHERE session_grant_id IS NULL')).rows[0].n).toBe(0);
 },120000);

 it('rejects missing authoritative mappings and ignores browser-like organization/role claims',async()=>{
  await expect(run(t=>service().persist(t,bank,ledger),authority(randomUUID()))).rejects.toThrow();
  const forged=authority();forged.verify=async()=>({issuer:HOSTED_ISSUER,audience:'authenticated',subject,sessionId:randomUUID(),expiresAt:Date.now()+60000,organizationId:otherOrg,role:'Admin'});
  const r=await run(t=>service().persist(t,bank,ledger),forged);
  expect((await run(t=>service().get(t,r.processingId))).job.organization_id).toBe(org);
 });
 it('enforces hosted-proposal RLS against direct cross-organization reads and audit writes',async()=>{
  await run(async token=>{
   const job=await service().persist(token,bank,ledger);
   const pool=new Pool({host:'127.0.0.1',port:cluster.port,database:'postgres',user:'prep_runtime',max:1});
   const c=await pool.connect();
   try{
    await c.query('BEGIN');await c.query("SELECT set_config('fingence.reconciliation_token_hash',$1,true)",[digest(Buffer.from(token))]);
    expect((await c.query('SELECT * FROM fingence_reconciliation.jobs WHERE organization_id=$1',[otherOrg])).rows).toEqual([]);
    await expect(c.query("INSERT INTO fingence_reconciliation.audit(organization_id,processing_id,actor_id,action) VALUES($1,$2,$3,'READ')",[otherOrg,job.processingId,otherUser])).rejects.toMatchObject({code:'42501'});
   }finally{await c.query('ROLLBACK');c.release();await pool.end();}
  });
 });
 it('retains safe DB02 function permissions and separates identity owner from runtime',async()=>{
  const r=(await owner.query("SELECT p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p WHERE p.oid='public.serialize_warning_issue_mutation()'::regprocedure")).rows[0];
  expect(r.prosecdef).toBe(false);expect(r.anon_execute).toBe(false);expect(r.proconfig).toContain('search_path=pg_catalog, public');
  const principal=(await owner.query("SELECT pg_get_userbyid(proowner) AS owner,proconfig FROM pg_proc WHERE oid='fingence_reconciliation.principal()'::regprocedure")).rows[0];
  expect(principal.owner).not.toBe('prep_runtime');expect(principal.proconfig).toContain('search_path=pg_catalog');
 });
 it.each(['expired','issuer','audience','revoked','suspended','stale'] as const)('denies %s upstream verification/lifecycle before issuing a grant',async reason=>{
  const a=authority();const verify=a.verify;
  a.verify=async token=>({...await verify(token),...(reason==='expired'?{expiresAt:Date.now()-1}:reason==='issuer'?{issuer:'https://wrong.invalid'}:reason==='audience'?{audience:'anon'}:{})});
  a.session=async({subject,sessionId})=>({subject,sessionId,active:reason!=='revoked',suspended:reason==='suspended',checkedAt:Date.now()-(reason==='stale'?6000:0)});
  const operation=vi.fn();await expect(run(operation,a)).rejects.toThrow('HOSTED_IDENTITY_DENIED');expect(operation).not.toHaveBeenCalled();
 });
 it.each(['membership','organization','suspension','version','revocation','expiry'] as const)('database principal rejects %s changes between financial transactions',async reason=>{
  await run(async token=>{
   const r=await service().persist(token,bank,ledger);
   const hash=digest(Buffer.from(token));
   if(reason==='membership')await owner.query('UPDATE fingence_m2.memberships SET active=false WHERE user_id=$1',[user]);
   if(reason==='organization')await owner.query('UPDATE fingence_m3.organization_states SET active=false WHERE organization_id=$1',[org]);
   if(reason==='suspension')await owner.query('UPDATE fingence_m2.users SET suspended=true WHERE id=$1',[user]);
   if(reason==='version')await owner.query('UPDATE fingence_m2.memberships SET version=version+1 WHERE user_id=$1',[user]);
   if(reason==='revocation')await owner.query('UPDATE fingence_m2.sessions SET revoked=true WHERE token_hash=$1',[hash]);
   if(reason==='expiry')await owner.query("UPDATE fingence_m2.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[hash]);
   await expect(service().get(token,r.processingId)).rejects.toThrow();
  });
 });
 it('rejects ambiguous memberships and blocks runtime/broker identity-table mutation',async()=>{
  await owner.query("INSERT INTO fingence_m2.memberships VALUES($1,$2,'Finance',true,1)",[user,otherOrg]);
  try{await expect(run(t=>service().persist(t,bank,ledger))).rejects.toThrow();}finally{await owner.query('DELETE FROM fingence_m2.memberships WHERE user_id=$1 AND organization_id=$2',[user,otherOrg]);}
  await expect(runtime.transaction(tx=>tx.query('SELECT * FROM fingence_m2.sessions'))).rejects.toThrow();
  await expect(broker.transaction(tx=>tx.query('UPDATE fingence_m2.memberships SET active=true'))).rejects.toThrow();
  expect((await owner.query("SELECT has_table_privilege('service_role','fingence_m2.sessions','SELECT') AS identity_read,has_table_privilege('authenticated','fingence_reconciliation.transactions','SELECT') AS financial_read,has_function_privilege('service_role','fingence_m2.issue_hosted_grant(text,uuid,text,uuid,uuid,timestamptz)','EXECUTE') AS can_issue")).rows[0]).toEqual({identity_read:false,financial_read:false,can_issue:false});
 });
 it('serializes phantom membership insertion with issuance subject locks',async()=>{
  const a=await owner.connect(),b=await owner.connect();
  try{
   await a.query('BEGIN');
   await a.query("SELECT * FROM fingence_m2.issue_hosted_grant($1,$2,$3,$4,$5,clock_timestamp()+interval '20 seconds')",['a'.repeat(64),randomUUID(),HOSTED_ISSUER,subject,randomUUID()]);
   await b.query("BEGIN; SET LOCAL lock_timeout='120ms'");
   await expect(b.query("INSERT INTO fingence_m2.memberships VALUES($1,$2,'Finance',true,1)",[user,otherOrg])).rejects.toMatchObject({code:'55P03'});
  }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
 });
 it('revokes operation capabilities after use and never retries unknown operation outcomes',async()=>{
  let saved='';await run(async token=>{saved=token;await service().persist(token,bank,ledger);});
  await expect(service().persist(saved,bank,ledger)).rejects.toThrow();
  const operation=vi.fn(async()=>{throw Error('COMMIT_OUTCOME_UNKNOWN');});
  await expect(run(operation)).rejects.toThrow('COMMIT_OUTCOME_UNKNOWN');expect(operation).toHaveBeenCalledTimes(1);
 });

 it('tests historical invalid source filenames without altering or weakening the real financial constraint',async()=>{
  await owner.query("CREATE TABLE public.prep_legacy_probe(id int PRIMARY KEY,source_file text NOT NULL,amount numeric); INSERT INTO public.prep_legacy_probe VALUES(1,'../legacy.csv',9007199254740993.123456789); ALTER TABLE public.prep_legacy_probe ADD CONSTRAINT prep_legacy_safe CHECK(public.is_safe_source_file(source_file)) NOT VALID");
  const before=(await owner.query('SELECT row_to_json(t)::text AS row FROM public.prep_legacy_probe t')).rows;
  await expect(owner.query('ALTER TABLE public.prep_legacy_probe VALIDATE CONSTRAINT prep_legacy_safe')).rejects.toMatchObject({code:'23514'});
  // The real fence performs this identical-value parent UPDATE; CHECK revalidation
  // semantics are independent of its trigger caller and reject legacy violations.
  await expect(owner.query('UPDATE public.prep_legacy_probe SET amount=amount')).rejects.toMatchObject({code:'23514'});
  expect((await owner.query('SELECT row_to_json(t)::text AS row FROM public.prep_legacy_probe t')).rows).toEqual(before);
  await owner.query("CREATE TABLE public.prep_valid_probe(source_file text); INSERT INTO public.prep_valid_probe VALUES('safe.csv'); ALTER TABLE public.prep_valid_probe ADD CONSTRAINT prep_valid_safe CHECK(public.is_safe_source_file(source_file)) NOT VALID");
  const a=await owner.connect(),b=await owner.connect();
  try{
   await a.query('BEGIN');await a.query('ALTER TABLE public.prep_valid_probe VALIDATE CONSTRAINT prep_valid_safe');
   expect((await b.query("SELECT mode FROM pg_locks WHERE pid=$1 AND relation='public.prep_valid_probe'::regclass",[(await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid])).rows).toContainEqual({mode:'ShareUpdateExclusiveLock'});
   expect((await b.query('SELECT count(*)::int n FROM public.prep_valid_probe')).rows[0].n).toBe(1);
   await b.query("BEGIN; SET LOCAL lock_timeout='120ms'");
   await expect(b.query('LOCK TABLE public.prep_valid_probe IN ACCESS EXCLUSIVE MODE')).rejects.toMatchObject({code:'55P03'});
   await b.query('ROLLBACK');await a.query('COMMIT');
  }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
 });

 it('serializes real DB02 warning mutations, reports lock timeout and rejects stale REPEATABLE READ updates',async()=>{
  const receipt=await createGroupedPersistenceService(transactionDatabase(owner)).persistGroupedAttempt({attempt_id:randomUUID(),results:[await syntheticResult(`${header}\n${validRow.replace('MYR','MYRR')}`)]});
  const id=(await owner.query('SELECT id FROM public.financial_records WHERE batch_id=$1',[receipt.datasets[0].batch_id])).rows[0].id;
  const a=await owner.connect(),b=await owner.connect();
  try{
   await a.query('BEGIN');await a.query('UPDATE public.validation_issues SET message=message WHERE financial_record_id=$1',[id]);
   await b.query("BEGIN; SET LOCAL lock_timeout='120ms'");
   await expect(b.query('UPDATE public.validation_issues SET message=message WHERE financial_record_id=$1',[id])).rejects.toMatchObject({code:'55P03'});
   await b.query('ROLLBACK');await a.query('ROLLBACK');
   await a.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await a.query('SELECT id FROM public.financial_records WHERE id=$1',[id]);
   await b.query('UPDATE public.validation_issues SET message=message WHERE financial_record_id=$1',[id]);
   await expect(a.query('UPDATE public.validation_issues SET message=message WHERE financial_record_id=$1',[id])).rejects.toMatchObject({code:'40001'});
  }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
 });
 it('reports real warning-fence deadlocks and preserves evidence after victim rollback',async()=>{
  const row=validRow.replace('MYR','MYRR');
  const receipt=await createGroupedPersistenceService(transactionDatabase(owner)).persistGroupedAttempt({attempt_id:randomUUID(),results:[await syntheticResult(`${header}\n${row}\n${row}`)]});
  const ids=(await owner.query('SELECT id FROM public.financial_records WHERE batch_id=$1 ORDER BY id',[receipt.datasets[0].batch_id])).rows.map(r=>r.id);
  expect(ids).toHaveLength(2);
  const snapshot=async()=>(await owner.query('SELECT to_jsonb(t)::text AS row FROM public.validation_issues t WHERE financial_record_id=ANY($1::uuid[]) ORDER BY id',[ids])).rows;
  const before=await snapshot(),a=await owner.connect(),b=await owner.connect();
  const update='UPDATE public.validation_issues SET message=message WHERE financial_record_id=$1';
  try{
   await a.query("BEGIN; SET LOCAL deadlock_timeout='100ms'");await b.query("BEGIN; SET LOCAL deadlock_timeout='100ms'");
   await a.query(update,[ids[0]]);await b.query(update,[ids[1]]);
   const finish=async(c:typeof a,id:string)=>{try{await c.query(update,[id]);await c.query('COMMIT');return 'COMMITTED';}catch(error){await c.query('ROLLBACK');return (error as {code:string}).code;}};
   expect((await Promise.all([finish(a,ids[1]),finish(b,ids[0])])).sort()).toEqual(['40P01','COMMITTED']);
   expect(await snapshot()).toEqual(before);
   await a.query('BEGIN');await a.query('UPDATE public.validation_issues SET message=message||$2 WHERE financial_record_id=$1',[ids[0],'-synthetic-rollback']);await a.query('ROLLBACK');
   expect(await snapshot()).toEqual(before);
  }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
 });
 it('runs the exact validation proposal on valid synthetic financial data without changing row values',async()=>{
  const before=(await owner.query('SELECT to_jsonb(r)::text AS row FROM public.financial_records r ORDER BY id')).rows;
  await owner.query(readFileSync('supabase/sql/db04-source-file-validation-review.sql','utf8'));
  expect((await owner.query('SELECT to_jsonb(r)::text AS row FROM public.financial_records r ORDER BY id')).rows).toEqual(before);
  expect((await owner.query("SELECT convalidated FROM pg_constraint WHERE conname='financial_records_source_file_safe'")).rows[0].convalidated).toBe(true);
 });

 it('round-trips combined synthetic financial/evidence/identity data and ACLs through a real custom archive',async()=>{
  await run(t=>service().persist(t,bank,ledger));
  const snapshot=snapshotCombined;
  const before=await snapshot(owner),archive=lab.child('combined.dump'),dump=await lab.logicalDump(cluster,archive);
  expect(dump.bytes).toBeGreaterThan(0);verifyArchive(archive,dump.sha256);
  const corrupt=lab.child('corrupt.dump');writeFileSync(corrupt,Buffer.concat([readFileSync(archive),Buffer.from('corruption')]));
  expect(()=>verifyArchive(corrupt,dump.sha256)).toThrow('Backup checksum mismatch');
  const target=await lab.freshDatabase(cluster,'db03_combined_restore');
  await lab.logicalRestore(target,archive,dump.sha256);
  const after=await snapshot(target.pool);
  expect(after.rows).toEqual(before.rows);expect(after.schema).toEqual(before.schema);
  recoveryEvidence.logical={archiveSha256:dump.sha256,bytes:dump.bytes,rowTextSha256:digest(Buffer.from(JSON.stringify(before.rows))),schemaAndAclSha256:digest(Buffer.from(JSON.stringify(before.schema))),dataAndAclEquality:true,checksumCorruptionRejected:true};
  await expect(lab.logicalRestore(target,archive,dump.sha256)).rejects.toThrow('unused');
  expect((await target.pool.query("SELECT count(*)::int n FROM pg_policy WHERE polrelid IN (SELECT oid FROM pg_class WHERE relnamespace='fingence_reconciliation'::regnamespace)")).rows[0].n).toBeGreaterThan(10);
  const rp=new Pool({host:'127.0.0.1',port:cluster.port,database:target.name,user:'prep_runtime'}),bp=new Pool({host:'127.0.0.1',port:cluster.port,database:target.name,user:'prep_broker'});
  const restoredRuntime=transactionDatabase(rp),restoredBroker=transactionDatabase(bp);
  try{
   const restoredService=createFinancialProcessingService(restoredRuntime,registry);
   await createHostedAdmission(authority(),restoredBroker).withFinance('synthetic-token',async token=>{
    const r=await restoredService.persist(token,bank,ledger);expect(r.reused).toBe(true);
    const context=await restoredService.get(token,r.processingId);
    expect(financialViews({version:'db04-processing-read/1',processingId:r.processingId,...context},r.processingId).cashMovement.net).toBe('6380.53');
   });
  }finally{await restoredRuntime.close();await restoredBroker.close();}
 },60000);
 it('verifies a physical backup and recovers an independent synthetic cluster with its roles and RLS',async()=>{
  const backup=lab.baseBackup(cluster,'physical-base');expect(lab.verifyBase(backup.dest).exitCode).toBe(0);
  const restored=await lab.recover(backup.dest,'physical-restored',null);
  const p=await lab.pool(restored.cluster);
  expect((await p.query("SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='prep_runtime'")).rows[0]).toMatchObject({rolname:'prep_runtime',rolsuper:false,rolbypassrls:false});
  expect((await p.query("SELECT count(*)::int n FROM pg_class WHERE relnamespace='fingence_reconciliation'::regnamespace AND relrowsecurity AND relforcerowsecurity")).rows[0].n).toBe(11);
  expect((await p.query('SELECT count(*)::int n FROM fingence_reconciliation.transactions')).rows[0].n).toBe(2);
  recoveryEvidence.physical={manifestSha256:digest(readFileSync(join(backup.dest,'backup_manifest'))),verifyBackupExitCode:0,recoveredIndependently:true,db04ForcedRlsTables:11,financialRows:2,recoveryDurationMs:restored.durationMs};
 },90000);
});
