"use client";
import {useId,useState} from 'react';
import {pairVerificationResult,type GPTDisplayView} from '@/lib/gpt-evidence-view';

type DisplayItem=GPTDisplayView['runs'][number]['items'][number];
const verificationOf=(item:DisplayItem)=>'verificationResult' in item?item.verificationResult:pairVerificationResult(item);

/** Count saved entries shown here, not unique transactions across historical runs or approvals. */
export function summarizeGPTSuggestions(data:GPTDisplayView){
 const items=data.runs.flatMap<DisplayItem>(run=>run.items),suggestions=items.filter(item=>item.type==='SUGGESTION');
 const verified=suggestions.filter(item=>verificationOf(item)==='PASS').length;
 return {suggestions:suggestions.length,verified,needsReview:suggestions.length-verified,withoutSuggestions:items.filter(item=>item.type==='ABSTENTION').length};
}
function savedTime(value:string){
 const date=new Date(value);
 return Number.isNaN(date.getTime())?'Saved time unavailable':`Saved ${date.toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})} UTC`;
}
function explanationOf(item:DisplayItem){
 if(item.explanation==='Model-proposed pair checked independently against the committed job sources.')return 'This suggested bank and ledger pair was checked against your saved transactions.';
 if(item.explanation==='The model abstained for this record.'||item.explanation==='No pair proposed for this record.')return 'No bank and ledger match was suggested for this transaction. It still needs your review.';
 return item.explanation.trim()||'No explanation was saved for this transaction.';
}
function VerificationLabel({item}:{item:DisplayItem}){
 const result=verificationOf(item);
 return <p className={`rounded-lg px-3 py-2 text-sm font-semibold ${result==='PASS'?'bg-[var(--good-soft)] text-[var(--good-ink)]':result==='FAIL'?'bg-[var(--bad-soft)] text-[var(--bad-ink)]':'bg-[var(--warn-soft)] text-[var(--warn-ink)]'}`}>
 {result==='PASS'?'All matching checks passed':result==='FAIL'?'Matching checks failed':'Matching checks unavailable'}</p>;
}
export function GPTFinancialSummary({data,technical}:{data:GPTDisplayView;technical:boolean}){
 const [view,setView]=useState<GPTOutcomeView>('VERIFIED');
 return <GPTFinancialSummaryView data={data} technical={technical} view={view} onViewChange={setView}/>;
}
export type GPTOutcomeView='VERIFIED'|'ALL';
export function GPTFinancialSummaryView({data,technical,view,onViewChange}:{data:GPTDisplayView;technical:boolean;view:GPTOutcomeView;onViewChange:(view:GPTOutcomeView)=>void}){
 const summary=summarizeGPTSuggestions(data);
 const allCount=summary.suggestions+summary.withoutSuggestions,resultsId=useId();
 const unmatched=data.runs.flatMap(run=>run.items.filter(item=>item.type==='ABSTENTION').map(item=>({item,createdAt:run.createdAt})));
 return <>
 <dl aria-label="Saved matching summary" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
 {[[summary.verified,'Verified suggested matches'],[summary.needsReview,'Suggestions needing review'],[summary.withoutSuggestions,'No match suggested']].map(([count,label])=><div key={label} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
 <dt className="text-xs font-medium text-[var(--muted)]">{label}</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{count}</dd></div>)}
 </dl>
 <p className="text-xs text-[var(--muted)]">Counts cover all saved suggestions and no-match entries, including hidden results. Passed checks do not mean a match is approved.</p>
 <div role="group" aria-label="Suggestion views" className="flex min-w-0 flex-wrap gap-2">
 {([['VERIFIED',`Verified suggestions (${summary.verified})`],['ALL',`All outcomes (${allCount})`]] as const).map(([option,label])=><button key={option} type="button" aria-pressed={view===option} aria-controls={resultsId}
  onClick={()=>onViewChange(option)} className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${view===option?'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-ink)]':'border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)]'}`}>{label}</button>)}
 </div>
 <p role="status" aria-atomic="true" className="sr-only">{view==='VERIFIED'?`Showing ${summary.verified} verified ${summary.verified===1?'suggestion':'suggestions'}.`:`Showing ${allCount} saved outcomes. Transactions without suggestions can be expanded below.`}</p>
 {summary.suggestions===0&&summary.withoutSuggestions===0&&<p role="status">No suggestions or transactions without suggestions were saved for this job.</p>}
 {view==='VERIFIED'&&summary.verified===0&&allCount>0&&<p role="status">No verified suggestions yet. Choose All outcomes to review the other saved results.</p>}
 <div id={resultsId} className="min-w-0 space-y-5">
 {data.runs.map((run,runIndex)=>{
  const suggestions=run.items.filter(item=>item.type==='SUGGESTION'&&(view==='ALL'||verificationOf(item)==='PASS'));
  if(!suggestions.length&&!technical)return null;
  return <section key={runIndex} aria-label={`Saved result ${runIndex+1}`} className="min-w-0 space-y-4">
   <p className="text-xs text-[var(--muted)]">{data.runs.length>1&&<>Saved result {runIndex+1} / </>}{savedTime(run.createdAt)}</p>
   {suggestions.length>0&&<div className="min-w-0 space-y-3"><h3 className="font-semibold">Suggested matches</h3>
    {suggestions.map((item,index)=><article key={item.ordinal} aria-label={`Suggested match ${index+1}`} className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] p-4">
     <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Bank to ledger match</h4><span className="rounded-full bg-[var(--warn-soft)] px-3 py-1 text-xs font-semibold text-[var(--warn-ink)]">Not yet approved</span></div>
     <div className="grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="min-w-0 rounded-lg bg-[var(--surface-subtle)] p-3"><p className="text-xs font-medium text-[var(--muted)]">Bank</p><p className="mt-1 whitespace-pre-wrap font-semibold [overflow-wrap:anywhere]">{item.bankReference?.trim()||'Reference not saved'}</p></div>
      <span aria-hidden="true" className="text-center text-xl text-[var(--muted)]"><span className="sm:hidden">↓</span><span className="hidden sm:inline">→</span></span>
      <div className="min-w-0 rounded-lg bg-[var(--surface-subtle)] p-3"><p className="text-xs font-medium text-[var(--muted)]">Ledger</p><p className="mt-1 whitespace-pre-wrap font-semibold [overflow-wrap:anywhere]">{item.ledgerReference?.trim()||'Reference not saved'}</p></div>
     </div>
     <VerificationLabel item={item}/><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{explanationOf(item)}</p>
     <p className="text-xs text-[var(--muted)]">{verificationOf(item)==='FAIL'?'Review the failed matching checks before deciding.':verificationOf(item)==='PASS'?'Review both transactions before deciding whether to approve this match.':'A matching result cannot be confirmed until the saved checks are available.'}</p>
    </article>)}
   </div>}
   {technical&&'processingId' in data&&'evidenceId' in run&&<details className="min-w-0 rounded-xl border border-[var(--border)] p-4 text-xs">
    <summary className="cursor-pointer font-semibold text-[var(--brand-ink)]">Technical evidence</summary>
    <dl className="mt-3 space-y-2 break-all"><div><dt className="font-semibold">Model</dt><dd>{run.model}</dd></div><div><dt className="font-semibold">Prompt version</dt><dd>{run.prompt}</dd></div>
    <div><dt className="font-semibold">Evidence ID</dt><dd>{run.evidenceId}</dd></div><div><dt className="font-semibold">Processing ID</dt><dd>{data.processingId}</dd></div>
    <div><dt className="font-semibold">Bank SHA256</dt><dd>{run.bankSha256}</dd></div><div><dt className="font-semibold">Ledger SHA256</dt><dd>{run.ledgerSha256}</dd></div><div><dt className="font-semibold">Stored outcome</dt><dd>{run.outcome}</dd></div></dl>
    <pre className="mt-3 max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(run.items,null,2)}</pre>
   </details>}
  </section>;
 })}
 {view==='ALL'&&unmatched.length>0&&<details className="min-w-0 rounded-xl border border-[var(--border)] p-4">
  <summary className="cursor-pointer font-semibold text-[var(--brand-ink)]">Transactions without suggestions ({unmatched.length})</summary>
  <div className="mt-4 min-w-0 space-y-3">
  {unmatched.map(({item,createdAt},index)=><article key={index} aria-label={`Transaction without a suggestion ${index+1}`} className="min-w-0 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
   <h4 className="font-semibold [overflow-wrap:anywhere]">{item.bankReference?.trim()||item.ledgerReference?.trim()||`Transaction ${index+1}`}</h4>
   <p className="font-medium">No match suggested</p><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{explanationOf(item)}</p>
   {!item.bankReference?.trim()&&!item.ledgerReference?.trim()&&<p className="text-xs text-[var(--muted)]">A readable transaction reference was not saved.</p>}
   {data.runs.length>1&&<p className="text-xs text-[var(--muted)]">{savedTime(createdAt)}</p>}
  </article>)}
  </div>
 </details>}
 </div>
 </>;
}
