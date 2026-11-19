import {afterAll,describe,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('server-only',()=>({}));
import {GPTSuggestionsView,type GPTEvidenceState} from '../../components/reconciliation/gpt-suggestions';
import {GPTFinancialSummaryView,referenceCategory,selectGPTOutcomes,explainGPTOutcome,summarizeGPTSuggestions,type GPTOutcomeView} from '../../components/reconciliation/gpt-financial-summary';
import {financeGPTView,type GPTEvidenceView} from '../../lib/gpt-evidence-view';
import {WorkspaceContext,type WorkspaceRole} from '../../components/workspace/context';
type Item=GPTEvidenceView['runs'][number]['items'][number];
const pair:Item={type:'SUGGESTION',ordinal:0,bankId:'BANK_ID',ledgerId:'LEDGER_ID',recordId:null,bankReference:'INV-101',ledgerReference:'INV-101',explanation:'Saved explanation',reasons:['PAIR_CHECKS_PASSED'],verification:{policy:'website-pair-verifier/1',authoritativeRecordIds:true,equalSignedCents:true,sameCurrency:true,dateWithinSevenDays:true},score:null,outcome:'UNRESOLVED'};
function fixture():GPTEvidenceView{
 const other={...structuredClone(pair),ordinal:1,bankId:'BANK_2',ledgerId:'LEDGER_2',bankReference:'BANK-202',ledgerReference:'BOOK-202'};
 const fail={...structuredClone(pair),ordinal:2,verification:{...pair.verification,equalSignedCents:false}};
 const unknown={...structuredClone(pair),ordinal:3,verification:{}};
 const none:Item={...structuredClone(pair),type:'ABSTENTION',ordinal:4,bankId:null,ledgerId:null,recordId:'UNMATCHED_RECORD',bankReference:null,ledgerReference:null,verification:{}};
 return {version:'gpt-evidence-view/1',batchId:'synthetic-job',processingId:'TECHNICAL_PROCESSING',runs:[{evidenceId:'TECHNICAL_EVIDENCE',model:'TECHNICAL_MODEL',prompt:'TECHNICAL_PROMPT',createdAt:'2026-11-16T00:00:00Z',bankSha256:'a'.repeat(64),ledgerSha256:'b'.repeat(64),outcome:'UNRESOLVED',items:[structuredClone(pair),other,fail,unknown,none]}]};
}
function many(count=23){const data=fixture();data.runs[0].items=Array.from({length:count},(_,i)=>({...structuredClone(pair),ordinal:i,bankId:`B${i}`,ledgerId:`L${i}`,bankReference:`BANK-${i}`,ledgerReference:i%2?`LEDGER-${i}`:`BANK-${i}`}));return data;}
function render(data=fixture(),view:GPTOutcomeView='SUGGESTED',page=1,role:WorkspaceRole='FINANCE',preview:WorkspaceRole=role){
 const financial=role==='FINANCE'||preview==='FINANCE';
 return renderToStaticMarkup(createElement(GPTFinancialSummaryView,{data:financial?financeGPTView(data):data,technical:!financial,view,page,onViewChange:()=>{},onPageChange:()=>{}}));
}
function actual(data=fixture(),role:WorkspaceRole='FINANCE',preview:WorkspaceRole=role,state?:GPTEvidenceState){return renderToStaticMarkup(createElement(WorkspaceContext.Provider,{value:{enabled:true,loading:false,session:{email:'synthetic@example.invalid',role,organization:{name:'Synthetic'},processing:{paused:false,reason:null,since:null},ai:{enabled:true}},viewRole:preview,setViewAs:()=>{},ended:false,refresh:async()=>null,signOut:async()=>{}}},createElement(GPTSuggestionsView,{state:state??{status:'ready',data:role==='FINANCE'?financeGPTView(data):data}})));}
const rowCount=(html:string)=>(html.match(/<tbody>.*?<\/tbody>/)?.[0].match(/<tr/g)??[]).length;
describe('AI06 financial matching table',()=>{
 it('renders five semantic columns with bold saved references and no cards or row action',()=>{
  const html=actual();for(const label of ['Outcome','Bank Reference','Ledger Reference','AI Suggestion','Explanation'])expect(html).toContain(label);
  expect(html).toContain('<table');expect(html).toMatch(/<strong[^>]*>INV-101<\/strong>/);expect(rowCount(html)).toBe(4);expect(html).not.toContain('<article');expect(html).not.toMatch(/<tr[^>]*(onclick|role="button"|tabindex)/i);
  expect(html).toContain('hover:bg-[var(--surface-subtle)]');expect(html).toContain('transition-colors');
 });
 it.each([['SUGGESTED',[0,1,2,3]],['SAME',[0,2,3]],['DIFFERENT',[1]],['NONE',[4]],['ALL',[0,1,2,3,4]]] as const)('%s selects only the intended saved outcomes', (view,ordinals)=>{
  expect(selectGPTOutcomes(fixture(),view).map(item=>item.ordinal)).toEqual(ordinals);
 });
 it('compares actual references case-sensitively after trimming; never classifies missing references by IDs',()=>{
  expect(referenceCategory({...pair,bankReference:' INV-101 ',ledgerReference:'INV-101'})).toBe('SAME');
  expect(referenceCategory({...pair,ledgerReference:'inv-101'})).toBe('DIFFERENT');
  for(const ref of [null,'',' '])expect(referenceCategory({...pair,bankReference:ref,bankId:'same',ledgerId:'same'})).toBe('MISSING');
 });
 it('shows failed and unavailable outcomes as review needs without claiming matching checks passed',()=>{
  const data=fixture();data.runs[0].items=data.runs[0].items.slice(2,4);
  expect(selectGPTOutcomes(data,'SUGGESTED')).toHaveLength(2);expect(selectGPTOutcomes(data,'SAME')).toHaveLength(2);expect(selectGPTOutcomes(data,'DIFFERENT')).toHaveLength(0);
  const html=render(data,'ALL');expect(html).toContain('Needs review');expect(html).toContain('Saved matching checks are unavailable');expect(html).not.toContain('All matching checks passed');
 });
 it('uses record IDs only when saved references are absent and never guesses an abstention source side',()=>{
  const data=fixture();data.runs[0].items[0].bankReference=null;data.runs[0].items[0].ledgerReference=' ';
  const html=render(data);expect(html).toMatch(/<strong[^>]*>BANK_ID<\/strong>/);expect(html).toMatch(/<strong[^>]*>LEDGER_ID<\/strong>/);expect(html).toContain('bank record');
  expect(render(fixture(),'NONE')).toContain('transaction record');expect(render(fixture(),'NONE')).toContain('UNMATCHED_RECORD');expect(render(fixture(),'NONE').match(/>Not saved<\/strong>/g)).toHaveLength(2);
  expect(actual()).not.toContain('BANK_ID');
 });
 it('generates individual factual explanations from references and saved independent verdicts without scores or amounts',()=>{
  const data=fixture();const explanations=data.runs[0].items.map(explainGPTOutcome);
  expect(explanations[0]).toContain('INV-101');expect(explanations[1]).toContain('BANK-202');expect(explanations[1]).toContain('BOOK-202');expect(explanations[0]).not.toBe(explanations[1]);
  expect(explanations[2]).toContain('failed');expect(explanations[3]).toContain('unavailable');expect(explanations[4]).toContain('No match was suggested');
  expect(explanations.join(' ')).not.toMatch(/confidence|score|\d+%|MYR|USD/);
 });
 it('always shows verified/no-match counters, hides zero verification issues, and leaves counts unchanged across filters',()=>{
  expect(summarizeGPTSuggestions(fixture())).toEqual({suggestions:4,verified:2,needsReview:2,withoutSuggestions:1});
  const counters=render().match(/<dl aria-label="Saved matching summary".*?<\/dl>/)?.[0];
  for(const view of ['SAME','DIFFERENT','NONE','ALL'] as const)expect(render(fixture(),view).match(/<dl aria-label="Saved matching summary".*?<\/dl>/)?.[0]).toBe(counters);
  expect(counters).toContain('Needs Review');expect(render(many())).not.toContain('Needs Review');expect(render(many())).toContain('No Match Suggested');
 });
 it.each([1,2,3])('paginates page %s at ten rows with accurate totals',page=>{
  const html=render(many(),'SUGGESTED',page);expect(rowCount(html)).toBe(page===3?3:10);expect(html).toContain(`${(page-1)*10+1}-${Math.min(page*10,23)} of 23 results`);
 });
 it('disables boundary buttons and clamps stale out-of-range pages safely',()=>{
  const first=render(many()),last=render(many(),'SUGGESTED',999);
  expect(first).toMatch(/aria-label="Previous page"[^>]*\sdisabled=""/);expect(first).not.toMatch(/aria-label="Next page"[^>]*\sdisabled=""/);
  expect(last).toMatch(/aria-label="Next page"[^>]*\sdisabled=""/);expect(last).toContain('21-23 of 23 results');
 });
 it.each(['SUGGESTED','SAME','DIFFERENT','NONE','ALL'] as const)('handles an empty %s category with disabled pagination',view=>{
  const data=fixture();data.runs=[];const html=render(data,view);expect(rowCount(html)).toBe(0);expect(html).toContain('No saved outcomes.');expect(html).toContain('0-0 of 0 results');expect(html.match(/disabled=""/g)).toHaveLength(2);
 });
 it('has accessible category names, selected state, result linkage, headers and pagination',()=>{
  const html=actual();for(const name of ['Suggested Matches','Same Reference','Different Reference','No Suggestion','All Outcomes'])expect(html).toContain(name);
  expect(html).toMatch(/aria-pressed="true"[^>]*>Suggested Matches/);expect(html).toContain('aria-controls=');expect(html).toContain('Matching result categories');expect(html).toContain('Matching results pagination');expect(html.match(/scope="col"/g)).toHaveLength(5);
 });
 it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s viewing Finance has the same simple table and no technical evidence',role=>{
  const html=actual(fixture(),role,'FINANCE');expect(html).toBe(actual());expect(html).not.toMatch(/TECHNICAL_|SHA256|<pre|<details/);expect(html).toContain('Not Yet Approved');
 });
 it.each(['ADMIN','SUPERADMIN'] as const)('%s retains collapsed own-job technical evidence',role=>{
  const html=actual(fixture(),role);expect(html).toContain('TECHNICAL_MODEL');expect(html).toContain('UNRESOLVED');expect(html).not.toMatch(/<details[^>]*\bopen/);expect(actual(fixture(),role,'FINANCE')).not.toContain('TECHNICAL_');
 });
 it('escapes saved references and does not render unverified model explanations as new financial facts',()=>{
  const data=fixture();data.runs[0].items[0].bankReference='<script>bad()</script>';data.runs[0].items[0].explanation='Invented financial claim';const html=actual(data);
  expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('Invented financial claim');
 });
 it('keeps evidence immutable and missing/unknown checks unverified',()=>{
  const data=fixture(),before=JSON.stringify(data);data.runs[0].items[0].verification.policy='unknown';expect(selectGPTOutcomes(data,'SUGGESTED').map(x=>x.ordinal)).toEqual([0,1,2,3]);
  data.runs[0].items[0].verification.policy='website-pair-verifier/1';for(const view of ['SUGGESTED','SAME','DIFFERENT','NONE','ALL'] as const)render(data,view);expect(JSON.stringify(data)).toBe(before);
 });
 it.each(['loading','generating','empty','unavailable','error'] as const)('handles %s without stale results or manual refresh controls',status=>{
  const html=actual(fixture(),'FINANCE','FINANCE',{status});expect(html).not.toContain('INV-101');expect(html).not.toContain('Refresh');expect(html).toContain(status==='error'?'role="alert"':'role="status"');
 });
});
afterAll(()=>{if(process.env.AI06_UI_REVIEW!=='1')return;const dir='.local/reviews/ai06-table-ui';mkdirSync(dir,{recursive:true});const data=many();data.runs[0].items.push(...fixture().runs[0].items.slice(2));writeFileSync(`${dir}/data.json`,JSON.stringify(data));});

