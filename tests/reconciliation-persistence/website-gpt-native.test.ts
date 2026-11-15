import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
vi.mock('server-only',()=>({}));
import {PostgresWebsiteGPTStore} from '../../lib/server/reconciliation/website-gpt-storage';
import {generateWebsiteJobGPT,readWebsiteJobSuggestions,type Owner} from '../../lib/server/reconciliation/website-job-gpt';
import {transactionDatabase} from '../../lib/server/db/postgres';
import {caller} from '../../lib/server/workspace/session';
import {secretHash} from '../../lib/server/workspace/store';
import {processDocuments} from '../../lib/demo/pipeline';
import type {GPTEvidenceView} from '../../lib/gpt-evidence-view';
import {GPTSuggestionsView} from '../../components/reconciliation/gpt-suggestions';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Opt-in ONLY for the disposable cluster created for this task. Never accepts a
// remote URL, generic database environment or an existing/personal local database.
const url=process.env.AI06_NATIVE_TEST_URL;
describe.skipIf(!url)('AI06 disposable native PostgreSQL',()=>{
 let admin:Pool,runtime:Pool,store:PostgresWebsiteGPTStore;
 const organizationId=randomUUID(),memberId=randomUUID(),token='S'.repeat(43),tokenHash=secretHash(token);
 let baseline:string;
 const fingerprint=async()=>JSON.stringify((await admin.query(`SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
  (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
  (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
  (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid) AS indexes
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('fingence_workspace','fingence_processing','fingence_ingestion') AND c.relkind='r' ORDER BY n.nspname,c.relname`)).rows);
 beforeAll(async()=>{
  const parsed=new URL(url!);
  if(parsed.hostname!=='127.0.0.1'||parsed.port!=='55487'||parsed.pathname!=='/ai06_native_review'||parsed.username!=='postgres')throw Error('DISPOSABLE_NATIVE_DATABASE_REQUIRED');
  admin=new Pool({connectionString:url,max:3});
  const directory=(await admin.query('SHOW data_directory')).rows[0].data_directory as string;
  if(resolve(directory).toLowerCase()!==resolve('.local/native-ai06-final/data').toLowerCase())throw Error('DISPOSABLE_CLUSTER_REQUIRED');
  // Reproducible resets are limited to this proven, synthetic-only test cluster.
  await admin.query('DROP SCHEMA IF EXISTS fingence_gpt_website,fingence_workspace,fingence_processing,fingence_ingestion CASCADE');
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION pg_database_owner; GRANT USAGE ON SCHEMA public TO PUBLIC');
  for(const role of ['fingence_ai06_website_login','fingence_ai06_website_runtime']){
   if((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount){await admin.query(`DROP OWNED BY ${role}`);await admin.query(`DROP ROLE ${role}`);}
  }
  await admin.query(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  for(const path of ['ingestion-layer-v1.sql','processing-jobs-v1.sql','workspace-v1.sql','workspace-v2-saic.sql','workspace-v3-log.sql'])await admin.query(readFileSync(`supabase/sql/${path}`,'utf8'));
  baseline=await fingerprint();
  await admin.query(readFileSync('supabase/sql/ai06-website-gpt-storage-review.sql','utf8'));
  await admin.query(readFileSync('supabase/sql/ai06-website-gpt-login-review.sql','utf8'));
  await admin.query("INSERT INTO fingence_workspace.organizations(id,name) VALUES($1,'Synthetic native test')",[organizationId]);
  await admin.query("INSERT INTO fingence_workspace.members(id,organization_id,email,role,password_hash) VALUES($1,$2,'native@example.invalid','FINANCE',$3)",[memberId,organizationId,'x'.repeat(64)]);
  await admin.query("INSERT INTO fingence_workspace.sessions(member_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[memberId,tokenHash]);
  runtime=new Pool({host:'127.0.0.1',port:55487,user:'fingence_ai06_website_login',database:'ai06_native_review',max:4});
  store=new PostgresWebsiteGPTStore(transactionDatabase(runtime),tokenHash);
 },60000);
 afterAll(async()=>{await runtime?.end();await admin?.end();});
 async function job(){
  const jobId=randomUUID(),ingestion=randomUUID(),processing='b'.repeat(64);
  await admin.query("INSERT INTO fingence_ingestion.runs(id,pipeline_version,processing_id,scope,document_count,organization_id,member_id) VALUES($1,'synthetic',$2,'{}',2,$3,$4)",[ingestion,processing,organizationId,memberId]);
  await admin.query("INSERT INTO fingence_processing.jobs(id,organization_id,member_id,status,outcome,inputs,processing_id,ingestion_run_id) VALUES($1,$2,$3,'COMPLETED','COMPLETED_WITH_EXCEPTIONS','[{}]',$4,$5)",[jobId,organizationId,memberId,processing,ingestion]);
  await admin.query('INSERT INTO fingence_processing.results(job_id,documents) VALUES($1,$2)',[jobId,JSON.stringify([{role:'BANK_STATEMENT',decision:'AUTO_ACCEPTED',sha256:'d'.repeat(64)},{role:'GENERAL_LEDGER',decision:'AUTO_ACCEPTED',sha256:'e'.repeat(64)}])]);
  const owner:Owner={organizationId,memberId,jobId};
  const data:GPTEvidenceView={version:'gpt-evidence-view/1',batchId:jobId,processingId:processing,runs:[{evidenceId:'c'.repeat(64),model:'openai/gpt-oss-120b',prompt:'website-job-gpt/1',createdAt:new Date().toISOString(),bankSha256:'d'.repeat(64),ledgerSha256:'e'.repeat(64),outcome:'UNRESOLVED',items:[]}]};
  return {owner,data};
 }
 async function admitted(){const f=await job();expect(await store.claim(f.owner)).toBe(true);await store.audit(f.owner,'START');return f;}
 it('installs the unchanged review SQL with forced RLS and no direct runtime table grants',async()=>{
  const rows=(await admin.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,has_table_privilege('fingence_ai06_website_login',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS direct FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_gpt_website' AND c.relkind='r'")).rows;
  expect(rows).toHaveLength(3);expect(rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity&&!r.direct)).toBe(true);
 });
 it('preserves existing ingestion/workspace/processing catalog definitions',async()=>{expect(await fingerprint()).toBe(baseline);});
 it('persists and retrieves through the actual restricted runtime with atomic audit',async()=>{
  const f=await admitted();await store.save(f.owner,f.data);expect(await store.read(f.owner)).toEqual(f.data);
  expect((await admin.query('SELECT action FROM fingence_gpt_website.audit WHERE job_id=$1 ORDER BY id',[f.owner.jobId])).rows.map(r=>r.action)).toEqual(['CLAIM','START','SAVED','READ']);
 });
 it('admits exactly one concurrent request and freezes failed attempts',async()=>{
  const f=await job();expect((await Promise.all([store.claim(f.owner),store.claim(f.owner)])).sort()).toEqual([false,true]);
  await store.audit(f.owner,'FAILED');expect(await store.claim(f.owner)).toBe(false);await expect(store.save(f.owner,f.data)).rejects.toThrow();
 });
 it('denies direct financial/evidence access, mutation and anonymous API execution',async()=>{
  for(const sql of ['SELECT * FROM fingence_processing.jobs','SELECT * FROM fingence_gpt_website.evidence','DELETE FROM fingence_gpt_website.evidence','UPDATE fingence_gpt_website.attempts SET processing_id=processing_id'])await expect(runtime.query(sql)).rejects.toMatchObject({code:'42501'});
  expect((await admin.query("SELECT has_function_privilege('anon','fingence_gpt_website.operate(text,uuid,text,jsonb)','EXECUTE') AS allowed")).rows[0].allowed).toBe(false);
 });
 it('rejects mismatched principal scope, invalid sessions and stored job ownership mismatches',async()=>{
  const f=await job();await expect(store.claim({...f.owner,memberId:randomUUID()})).rejects.toThrow();
  expect((await admin.query('SELECT 1 FROM fingence_gpt_website.attempts WHERE job_id=$1',[f.owner.jobId])).rowCount).toBe(0);
  await expect(new PostgresWebsiteGPTStore(transactionDatabase(runtime),'f'.repeat(64)).claim(f.owner)).rejects.toThrow();
  await admin.query('UPDATE fingence_processing.jobs SET member_id=NULL WHERE id=$1',[f.owner.jobId]);await expect(store.claim(f.owner)).rejects.toThrow();
 });
 it('rejects ended sessions and paused or disabled organization generation',async()=>{
  const f=await job();
  await admin.query("UPDATE fingence_workspace.sessions SET ended_at=now(),end_reason='SIGNED_OUT' WHERE token_hash=$1",[tokenHash]);
  try{await expect(store.claim(f.owner)).rejects.toThrow();}finally{await admin.query('UPDATE fingence_workspace.sessions SET ended_at=NULL,end_reason=NULL WHERE token_hash=$1',[tokenHash]);}
  await admin.query('UPDATE fingence_workspace.organizations SET ai_enabled=false WHERE id=$1',[organizationId]);
  try{await expect(store.claim(f.owner)).rejects.toThrow();}finally{await admin.query('UPDATE fingence_workspace.organizations SET ai_enabled=true WHERE id=$1',[organizationId]);}
 });
 it('rejects foreign ingestion lineage and evidence source fingerprints',async()=>{
  const f=await admitted();f.data.runs[0].bankSha256='9'.repeat(64);await expect(store.save(f.owner,f.data)).rejects.toThrow();
  expect((await admin.query('SELECT 1 FROM fingence_gpt_website.evidence WHERE job_id=$1',[f.owner.jobId])).rowCount).toBe(0);
  await admin.query('UPDATE fingence_ingestion.runs SET member_id=NULL WHERE id=(SELECT ingestion_run_id FROM fingence_processing.jobs WHERE id=$1)',[f.owner.jobId]);await expect(store.read(f.owner)).rejects.toThrow();
 });
 it('enforces UNRESOLVED even when the SQL API is called directly',async()=>{
  const f=await admitted();(f.data.runs[0] as {outcome:string}).outcome='APPROVED';
  await expect(runtime.query('SELECT fingence_gpt_website.operate($1,$2,$3,$4)',[tokenHash,f.owner.jobId,'SAVE',JSON.stringify(f.data)])).rejects.toThrow();
 });
 it('enforces append-only evidence even for owner UPDATE, DELETE and TRUNCATE',async()=>{
  const f=await admitted();await store.save(f.owner,f.data);
  for(const sql of ['UPDATE fingence_gpt_website.evidence SET outcome=outcome','DELETE FROM fingence_gpt_website.evidence','TRUNCATE fingence_gpt_website.evidence'])await expect(admin.query(sql)).rejects.toMatchObject({code:'42501'});
 });
 it('rolls back SAVE and withholds READ when the atomic audit insert fails',async()=>{
  const f=await admitted();await admin.query("CREATE FUNCTION fingence_gpt_website.test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER test_audit_failure BEFORE INSERT ON fingence_gpt_website.audit FOR EACH ROW EXECUTE FUNCTION fingence_gpt_website.test_audit_failure()");
  try{await expect(store.save(f.owner,f.data)).rejects.toThrow();await expect(store.read(f.owner)).rejects.toThrow();}
  finally{await admin.query('DROP TRIGGER test_audit_failure ON fingence_gpt_website.audit; DROP FUNCTION fingence_gpt_website.test_audit_failure()');}
  expect((await admin.query('SELECT 1 FROM fingence_gpt_website.evidence WHERE job_id=$1',[f.owner.jobId])).rowCount).toBe(0);
 });
 it('rolls back evidence and SAVED audit on explicit transaction rollback',async()=>{
  const f=await admitted(),client=await runtime.connect();
  try{await client.query('BEGIN');await client.query('SELECT fingence_gpt_website.operate($1,$2,$3,$4)',[tokenHash,f.owner.jobId,'SAVE',JSON.stringify(f.data)]);await client.query('ROLLBACK');}finally{client.release();}
  expect((await admin.query("SELECT 1 FROM fingence_gpt_website.audit WHERE job_id=$1 AND action='SAVED'",[f.owner.jobId])).rowCount).toBe(0);expect(await store.read(f.owner)).toBeNull();
 });
 it('runs trusted synthetic records -> mocked GPT -> native Supabase contract -> verified cookie -> Reconciliation UI',async()=>{
  const f=await job(),docs=['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv'].map(name=>({name,bytes:new Uint8Array(readFileSync(`public/demo/${name}`)),provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const}));
  const context=await processDocuments(docs,undefined,undefined,{job:{id:f.owner.jobId,runner:'BACKEND_JOB_RUNNER'}});
  const before=JSON.stringify(context.outputs),bank=context.outputs.bank!,ledger=context.outputs.ledger!;
  await admin.query('UPDATE fingence_processing.jobs SET processing_id=$1 WHERE id=$2',[context.processingId,f.owner.jobId]);
  await admin.query('UPDATE fingence_processing.results SET documents=$1 WHERE job_id=$2',[JSON.stringify([{role:'BANK_STATEMENT',decision:'AUTO_ACCEPTED',sha256:bank.sha256},{role:'GENERAL_LEDGER',decision:'AUTO_ACCEPTED',sha256:ledger.sha256}]),f.owner.jobId]);
  const complete=vi.fn(async()=>({content:{suggestions:[],abstentions:[]},receipt:{provider:'GROQ' as const,model:'openai/gpt-oss-120b',requestId:'synthetic',latencyMs:1,mode:'LIVE' as const,inputTokens:1,outputTokens:1,estimatedUsd:0}}));
  await generateWebsiteJobGPT(context,f.owner,'synthetic',{store,complete,admission:async()=>({admitted:true,reservedMicros:0,settle:async()=>{}})});
  expect(JSON.stringify(context.outputs)).toBe(before);
  const verify=(headers:Headers)=>caller(headers,{url:'http://127.0.0.1:55487',key:'synthetic-local'},async(_input,init)=>{
   const args=JSON.parse(String(init?.body));const result=await admin.query('SELECT public.fingence_workspace_principal($1) AS principal',[args.p_token_hash]);return Response.json(result.rows[0].principal);
  });
  const response=await readWebsiteJobSuggestions(new Request(`http://localhost/?jobId=${f.owner.jobId}`,{headers:{cookie:`fingence_session=${token}`}}),{store,verify});
  expect(response.status).toBe(200);const data=await response.json();expect(data.processingId).toBe(context.processingId);
  expect(renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'ready',data}}))).toContain('UNRESOLVED');
 });
});
