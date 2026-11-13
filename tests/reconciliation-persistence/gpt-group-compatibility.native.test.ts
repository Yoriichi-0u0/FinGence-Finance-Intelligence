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
import {createGroupGPTBackend,groupGPTRuntimeDatabase} from '../../lib/server/reconciliation/group-gpt-backend';
import {createGPTProposer,type GPTResult} from '../../lib/server/reconciliation/gpt';
import {digest} from '../../lib/server/reconciliation/processing';
import {canonicalEvidence} from '../../lib/server/reconciliation/gpt-persistence';
import {randomUUID} from 'node:crypto';
import {createGPTWebsiteHandler,type GPTWebsiteDependencies} from '../../lib/server/reconciliation/gpt-website';
import {GPTSuggestionsView,loadGPTEvidence} from '../../components/reconciliation/gpt-suggestions';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {GPTEvidenceView} from '../../lib/gpt-evidence-view';
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
(approved?describe:describe.skip)('Group-compatible GPT 005 native PostgreSQL (local only)',()=>{
 let directory:string,port:number,started=false,owner:Pool,runtime:Pool,auditPool:Pool,db:TransactionDatabase,result:GPTResult;
 let catalogBefore:unknown,catalogAfter:unknown,baselineTables:Array<{schema:string;name:string}>=[];
 const processing=()=>createFinancialProcessingService(db,registry);
 const evidence=()=>createGPTEvidenceService(groupGPTRuntimeDatabase(db),registry);
 beforeAll(async()=>{
  if(!existsSync(executable('initdb'))||!existsSync(executable('pg_ctl')))throw Error('NATIVE_POSTGRES_BINARIES_REQUIRED');
  directory=mkdtempSync(join(tmpdir(),'fingence-gpt-pg-'));
  execFileSync(executable('initdb'),['-D',directory,'-U','postgres','-A','trust','--no-locale','-E','UTF8'],{windowsHide:true,timeout:30000,stdio:'pipe'});
  const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
  started=true;execFileSync(executable('pg_ctl'),['-D',directory,'-l',join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{windowsHide:true,timeout:35000,stdio:'ignore'});
  owner=new Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres'});
  await owner.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
  // Byte-preserved historical group contract fixture; fresh local cluster only.
  await owner.query(readFileSync('tests/reconciliation-persistence/sql/group-contract-943e0ef.sql','utf8'));
  // Managed platforms may grant new objects directly through default privileges.
  await owner.query('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role');
  // Official audit contracts installed only into this fresh synthetic local cluster.
  await owner.query(readFileSync('supabase/sql/phase3-security-audit-upgrade.sql','utf8'));
  await owner.query(readFileSync('supabase/sql/phase3-security-audit-api-events.sql','utf8'));
  await owner.query("CREATE ROLE gpt_audit_test LOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO gpt_audit_test; GRANT INSERT ON public.security_audit_events TO gpt_audit_test; GRANT USAGE ON SEQUENCE public.security_audit_events_id_seq TO gpt_audit_test; CREATE POLICY gpt_audit_insert ON public.security_audit_events FOR INSERT TO gpt_audit_test WITH CHECK(true)");
  auditPool=new Pool({host:'127.0.0.1',port,user:'gpt_audit_test',database:'postgres'});
  catalogBefore=await catalog();
  baselineTables=(await owner.query<{schema:string;name:string}>("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows;
  await owner.query(readFileSync('supabase/sql/db04-group-access-review/02-gpt-005-group-compatibility-review.sql','utf8'));
  catalogAfter=await catalog(true);
  await owner.query('CREATE ROLE gpt_test LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE fingence_db04_group_runtime');
  await owner.query("INSERT INTO fingence_db04_group_synthetic.organizations VALUES($1,'synthetic'),($2,'other')",[org,otherOrg]);
  await owner.query("INSERT INTO fingence_db04_group_synthetic.users(id,issuer,subject) VALUES($1,'urn:fingence:db04:group-synthetic:1',$1),($2,'urn:fingence:db04:group-synthetic:1',$2)",[user,otherUser]);
  await owner.query("INSERT INTO fingence_db04_group_synthetic.memberships(user_id,organization_id,role,version) VALUES($1,$2,'Finance',1),($3,$4,'Finance',1)",[user,org,otherUser,otherOrg]);
  await owner.query('INSERT INTO fingence_db04_group_synthetic.organization_states(organization_id,active) VALUES($1,true),($2,true)',[org,otherOrg]);
  for(const [t,u,o]of [[token,user,org],[otherToken,otherUser,otherOrg]])await owner.query("INSERT INTO fingence_db04_group_synthetic.sessions VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',false,1,'group-synthetic-admission/1')",[randomUUID(),tokenHash(t),u,o,randomUUID()]);
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
  await auditPool?.end();await runtime?.end();await owner?.end();
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
 function website(){
  const deps:GPTWebsiteDependencies={database:transactionDatabase(auditPool),backend:createGroupGPTBackend(db,registry),
   resolvePrincipal:async()=>({subjectId:user,organizationId:org,role:'finance_analyst'}),
   resolveAccess:async()=>({subjectId:user,organizationId:org,scopeVersion:'1',batchIds:[result.processingId]}),
   resolveBatch:async(_principal,batchId)=>{
    // Isolated trusted owner fixture lookup; never a Production identity adapter.
    const found=(await owner.query(`SELECT processing_id FROM ${s}.jobs WHERE organization_id=$1 AND processing_id=$2`,[org,batchId])).rows[0];
    return found?{organizationId:org,batchId,processingId:String(found.processing_id),capability:token}:null;
   }};
  return {deps,request:()=>new Request(`http://localhost/api/reconciliation/gpt-evidence?batchId=${result.processingId}`)};
 }
 it('runs saved GPT persistence, authenticated API, durable audit and UI rendering end to end',async()=>{
  const backend=createGroupGPTBackend(db,registry);await Promise.all([backend.persistGPTEvidence(token,result),backend.persistGPTEvidence(token,result)]);
  const f=website(),handler=createGPTWebsiteHandler(f.deps),response=await handler(f.request());expect(response.status).toBe(200);
  const data=await response.json() as GPTEvidenceView;expect(data.runs).toHaveLength(1);expect(data.runs[0].items).toHaveLength(1);
  const html=renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'ready',data}}));expect(html).toContain('UNRESOLVED');expect(html).toContain('GPT Matching Suggestions');expect(html).not.toContain('<button');
  const transport=async()=>handler(f.request());expect((await loadGPTEvidence(result.processingId,new AbortController().signal,transport)).status).toBe('ready');
  expect((await owner.query("SELECT count(*)::int AS n FROM public.security_audit_events WHERE target_id=$1 AND outcome='success'",[result.processingId])).rows[0].n).toBeGreaterThanOrEqual(2);
 });
 it('binds website evidence to both the verified user and capability tenant',async()=>{
  await evidence().persist(token,result);const f=website();
  f.deps.resolveBatch=async()=>({organizationId:org,batchId:result.processingId,processingId:result.processingId,capability:otherToken});
  expect((await createGPTWebsiteHandler(f.deps)(f.request())).status).toBe(503);
  await expect(createGroupGPTBackend(db,registry).listSavedGPTEvidence(token,result.processingId,{userId:otherUser,organizationId:org})).rejects.toThrow();
 });
 it('returns an empty saved-evidence state and withholds data when the durable security audit fails',async()=>{
  const f=website();const empty=await createGPTWebsiteHandler(f.deps)(f.request());expect(empty.status).toBe(200);expect((await empty.json()).runs).toEqual([]);
  await evidence().persist(token,result);await owner.query('REVOKE INSERT ON public.security_audit_events FROM gpt_audit_test');
  try{const response=await createGPTWebsiteHandler(f.deps)(f.request());expect(response.status).toBe(503);expect(await response.text()).not.toContain(result.sourceFingerprint);}
  finally{await owner.query('GRANT INSERT ON public.security_audit_events TO gpt_audit_test');}
 });
 it('connects the group backend through its restricted runtime for proposal, persistence and audited retrieval',async()=>{
  const backend=createGroupGPTBackend(db,registry);
  const proposed=await backend.proposeGPT(token,result.processingId,{kind:'GROQ',suggest:async()=>JSON.stringify(result.proposal)});
  const first=await backend.persistGPTEvidence(token,proposed),second=await backend.persistGPTEvidence(token,proposed);
  expect(first.reused).toBe(false);expect(second.reused).toBe(true);
  const stored=await backend.getGPTEvidence(token,result.processingId,first.evidenceId);
  expect(stored.run.outcome).toBe('UNRESOLVED');expect(stored.items.length).toBeGreaterThan(0);
  expect((await owner.query(`SELECT action FROM ${s}.audit WHERE processing_id=$1`,[result.processingId])).rows.some(r=>r.action==='PERSISTED')).toBe(true);
  await expect(backend.getGPTEvidence(otherToken,result.processingId,first.evidenceId)).rejects.toThrow();
 });
 it('rejects an owner connection before evidence or processing access',async()=>{
  const privileged=transactionDatabase(owner);
  await expect(createGroupGPTBackend(privileged,registry).persistGPTEvidence(token,result)).rejects.toThrow();
 });
 it('does not persist on mocked provider failure',async()=>{
  const before=await counts();const provider={kind:'GROQ' as const,suggest:vi.fn().mockRejectedValue(Error('private provider details'))};
  await expect(createGroupGPTBackend(db,registry).proposeGPT(token,result.processingId,provider)).rejects.toThrow('GPT_PROVIDER_FAILURE');
  expect(provider.suggest).toHaveBeenCalledTimes(1);expect(await counts()).toEqual(before);
 });
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
  await owner.query('CREATE ROLE gpt_forced_owner NOLOGIN NOSUPERUSER NOBYPASSRLS IN ROLE fingence_db04_group_runtime');
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
 it('binds the membership FK and runtime grants to group contracts without legacy aliases',async()=>{
  const fk=(await owner.query(`SELECT n.nspname,c.relname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.conrelid='fingence_reconciliation.gpt_runs'::regclass AND k.contype='f' AND c.relname='memberships'`)).rows;
  expect(fk).toHaveLength(1);expect(fk[0].nspname).toBe('fingence_db04_group_synthetic');
  expect((await owner.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname IN ('fingence_m2','fingence_m3')")).rows[0].n).toBe(0);
  expect((await owner.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='fingence_reconciliation_runtime'")).rows[0].n).toBe(0);
  const receipt=await evidence().persist(token,result);
  const audit=(await owner.query(`SELECT a.session_grant_id,a.actor_id,a.organization_id FROM ${s}.audit a JOIN fingence_db04_group_synthetic.sessions g ON (g.id,g.user_id,g.organization_id)=(a.session_grant_id,a.actor_id,a.organization_id) WHERE a.action='PERSISTED' AND a.organization_id=$1 AND a.processing_id=$2 ORDER BY a.id`,[org,result.processingId])).rows;
  expect(audit).toHaveLength(2);expect(audit.every(a=>a.session_grant_id&&a.actor_id===user)).toBe(true);
  expect((await evidence().get(token,result.processingId,receipt.evidenceId)).run.created_by).toBe(user);
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
  const before=await counts();await owner.query(`REVOKE INSERT ON ${s}.audit FROM fingence_db04_group_runtime`);
  try{await expect(evidence().persist(token,result)).rejects.toThrow();expect(await counts()).toEqual(before);}finally{await owner.query(`GRANT INSERT ON ${s}.audit TO fingence_db04_group_runtime`);}
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
   await owner.query(`UPDATE fingence_db04_group_synthetic.sessions SET ${change} WHERE token_hash=$1`,[tokenHash(token)]);
   try{await expect(evidence().persist(token,result)).rejects.toThrow();}finally{await owner.query("UPDATE fingence_db04_group_synthetic.sessions SET revoked=false,expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=$1",[tokenHash(token)]);}
  }
  await owner.query("UPDATE fingence_db04_group_synthetic.memberships SET role='Technical (Management)' WHERE user_id=$1 AND organization_id=$2",[user,org]);
  try{await expect(evidence().persist(token,result)).rejects.toThrow();}finally{await owner.query("UPDATE fingence_db04_group_synthetic.memberships SET role='Finance' WHERE user_id=$1 AND organization_id=$2",[user,org]);}
 });
});
