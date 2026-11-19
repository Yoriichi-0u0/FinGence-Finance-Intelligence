"use client";
import {useEffect,useState} from 'react';
import {Panel} from '@/components/ui';
import {financeGPTView,type GPTDisplayView} from '@/lib/gpt-evidence-view';
import {GPTFinancialSummary} from './gpt-financial-summary';
import {useGPTReview,type GPTReviewControls} from './gpt-review';
import {useTechnicalDetail} from '@/components/workspace/context';
export type GPTEvidenceState={status:'loading'|'generating'|'empty'|'unavailable'|'error'}|{status:'ready';data:GPTDisplayView};
export async function loadGPTEvidence(batchId:string,signal:AbortSignal,transport:typeof fetch=fetch,websiteJob=false):Promise<GPTEvidenceState>{
 try{
  const response=await transport(websiteJob?`/api/reconciliation/website-gpt-evidence?jobId=${encodeURIComponent(batchId)}`:`/api/reconciliation/gpt-evidence?batchId=${encodeURIComponent(batchId)}`,{method:'GET',credentials:'same-origin',cache:'no-store',signal});
  if(websiteJob&&response.status===404)return {status:'empty'};
  if([401,403,404,503].includes(response.status))return {status:'unavailable'};
  if(!response.ok)return {status:'error'};
  const data:GPTDisplayView=await response.json();
  if(!['gpt-evidence-view/1','gpt-finance-view/1'].includes(data.version)||data.batchId!==batchId||!Array.isArray(data.runs))return {status:'error'};
  return data.runs.length?{status:'ready',data}:{status:'empty'};
 }catch{return {status:'error'};}
}
/** One serialized read loop per effect. The 90-second window begins at the first empty website result. */
export function watchGPTEvidence(batchId:string,websiteJob:boolean,onState:(state:GPTEvidenceState)=>void,transport:typeof fetch=fetch){
 const controller=new AbortController();
 let stopped=false,expiresAt:number|undefined,next:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
 const stop=()=>{stopped=true;clearTimeout(next);clearTimeout(deadline);controller.abort();};
 const expire=()=>{stop();onState({status:'empty'});};
 const read=async()=>{
  if(stopped)return;
  if(expiresAt!==undefined&&Date.now()>=expiresAt){expire();return;}
  const result=await loadGPTEvidence(batchId,controller.signal,transport,websiteJob);
  if(stopped)return;
  if(expiresAt!==undefined&&Date.now()>=expiresAt){expire();return;}
  if(websiteJob&&result.status==='empty'){
   if(deadline===undefined){expiresAt=Date.now()+90_000;deadline=setTimeout(expire,90_000);}
   next=setTimeout(()=>{next=undefined;void read();},5_000);
   onState({status:'generating'});
  }else{stop();onState(result);}
 };
 void read();
 return stop;
}
export function GPTSuggestionsView({state:input,reviewControls}:{state:GPTEvidenceState;reviewControls?:GPTReviewControls}){
 const technical=useTechnicalDetail();
 // Preview only reduces presentation. The API still authorizes using the real server session role.
 const state=input.status==='ready'&&!technical&&input.data.version==='gpt-evidence-view/1'
  ?{...input,data:financeGPTView(input.data)}:input;
 return <div className="my-4 min-w-0"><Panel title="GPT Matching Suggestions"><div className="min-w-0 space-y-5 p-4 text-sm sm:p-5">
 <p className="text-xs leading-relaxed text-[var(--muted)]">AI matching may take around 90 seconds. Please wait while your transactions are checked.</p>
 <p className="text-xs leading-relaxed text-[var(--muted)]">Rejecting a suggestion saves your decision permanently. It will not delete transactions or change financial totals.</p>
 {state.status!=='ready'?<p className="rounded-xl bg-[var(--surface-subtle)] p-4" role={state.status==='error'?'alert':'status'}>
 {state.status==='loading'?'Loading saved suggestions...':state.status==='generating'?'Generating GPT suggestions...':state.status==='empty'?'No saved suggestions are available.':state.status==='unavailable'?'Saved suggestions are unavailable. Please contact your administrator if this continues.':'Suggestions could not be loaded. No results are shown.'}</p>:<GPTFinancialSummary data={state.data} technical={technical} reviewControls={reviewControls}/>}
 </div></Panel></div>;
}

const stateJob=(value?:string)=>!!value&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function EvidenceLoader({batchId,websiteJob=false}:{batchId?:string;websiteJob?:boolean}){
 const [state,setState]=useState<GPTEvidenceState>({status:batchId?'loading':'unavailable'});
 const reviewControls=useGPTReview(state.status==='ready'&&websiteJob&&stateJob(batchId)?batchId:undefined);
 useEffect(()=>{if(!batchId)return;return watchGPTEvidence(batchId,websiteJob,setState);},[batchId,websiteJob]);
 return <GPTSuggestionsView state={state} reviewControls={websiteJob?reviewControls:undefined}/>;
}
export default function GPTSuggestions({batchId,websiteJob=false}:{batchId?:string;websiteJob?:boolean}){return <EvidenceLoader key={`${websiteJob}:${batchId??'unavailable'}`} batchId={batchId} websiteJob={websiteJob}/>;}
