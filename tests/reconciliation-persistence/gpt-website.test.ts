import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createGPTWebsiteHandler,type GPTWebsiteDependencies} from '../../lib/server/reconciliation/gpt-website';
import {GET} from '../../app/api/reconciliation/gpt-evidence/route';
import {loadGPTEvidence,GPTSuggestionsView} from '../../components/reconciliation/gpt-suggestions';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {TransactionDatabase,SqlConnection} from '../../lib/server/db/postgres';
import type {GPTEvidenceView} from '../../lib/gpt-evidence-view';
const id='a'.repeat(64),batch='batch-a',user='user-a',org='org-a';
function setup(){
 const query=vi.fn(async()=>({rows:[],rowCount:1}));const db={transaction:async<T>(work:(tx:SqlConnection)=>Promise<T>)=>work({query} as unknown as SqlConnection),close:async()=>{}} satisfies TransactionDatabase;
 const saved={runs:[{organization_id:org,processing_id:id,evidence_id:'e',model_version:'openai/gpt-oss-120b',prompt_version:'prompt',created_at:'date',bank_sha256:'b',ledger_sha256:'c',outcome:'UNRESOLVED',suggestion_count:1,abstention_count:0}],items:[{organization_id:org,processing_id:id,evidence_id:'e',item_type:'SUGGESTION',ordinal:0,bank_claim:'B1',ledger_claim:'L1',bank_reference:'REF-B',ledger_reference:'REF-L',explanation:'Saved reason <script>',reasons:['ASSIGNMENT_POLICY_NOT_APPROVED'],verification:{financialEligible:false},outcome:'UNRESOLVED'}]};
 const dependencies: GPTWebsiteDependencies={database:db,resolvePrincipal:vi.fn(async()=>({subjectId:user,organizationId:org,role:'finance_analyst' as const})),resolveAccess:vi.fn(async()=>({subjectId:user,organizationId:org,scopeVersion:'1',batchIds:[batch]})),resolveBatch:vi.fn(async()=>({organizationId:org,batchId:batch,processingId:id,capability:'A'.repeat(43)})),backend:{listSavedGPTEvidence:vi.fn(async()=>saved)}};
 return {dependencies,saved,query,handler:createGPTWebsiteHandler(dependencies),request:()=>new Request(`http://localhost/api/reconciliation/gpt-evidence?batchId=${batch}`)};
}
it('keeps the unconfigured actual website route unavailable and uncached',async()=>{const r=await GET(new Request('http://localhost'));expect(r.status).toBe(503);expect(r.headers.get('cache-control')).toContain('no-store');});
it('renders actual authorized saved evidence through API and UI without scores or approvals',async()=>{
 const f=setup(),r=await f.handler(f.request());expect(r.status).toBe(200);const data=await r.json() as GPTEvidenceView;
 const html=renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'ready',data}}));
 for(const text of ['GPT Matching Suggestions','REF-B','REF-L','UNRESOLVED','financialEligible','Score: unavailable'])expect(html).toContain(text);
 expect(html).not.toContain('<script>');expect(html).not.toContain('<button');expect(f.query).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(data)).not.toContain('capability');expect(data.runs[0].items[0].score).toBe(null);
});
it('denies unauthenticated, wrong role, foreign tenant and out-of-scope batch before evidence access',async()=>{
 for(const mode of ['unauthenticated','role','tenant','batch']){
  const f=setup();if(mode==='unauthenticated')vi.mocked(f.dependencies.resolvePrincipal).mockResolvedValue(null);
  if(mode==='role')vi.mocked(f.dependencies.resolvePrincipal).mockResolvedValue({subjectId:user,organizationId:org,role:'management_reviewer'});
  if(mode==='tenant')vi.mocked(f.dependencies.resolveAccess).mockResolvedValue({subjectId:user,organizationId:'other',scopeVersion:'1',batchIds:[batch]});
  if(mode==='batch')vi.mocked(f.dependencies.resolveAccess).mockResolvedValue({subjectId:user,organizationId:org,scopeVersion:'1',batchIds:[]});
  expect((await f.handler(f.request())).status).toBe(mode==='unauthenticated'?401:mode==='role'?403:404);expect(f.dependencies.backend.listSavedGPTEvidence).not.toHaveBeenCalled();expect(f.query).toHaveBeenCalledTimes(1);
 }
});
it('denies missing batch mapping, crossed capability tenant and incomplete persisted evidence',async()=>{
 for(const mode of ['scope','tenant','missing']){
  const f=setup();if(mode==='scope')vi.mocked(f.dependencies.resolveBatch).mockResolvedValue(null);
  if(mode==='tenant')f.saved.runs[0].organization_id='other';
  if(mode==='missing')f.saved.items=[];
  const response=await f.handler(f.request());expect(response.status).toBe(mode==='scope'?404:503);expect(await response.text()).not.toContain('REF-B');
 }
});
it('withholds data on durable security audit failure',async()=>{const f=setup();f.query.mockRejectedValue(Error('private'));const r=await f.handler(f.request());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private');});
it('validates exact request shape and handles duplicate read requests without writes to GPT evidence',async()=>{
 const f=setup();expect((await f.handler(new Request('http://localhost/?batchId=batch-a&organizationId=other'))).status).toBe(400);
 const a=await f.handler(f.request()),b=await f.handler(f.request());expect(await a.json()).toEqual(await b.json());expect(f.query).toHaveBeenCalledTimes(2);
});
it('shows loading, empty, unavailable, error and saved abstention states',()=>{
 for(const status of ['loading','empty','unavailable','error'] as const){const html=renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status}}));expect(html).toContain('GPT Matching Suggestions');expect(html).not.toContain('REF-B');}
 const data={version:'gpt-evidence-view/1',batchId:batch,processingId:id,runs:[{evidenceId:'e',model:'model',prompt:'p',createdAt:'date',bankSha256:'b',ledgerSha256:'l',outcome:'UNRESOLVED',items:[{type:'ABSTENTION',ordinal:0,bankId:null,ledgerId:null,recordId:'B',bankReference:null,ledgerReference:null,explanation:'Uncertain',reasons:['MODEL_ABSTENTION'],verification:{},score:null,outcome:'UNRESOLVED'}]}]} satisfies GPTEvidenceView;
 expect(renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'ready',data}}))).toContain('Abstention');
});
it('loads only same-origin saved evidence, rejects stale batches and maps unavailable responses',async()=>{
 const signal=new AbortController().signal;
 for(const status of [401,403,404,503])expect(await loadGPTEvidence(batch,signal,vi.fn(async()=>new Response('',{status})))).toEqual({status:'unavailable'});
 const transport=vi.fn<typeof fetch>(async()=>Response.json({version:'gpt-evidence-view/1',batchId:'other',runs:[]}));expect(await loadGPTEvidence(batch,signal,transport)).toEqual({status:'error'});
 expect(transport.mock.calls[0][1]).toMatchObject({credentials:'same-origin',cache:'no-store'});
 expect(await loadGPTEvidence(batch,signal,vi.fn(async()=>Response.json({version:'gpt-evidence-view/1',batchId:batch,runs:[]})))).toEqual({status:'empty'});
});