it('shows only compact Reject for an authorized NEEDS_REVIEW row and renders the saved decision',()=>{
 const data=fixture();data.runs[0].items=[data.runs[0].items[2]];
 const controls={review:{version:'website-gpt-review/1' as const,evidenceId:'a'.repeat(64),accountingEffect:'NONE' as const,items:[{ordinal:2,decision:'PENDING' as 'PENDING'|'REJECT',canApprove:false,canReject:true}]},busy:false,message:'',decide:vi.fn(async()=>{})};
 const render=()=>renderToStaticMarkup(createElement(GPTFinancialSummaryView,{data:financeGPTView(data),technical:false,reviewControls:controls,view:'SUGGESTED',onViewChange:()=>{}}));
 expect(render()).not.toContain('>Approve</button>');expect(render()).toMatch(/<button(?![^>]* disabled=)[^>]*>Reject<\/button>/);
 controls.review.items[0]={ordinal:2,decision:'REJECT',canApprove:false,canReject:false};expect(render()).toContain('Proposal rejected');expect(render()).not.toContain('>Reject</button>');expect(render()).toContain('Needs review');
});

const approvedNotices=[
 'AI matching may take around 90 seconds. Please wait while your transactions are checked.',
 'VERIFIED: The suggestion passed all required verification checks. You can click Approve to accept the suggested match.',
 'NEEDS REVIEW: The suggestion did not pass all verification checks. Approve is unavailable because there is not enough evidence to confirm the match. You can only click Reject if you do not accept the suggestion.',
 'NO SUGGESTION: The AI could not identify a suitable match. No action is required.',
 'IMPORTANT: Approving or rejecting a suggestion permanently saves your decision. It does not delete transactions or automatically change financial totals.',
];
it.each(['loading','generating','empty','unavailable','error'] as const)('shows all exact approved notices in %s',status=>{
 const html=actual(fixture(),'FINANCE','FINANCE',{status});
 for(const notice of approvedNotices)expect(html).toContain(notice);
 expect(html).not.toContain('Rejecting a suggestion saves your decision permanently.');
 expect(html).not.toContain('>Approve</button>');expect(html).not.toContain('>Reject</button>');
});
it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('retains all exact approved notices for ready %s results',role=>{
 const html=actual(fixture(),role,role);for(const notice of approvedNotices)expect(html).toContain(notice);
});

it('keeps compact status badges on one line on narrow tables',()=>{
 const html=actual();expect(html).toContain('whitespace-nowrap rounded-full');expect(html).toContain('px-2.5 py-1 text-[11px]');expect(html).not.toContain('Verified · Suggested Match');
});
