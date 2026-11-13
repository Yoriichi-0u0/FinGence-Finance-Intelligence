import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createGPTProposer} from '../../lib/server/reconciliation/gpt';
import {GroqProvider} from '../../lib/server/reconciliation/gpt-provider';
import {parseSuggestion,VERSION} from '../../lib/server/reconciliation/gpt-schema';
import {bank,ledger} from '../poc-reconciliation/fixtures';
import type {ProcessingDashboardV1} from '../../lib/reconciliation-dashboard';
const id='a'.repeat(64),org='org',registry={bank:'b'.repeat(64),ledger:'c'.repeat(64)};
function context():ProcessingDashboardV1{return {version:'db04-processing-read/1',processingId:id,
 job:{organization_id:org,processing_id:id,policy:{version:'synthetic-cash-same-day/1',maxDays:0}},
 sources:['BANK','LEDGER'].map(kind=>({organization_id:org,kind,sha256:kind==='BANK'?registry.bank:registry.ledger,classification_method:'REGISTERED_SYNTHETIC_EXACT_SCHEMA'})),
 transactions:[{kind:'BANK',record_id:'B',sha256:registry.bank,status:'VALID',signed_amount:'6380.53',currency:'MYR',transaction_date:null,canonical_date:'2026-03-01',value_date:'2026-03-01',date_basis:'VALUE_DATE',evidence:{...bank}},
 {kind:'LEDGER',record_id:'L',sha256:registry.ledger,status:'WARNING',signed_amount:'6380.53',currency:'MYR',transaction_date:null,canonical_date:'2026-03-01',posting_date:'2026-03-01',date_basis:'POSTING_DATE',evidence:{...ledger}}],proposals:[],cases:[],rankings:[]};}
