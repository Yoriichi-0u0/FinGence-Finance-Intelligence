"use client";
import {useEffect,useState} from 'react';
import {Panel} from '@/components/ui';
import type {GPTEvidenceView} from '@/lib/gpt-evidence-view';
export type GPTEvidenceState={status:'loading'|'empty'|'unavailable'|'error'}|{status:'ready';data:GPTEvidenceView};
export async function loadGPTEvidence(batchId:string,signal:AbortSignal,transport:typeof fetch=fetch):Promise<GPTEvidenceState>{
 try{
  const response=await transport(`/api/reconciliation/gpt-evidence?batchId=${encodeURIComponent(batchId)}`,{credentials:'same-origin',cache:'no-store',signal});
  if([401,403,404,503].includes(response.status))return {status:'unavailable'};
  if(!response.ok)return {status:'error'};
  const data:GPTEvidenceView=await response.json();
  if(data.version!=='gpt-evidence-view/1'||data.batchId!==batchId||!Array.isArray(data.runs))return {status:'error'};
  return data.runs.length?{status:'ready',data}:{status:'empty'};
 }catch{return {status:'error'};}
}
export function GPTSuggestionsView({state}:{state:GPTEvidenceState}){
 return <div className="my-4"><Panel title="GPT Matching Suggestions" eyebrow="Saved evidence · human review required"><div className="space-y-3 p-5 text-sm">
 <p className="text-xs text-[var(--muted)]">Suggestions remain UNRESOLVED and do not change reconciliation totals or approve financial matches.</p>
 {state.status!=='ready'?<p role={state.status==='error'?'alert':'status'}>{state.status==='loading'?'Loading saved GPT evidence…':state.status==='empty'?'No saved GPT suggestions or abstentions for this batch.':state.status==='unavailable'?'GPT evidence unavailable. Verified access and a saved database batch are required.':'Unable to load GPT evidence. No results are shown.'}</p>:state.data.runs.map(run=><article key={run.evidenceId} className="min-w-0 rounded-lg border border-[var(--border)] p-4">
 <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{run.model}</p><span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs font-semibold">UNRESOLVED</span></div>
 <p className="mt-1 break-all text-xs text-[var(--muted)]">Saved {run.createdAt} · {run.prompt} · Evidence {run.evidenceId}</p>
 {!run.items.length&&<p className="mt-3">The model returned no suggestions or abstentions.</p>}
 {run.items.map(item=><section key={`${item.type}:${item.ordinal}`} className="mt-3 rounded-lg bg-[var(--surface-subtle)] p-3">
 <h3 className="font-semibold">{item.type==='ABSTENTION'?`Abstention · ${item.recordId??'Record unavailable'}`:`BANK ${item.bankId??'Unavailable'} → LEDGER ${item.ledgerId??'Unavailable'}`}</h3>
 {item.type==='SUGGESTION'&&<p className="mt-1 break-words text-xs">Bank reference: {item.bankReference??'Unavailable'} · Ledger reference: {item.ledgerReference??'Unavailable'} · Score: unavailable (none persisted)</p>}
 <p className="mt-2 whitespace-pre-wrap">{item.explanation}</p><p className="mt-2 text-xs">{item.reasons.join(' · ')}</p>
 <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-[var(--brand-ink)]">Supporting evidence and independent verification</summary>
 <p className="mt-2 break-all">Processing {state.data.processingId}<br/>BANK SHA256 {run.bankSha256}<br/>LEDGER SHA256 {run.ledgerSha256}</p>
 <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all">{Object.keys(item.verification).length?JSON.stringify(item.verification,null,2):'No independent pair verification for an abstention.'}</pre></details>
 </section>)}
 </article>)}
 </div></Panel></div>;
}
function EvidenceLoader({batchId}:{batchId?:string}){
 const [state,setState]=useState<GPTEvidenceState>({status:batchId?'loading':'unavailable'});
 useEffect(()=>{if(!batchId)return;const controller=new AbortController();void loadGPTEvidence(batchId,controller.signal).then(result=>{if(!controller.signal.aborted)setState(result);});return ()=>controller.abort();},[batchId]);
 return <GPTSuggestionsView state={state}/>;
}
export default function GPTSuggestions({batchId}:{batchId?:string}){return <EvidenceLoader key={batchId??'unavailable'} batchId={batchId}/>;}
