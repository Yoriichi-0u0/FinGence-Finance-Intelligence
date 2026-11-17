import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
vi.mock('server-only',()=>({}));
import {PostgresWebsiteGPTStore,createWebsiteGPTDatabase} from '../../lib/server/reconciliation/website-gpt-storage';
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
  for(const path of ['ingestion-layer-v1.sql','processing-jobs-v1.sql','workspace-v1.sql','workspace-v2-saic.sql','workspace-v3-log.sql','workspace-v4-preferences.sql','workspace-v5-dashboard-cards.sql','workspace-v6-saved-runs.sql','workspace-v7-password.sql'])await admin.query(readFileSync(`supabase/sql/${path}`,'utf8'));
  baseline=await fingerprint();
  await admin.query(readFileSync('supabase/sql/ai06-website-gpt-storage-review.sql','utf8'));
  await admin.query(readFileSync('supabase/sql/ai06-website-gpt-login-review.sql','utf8'));
  await admin.query(readFileSync('supabase/sql/ai06-unexplained-review-approval.sql','utf8'));
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
 it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s: existing operate ownership and role-projected audited evidence',async role=>{
  const verifySession=(sessionToken:string)=>caller(new Headers({cookie:`fingence_session=${sessionToken}`}),{url:'https://synthetic.invalid',key:'synthetic'},(async(_input,init)=>{
   const args=JSON.parse(String(init?.body));return Response.json((await admin.query('SELECT public.fingence_workspace_principal($1) result',[args.p_token_hash])).rows[0].result);
  }) as typeof fetch);
  await admin.query('UPDATE fingence_workspace.members SET role=$1 WHERE id=$2',[role,memberId]);
  try{
   const f=await admitted();await store.save(f.owner,f.data);
   const identity=await verifySession(token);
   const request=()=>new Request(`http://localhost/?jobId=${f.owner.jobId}`);
   const response=await readWebsiteJobSuggestions(request(),{store,verify:async()=>identity});
   expect(response.status).toBe(200);const body=await response.json();
   expect(body.version).toBe(role==='FINANCE'?'gpt-finance-view/1':'gpt-evidence-view/1');
   expect(body.runs[0].outcome).toBe('UNRESOLVED');
   if(role==='FINANCE'){
    expect(body).not.toHaveProperty('processingId');expect(body.runs[0]).not.toHaveProperty('bankSha256');
   }else expect(body).toEqual(f.data);
   {
    const other=randomUUID(),otherToken=randomUUID().replaceAll('-','')+'O'.repeat(11),hash=secretHash(otherToken);
    const org=organizationId;
    await admin.query("INSERT INTO fingence_workspace.members(id,organization_id,email,role,password_hash) VALUES($1,$2,$3,$4,$5)",[other,org,`${other}@example.invalid`,role,'x'.repeat(64)]);
    await admin.query("INSERT INTO fingence_workspace.sessions(member_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[other,hash]);
    const otherIdentity=await verifySession(otherToken),otherStore=new PostgresWebsiteGPTStore(transactionDatabase(runtime),hash);
    const denied=await readWebsiteJobSuggestions(request(),{store:otherStore,verify:async()=>otherIdentity});
    expect(denied.status).toBe(404);expect(await denied.text()).not.toContain(f.data.processingId);
   }
  }finally{await admin.query("UPDATE fingence_workspace.members SET role='FINANCE' WHERE id=$1",[memberId]);}
 });
 async function admitted(){const f=await job();expect(await store.claim(f.owner)).toBe(true);await store.audit(f.owner,'START');return f;}
 const api=(owner:Owner,backend=store)=>readWebsiteJobSuggestions(new Request(`http://localhost/?jobId=${owner.jobId}`),{store:backend,verify:async()=>({kind:'SIGNED_IN',tokenHash,principal:{sessionId:'native',memberId:owner.memberId,email:'native@example.invalid',role:'FINANCE',organization:{id:owner.organizationId,name:'Synthetic'},processing:{paused:false,reason:null,since:null},ai:{enabled:true,since:null}}})});
 it('installs the unchanged review SQL with forced RLS and no direct runtime table grants',async()=>{
  const rows=(await admin.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,has_table_privilege('fingence_ai06_website_login',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS direct FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_gpt_website' AND c.relkind='r'")).rows;
  expect(rows).toHaveLength(5);expect(rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity&&!r.direct)).toBe(true);
 });
 async function reviewFixture(){
  const f=await admitted(),b=randomUUID(),l=randomUUID(),ref='INV-'+randomUUID().slice(0,8);
  const ingestion=(await admin.query('SELECT ingestion_run_id FROM fingence_processing.jobs WHERE id=$1',[f.owner.jobId])).rows[0].ingestion_run_id;
  for(const [ordinal,role,sha,id] of [[0,'BANK_STATEMENT',f.data.runs[0].bankSha256,b],[1,'GENERAL_LEDGER',f.data.runs[0].ledgerSha256,l]] as const){
   const document=(await admin.query("INSERT INTO fingence_ingestion.documents(run_id,ordinal,name,file_sha256,table_sha256,format,role,decision,reason,method) VALUES($1,$2,'synthetic.csv',$3,$3,'CSV',$4,'AUTO_ACCEPTED','Synthetic native contract fixture','EXACT_SIGNATURE') RETURNING id",[ingestion,ordinal,sha,role])).rows[0].id;
   await admin.query("INSERT INTO fingence_ingestion.records(document_id,ordinal,record_id,business_id,transaction_date,currency,signed_cents,reference) VALUES($1,0,$2,'synthetic-business','2026-03-01','MYR',913721,$3)",[document,id,ref]);
  }
  const keys='authoritativeRecordIds pairTopology uniqueSourceIdentities finalUnexplained distinctRoles bankSourceIdentity bankSourceFingerprint bankEligibility bankTransactionIdentity bankMonetaryBasis bankDateBasis ledgerSourceIdentity ledgerSourceFingerprint ledgerEligibility ledgerTransactionIdentity ledgerMonetaryBasis ledgerDateBasis equalSignedCents sameCurrency sameDirection dateWithinSevenDays referenceAgreement businessScope authoritativeReferences uniqueFinancialPartner uniqueAssignment'.split(' ');
  f.data.runs[0].items=[{type:'SUGGESTION',ordinal:0,bankId:b,ledgerId:l,recordId:null,bankReference:ref,ledgerReference:ref,explanation:'Synthetic contract fixture',reasons:['PAIR_CHECKS_PASSED'],verification:{...Object.fromEntries(keys.map(k=>[k,true])),policy:'website-pair-verifier/1',proposalPolicy:'website-unexplained/1'},score:null,outcome:'UNRESOLVED'}];
  const reconciliation={version:'fingence-reconciliation-layer-v1',origin:'DETERMINISTIC_RULES',status:'UNEXPLAINED_DIFFERENCE',scope:{businessId:'synthetic-business'},sources:{bank:{sha256:f.data.runs[0].bankSha256},ledger:{sha256:f.data.runs[0].ledgerSha256}},checks:[{passed:true}],periods:[{checks:[{passed:true}],items:[{resolution:'UNEXPLAINED',bankRecordId:b,ledgerRecordIds:[l],link:null,entryIds:[]}]}],entries:[]};
  await admin.query('UPDATE fingence_processing.results SET reconciliation=$2 WHERE job_id=$1',[f.owner.jobId,JSON.stringify(reconciliation)]);
  await store.save(f.owner,f.data);
  return {...f,b,l,payload:{ordinal:0,expectedEvidenceId:f.data.runs[0].evidenceId,requestId:randomUUID()}};
 }
 it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s: own proposal approval is audited and never changes accounting',async role=>{
  await admin.query('UPDATE fingence_workspace.members SET role=$1 WHERE id=$2',[role,memberId]);
  try{const f=await reviewFixture(),before=(await admin.query('SELECT reconciliation FROM fingence_processing.results WHERE job_id=$1',[f.owner.jobId])).rows;
   expect(await store.reviewOperation(f.owner,'READ')).toMatchObject({items:[{canApprove:true,canReject:true,decision:'PENDING'}]});
   expect(await store.reviewOperation(f.owner,'APPROVE',f.payload)).toMatchObject({decision:'APPROVE',financialOutcome:'UNRESOLVED',accountingEffect:'NONE'});
   expect((await admin.query('SELECT reconciliation FROM fingence_processing.results WHERE job_id=$1',[f.owner.jobId])).rows).toEqual(before);
   expect((await store.read(f.owner))!.runs[0].outcome).toBe('UNRESOLVED');
  }finally{await admin.query("UPDATE fingence_workspace.members SET role='FINANCE' WHERE id=$1",[memberId]);}
 });
 it('replays the same request idempotently and rejects altered/stale replay',async()=>{
  const f=await reviewFixture();await store.reviewOperation(f.owner,'REJECT',f.payload);
  await expect(store.reviewOperation(f.owner,'REJECT',f.payload)).resolves.toMatchObject({decision:'REJECT'});
  await expect(store.reviewOperation(f.owner,'APPROVE',f.payload)).rejects.toThrow('GPT_SQL_DUPLICATE');
  await expect(store.reviewOperation(f.owner,'REJECT',{...f.payload,expectedEvidenceId:'0'.repeat(64)})).rejects.toThrow('GPT_SQL_DUPLICATE');
  expect((await admin.query('SELECT count(*)::int n FROM fingence_gpt_website.reviews WHERE job_id=$1',[f.owner.jobId])).rows[0].n).toBe(1);
 });
 it('serializes conflicting approve/reject decisions and atomically audits the winner',async()=>{
  const f=await reviewFixture();const results=await Promise.allSettled([store.reviewOperation(f.owner,'APPROVE',f.payload),store.reviewOperation(f.owner,'REJECT',{...f.payload,requestId:randomUUID()})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await admin.query('SELECT count(*)::int n FROM fingence_gpt_website.review_audit WHERE job_id=$1',[f.owner.jobId])).rows[0].n).toBe(1);
 });
 it('rolls back review on audit failure and denies cross-user or cross-organization scope',async()=>{
  const f=await reviewFixture();await admin.query("CREATE FUNCTION fingence_gpt_website.fail_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER fail_review_audit BEFORE INSERT ON fingence_gpt_website.review_audit FOR EACH ROW EXECUTE FUNCTION fingence_gpt_website.fail_review_audit()");
  try{await expect(store.reviewOperation(f.owner,'REJECT',f.payload)).rejects.toThrow();expect((await admin.query('SELECT 1 FROM fingence_gpt_website.reviews WHERE job_id=$1',[f.owner.jobId])).rowCount).toBe(0);}
  finally{await admin.query('DROP TRIGGER fail_review_audit ON fingence_gpt_website.review_audit; DROP FUNCTION fingence_gpt_website.fail_review_audit()');}
  for(const field of ['memberId','organizationId'] as const)await expect(store.reviewOperation({...f.owner,[field]:randomUUID()},'REJECT',f.payload)).rejects.toThrow('GPT_SCOPE_DENIED');
  expect((await admin.query('SELECT 1 FROM fingence_gpt_website.reviews WHERE job_id=$1',[f.owner.jobId])).rowCount).toBe(0);
 });
 it.each(['reference','amount','resolved','correcting-entry','failed-check','legacy'] as const)('denies stale/unsafe review: %s',async mode=>{
  const f=await reviewFixture();
  if(mode==='reference')await admin.query("UPDATE fingence_ingestion.records SET reference='INV830' WHERE record_id=$1",[f.l]);
  if(mode==='amount')await admin.query('UPDATE fingence_ingestion.records SET signed_cents=1 WHERE record_id=$1',[f.l]);
  if(mode==='resolved')await admin.query("UPDATE fingence_processing.results SET reconciliation=jsonb_set(reconciliation,'{periods,0,items,0,resolution}','\"TIMING_OPEN\"') WHERE job_id=$1",[f.owner.jobId]);
  if(mode==='correcting-entry')await admin.query("UPDATE fingence_processing.results SET reconciliation=jsonb_set(reconciliation,'{entries}',$2) WHERE job_id=$1",[f.owner.jobId,JSON.stringify([{sourceRecordIds:[f.b]}])]);
  if(mode==='failed-check')await admin.query("UPDATE fingence_processing.results SET reconciliation=jsonb_set(reconciliation,'{checks,0,passed}','false') WHERE job_id=$1",[f.owner.jobId]);
  // Immutable evidence cannot be changed, even for a test: create a legacy item via its original save contract instead.
  if(mode==='legacy'){
   const legacy=await admitted();legacy.data.runs[0].items=[{...f.data.runs[0].items[0],verification:{equalSignedCents:true,sameCurrency:true,dateWithinSevenDays:true}}];await store.save(legacy.owner,legacy.data);
   expect(await store.reviewOperation(legacy.owner,'READ')).toMatchObject({items:[{canApprove:false,canReject:true}]});
   await expect(store.reviewOperation(legacy.owner,'APPROVE',{...f.payload,expectedEvidenceId:legacy.data.runs[0].evidenceId})).rejects.toThrow();return;
  }
  await expect(store.reviewOperation(f.owner,'APPROVE',f.payload)).rejects.toThrow();
 });
 it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s cannot review another member job with a real foreign session',async role=>{
  const f=await reviewFixture(),other=randomUUID(),otherHash=secretHash(randomUUID()+'synthetic-foreign-session');
  await admin.query("INSERT INTO fingence_workspace.members(id,organization_id,email,role,password_hash) VALUES($1,$2,$3,$4,$5)",[other,organizationId,`${other}@example.invalid`,role,'x'.repeat(64)]);
  await admin.query("INSERT INTO fingence_workspace.sessions(member_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[other,otherHash]);
  const foreign=new PostgresWebsiteGPTStore(transactionDatabase(runtime),otherHash);
  await expect(foreign.reviewOperation({...f.owner,memberId:other},'APPROVE',f.payload)).rejects.toThrow('GPT_JOB_DENIED');
  await expect(foreign.reviewOperation({...f.owner,memberId:other},'READ')).rejects.toThrow('GPT_JOB_DENIED');
 });
 it('enforces append-only review history and no direct runtime or anonymous privileges',async()=>{
  const f=await reviewFixture();await store.reviewOperation(f.owner,'REJECT',f.payload);
  for(const table of ['reviews','review_audit']){
   await expect(runtime.query(`SELECT * FROM fingence_gpt_website.${table}`)).rejects.toMatchObject({code:'42501'});
   await expect(admin.query(`DELETE FROM fingence_gpt_website.${table}`)).rejects.toThrow();
   await expect(admin.query(`TRUNCATE fingence_gpt_website.${table}`)).rejects.toThrow();
  }
  expect((await admin.query("SELECT has_function_privilege('anon','fingence_gpt_website.review(text,uuid,text,jsonb)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
 });
 it('preserves existing ingestion/workspace/processing catalog definitions',async()=>{expect(await fingerprint()).toBe(baseline);});
 it('persists and retrieves through the actual restricted runtime with atomic audit',async()=>{
  const f=await admitted();await store.save(f.owner,f.data);expect(await store.read(f.owner)).toEqual(f.data);
  expect((await admin.query('SELECT action FROM fingence_gpt_website.audit WHERE job_id=$1 ORDER BY id',[f.owner.jobId])).rows.map(r=>r.action)).toEqual(['CLAIM','START','SAVED','READ']);
 });
 it('allows a non-callable private PUBLIC helper but still denies newly callable access',async()=>{
  const f=await job();
  await admin.query('CREATE FUNCTION fingence_workspace.ai06_private_helper() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$');
  try{
   await expect(runtime.query('SELECT fingence_workspace.ai06_private_helper()')).rejects.toMatchObject({code:'42501'});
   expect(await store.claim(f.owner)).toBe(true);
   await admin.query('GRANT USAGE ON SCHEMA fingence_workspace TO fingence_ai06_website_login');
   try{await expect(store.read(f.owner)).rejects.toThrow('GPT_RUNTIME_DENIED');}
   finally{await admin.query('REVOKE USAGE ON SCHEMA fingence_workspace FROM fingence_ai06_website_login');}
  }finally{await admin.query('DROP FUNCTION fingence_workspace.ai06_private_helper()');}
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
  expect(response.status).toBe(200);const data=await response.json();expect(data.version).toBe('gpt-finance-view/1');expect(data).not.toHaveProperty('processingId');
  expect(data.runs.every((run:{outcome:string})=>run.outcome==='UNRESOLVED')).toBe(true);
  expect(renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'ready',data}}))).toContain('No saved outcomes.');
  expect(complete).not.toHaveBeenCalled();
 });
 it('returns 404 for a missing, other-owner or missing-lineage job instead of masking it as 503',async()=>{
  const f=await job();expect((await api({...f.owner,jobId:randomUUID()})).status).toBe(404);
  await admin.query('UPDATE fingence_processing.jobs SET member_id=NULL WHERE id=$1',[f.owner.jobId]);expect((await api(f.owner)).status).toBe(404);
 });
 it('returns 401 when the database session ends after the website identity check',async()=>{
  const f=await job();await admin.query("UPDATE fingence_workspace.sessions SET ended_at=now(),end_reason='SIGNED_OUT' WHERE token_hash=$1",[tokenHash]);
  try{expect((await api(f.owner)).status).toBe(401);}finally{await admin.query('UPDATE fingence_workspace.sessions SET ended_at=NULL,end_reason=NULL WHERE token_hash=$1',[tokenHash]);}
 });
 it('keeps genuine forbidden table access and missing forced RLS as safe 503 failures',async()=>{
  const f=await job();await admin.query('GRANT SELECT ON fingence_gpt_website.evidence TO fingence_ai06_website_login');
  try{expect((await api(f.owner)).status).toBe(503);}finally{await admin.query('REVOKE SELECT ON fingence_gpt_website.evidence FROM fingence_ai06_website_login');}
  await admin.query('ALTER TABLE fingence_gpt_website.evidence NO FORCE ROW LEVEL SECURITY');
  try{expect((await api(f.owner)).status).toBe(503);}finally{await admin.query('ALTER TABLE fingence_gpt_website.evidence FORCE ROW LEVEL SECURITY');}
 });
 it('fails safely with 503 when the reviewed operate contract is absent',async()=>{
  const f=await job();await admin.query('ALTER FUNCTION fingence_gpt_website.operate(text,uuid,text,jsonb) RENAME TO native_unavailable_operate');
  try{expect((await api(f.owner)).status).toBe(503);}finally{await admin.query('ALTER FUNCTION fingence_gpt_website.native_unavailable_operate(text,uuid,text,jsonb) RENAME TO operate');}
 });
 it('returns empty 404 for an authorized job and still audits READ_EMPTY',async()=>{
  const f=await job();expect((await api(f.owner)).status).toBe(404);
  expect((await admin.query("SELECT 1 FROM fingence_gpt_website.audit WHERE job_id=$1 AND action='READ_EMPTY'",[f.owner.jobId])).rowCount).toBe(1);
 });
 it('keeps reads working while AI generation is disabled',async()=>{
  const f=await admitted();await store.save(f.owner,f.data);await admin.query('UPDATE fingence_workspace.organizations SET ai_enabled=false WHERE id=$1',[organizationId]);
  try{expect((await api(f.owner)).status).toBe(200);}finally{await admin.query('UPDATE fingence_workspace.organizations SET ai_enabled=true WHERE id=$1',[organizationId]);}
 });
 it('fails closed on an invalid saved DTO without returning stored content',async()=>{
  const f=await admitted();const malformed=structuredClone(f.data);(malformed.runs[0] as {model:unknown}).model={private:'SYNTHETIC_NOT_FOR_CLIENT'};
  await runtime.query('SELECT fingence_gpt_website.operate($1,$2,$3,$4)',[tokenHash,f.owner.jobId,'SAVE',JSON.stringify(malformed)]);
  const response=await api(f.owner);expect(response.status).toBe(503);expect(await response.text()).not.toContain('SYNTHETIC_NOT_FOR_CLIENT');
 });
 it('returns safe 503 for native TLS and login failures with no plaintext fallback',async()=>{
  const f=await job();
  for(const connection of ['postgresql://fingence_ai06_website_login@127.0.0.1:55487/ai06_native_review?sslmode=verify-full','postgresql://native_missing_login@127.0.0.1:55487/ai06_native_review?sslmode=disable']){
   const db=createWebsiteGPTDatabase({SUPABASE_DATABASE_URL:connection});
   try{const response=await api(f.owner,new PostgresWebsiteGPTStore(db,tokenHash));expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'GPT_UNAVAILABLE'});}finally{await db.close();}
  }
 });
});
