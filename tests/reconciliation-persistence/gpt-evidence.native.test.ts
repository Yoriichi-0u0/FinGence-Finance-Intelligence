/** REVIEW-PREPARED: no database startup unless explicit execution approval flag is supplied.
 * Uses only a newly initialized loopback cluster; never accepts a database URL. */
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {Pool} from 'pg';
import {transactionDatabase,type TransactionDatabase} from '../../lib/server/db/postgres';
import {createFinancialProcessingService} from '../../lib/server/reconciliation/service';
import {createGPTEvidenceService} from '../../lib/server/reconciliation/gpt-persistence';
import {createGPTProposer,type GPTResult} from '../../lib/server/reconciliation/gpt';
import {digest} from '../../lib/server/reconciliation/processing';
import {canonicalEvidence} from '../../lib/server/reconciliation/gpt-persistence';
import {tokenHash} from '../../lib/server/ai-ingestion/m2/identity';
const approved=process.env.FINGENCE_DB04_GPT_NATIVE_APPROVED==='1';
const bin=process.env.FINGENCE_TEST_PG_BIN??'C:\\Program Files\\PostgreSQL\\18\\bin';
const executable=(n:string)=>join(bin,n+(process.platform==='win32'?'.exe':''));
const org='00000000-0000-4000-8000-000000000001',otherOrg='00000000-0000-4000-8000-000000000002';
const user='00000000-0000-4000-8000-000000000003',otherUser='00000000-0000-4000-8000-000000000004';
const token='A'.repeat(43),otherToken='B'.repeat(43),s='fingence_reconciliation';
const bank={bytes:readFileSync(new URL('./fixtures/bank.csv',import.meta.url)),filename:'bank.csv'};
const ledger={bytes:readFileSync(new URL('./fixtures/ledger.csv',import.meta.url)),filename:'ledger.csv'};
const registry={bank:digest(bank.bytes),ledger:digest(ledger.bytes)};
(approved?describe:describe.skip)('GPT evidence native PostgreSQL (explicit approval required)',()=>{
 let directory:string,port:number,started=false,owner:Pool,runtime:Pool,db:TransactionDatabase,result:GPTResult;
 let catalogBefore:unknown,catalogAfter:unknown,baselineTables:Array<{schema:string;name:string}>=[];
 const processing=()=>createFinancialProcessingService(db,registry);
 const evidence=()=>createGPTEvidenceService(db,registry);
 beforeAll(async()=>{
  if(!existsSync(executable('initdb'))||!existsSync(executable('pg_ctl')))throw Error('NATIVE_POSTGRES_BINARIES_REQUIRED');
  directory=mkdtempSync(join(tmpdir(),'fingence-gpt-pg-'));
  execFileSync(executable('initdb'),['-D',directory,'-U','postgres','-A','trust','--no-locale','-E','UTF8'],{windowsHide:true,timeout:30000,stdio:'pipe'});
  const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
  started=true;execFileSync(executable('pg_ctl'),['-D',directory,'-l',join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{windowsHide:true,timeout:35000,stdio:'ignore'});
  owner=new Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres'});
  await owner.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
  for(const file of ['phase1-clean-setup.sql','c3b1-grouped-persistence-upgrade.sql','db02-001-warning-mutation-fence.sql','v2-verified-document-local.sql','v2-m2-local.sql','v2-m3-local.sql','db04-001-reconciliation.sql','db04-002-reconciliation-security.sql','db04-003-ranking-evidence.sql','db04-004-proposal-verification.sql'])await owner.query(readFileSync(join('supabase/sql',file),'utf8'));
  // Managed platforms may grant new objects directly through default privileges.
  await owner.query('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role');
  catalogBefore=await catalog();
  baselineTables=(await owner.query<{schema:string;name:string}>("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows;
  await owner.query(readFileSync('supabase/sql/db04-005-gpt-evidence-review.sql','utf8'));
  catalogAfter=await catalog(true);
  await owner.query('CREATE ROLE gpt_test LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE fingence_reconciliation_runtime');
  await owner.query("INSERT INTO fingence_m2.organizations VALUES($1,'synthetic'),($2,'other')",[org,otherOrg]);
  await owner.query("INSERT INTO fingence_m2.users VALUES($1,'one@synthetic.invalid','unused'),($2,'two@synthetic.invalid','unused')",[user,otherUser]);
  await owner.query("INSERT INTO fingence_m2.memberships(user_id,organization_id,role) VALUES($1,$2,'Finance'),($3,$4,'Finance')",[user,org,otherUser,otherOrg]);
  await owner.query('INSERT INTO fingence_m3.organization_states(organization_id) VALUES($1),($2)',[org,otherOrg]);
  for(const [t,u,o]of [[token,user,org],[otherToken,otherUser,otherOrg]])await owner.query("INSERT INTO fingence_m2.sessions VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',false,1)",[tokenHash(t),u,o]);
  runtime=new Pool({host:'127.0.0.1',port,user:'gpt_test',database:'postgres',max:4});db=transactionDatabase(runtime);
 },60000);
 beforeEach(async()=>{
  await owner.query(`TRUNCATE ${s}.gpt_items,${s}.gpt_runs,${s}.proposal_verifications,${s}.rankings,${s}.audit,${s}.reviews,${s}.cases,${s}.decisions,${s}.proposals,${s}.transactions,${s}.job_sources,${s}.jobs,${s}.documents`);
  const {processingId}=await processing().persist(token,bank,ledger);
  await processing().persist(otherToken,bank,ledger);
  const read=async(t:string,id:string)=>({version:'db04-processing-read/1' as const,processingId:id,...await processing().get(t,id)});
  const context=await read(token,processingId),b=context.transactions.find(r=>r.kind==='BANK')!,l=context.transactions.find(r=>r.kind==='LEDGER')!;
  result=await createGPTProposer(read,registry)(token,processingId,{kind:'GROQ',suggest:async()=>JSON.stringify({version:'llm-reconciliation-suggestion/1',suggestions:[{bankId:b.record_id,ledgerId:l.record_id,bankReference:(b.evidence as Record<string,string>).BankReference,ledgerReference:(l.evidence as Record<string,string>).LedgerReference,rationale:'Review only'}],abstentions:[]})});
 });
 afterAll(async()=>{
  await runtime?.end();await owner?.end();
  if(started&&existsSync(join(directory,'postmaster.pid')))execFileSync(executable('pg_ctl'),['-D',directory,'-m','fast','-w','stop'],{windowsHide:true,timeout:25000,stdio:'ignore'});
  if(directory){const child=relative(resolve(tmpdir()),resolve(directory));if(child.startsWith('fingence-gpt-pg-')&&!child.includes('..')&&!child.includes('\\')&&!child.includes('/'))rmSync(directory,{recursive:true});}
 },30000);
 async function catalog(excludeGPT=false){
  const schemas=(await owner.query("SELECT nspname,nspacl::text FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY nspname")).rows;
  const relations=(await owner.query(`SELECT n.nspname,c.relname,c.relkind,c.relowner::regrole::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,
   (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
   (SELECT jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid)) ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid) constraints,
   (SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) triggers,
   (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'roles',p.polroles,'cmd',p.polcmd,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) policies
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND ($1=false OR NOT(n.nspname='fingence_reconciliation' AND c.relname LIKE 'gpt_%')) ORDER BY n.nspname,c.relname`,[excludeGPT])).rows;
  const functions=(await owner.query(`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,p.proacl::text,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prokind IN ('f','p') AND ($1=false OR NOT(n.nspname='fingence_reconciliation' AND p.proname LIKE 'gpt_%')) ORDER BY 1,2,3`,[excludeGPT])).rows;
  return {schemas,relations,functions};
 }
 async function baselineData(){
  const result:Record<string,string>={};
  for(const t of baselineTables){if(t.schema==='fingence_reconciliation'&&t.name==='audit')continue;
   const q='"'+t.schema.replaceAll('"','""')+'"."'+t.name.replaceAll('"','""')+'"';
   const rows=(await owner.query(`SELECT to_jsonb(t) AS value FROM ${q} t`)).rows.map(r=>canonicalEvidence(r.value)).sort();result[t.schema+'.'+t.name]=digest(canonicalEvidence(rows));
  }return result;
 }
 const counts=async()=>(await owner.query(`SELECT (SELECT count(*)::int FROM ${s}.gpt_runs) runs,(SELECT count(*)::int FROM ${s}.gpt_items) items,(SELECT count(*)::int FROM ${s}.audit WHERE action='PERSISTED') audits`)).rows[0];
 async function scoped(t:string,sql:string,args:unknown[]=[]){
  const c=await runtime.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('fingence.reconciliation_token_hash',$1,true)",[tokenHash(t)]);const result=await c.query(sql,args);await c.query('COMMIT');return result;}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async function cloneRun(change:Record<string,unknown>){
  const row=(await owner.query(`SELECT * FROM ${s}.gpt_runs`)).rows[0];
  const value={...row,evidence_id:'e'.repeat(64),verification_fingerprint:'f'.repeat(64),...change};
  delete value.created_at;const keys=Object.keys(value);
  return scoped(token,`INSERT INTO ${s}.gpt_runs(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>value[k]));
 }
 it('adds migration 005 without changing any existing prerequisite schema object or ACL',async()=>{
  expect(catalogAfter).toEqual(catalogBefore);expect(baselineTables.length).toBeGreaterThan(10);
 });
 it('reuses processing and immutable evidence after closing and reopening the database pool',async()=>{
  const before=await baselineData(),receipt=await evidence().persist(token,result);
  const stored=await evidence().get(token,result.processingId,receipt.evidenceId);
  expect(stored.items[0].verification).toMatchObject({checks:{RECORDS_EXIST:true,CONTEXT:true,RAW_ACCOUNTING:true},referenceClaims:true});
  expect(stored.items[0].reasons).toContain('ASSIGNMENT_POLICY_NOT_APPROVED');
  await db.close();runtime=new Pool({host:'127.0.0.1',port,user:'gpt_test',database:'postgres',max:4});db=transactionDatabase(runtime);
  const rerun=await processing().persist(token,bank,ledger);expect(rerun).toEqual({processingId:result.processingId,reused:true});
  const replay=await evidence().persist(token,result);expect(replay).toEqual({...receipt,reused:true});
  expect(await evidence().get(token,result.processingId,receipt.evidenceId)).toEqual(stored);
  expect(await baselineData()).toEqual(before);
 });
 it('enforces forced RLS for a nonsuperuser table owner and restricted runtime/public grants',async()=>{
  await evidence().persist(token,result);
  const privileges=(await owner.query(`SELECT has_table_privilege('gpt_test','${s}.gpt_runs','SELECT') r,has_table_privilege('gpt_test','${s}.gpt_runs','INSERT') i,has_table_privilege('gpt_test','${s}.gpt_runs','UPDATE') u,has_table_privilege('gpt_test','${s}.gpt_items','DELETE') d,has_table_privilege('gpt_test','${s}.gpt_runs','TRUNCATE') t,has_table_privilege('anon','${s}.gpt_runs','SELECT') anon`)).rows[0];expect(privileges).toEqual({r:true,i:true,u:false,d:false,t:false,anon:false});
  const role=(await owner.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='gpt_test'")).rows[0];expect(role).toEqual({rolsuper:false,rolbypassrls:false});
  await owner.query('CREATE ROLE gpt_forced_owner NOLOGIN NOSUPERUSER NOBYPASSRLS IN ROLE fingence_reconciliation_runtime');
  await owner.query(`ALTER TABLE ${s}.gpt_runs OWNER TO gpt_forced_owner`);
  const c=await owner.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE gpt_forced_owner');expect((await c.query(`SELECT * FROM ${s}.gpt_runs`)).rows).toHaveLength(0);await c.query("SELECT set_config('fingence.reconciliation_token_hash',$1,true)",[tokenHash(token)]);expect((await c.query(`SELECT * FROM ${s}.gpt_runs`)).rows).toHaveLength(1);await c.query('ROLLBACK');}
  finally{await c.query('ROLLBACK');c.release();await owner.query(`ALTER TABLE ${s}.gpt_runs OWNER TO postgres`);await owner.query('DROP ROLE gpt_forced_owner');}
 });
 it('removes managed-default grants from only the new GPT tables and trigger functions',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   for(const table of ['gpt_runs','gpt_items']){
    const row=(await owner.query(`SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed`,[role,s+'.'+table])).rows[0];expect(row.allowed).toBe(false);
   }
   for(const fn of ['gpt_complete()','gpt_audit()'])expect((await owner.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,s+'.'+fn])).rows[0].allowed).toBe(false);
  }
 });
 it('atomically stores evidence, timestamps and audit; concurrent identical writes reuse one run',async()=>{
  const before=await counts();const receipts=await Promise.all([evidence().persist(token,result),evidence().persist(token,result)]);
  expect(receipts.filter(r=>!r.reused)).toHaveLength(1);const after=await counts();expect(after).toEqual({runs:1,items:1,audits:before.audits+1});
  const stored=await evidence().get(token,result.processingId,receipts[0].evidenceId);expect(stored.run.outcome).toBe('UNRESOLVED');expect(stored.run.created_at).toBeTruthy();expect(stored.items[0].created_at).toBeTruthy();
 });
 it('persists abstentions and empty responses without inventing financial records',async()=>{
  const original=await processing().get(token,result.processingId);
  const read=async(t:string,id:string)=>({version:'db04-processing-read/1' as const,processingId:id,...await processing().get(t,id)});
  for(const abstentions of [[{recordId:original.transactions[0].record_id,reason:'Uncertain'}],[]]){
   const response=await createGPTProposer(read,registry)(token,result.processingId,{kind:'GROQ',suggest:async()=>JSON.stringify({version:'llm-reconciliation-suggestion/1',suggestions:[],abstentions})});
   const receipt=await evidence().persist(token,response);const stored=await evidence().get(token,result.processingId,receipt.evidenceId);
   expect(stored.items).toHaveLength(abstentions.length);expect(stored.run.outcome).toBe('UNRESOLVED');
   if(stored.items.length)expect(stored.items[0].abstention_record_id).toBe(abstentions[0].recordId);
  }
  expect((await processing().get(token,result.processingId)).transactions).toEqual(original.transactions);
 });
 it('enforces forced RLS, scoped reads and actor binding',async()=>{
  const r=await evidence().persist(token,result);await expect(evidence().get(otherToken,result.processingId,r.evidenceId)).rejects.toThrow();
  expect((await runtime.query(`SELECT * FROM ${s}.gpt_runs`)).rows).toHaveLength(0);
  await expect(cloneRun({created_by:otherUser,suggestion_count:0})).rejects.toMatchObject({code:'42501'});
  const flags=(await owner.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('fingence_reconciliation.gpt_runs'::regclass,'fingence_reconciliation.gpt_items'::regclass)")).rows;expect(flags.every(r=>r.relrowsecurity&&r.relforcerowsecurity)).toBe(true);
 });
 it('rejects wrong job/source foreign keys, non-unresolved outcomes and incomplete runs',async()=>{
  await evidence().persist(token,result);const before=await counts();
  for(const change of [{bank_sha256:'d'.repeat(64)},{processing_id:'d'.repeat(64)}])await expect(cloneRun(change)).rejects.toMatchObject({code:'23503'});
  for(const change of [{outcome:'APPROVED'},{suggestion_count:1}])await expect(cloneRun(change)).rejects.toMatchObject({code:'23514'});
  expect(await counts()).toEqual(before);
 });
 it('rejects update, delete and truncate by runtime, and immutable updates even by owner',async()=>{
  await evidence().persist(token,result);
  for(const sql of [`UPDATE ${s}.gpt_runs SET outcome='UNRESOLVED'`,`DELETE FROM ${s}.gpt_items`,`TRUNCATE ${s}.gpt_runs CASCADE`])await expect(scoped(token,sql)).rejects.toMatchObject({code:'42501'});
  await expect(owner.query(`UPDATE ${s}.gpt_items SET explanation='changed'`)).rejects.toMatchObject({code:'23514'});
 });
 it('rolls back evidence if atomic audit insertion is denied',async()=>{
  const before=await counts();await owner.query(`REVOKE INSERT ON ${s}.audit FROM fingence_reconciliation_runtime`);
  try{await expect(evidence().persist(token,result)).rejects.toThrow();expect(await counts()).toEqual(before);}finally{await owner.query(`GRANT INSERT ON ${s}.audit TO fingence_reconciliation_runtime`);}
 });
 it('rolls back parent and audit on child constraint failure',async()=>{
  await evidence().persist(token,result);const before=await counts();await expect(cloneRun({suggestion_count:1,abstention_count:1})).rejects.toThrow();expect(await counts()).toEqual(before);
 });
 it('enforces record foreign keys and rolls back audit on malformed child evidence',async()=>{
  await evidence().persist(token,result);const before=await counts();
  const original=(await owner.query(`SELECT * FROM ${s}.gpt_runs`)).rows[0];
  const value={...original,evidence_id:'e'.repeat(64),verification_fingerprint:'f'.repeat(64)};
  delete value.created_at;const keys=Object.keys(value);
  await expect(db.transaction(async tx=>{
   await tx.query("SELECT set_config('fingence.reconciliation_token_hash',$1,true)",[tokenHash(token)]);
   await tx.query(`INSERT INTO ${s}.gpt_runs(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>value[k]));
   const v={checks:{},identity:{},conflicts:{},rankingLineage:false,financialEligible:false,referenceClaims:false,uniqueEligiblePartner:false};
   await tx.query(`INSERT INTO ${s}.gpt_items(organization_id,processing_id,evidence_id,item_type,ordinal,bank_claim,ledger_claim,bank_record_id,explanation,reasons,verification)
    VALUES($1,$2,$3,'SUGGESTION',0,'does-not-exist','L','does-not-exist','Review only',$4::jsonb,$5::jsonb)`,[org,result.processingId,value.evidence_id,JSON.stringify(['ASSIGNMENT_POLICY_NOT_APPROVED']),JSON.stringify(v)]);
  })).rejects.toThrow();expect(await counts()).toEqual(before);
 });
 it('keeps deterministic decisions, fuzzy/E5 rankings and protected reads compatible',async()=>{
  await processing().rankFuzzy(token,result.processingId);
  // In-memory unit double only: validates the E5 interface and storage, not model quality.
  await processing().rankE5(token,result.processingId,{kind:'PRETRAINED_E5',initialize:async()=>({mode:'UNIT_DOUBLE'}),embed:async texts=>({vectors:texts.map(()=>Array.from({length:384},(_,i)=>i===0?1:0)),tokenCounts:texts.map(()=>1)}),terminate:()=>{},dispose:async()=>{}});
  await processing().verifyRankings(token,result.processingId);
  const before=await processing().get(token,result.processingId);
  const read=async(t:string,id:string)=>({version:'db04-processing-read/1' as const,processingId:id,...await processing().get(t,id)});
  result=await createGPTProposer(read,registry)(token,result.processingId,{kind:'GROQ',suggest:async()=>JSON.stringify(result.proposal)});
  await evidence().persist(token,result);const after=await processing().get(token,result.processingId);
  expect(after.proposals).toEqual(before.proposals);expect(after.rankings).toEqual(before.rankings);expect(after.proposalVerifications).toEqual(before.proposalVerifications);
 });
 it('denies expired, revoked and non-Finance sessions',async()=>{
  for(const change of ["revoked=true","expires_at=clock_timestamp()-interval '1 second'"]){
   await owner.query(`UPDATE fingence_m2.sessions SET ${change} WHERE token_hash=$1`,[tokenHash(token)]);
   try{await expect(evidence().persist(token,result)).rejects.toThrow();}finally{await owner.query("UPDATE fingence_m2.sessions SET revoked=false,expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=$1",[tokenHash(token)]);}
  }
  await owner.query("UPDATE fingence_m2.memberships SET role='Technical (Management)' WHERE user_id=$1 AND organization_id=$2",[user,org]);
  try{await expect(evidence().persist(token,result)).rejects.toThrow();}finally{await owner.query("UPDATE fingence_m2.memberships SET role='Finance' WHERE user_id=$1 AND organization_id=$2",[user,org]);}
 });
});
