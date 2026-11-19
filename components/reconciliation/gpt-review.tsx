"use client";
import {useEffect,useRef,useState} from 'react';
import {gptReviewView,gptReviewResult,type GPTReviewView} from '@/lib/gpt-review-view';
/** Read-only discovery never starts generation. Missing approved SQL leaves actions unavailable. */
export function useGPTReview(jobId?:string){
 const [saved,setSaved]=useState<{jobId:string;value:GPTReviewView}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const review=saved&&saved.jobId===jobId?saved.value:null;
 const pending=useRef(false),request=useRef<{key:string;id:string}|null>(null),active=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();active.current=controller;
  if(jobId)void fetch(`/api/reconciliation/website-gpt-review?jobId=${encodeURIComponent(jobId)}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async response=>{
    const parsed=response.ok?gptReviewView.safeParse(await response.json()):null;
    if(active.current!==controller||controller.signal.aborted)return;
    if(parsed?.success){setSaved({jobId:jobId!,value:parsed.data});setMessage('');}
    else setMessage('Saved review status is unavailable. No decision can be confirmed.');
   }).catch(()=>{if(active.current===controller&&!controller.signal.aborted)setMessage('Saved review status is unavailable. No decision can be confirmed.');});
  return ()=>{
   controller.abort();
   // Release only the departing scope. A late POST must not disable or update the next job.
   if(active.current===controller){pending.current=false;setBusy(false);setMessage('');}
  };
 },[jobId]);
 const decide=async(ordinal:number,decision:'APPROVE'|'REJECT')=>{
  if(!review||!jobId||pending.current)return;
  const item=review.items.find(i=>i.ordinal===ordinal);if(!item||(decision==='APPROVE'?!item.canApprove:!item.canReject))return;
  pending.current=true;setBusy(true);const controller=active.current,key=JSON.stringify([jobId,review.evidenceId,ordinal,decision]);
  if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
  try{
   // No automatic retry after a failed/uncertain POST. Explicit retry retains its idempotency key.
   const response=await fetch(`/api/reconciliation/website-gpt-review?jobId=${encodeURIComponent(jobId)}`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({ordinal,decision,expectedEvidenceId:review.evidenceId,requestId:request.current.id})});
   const parsed=response.ok?gptReviewResult.safeParse(await response.json()):null;
   if(controller!==active.current||controller?.signal.aborted)return;
   if(!parsed?.success){setMessage('Review not confirmed. Reload saved results before retrying.');return;}
   setSaved({jobId,value:{...review,items:review.items.map(i=>i.ordinal===ordinal?{...i,decision:parsed.data.decision,canApprove:false,canReject:false}:i)}});
   setMessage('Proposal review saved. Financial totals are unchanged; the match remains unresolved.');
  }catch{if(controller===active.current&&!controller?.signal.aborted)setMessage('Review not confirmed. Reload saved results before retrying.');}
  finally{if(controller===active.current&&!controller?.signal.aborted){pending.current=false;setBusy(false);}}
 };
 return {review,busy,message,decide};
}
export type GPTReviewControls=ReturnType<typeof useGPTReview>;
export function GPTReviewActions({ordinal,controls,verified}:{ordinal:number;controls:GPTReviewControls;verified:boolean}){
 const item=controls.review?.items.find(i=>i.ordinal===ordinal);if(!item)return null;
 if(item.decision!=='PENDING')return <span className="block text-xs">Proposal {item.decision==='APPROVE'?'approved':'rejected'} · No financial posting</span>;
 const decision=verified?'APPROVE':'REJECT';
 if(verified?!item.canApprove:!item.canReject)return null;
 return <div className="mt-2 flex flex-wrap gap-2">
  <button type="button" className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50" disabled={controls.busy} onClick={()=>void controls.decide(ordinal,decision)}>{verified?'Approve':'Reject'}</button>
 </div>;
}
