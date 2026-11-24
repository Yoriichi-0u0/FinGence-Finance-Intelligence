"use client";
import {useEffect,useRef,useState} from 'react';
import {gptReviewView,gptReviewResult,type GPTReviewView} from '@/lib/gpt-review-view';
/** Read-only discovery never starts generation. Missing approved SQL leaves actions unavailable. */
export function useGPTReview(jobId?:string,readinessKey=''){
 const [saved,setSaved]=useState<{jobId:string;key:string;value:GPTReviewView}|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState<{key:string;text:string}|null>(null);
 const [failed,setFailed]=useState<string|null>(null),scope=JSON.stringify([jobId,readinessKey]);
 const review=saved&&saved.jobId===jobId&&saved.key===scope?saved.value:null;
 const loading=!!jobId&&!review&&failed!==scope;
 const message=notice?.key===scope?notice.text:'';
 const pending=useRef(false),request=useRef<{key:string;id:string}|null>(null),active=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();active.current=controller;
  let retry:ReturnType<typeof setTimeout>|undefined;
  const current=()=>active.current===controller&&!controller.signal.aborted;
  const unavailable=()=>{if(current()){setFailed(scope);setNotice({key:scope,text:'Saved review status is unavailable. No decision can be confirmed.'});}};
  const read=async(attempt=0)=>{
   if(!current())return;
   try{
    const response=await fetch(`/api/reconciliation/website-gpt-review?jobId=${encodeURIComponent(jobId!)}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(!current())return;
    // Bounded read-only recovery is independent of the five-second evidence polling loop.
    if([404,502,503,504].includes(response.status)&&attempt<2){retry=setTimeout(()=>{void read(attempt+1);},attempt===0?250:1000);return;}
    const parsed=response.ok?gptReviewView.safeParse(await response.json()):null;
    if(!current())return;
    if(parsed?.success){setSaved({jobId:jobId!,key:scope,value:parsed.data});setFailed(null);setNotice({key:scope,text:''});}
    else unavailable();
   }catch{unavailable();}
  };
  if(jobId)void read();
  return ()=>{
   controller.abort();clearTimeout(retry);
   // Release only the departing scope. A late POST must not disable or update the next job.
   if(active.current===controller){pending.current=false;setBusy(false);setNotice({key:scope,text:''});}
  };
 },[jobId,scope]);
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
   if(!parsed?.success){setNotice({key:scope,text:'Review not confirmed. Reload saved results before retrying.'});return;}
   setSaved({jobId,key:scope,value:{...review,items:review.items.map(i=>i.ordinal===ordinal?{...i,decision:parsed.data.decision,canApprove:false,canReject:false}:i)}});
   setNotice({key:scope,text:'Proposal review saved. Financial totals are unchanged; the match remains unresolved.'});
  }catch{if(controller===active.current&&!controller?.signal.aborted)setNotice({key:scope,text:'Review not confirmed. Reload saved results before retrying.'});}
  finally{if(controller===active.current&&!controller?.signal.aborted){pending.current=false;setBusy(false);}}
 };
 return {review,busy,message,decide,loading};
}
export type GPTReviewControls=Omit<ReturnType<typeof useGPTReview>,'loading'>&{loading?:boolean};
export function GPTReviewActions({ordinal,controls,verified}:{ordinal:number;controls:GPTReviewControls;verified:boolean}){
 const loading=controls.loading===true,item=controls.review?.items.find(i=>i.ordinal===ordinal);if(!item&&!loading)return null;
 if(item&&item.decision!=='PENDING')return <span className="block text-xs">Proposal {item.decision==='APPROVE'?'approved':'rejected'} · No financial posting</span>;
 const decision=verified?'APPROVE':'REJECT';
 if(!loading&&(!item||(verified?!item.canApprove:!item.canReject)))return null;
 return <div className="mt-2 flex flex-wrap gap-2">
  <button type="button" className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50" aria-busy={loading||undefined} aria-label={loading?`${verified?'Approve':'Reject'} (checking review permissions)`:undefined} title={loading?'Checking review permissions...':undefined} disabled={controls.busy||loading} onClick={()=>void controls.decide(ordinal,decision)}>{verified?'Approve':'Reject'}</button>
 </div>;
}
