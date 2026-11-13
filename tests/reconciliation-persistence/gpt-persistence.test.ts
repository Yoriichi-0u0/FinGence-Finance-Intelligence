import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createGPTProposer,type GPTResult} from '../../lib/server/reconciliation/gpt';
import {createGPTEvidenceService,canonicalEvidence} from '../../lib/server/reconciliation/gpt-persistence';
import {bank,ledger} from '../poc-reconciliation/fixtures';
import type {TransactionDatabase,SqlConnection} from '../../lib/server/db/postgres';
const id='a'.repeat(64),org='00000000-0000-4000-8000-000000000001',registry={bank:'b'.repeat(64),ledger:'c'.repeat(64)};
function fixture(){
 const context={job:{organization_id:org,processing_id:id,policy:{version:'synthetic-cash-same-day/1',maxDays:0}},
 sources:['BANK','LEDGER'].map(kind=>({organization_id:org,kind,sha256:kind==='BANK'?registry.bank:registry.ledger,classification_method:'REGISTERED_SYNTHETIC_EXACT_SCHEMA'})),
 transactions:[{kind:'BANK',record_id:'B',sha256:registry.bank,status:'VALID',signed_amount:'6380.53',currency:'MYR',transaction_date:null,canonical_date:'2026-03-01',value_date:'2026-03-01',date_basis:'VALUE_DATE',evidence:{...bank}},
 {kind:'LEDGER',record_id:'L',sha256:registry.ledger,status:'VALID',signed_amount:'6380.53',currency:'MYR',transaction_date:null,canonical_date:'2026-03-01',posting_date:'2026-03-01',date_basis:'POSTING_DATE',evidence:{...ledger}}],proposals:[],cases:[],reviews:[],rankings:[],proposalVerifications:[]};
 const calls:Array<{sql:string;args:unknown[]}>=[],runs=new Map<string,unknown[]>(),items:unknown[][]=[];
 let failItem=false;
 const tx={query:vi.fn(async(sql:string,args:unknown[]=[])=>{
  calls.push({sql,args});let rows:unknown[]=[];
  if(sql.includes('FROM fingence_reconciliation.principal()'))rows=[{organization_id:org,user_id:'00000000-0000-4000-8000-000000000002'}];
  else if(sql.startsWith('SELECT * FROM fingence_reconciliation.jobs'))rows=[context.job];
  else if(sql.includes('JOIN fingence_reconciliation.documents'))rows=context.sources;
  else if(sql.includes('FROM fingence_reconciliation.transactions'))rows=context.transactions;
  else if(sql.includes('to_regclass'))rows=[{present:true}];
  else if(sql.startsWith('SELECT evidence_id'))rows=runs.has(String(args[2]))?[{evidence_id:args[2]}]:[];
  else if(sql.startsWith('INSERT INTO fingence_reconciliation.gpt_runs'))runs.set(String(args[2]),args);
  else if(sql.startsWith('INSERT INTO fingence_reconciliation.gpt_items')){if(failItem)throw Error('item write failed');items.push(args);}
  return {rows,rowCount:rows.length};
 })} as unknown as SqlConnection;
 const db={transaction:async<T>(fn:(tx:SqlConnection)=>Promise<T>)=>{const before=new Map(runs),n=items.length;try{return await fn(tx);}catch(e){runs.clear();for(const [k,v]of before)runs.set(k,v);items.length=n;throw e;}},close:async()=>{}} satisfies TransactionDatabase;
 const proposer=createGPTProposer(async()=>({version:'db04-processing-read/1',processingId:id,...structuredClone(context)}),registry);
 const make=(suggestions:unknown[]=[{bankId:'B',ledgerId:'L',bankReference:bank.BankReference,ledgerReference:ledger.LedgerReference,rationale:'Review only'}],abstentions:unknown[]=[])=>proposer('A'.repeat(43),id,{kind:'GROQ',suggest:async()=>JSON.stringify({version:'llm-reconciliation-suggestion/1',suggestions,abstentions})});
 return {context,calls,runs,items,make,service:createGPTEvidenceService(db,registry),fail:()=>{failItem=true;}};
}
it('canonicalizes evidence keys deterministically without reordering arrays',()=>{
 expect(canonicalEvidence({b:2,a:[{z:1,c:3}]})).toBe(canonicalEvidence({a:[{c:3,z:1}],b:2}));expect(canonicalEvidence([1,2])).not.toBe(canonicalEvidence([2,1]));
});
it('writes scoped immutable evidence and reuses identical content without second insert',async()=>{
 const f=fixture(),r=await f.make();const a=await f.service.persist('A'.repeat(43),r),b=await f.service.persist('A'.repeat(43),r);
 expect(a.reused).toBe(false);expect(b).toEqual({...a,reused:true});expect(f.runs.size).toBe(1);expect(f.items).toHaveLength(1);
 expect(a.outcome).toBe('UNRESOLVED');const insert=f.calls.find(c=>c.sql.startsWith('INSERT INTO fingence_reconciliation.gpt_runs'))!;expect(insert.args.slice(0,2)).toEqual([org,id]);
 expect(JSON.stringify(f.items)).not.toContain('6380.53');expect(JSON.stringify(f.items)).not.toContain('CashAccountDebitMYR');
});
it('recomputes independent verification and drops caller verification and extra fields',async()=>{
 const f=fixture(),r=await f.make();r.verification=[];(r as unknown as Record<string,unknown>).apiKey='must-not-persist';await f.service.persist('A'.repeat(43),r);
 const v=JSON.parse(String(f.items[0][14]));expect(v.checks.RAW_ACCOUNTING).toBe(true);expect(JSON.stringify(f.items)).not.toContain('must-not-persist');expect(String(f.items[0][13])).toContain('ASSIGNMENT_POLICY_NOT_APPROVED');
});
it('binds hallucinated IDs only as claims and preserves unresolved reasons',async()=>{
 const f=fixture(),r=await f.make([{bankId:'B',ledgerId:'made-up',bankReference:'R',ledgerReference:'R',rationale:'Uncertain'}]);await f.service.persist('A'.repeat(43),r);
 expect(f.items[0][6]).toBe('made-up');expect(f.items[0][9]).toBe(null);expect(String(f.items[0][13])).toContain('RECORDS_EXIST');
});
it('persists abstentions bound to exact source roles',async()=>{
 const f=fixture(),r=await f.make([],[{recordId:'B',reason:'Uncertain'}]);await f.service.persist('A'.repeat(43),r);expect(f.items[0].slice(10,12)).toEqual(['BANK','B']);expect(String(f.items[0][13])).toContain('MODEL_ABSTENTION');
});
it('rejects tenant, snapshot, schema and policy/version substitutions before writes',async()=>{
 for(const mutate of [(r:GPTResult)=>{r.organizationId='other';},(r:GPTResult)=>{r.sourceFingerprint='f'.repeat(64);},(r:GPTResult)=>{(r as unknown as Record<string,unknown>).promptVersion='bad';}]){
  const f=fixture(),r=await f.make();mutate(r);await expect(f.service.persist('A'.repeat(43),r)).rejects.toThrow();expect(f.runs.size).toBe(0);
 }
});
it('rolls back the header on child insertion failure',async()=>{
 const f=fixture(),r=await f.make();f.fail();await expect(f.service.persist('A'.repeat(43),r)).rejects.toThrow('item write failed');expect(f.runs.size).toBe(0);expect(f.items).toHaveLength(0);
});
it('rejects unknown abstentions and conflicting assignments on persistence input',async()=>{
 const f=fixture(),r=await f.make();r.proposal.abstentions=[{recordId:'unknown',reason:'No'}];await expect(f.service.persist('A'.repeat(43),r)).rejects.toThrow('GPT_UNKNOWN_OR_AMBIGUOUS_ABSTENTION');
 const g=fixture(),s=await g.make();s.proposal.suggestions.push(s.proposal.suggestions[0]);await expect(g.service.persist('A'.repeat(43),s)).rejects.toThrow('DUPLICATE_ASSIGNMENT');expect(g.runs.size).toBe(0);
});