const suggestion={bankId:'B',ledgerId:'L',bankReference:bank.BankReference,ledgerReference:ledger.LedgerReference,rationale:'Possible relationship for review'};
const json=(suggestions:unknown[]=[suggestion],abstentions:unknown[]=[])=>JSON.stringify({version:VERSION,suggestions,abstentions});
function setup(raw=json(),c=context()){
 const read=vi.fn(async(token:string)=>{if(token!=='authorized')throw Error('ACCESS_DENIED');return structuredClone(c);});
 const provider={kind:'GROQ' as const,suggest:vi.fn(async()=>raw)};
 return {read,provider,c,run:()=>createGPTProposer(read,registry)('authorized',id,provider)};
}
it('checks valid proposals against persisted authority, preserves source IDs and never approves',async()=>{
 const f=setup(),r=await f.run();expect(f.read).toHaveBeenCalledTimes(2);
 expect(r).toMatchObject({organizationId:org,processingId:id,outcome:'UNRESOLVED',persistence:'NOT_PERSISTED_MIGRATION_REQUIRED'});
 expect(r.verification[0]).toMatchObject({bankRecordId:'B',ledgerRecordId:'L',bankSha256:registry.bank,financialEligible:true,rankingLineage:true,referenceClaims:true,uniqueEligiblePartner:true,outcome:'UNRESOLVED'});
 expect(r.verification[0].reasons).toContain('ASSIGNMENT_POLICY_NOT_APPROVED');
 expect(JSON.stringify(f.provider.suggest.mock.calls)).not.toContain('authorized');
});
it('retains abstentions without inventing proposals',async()=>{
 const r=await setup(json([],[{recordId:'B',reason:'Uncertain'}])).run();expect(r.verification).toEqual([]);expect(r.proposal.abstentions).toHaveLength(1);
 await expect(setup(json([],[{recordId:'invented',reason:'Uncertain'}])).run()).rejects.toThrow('GPT_UNKNOWN_ABSTENTION');
});
it('retains hallucinated IDs as unresolved failures and checks copied references',async()=>{
 const r=await setup(json([{...suggestion,ledgerId:'invented'}])).run();expect(r.verification[0].checks.RECORDS_EXIST).toBe(false);expect(r.verification[0].rankingLineage).toBe(false);
 const s=await setup(json([{...suggestion,ledgerReference:'fabricated'}])).run();expect(s.verification[0].referenceClaims).toBe(false);
});
it('rejects duplicates, conflicting abstentions, duplicate JSON keys, extra fields and malformed JSON',()=>{
 for(const raw of [json([suggestion,suggestion]),json([suggestion],[{recordId:'B',reason:'No'}]),json().replace('"suggestions":','"version":"bad","suggestions":'),json([{...suggestion,approved:true}]),'{'])expect(()=>parseSuggestion(raw)).toThrow();
});
it('denies unauthorized tenants before provider invocation and requires registered synthetic sources',async()=>{
 const f=setup();await expect(createGPTProposer(f.read,registry)('other-tenant',id,f.provider)).rejects.toThrow('ACCESS_DENIED');expect(f.provider.suggest).not.toHaveBeenCalled();
 f.c.sources[0].organization_id='other';await expect(f.run()).rejects.toThrow();expect(f.provider.suggest).not.toHaveBeenCalled();
 const g=setup();g.c.sources[0].classification_method='UNTRUSTED';await expect(g.run()).rejects.toThrow('GPT_REGISTERED_SYNTHETIC_REQUIRED');
});
it('reauthorizes after inference and rejects changed evidence',async()=>{
 const f=setup();f.provider.suggest.mockImplementation(async()=>{f.c.transactions[1].signed_amount='1.00';return json();});await expect(f.run()).rejects.toThrow('GPT_CONTEXT_CHANGED');
 const g=setup();g.provider.suggest.mockImplementation(async()=>{g.read.mockRejectedValueOnce(Error('ACCESS_DENIED'));return json();});await expect(g.run()).rejects.toThrow('ACCESS_DENIED');
});
it('detects ambiguous candidates not selected by GPT',async()=>{
 const f=setup();f.c.transactions.push({...f.c.transactions[1],record_id:'L2'});const r=await f.run();expect(r.verification[0].uniqueEligiblePartner).toBe(false);
});
it('sanitizes provider failure without retry or fallback',async()=>{
 const f=setup();f.provider.suggest.mockRejectedValue(Error('secret transport details'));await expect(f.run()).rejects.toThrow('GPT_PROVIDER_FAILURE');expect(f.provider.suggest).toHaveBeenCalledTimes(1);
});
it('uses the Groq request contract with mocked transport only',async()=>{
 const transport=vi.fn(async()=>new Response(JSON.stringify({id:'mock',object:'chat.completion',created:0,model:'openai/gpt-oss-120b',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:json()}}]}),{headers:{'content-type':'application/json'}}));
 const provider=new GroqProvider({NODE_ENV:'test',FINGENCE_LLM_MODE:'groq',FINGENCE_GROQ_FREE_PLAN_CONFIRMED:'1',FINGENCE_GROQ_FIRST_REQUEST_APPROVED:'1',GROQ_API_KEY:'mock-only'},transport);
 const f=setup();const r=await createGPTProposer(f.read,registry)('authorized',id,provider);expect(r.verification).toHaveLength(1);expect(transport).toHaveBeenCalledTimes(1);
 await expect(createGPTProposer(f.read,registry)('authorized',id,provider)).rejects.toThrow('GPT_PROVIDER_FAILURE');expect(transport).toHaveBeenCalledTimes(1);
});

it('enforces authoritative accounting evidence and preserves existing deterministic assignments',async()=>{
 const f=setup();(f.c.transactions[1].evidence as Record<string,unknown>).CashAccount='9999';f.c.proposals=[{bank_record_id:'B',ledger_record_id:'OTHER',decision:'VERIFIED_SUGGESTION'}];
 const r=await f.run();expect(r.verification[0].checks.RAW_ACCOUNTING).toBe(false);expect(r.verification[0].conflicts.deterministic).toBe(true);expect(f.c.proposals[0].ledger_record_id).toBe('OTHER');
});
it('blocks production and provider transport failures without retry',async()=>{
 const f=setup();vi.stubEnv('NODE_ENV','production');try{await expect(f.run()).rejects.toThrow('GPT_LOCAL_ONLY');expect(f.read).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();}
 const transport=vi.fn(async()=>new Response(JSON.stringify({error:{message:'mock rate limit',type:'rate_limit_exceeded',code:'rate_limit_exceeded'}}),{status:429,headers:{'content-type':'application/json'}}));
 const provider=new GroqProvider({NODE_ENV:'test',FINGENCE_LLM_MODE:'groq',FINGENCE_GROQ_FREE_PLAN_CONFIRMED:'1',FINGENCE_GROQ_FIRST_REQUEST_APPROVED:'1',GROQ_API_KEY:'mock-only'},transport);
 await expect(createGPTProposer(f.read,registry)('authorized',id,provider)).rejects.toThrow('GPT_PROVIDER_FAILURE');expect(transport).toHaveBeenCalledTimes(1);
});
