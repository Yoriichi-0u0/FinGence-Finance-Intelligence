import './ai-runtime-03.mjs';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { saveI2Report } from './ai-i2-report.mjs';
// Offline-only runner: no provider credential is read and network fetch is disabled.
process.env.FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED='0';process.env.FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED='0';
globalThis.fetch=async()=>{throw new Error('OFFLINE_NETWORK_FORBIDDEN');};
process.env.FINGENCE_AI_PYTHON ??= resolve('.venv-ai/bin/python');
const { processLiveDocument03 }=await import('../lib/server/ai-ingestion/increment-03/service.ts');
const { RecordedControlI2 }=await import('../tests/support/i2-recorded-control.ts');
const { createV2Persistence,createExperimentalBatch,createExtractionFailureBatch,extractTrustedEvidence }=await import('../lib/server/ai-ingestion/v2-i1/persistence.ts');
const { scoreEvaluation }=await import('../lib/server/ai-ingestion/increment-i2/evaluation.ts');
const { policyHash,promptRevision }=await import('../lib/ai-ingestion/increment-03/plan.ts');
const manifest=JSON.parse(readFileSync('synthetic/ai-ingestion-i2/manifest.json','utf8')); const entries=Object.entries(manifest.files);
const db=await PGlite.create();await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');await db.exec(readFileSync('supabase/sql/v2-verified-document-local.sql','utf8'));
const database={close:async()=>db.close(),transaction:async work=>db.transaction(async tx=>work({query:async(sql,values)=>{const r=await tx.query(sql,values);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};}}))};
const runs=[];
try {
 for(const [name,info] of entries){
  const bytes=readFileSync(`synthetic/ai-ingestion-i2/${name}`);const digest=createHash('sha256').update(bytes).digest('hex');if(digest!==info.sha256||bytes.length!==info.bytes)throw new Error('INPUT_HASH_MISMATCH');
  const filename=`source${extname(name)}`;const r=await processLiveDocument03(bytes,filename,()=>{},new RecordedControlI2());
  const ids={attemptId:randomUUID(),jobId:randomUUID(),executionId:randomUUID(),tenantId:randomUUID()};let e=null;
  try {e=await extractTrustedEvidence(bytes,filename);} catch { /* Preserve an explicit extraction failure, without fabricated rows. */ }
  const batch=e?createExperimentalBatch({...ids,sourceBytes:bytes,evidence:e,blueprint:r.blueprint,origin:r.receipt?.mode??null,receipt:null}):createExtractionFailureBatch({...ids,bytes,filename});
  await createV2Persistence(database).persist(batch);const stored=await createV2Persistence(database).get(ids.attemptId,ids.tenantId);
  runs.push({name,digest,run:r,stored,atomicPersisted:stored?.source.sha256===digest&&stored?.publicationEligible===false});
 }
 // Evaluation labels are loaded only after all runtime proposals and verified persistence finish.
 const gold=JSON.parse(readFileSync('tests/fixtures/ai-ingestion-i2/gold.json','utf8'));
 const results=runs.map(({name,digest,run,stored,atomicPersisted})=>({case:name,sha256:digest,format:run.evidence?.format??null,mode:run.mode,origin:run.receipt?.mode??null,extractor:run.evidence?.extractor??null,extractionMs:run.evidence?.durationMs??null,runtimeMs:run.runtimeMs,error:run.error,receipt:run.receipt?{mode:run.receipt.mode,model:run.receipt.model,inputTokens:run.receipt.inputTokens,outputTokens:run.receipt.outputTokens,estimatedUsd:run.receipt.estimatedUsd,retries:run.receipt.retries}:null,promptHash:run.promptHash,atomicPersisted,persistedCounts:stored?.verification?.coverage??null,score:run.evidence?scoreEvaluation(run.evidence,run.proposal,run.verification,gold.cases[name],'RECORDED_TEST'):null}));
 const report={version:'v2-i2-evaluation-0.1',runType:'OFFLINE_RECORDED_CONTROL',modelAccuracy:null,genuineInferenceRuns:0,policyHash,promptRevision,inputs:entries.length,disclaimer:'Synthetic controls only; i03-i06 share a layout. No provider was called. False acceptance is measured only against the specified gold.',results};
 const summary=`V2-I2 offline recorded controls: ${results.length} synthetic documents. Genuine inference: 0; model accuracy: not measured.\n`+results.map(x=>`${x.case} ${x.format??'UNKNOWN'} ${x.mode} accepted=${x.score?.acceptance?.accepted??'unavailable'} unresolved=${x.score?.acceptance?.unresolved??'unavailable'} falseAccepted=${x.score?.acceptance?.falseAccepted??'unavailable'} extraction=${x.score?.extraction?.exactFields??0}/${x.score?.extraction?.expectedFields??0} latencyMs=${x.runtimeMs} persisted=${x.atomicPersisted}`).join('\n')+'\n';
 const paths=saveI2Report(report,summary);
 console.log(summary);console.log(JSON.stringify({...paths,mode:report.runType,genuineInferenceRuns:0}));
 if(results.some(r=>!r.atomicPersisted))process.exitCode=1;
} finally {await db.close();}
