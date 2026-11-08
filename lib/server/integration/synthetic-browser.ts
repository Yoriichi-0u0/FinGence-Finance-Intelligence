import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { approveMapping, createAcceptedDataPayload, createDataset, DEFAULT_OPTIONS, ingestDatasetRun, inspectFile, overrideMapping, suggestMapping, type IngestionOptions } from '../../ingestion';
import { createGroupedPersistenceService, type GroupedPersistenceReceipt } from '../persistence/grouped';
import { persistSecurityAuditEvent } from '../security/audit-store';
import { createLocalSessionSumService } from './local-session-sum';
import { createLocalFinancialReportService } from './local-financial-report';
import { createLocalFinancialQuestionService } from './local-financial-question';
import type { TransactionDatabase, SqlConnection } from '../db/postgres';

const samples = {
 '42e0789e996c5b4af3653d39128f6c91190faefa7708f1c1ec5d8bfc54fb14d9': {file:'ledger.csv',source:'Ledger',money:'debit_credit',date:'posting_date'},
 '8a4d11c7b5850dc99c1392ec1bd941cf4fa04fac2b61f621dffb35a0226896cf': {file:'bank_statement.xlsx',source:'Bank Statement',money:'amount_direction',date:'transaction_date'},
 '6224c108304ab11e0919919e2454492e8d3dbad9448771e5088d310a3736ccfd': {file:'edge_cases.csv',source:'Other',money:'signed_amount',date:'transaction_date'},
} as const;
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function localOnly() { if(process.env.NODE_ENV!=='development'||process.env.VERCEL||process.env.FINGENCE_AI_LOCAL!=='1'||process.env.FINGENCE_V2_I1_LOCAL!=='1') throw new Error('LOCAL_ONLY'); }
let instance:Promise<ReturnType<typeof createRuntime>>|undefined;
function createRuntime(db:PGlite, database:TransactionDatabase, tenant:string, subject:string) {
 const generation=randomUUID(); // Exactly this disposable database, not a durable commit verdict.
 const operationIdValid=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
 const operations=new Map<string, {state:'PROCESSING'|'COMMITTED'|'UNKNOWN'|'RETIRED';batchId?:string;sourceFile?:string}>();
 const watchers=new Map<string,Set<()=>void>>();
 const timers=new Map<string,ReturnType<typeof setTimeout>>();
 const notify=(token:string)=>{for(const listener of watchers.get(token)??[])listener();};
 async function authorize(tx:SqlConnection,token:string) {
   const auth=await tx.query<{subject_id:string;organization_id:string}>(`SELECT s.subject_id::text,s.organization_id::text FROM fingence_local_security_v1.sessions s JOIN fingence_local_security_v1.memberships m USING(subject_id,organization_id)
    WHERE s.token_hash=$1 AND s.revoked=false AND s.expires_at>clock_timestamp() AND m.active AND m.role='Finance' FOR SHARE OF s,m`,[sha(Buffer.from(token))]);
   if(auth.rows.length!==1||auth.rows[0].organization_id!==tenant)throw new Error('DENIED');
 }
 async function audit(tx:SqlConnection) {await persistSecurityAuditEvent(tx,{actorId:subject,organizationId:tenant,action:'transactions.list',outcome:'success',targetType:'transaction_collection',targetId:'transactions',requestId:null,approvalId:null});}
 async function scopedRead(tx:SqlConnection,batchId:string,token:string) {
   await authorize(tx,token);
   const batch=await tx.query<{id:string;source_file:string;rows_received:number;valid_count:number;warning_count:number;rejected_count:number}>(`SELECT b.id::text,b.source_file,b.rows_received,b.valid_count,b.warning_count,b.rejected_count FROM public.ingestion_batches b JOIN fingence_local_security_v1.batch_owners o ON o.batch_id=b.id WHERE b.id=$1::uuid AND o.organization_id=$2::uuid FOR SHARE OF b,o`,[batchId,tenant]);
   if(batch.rows.length!==1)throw new Error('DENIED');
   const records=await tx.query<{id:string;source_row_id:string;source_amount:string|null;currency:string|null;ingestion_status:string;reference:string|null}>(`SELECT id::text,source_row_id,source_amount::text,currency,ingestion_status,reference FROM public.financial_records WHERE batch_id=$1::uuid AND ingestion_status IN ('VALID','WARNING') ORDER BY source_row_id FOR SHARE`,[batchId]);
   return {batch:batch.rows[0],records:records.rows};
 }
 return {
  tenant,generation,
  async createSession(ttlMs=30*60*1000) {
   localOnly();const token=randomBytes(32).toString('base64url');const expiresAt=new Date(Date.now()+Math.min(Math.max(ttlMs,1),30*60*1000));
   await db.query('INSERT INTO fingence_local_security_v1.sessions VALUES($1,$2,$3,$4,false)',[sha(Buffer.from(token)),subject,tenant,expiresAt.toISOString()]);
   const timer=setTimeout(()=>{notify(token);timers.delete(token);},expiresAt.getTime()-Date.now());timer.unref();timers.set(token,timer);
   return {token,expiresAt:expiresAt.toISOString()};
  },
  async checkSession(token:string) {localOnly();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('DENIED');await database.transaction(tx=>authorize(tx,token));},
  async listBatches(token:string) {localOnly();return database.transaction(async tx=>{await authorize(tx,token);const rows=await tx.query<{id:string;name:string}>(`SELECT DISTINCT ON (b.source_file) b.id::text,b.source_file AS name FROM public.ingestion_batches b JOIN fingence_local_security_v1.batch_owners o ON o.batch_id=b.id WHERE o.organization_id=$1 ORDER BY b.source_file,b.created_at DESC,b.id DESC`,[tenant]);await audit(tx);return rows.rows;});},
  async revoke(token:string) {localOnly();await db.query('UPDATE fingence_local_security_v1.sessions SET revoked=true WHERE token_hash=$1',[sha(Buffer.from(token))]);clearTimeout(timers.get(token));timers.delete(token);notify(token);},
  watch(token:string,listener:()=>void) {const listeners=watchers.get(token)??new Set<()=>void>();listeners.add(listener);watchers.set(token,listeners);return()=>{listeners.delete(listener);if(!listeners.size)watchers.delete(token);};},
  async upload(bytes:Uint8Array, operationId:string,token:string,expectedGeneration:string) {
   localOnly();if(expectedGeneration!==generation||!operationIdValid(operationId))throw new Error('OPERATION_UNAVAILABLE');
   await database.transaction(tx=>authorize(tx,token));
   if(operations.has(operationId)||operations.size>=100)throw new Error('OPERATION_UNAVAILABLE');
   const sample=samples[sha(bytes) as keyof typeof samples]; if(!sample)throw new Error('SYNTHETIC_SAMPLE_REQUIRED');
   operations.set(operationId,{state:'PROCESSING'});
   try {
    const file=await inspectFile(bytes,{name:sample.file}); const dataset=createDataset(file,0);
    let mapping=suggestMapping(dataset); if(sample.file==='bank_statement.xlsx')mapping=overrideMapping(mapping,dataset.columns.indexOf('Details'),'reference');
    const result=ingestDatasetRun(dataset,approveMapping(mapping),{...DEFAULT_OPTIONS,sourceSystem:sample.source,monetaryMode:sample.money as IngestionOptions['monetaryMode'],dateBasis:sample.date as IngestionOptions['dateBasis']});
    const c1=createAcceptedDataPayload([result]); if(c1.datasets.length!==1||c1.datasets[0].normalized.length!==result.summary.accepted)throw new Error('C1_INVARIANT');
    const scoped:TransactionDatabase={close:async()=>{},transaction:work=>database.transaction(async tx=>{
     await authorize(tx,token);
     const receipt=await work(tx) as GroupedPersistenceReceipt;
     if(!Array.isArray(receipt.datasets))throw new Error('PERSISTENCE_INVARIANT');
     for(const child of receipt.datasets)await tx.query('INSERT INTO fingence_local_security_v1.batch_owners(batch_id,organization_id) VALUES($1,$2)',[child.batch_id,tenant]);
     await audit(tx);
     return receipt as never;
    })};
    const receipt=await createGroupedPersistenceService(scoped).persistGroupedAttempt({attempt_id:operationId,results:[result]});
    const batchId=receipt.datasets[0].batch_id; operations.set(operationId,{state:'COMMITTED',batchId,sourceFile:sample.file});
    return {operationId,batchId,sourceFile:sample.file};
   } catch { operations.set(operationId,{state:'UNKNOWN'}); throw new Error('OPERATION_UNCONFIRMED'); }
  },
  async lookup(operationId:string,token:string,originalGeneration:string|null=null) {
   localOnly();if(!operationIdValid(operationId)||(originalGeneration!==null&&!operationIdValid(originalGeneration)))throw new Error('DENIED');
   return database.transaction(async tx=>{await authorize(tx,token);await audit(tx);
    if(originalGeneration!==null&&originalGeneration!==generation)return {state:'RETIRED_GENERATION' as const,operationId,generation:originalGeneration,currentGeneration:generation};
    return operations.get(operationId)??{state:'NOT_REGISTERED' as const,operationId,generation:originalGeneration,currentGeneration:generation};
   });
  },
  async retire(operationId:string,token:string,originalGeneration:string|null,expectedGeneration:string) {
   localOnly();if(expectedGeneration!==generation||!operationIdValid(operationId)||(originalGeneration!==null&&!operationIdValid(originalGeneration)))throw new Error('DENIED');
   return database.transaction(async tx=>{await authorize(tx,token);
    if(originalGeneration!==null&&originalGeneration!==generation){await audit(tx);return {state:'RETIRED_GENERATION' as const,operationId,generation:originalGeneration,currentGeneration:generation};}
    const existing=operations.get(operationId);
    if(existing&&existing.state!=='RETIRED'){await audit(tx);return existing;}
    if(!existing){
     if(operations.size>=100)throw new Error('DENIED');
     // Synchronous reservation fences an upload whose body has not yet arrived.
     // Never retire PROCESSING/UNKNOWN. Retain the fence even if audit/DB fails.
     operations.set(operationId,{state:'UNKNOWN'});
     const found=await tx.query('SELECT id FROM public.persistence_attempts WHERE id=$1',[operationId]);
     if(found.rows.length){await audit(tx);return {state:'UNKNOWN' as const};}
    }
    await audit(tx);operations.set(operationId,{state:'RETIRED'});
    return {state:'RETIRED' as const,operationId,generation:originalGeneration,currentGeneration:generation};
   });
  },
  async result(batchId:string,token:string) {
   localOnly(); if(!/^[0-9a-f-]{36}$/i.test(batchId))throw new Error('DENIED');
   return database.transaction(async tx=>{
    const selection=await scopedRead(tx,batchId,token); const selected=selection.records.map(r=>r.id);
    if(!selected.length){await authorize(tx,token);await audit(tx);return {...selection,calculation:{status:'UNAVAILABLE' as const},report:null,answer:null};}
    const locked:TransactionDatabase={close:async()=>{},transaction:work=>work(tx)};
    const reports=createLocalFinancialReportService(createLocalSessionSumService(locked));
    const report=await reports.build(token,selected,'exclude');
    if(report.status==='DENIED')throw new Error('DENIED');
    await authorize(tx,token);
    if(report.status!=='AVAILABLE')return {...selection,calculation:report,report:null,answer:null};
    // Reuse the report produced and audited in this transaction. An answer must
    // not repeat the read or create duplicate audit events for the same result.
    const answer=await createLocalFinancialQuestionService({build:async()=>report}).answer(token,selected,'exclude','What is the sum of signed source amounts?');
    if(answer.status!=='ANSWERED'||answer.value!==report.answer.value||answer.currency!==report.answer.currency||JSON.stringify(answer.sources)!==JSON.stringify(report.answer.sources))throw new Error('DENIED');
    return {...selection,calculation:report.answer,report:report.download,answer};
   });
  },
  close:async()=>{for(const timer of timers.values())clearTimeout(timer);for(const token of watchers.keys())notify(token);await db.close();},
 };
}
export async function syntheticBrowserRuntime(tenant:string) {
 localOnly();
 instance??=(async()=>{
  const db=await PGlite.create();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  for(const file of ['phase1-clean-setup.sql','c3b1-grouped-persistence-upgrade.sql','db02-001-warning-mutation-fence.sql','phase3-security-audit-upgrade.sql','phase3-security-audit-api-events.sql','local-synthetic-browser.sql'])await db.exec(await readFile(`supabase/sql/${file}`,'utf8'));
  const database:TransactionDatabase={close:async()=>{},transaction:work=>db.transaction(async tx=>work({async query(sql,values){const r=await tx.query(sql,values);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length} as never;}}))};
  const subject=randomUUID();
  await db.query("INSERT INTO fingence_local_security_v1.memberships VALUES($1,$2,'Finance',true,1)",[subject,tenant]);
  return createRuntime(db,database,tenant,subject);
 })();
 const runtime=await instance;
 if(runtime.tenant!==tenant)throw new Error('DENIED');
 return runtime;
}
