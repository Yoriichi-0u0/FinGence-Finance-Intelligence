"use client";
import {useId,useState} from 'react';
import {Table,button,chip} from '@/components/demo/shared';
import {pairVerificationResult,gptSuggestionOutcome,type GPTDisplayView} from '@/lib/gpt-evidence-view';
import {GPTReviewActions,type GPTReviewControls} from './gpt-review';

type Item=GPTDisplayView['runs'][number]['items'][number];
export type GPTOutcomeView='SUGGESTED'|'SAME'|'DIFFERENT'|'NONE'|'ALL';
const categories:ReadonlyArray<readonly [GPTOutcomeView,string]>=[['SUGGESTED','Suggested Matches'],['SAME','Same Reference'],['DIFFERENT','Different Reference'],['NONE','No Suggestion'],['ALL','All Outcomes']];
const PAGE_SIZE=10;
const verificationOf=(item:Item)=>'verificationResult' in item?item.verificationResult:pairVerificationResult(item);
const itemsOf=(data:GPTDisplayView)=>data.runs.flatMap<Item>(run=>run.items);
const savedReference=(value:string|null)=>value?.trim()||null;
export function referenceCategory(item:Item):'SAME'|'DIFFERENT'|'MISSING'{
 const bank=savedReference(item.bankReference),ledger=savedReference(item.ledgerReference);
 return !bank||!ledger?'MISSING':bank===ledger?'SAME':'DIFFERENT';
}
export function selectGPTOutcomes(data:GPTDisplayView,view:GPTOutcomeView){
 return itemsOf(data).filter(item=>{
  if(view==='ALL')return true;
  if(view==='NONE')return item.type==='ABSTENTION';
  if(item.type!=='SUGGESTION')return false;
  return view==='SUGGESTED'||referenceCategory(item)===view;
 });
}
export function summarizeGPTSuggestions(data:GPTDisplayView){
 const items=itemsOf(data),suggestions=items.filter(item=>item.type==='SUGGESTION');
 const verified=suggestions.filter(item=>verificationOf(item)==='PASS').length;
 return {suggestions:suggestions.length,verified,needsReview:suggestions.length-verified,withoutSuggestions:items.filter(item=>item.type==='ABSTENTION').length};
}
function description(item:Item,side:'bank'|'ledger'){
 const ref=savedReference(side==='bank'?item.bankReference:item.ledgerReference),id=side==='bank'?item.bankId:item.ledgerId;
 return ref?`${side} reference “${ref}”`:id?`${side} record “${id}”`:`the ${side} transaction`;
}
export function explainGPTOutcome(item:Item){
 if(item.type==='ABSTENTION'){
  const bank=savedReference(item.bankReference),ledger=savedReference(item.ledgerReference);
  const source=bank?description(item,'bank'):ledger?description(item,'ledger'):item.recordId?`transaction record “${item.recordId}”`:'this transaction';
  return `No match was suggested for ${source}.`;
 }
 const pair=`${description(item,'bank')} and ${description(item,'ledger')}`,result=verificationOf(item);
 if(result==='PASS')return `All matching checks passed for ${pair}.`;
 if(result==='FAIL')return `One or more saved matching checks failed for ${pair}. Needs review; approval is unavailable.${item.reasons.includes('REVIEW_REFERENCE_NOT_VERIFIED')?' Reference identity is not verified.':''}${item.reasons.includes('REVIEW_ORIGINAL_ACCOUNTING_RETAINED')?' Existing accounting entries are retained; these records are not both final unexplained items.':''} Original entries and totals are unchanged.`;
 return `Saved matching checks are unavailable for ${pair}. This suggestion has not been verified.`;
}
function referenceCell(item:Item,side:'bank'|'ledger'){
 const reference=savedReference(side==='bank'?item.bankReference:item.ledgerReference),id=side==='bank'?item.bankId:item.ledgerId;
 return <strong className="font-semibold [overflow-wrap:anywhere]">{reference??id??'Not saved'}</strong>;
}
function outcomeCell(item:Item){
 const result=verificationOf(item),passed=item.type==='SUGGESTION'&&result==='PASS';
 return <div className="space-y-1"><span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${passed?'bg-[var(--good-soft)] text-[var(--good-ink)]':item.type==='ABSTENTION'?'bg-[var(--surface-subtle)] text-[var(--muted-strong)]':'bg-[var(--warn-soft)] text-[var(--warn-ink)]'}`}>
 {item.type==='ABSTENTION'?'No Suggestion':passed?'Verified · Suggested Match':'Needs review'}</span><span className="block text-xs text-[var(--muted)]">Not Yet Approved</span></div>;
}
export function GPTFinancialSummary({data,technical,reviewControls}:{data:GPTDisplayView;technical:boolean;reviewControls?:GPTReviewControls}){
 const [view,setView]=useState<GPTOutcomeView>('SUGGESTED'),[page,setPage]=useState(1);
 return <GPTFinancialSummaryView data={data} technical={technical} reviewControls={reviewControls} view={view} page={page} onPageChange={setPage} onViewChange={next=>{setView(next);setPage(1);}}/>;
}
export function GPTFinancialSummaryView({data,technical,reviewControls,view,onViewChange,page=1,onPageChange=()=>{}}:{data:GPTDisplayView;technical:boolean;reviewControls?:GPTReviewControls;view:GPTOutcomeView;onViewChange:(view:GPTOutcomeView)=>void;page?:number;onPageChange?:(page:number)=>void}){
 const summary=summarizeGPTSuggestions(data),resultsId=useId(),visible=selectGPTOutcomes(data,view);
 const pages=Math.max(1,Math.ceil(visible.length/PAGE_SIZE)),current=Math.max(1,Math.min(page,pages)),start=(current-1)*PAGE_SIZE,rows=visible.slice(start,start+PAGE_SIZE);
 return <>
 {reviewControls?.message&&<p role="status">{reviewControls.message}</p>}
 <dl aria-label="Saved matching summary" className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
 {[[summary.verified,'Verified Suggestions'],[summary.withoutSuggestions,'No Match Suggested'],...(summary.needsReview?[[summary.needsReview,'Needs Review']]:[])].map(([count,label])=><div key={label} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
 <dt className="text-xs font-medium text-[var(--muted)]">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd></div>)}
 </dl>
 <div role="group" aria-label="Matching result categories" className="flex min-w-0 flex-wrap gap-2">
 {categories.map(([option,label])=><button key={option} type="button" aria-pressed={view===option} aria-controls={resultsId} onClick={()=>onViewChange(option)} className={`${chip(view===option)} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]`}>{label}</button>)}
 </div>
 <div id={resultsId} className="min-w-0 overflow-hidden rounded-xl border border-[var(--border)]">
 {rows.length?<Table stack={false} caption="AI06 matching results" columns={['Outcome','Bank Reference','Ledger Reference','AI Suggestion','Explanation']} rows={rows.map(item=>[
  outcomeCell(item),referenceCell(item,'bank'),referenceCell(item,'ledger'),
  <div key="suggestion" className="[overflow-wrap:anywhere]">{item.type==='ABSTENTION'?'No match suggested':verificationOf(item)==='PASS'?'Bank → Ledger match':'Needs review'}{reviewControls&&gptSuggestionOutcome(item)==='VERIFIED'&&<GPTReviewActions ordinal={item.ordinal} controls={reviewControls}/>}</div>,
  <span key="explanation" className="[overflow-wrap:anywhere]">{explainGPTOutcome(item)}</span>,
 ])}/>:<p role="status" className="p-4 text-sm text-[var(--muted)]">{!itemsOf(data).length?'No saved outcomes.':view==='SUGGESTED'?'No suggestions.':'No results in this category.'}</p>}
 </div>
 <nav aria-label="Matching results pagination" className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
 <p role="status" aria-atomic="true">{visible.length?start+1:0}-{start+rows.length} of {visible.length} results · Page {current} of {pages}</p>
 <div className="flex gap-2"><button type="button" aria-label="Previous page" className={`${button} disabled:opacity-40`} disabled={current===1} onClick={()=>onPageChange(current-1)}>Previous</button>
 <button type="button" aria-label="Next page" className={`${button} disabled:opacity-40`} disabled={current===pages} onClick={()=>onPageChange(current+1)}>Next</button></div>
 </nav>
 {technical&&data.version==='gpt-evidence-view/1'&&data.runs.map((run,index)=><details key={index} className="min-w-0 rounded-xl border border-[var(--border)] p-4 text-xs">
  <summary className="cursor-pointer font-semibold text-[var(--brand-ink)]">Technical evidence</summary>
  <dl className="mt-3 space-y-2 break-all"><div><dt className="font-semibold">Model</dt><dd>{run.model}</dd></div><div><dt className="font-semibold">Prompt version</dt><dd>{run.prompt}</dd></div>
  <div><dt className="font-semibold">Evidence ID</dt><dd>{run.evidenceId}</dd></div><div><dt className="font-semibold">Processing ID</dt><dd>{data.processingId}</dd></div>
  <div><dt className="font-semibold">Bank SHA256</dt><dd>{run.bankSha256}</dd></div><div><dt className="font-semibold">Ledger SHA256</dt><dd>{run.ledgerSha256}</dd></div><div><dt className="font-semibold">Stored outcome</dt><dd>{run.outcome}</dd></div></dl>
  <pre className="mt-3 max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(run.items,null,2)}</pre>
 </details>)}
 </>;
}
