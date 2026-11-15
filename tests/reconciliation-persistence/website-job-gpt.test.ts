import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('server-only',()=>({}));
import {processDocuments,type ProcessingContext} from '../../lib/demo/pipeline';
import {WebsiteGPTEvidenceStore,generateWebsiteJobGPT,readWebsiteJobSuggestions,websiteGPTRoot} from '../../lib/server/reconciliation/website-job-gpt';
import {GPTSuggestionsView,loadGPTEvidence} from '../../components/reconciliation/gpt-suggestions';
import type {Caller} from '../../lib/server/workspace/session';
import {createJob,runJob,getJob} from '../../lib/server/processing/jobs';
import {processingDatabase,rpcTransport} from '../processing/db';
import {structuredCompletion} from '../../lib/server/ai/groq';
import {setAiCallSink,runAsCaller} from '../../lib/ai-calls';
const owner={organizationId:'org',memberId:'member',jobId:'00000000-0000-4000-8000-000000000001'};
const verified=async():Promise<Caller>=>({kind:'SIGNED_IN',tokenHash:'unused',principal:{sessionId:'session',memberId:owner.memberId,email:'synthetic@example.invalid',role:'FINANCE',organization:{id:owner.organizationId,name:'Synthetic'},processing:{paused:false,reason:null,since:null},ai:{enabled:true,since:null}}});
const documents=()=>['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv'].map(name=>({name,bytes:new Uint8Array(readFileSync(`public/demo/${name}`)),provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const}));
let dir:string,store:WebsiteGPTEvidenceStore,c:ProcessingContext;
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'ai06-'));store=new WebsiteGPTEvidenceStore(dir);c=await processDocuments(documents(),undefined,undefined,{job:{id:owner.jobId,runner:'BACKEND_JOB_RUNNER'}});
 // Controlled authoritative synthetic records, with an unresolved pair.
 const b=c.outputs.bank!.rows[0],l=c.outputs.ledger!.rows[0];
 l.signedCents=b.signedCents;l.currency=b.currency;l.date=b.date;
 c.outputs.reconciliation!.results=[{status:'AMOUNT_MISMATCH_REVIEW',bankRecordId:b.recordId,ledgerRecordIds:[l.recordId],reason:'synthetic unresolved pair',bankEvidenceIds:[],ledgerEvidenceIds:[]}];
});
afterEach(async()=>{setAiCallSink(null);vi.unstubAllEnvs();await rm(dir,{recursive:true,force:true});});
const admission=vi.fn(async()=>({admitted:true as const,reservedMicros:1,settle:vi.fn(async()=>{})}));
function complete(raw:unknown){return vi.fn(async()=>({content:raw,receipt:{provider:'GROQ' as const,model:'openai/gpt-oss-120b',requestId:'synthetic',latencyMs:1,mode:'LIVE' as const,inputTokens:1,outputTokens:1,estimatedUsd:0}}));}
const request=()=>new Request(`http://localhost/api/reconciliation/website-gpt-evidence?jobId=${owner.jobId}`);
const ids=()=>({bankId:c.outputs.bank!.rows[0].recordId,ledgerId:c.outputs.ledger!.rows[0].recordId});
it('verifies a synthetic pair, saves immutable evidence, retrieves through authorization and renders UNRESOLVED',async()=>{
 await generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:complete({suggestions:[ids()],abstentions:[]})});
 const response=await readWebsiteJobSuggestions(request(),{store,verify:verified});expect(response.status).toBe(200);
 const data=await response.json();expect(data.processingId).toBe(c.processingId);expect(data.runs[0].bankSha256).toBe(c.outputs.bank!.sha256);
 expect(data.runs[0].items[0]).toMatchObject({outcome:'UNRESOLVED',score:null,reasons:['PAIR_CHECKS_PASSED']});
 const html=renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'ready',data}}));expect(html).toContain('UNRESOLVED');expect(html).toContain(ids().bankId);
 await expect(store.save(owner,data)).rejects.toThrow();
 expect(await readFile(join(dir,'audit.jsonl'),'utf8')).not.toContain(c.outputs.bank!.rows[0].reference);
});
it('keeps independently failed pairs unresolved with visible failed verification',async()=>{
 c.outputs.ledger!.rows[0].signedCents='999999999';
 await generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:complete({suggestions:[ids()],abstentions:[]})});
 expect((await store.read(owner))!.runs[0].items[0]).toMatchObject({outcome:'UNRESOLVED',reasons:['VERIFICATION_FAILED'],verification:{equalSignedCents:false}});
});
it('persists model abstentions and records omissions without inventing model claims',async()=>{
 await generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:complete({suggestions:[],abstentions:[{recordId:ids().bankId}]})});
 expect((await store.read(owner))!.runs[0].items.map(i=>i.reasons[0])).toEqual(['MODEL_ABSTAINED','NO_PAIR_PROPOSED']);
});
it.each(['hallucination','duplicate','invalid-schema'] as const)('rejects %s without saving evidence',async mode=>{
 const raw=mode==='hallucination'?{suggestions:[{bankId:'unknown',ledgerId:ids().ledgerId}],abstentions:[]}:mode==='duplicate'?{suggestions:[ids(),ids()],abstentions:[]}:{suggestions:[],abstentions:[],approve:true};
 await expect(generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:complete(raw)})).rejects.toThrow('GPT_SUGGESTIONS_FAILED');expect(await store.read(owner)).toBeNull();
});
it('serializes duplicate/concurrent attempts and never redispatches after provider failure',async()=>{
 const provider=complete({suggestions:[],abstentions:[]});provider.mockRejectedValue(Error('private provider detail'));
 await Promise.allSettled([generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:provider}),generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:provider})]);
 await generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:provider});expect(provider).toHaveBeenCalledTimes(1);expect(await store.read(owner)).toBeNull();
});
it('isolates both organization and member and refuses anonymous/unavailable sessions',async()=>{
 await generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:complete({suggestions:[],abstentions:[]})});
 for(const field of ['organization','member'] as const){const who=await verified();if(who.kind!=='SIGNED_IN')throw Error();if(field==='organization')who.principal.organization.id='other';else who.principal.memberId='other';expect((await readWebsiteJobSuggestions(request(),{store,verify:async()=>who})).status).toBe(404);}
 for(const kind of ['ANONYMOUS','ENDED','UNAVAILABLE'] as const)expect((await readWebsiteJobSuggestions(request(),{store,verify:async()=>({kind})})).status).toBe(kind==='UNAVAILABLE'?503:401);
});
it('withholds evidence on audit failure and does not dispatch when start audit fails',async()=>{
 const provider=complete({suggestions:[],abstentions:[]});await generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:provider});
 vi.spyOn(store,'audit').mockRejectedValue(Error('private'));expect((await readWebsiteJobSuggestions(request(),{store,verify:verified})).status).toBe(503);
 const other={...owner,jobId:'00000000-0000-4000-8000-000000000002'};c.job={id:other.jobId};provider.mockClear();await expect(generateWebsiteJobGPT(c,other,'synthetic',{store,admission,complete:provider})).rejects.toThrow();expect(provider).not.toHaveBeenCalled();
});
it('fails closed on storage configuration, unexpected query claims and missing evidence',async()=>{
 vi.stubEnv('FINGENCE_GPT_SUGGESTIONS','1');vi.stubEnv('FINGENCE_GPT_EVIDENCE_DIR',dir);vi.stubEnv('VERCEL','1');expect(websiteGPTRoot()).toBeNull();
 expect((await readWebsiteJobSuggestions(request(),{store:null})).status).toBe(503);
 expect((await readWebsiteJobSuggestions(new Request(`${request().url}&organizationId=other`),{store,verify:verified})).status).toBe(400);
 expect((await readWebsiteJobSuggestions(request(),{store,verify:verified})).status).toBe(404);
 vi.stubEnv('VERCEL','');vi.stubEnv('FINGENCE_GPT_EVIDENCE_DIR',join(process.cwd(),'public','evidence'));expect(websiteGPTRoot()).toBeNull();
});
it('uses the real shared JSON gateway and AI-call log with a mocked provider, not a live request',async()=>{
 vi.stubEnv('GROQ_API_KEY','');vi.stubEnv('GROQ_API_KEY2','');const log=vi.fn(async()=>{});setAiCallSink(log);
 const transport=vi.fn(async()=>({status:200,json:{id:'synthetic',model:'openai/gpt-oss-120b',choices:[{message:{content:JSON.stringify({suggestions:[ids()],abstentions:[]})}}],usage:{prompt_tokens:1,completion_tokens:1}}}));
 await runAsCaller({...owner},()=>generateWebsiteJobGPT(c,owner,'synthetic',{store,admission,complete:req=>structuredCompletion({...req,transport})}));
 expect(transport).toHaveBeenCalledTimes(1);expect(log).toHaveBeenCalledTimes(1);
 expect(log.mock.calls[0]).toBeDefined();expect(JSON.stringify(log.mock.calls)).not.toContain(c.outputs.bank!.rows[0].reference);
 expect((await store.read(owner))!.runs[0].items[0].reasons).toEqual(['PAIR_CHECKS_PASSED']);
});
it('uses the website endpoint and preserves the existing DB04 loader behavior',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>new Response('',{status:404}));expect(await loadGPTEvidence(owner.jobId,new AbortController().signal,transport,true)).toEqual({status:'empty'});expect(transport.mock.calls[0][0]).toContain('website-gpt-evidence?jobId=');
 expect(await loadGPTEvidence(owner.jobId,new AbortController().signal,transport)).toEqual({status:'unavailable'});
});
it('runs real synthetic pipeline -> isolated PostgreSQL job commit -> saved website evidence -> authorized API -> UI',async()=>{
 const db=await processingDatabase();
 try{
  const deps={store:{url:'http://127.0.0.1:54329',key:null,local:true},transport:rpcTransport(db),interpreter:null};
  const created=await createJob(documents(),null,deps);if(!('jobId'in created))throw Error('synthetic job failed');
  const jobOwner={...owner,jobId:created.jobId};
  const status=await runJob(created.jobId,documents(),'synthetic',{...deps,suggestions:async context=>{
   expect((await getJob(created.jobId,true,deps))?.status).toBe('COMPLETED');
   await generateWebsiteJobGPT(context,jobOwner,'synthetic',{store,admission,complete:complete({suggestions:[],abstentions:[]})});
  }});expect(status).toBe('COMPLETED');
  const response=await readWebsiteJobSuggestions(new Request(`http://localhost/?jobId=${created.jobId}`),{store,verify:verified});expect(response.status).toBe(200);
  const data=await response.json();expect(data.processingId).toBe((await getJob(created.jobId,true,deps))!.processingId);
  expect(renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'ready',data}}))).toContain('UNRESOLVED');
 }finally{await db.close();}
},30000);
