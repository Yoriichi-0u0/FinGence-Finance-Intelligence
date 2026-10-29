'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {PageHeader,Panel} from '@/components/ui';
import {archiveRetiredOperation,clearResolvedOperation,createPendingOperation,pendingOperation,pendingOperationKey as key} from '@/lib/ai-ingestion/local-demo-operation';

type Batch={id:string;source_file:string;rows_received:number;valid_count:number;warning_count:number;rejected_count:number};
type Result={batch:Batch;records:{id:string;source_row_id:string;source_amount:string|null;currency:string|null;ingestion_status:string;reference:string|null}[];calculation:{value?:string;currency?:string};report:string|null;answer:{status:string;value?:string;currency?:string}|null};
const endpoint='/api/ai-ingestion/synthetic-financial';
export function SyntheticFinancialDemo(){
 const [token,setToken]=useState(''),[authenticated,setAuthenticated]=useState(false),[connected,setConnected]=useState(false),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pending,setPending]=useState<string|null>(null),[ready,setReady]=useState(false),[batches,setBatches]=useState<{id:string;name:string}[]>([]),[selected,setSelected]=useState(''),[result,setResult]=useState<Result|null>(null),[question,setQuestion]=useState(''),[answer,setAnswer]=useState('');
 const [runtimeGeneration,setRuntimeGeneration]=useState(''),[retirementAvailable,setRetirementAvailable]=useState(false);
 const generation=useRef(0),accessEpoch=useRef(0);
 const invalidate=useCallback((text:string)=>{accessEpoch.current++;generation.current++;setConnected(false);setAuthenticated(false);setRuntimeGeneration('');setRetirementAvailable(false);setBatches([]);setSelected('');setResult(null);setAnswer('');setMessage(text);},[]);
 useEffect(()=>{
  let cancelled=false;const epoch=accessEpoch.current;const sync=()=>{try{setPending(localStorage.getItem(key));setRetirementAvailable(false);setReady(true);}catch{setMessage('Browser storage is unavailable. Processing is disabled.');}};sync();window.addEventListener('storage',sync);
  void fetch(endpoint+'?action=session',{cache:'no-store'}).then(r=>r.json()).then(data=>{if(!cancelled&&epoch===accessEpoch.current&&data.active&&typeof data.generation==='string'){setRuntimeGeneration(data.generation);setBatches(data.batches??[]);setAuthenticated(true);}}).catch(()=>{});
  return()=>{cancelled=true;window.removeEventListener('storage',sync);};
 },[]);
 useEffect(()=>{
  if(!authenticated)return;
  const source=new EventSource(endpoint+'?action=events');let watchdog:ReturnType<typeof setTimeout>;let stopped=false;
  const denied=()=>{if(stopped)return;stopped=true;source.close();invalidate('Access expired, was revoked, or the session channel disconnected. Sign in again.');};
  const heartbeat=()=>{if(stopped)return;setConnected(true);clearTimeout(watchdog);watchdog=setTimeout(denied,5000);};
  source.addEventListener('active',heartbeat);source.addEventListener('revoked',denied);source.onerror=denied;watchdog=setTimeout(denied,5000);
  return()=>{stopped=true;clearTimeout(watchdog);source.close();};
 },[authenticated,invalidate]);
 async function login(){const epoch=++accessEpoch.current;setBusy(true);setMessage('');try{const r=await fetch(endpoint+'?action=login',{method:'POST',headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error();const data=await r.json();if(epoch!==accessEpoch.current)return;if(typeof data.generation!=='string')throw new Error();setRuntimeGeneration(data.generation);setToken('');setBatches(data.batches??[]);setAuthenticated(true);}catch{if(epoch===accessEpoch.current)invalidate('Local sign-in failed. Check the demonstration code.');}finally{setBusy(false);}}
 async function logout(){invalidate('Signing out…');try{const response=await fetch(endpoint+'?action=logout',{method:'POST'});setMessage(response.ok?'Signed out.':'The display was cleared; server-side sign-out was not confirmed.');}catch{setMessage('The display was cleared; server-side sign-out was not confirmed.');}}
 async function retrieve(batch:string){
  const current=++generation.current;setResult(null);setAnswer('');setSelected(batch);setMessage('');
  if(!batch||!connected)return;
  try{const response=await fetch(`${endpoint}?batch=${encodeURIComponent(batch)}`,{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json() as Result;if(current!==generation.current)return;setResult(data);return data;}
  catch{if(current===generation.current)invalidate('The batch is unavailable or access was denied. Sign in again.');}
 }
 async function process(){
  if(!file||!connected||busy||pending||!ready)return;
  if(!navigator.locks){setMessage('This browser cannot coordinate processing safely.');return;}
  const epoch=accessEpoch.current;
  await navigator.locks.request('fingence-synthetic-c1-demo',{ifAvailable:true},async lock=>{
   if(!lock){setMessage('Another tab is processing a sample.');return;}
   let id:string,raw:string;try{if(localStorage.getItem(key)){setPending(localStorage.getItem(key));return;}id=crypto.randomUUID();raw=createPendingOperation(id,runtimeGeneration);localStorage.setItem(key,raw);}catch{setMessage('Browser storage is unavailable. Processing was not started.');return;}
   setPending(raw);setRetirementAvailable(false);generation.current++;setResult(null);setAnswer('');setBusy(true);setMessage('Validating the synthetic file and persisting accepted records…');
   try{const form=new FormData();form.append('file',file);const response=await fetch(endpoint,{method:'POST',headers:{'X-FinGence-Operation':id,'X-FinGence-Generation':runtimeGeneration},body:form});const data=await response.json();if(epoch!==accessEpoch.current)return;
    if(response.status===422&&data.code==='SYNTHETIC_SAMPLE_REQUIRED'){clearResolvedOperation(localStorage,raw);setPending(null);setMessage('Only the approved synthetic sample files are supported.');return;}
    if(!response.ok||data.operationId!==id||typeof data.batchId!=='string'||typeof data.sourceFile!=='string')throw new Error();
    clearResolvedOperation(localStorage,raw);setPending(null);setBatches(previous=>[...previous.filter(batch=>batch.name!==data.sourceFile),{id:data.batchId,name:data.sourceFile}]);await retrieve(data.batchId);
   }catch{setMessage('Processing could not be confirmed. Check the original operation before starting another.');}finally{setBusy(false);}
  });
 }
 async function investigate(){
  if(!pending||!connected)return;const epoch=accessEpoch.current,raw=pending;setBusy(true);setResult(null);setAnswer('');setRetirementAvailable(false);
  try{const reference=pendingOperation(raw);const query=new URLSearchParams({operation:reference.operationId});if(reference.generation)query.set('generation',reference.generation);
   const response=await fetch(`${endpoint}?${query}`,{cache:'no-store'});const data=await response.json();if(epoch!==accessEpoch.current)return;if(!response.ok)throw new Error();
   if(data.state==='COMMITTED'&&typeof data.batchId==='string'&&typeof data.sourceFile==='string'){clearResolvedOperation(localStorage,raw);setPending(null);setBatches(previous=>[...previous.filter(batch=>batch.name!==data.sourceFile),{id:data.batchId,name:data.sourceFile}]);await retrieve(data.batchId);}
   else if(['RETIRED_GENERATION','NOT_REGISTERED','RETIRED'].includes(data.state)){setRetirementAvailable(true);setMessage(data.state==='RETIRED_GENERATION'?'The previous temporary database was discarded. Its original commit outcome is not recoverable. You may explicitly archive this reference; this does not retry processing.':'No completed result is confirmed. Explicit retirement fences delayed uploads before releasing this reference.');}
   else setMessage('The operation is unresolved. Do not submit it again.');
  }catch{if(epoch===accessEpoch.current)setMessage('Operation status is unavailable. Preserve the reference; do not submit it again.');}finally{setBusy(false);}
 }
 async function retire(){
  if(!pending||!connected||busy||!navigator.locks)return;
  const raw=pending,epoch=accessEpoch.current,currentGeneration=runtimeGeneration;
  await navigator.locks.request('fingence-synthetic-c1-demo',{ifAvailable:true},async lock=>{
   if(!lock){setMessage('Another tab is using this operation.');return;}
   setBusy(true);setResult(null);setAnswer('');
   try{if(localStorage.getItem(key)!==raw)throw new Error();const reference=pendingOperation(raw);
    const headers:Record<string,string>={'X-FinGence-Operation':reference.operationId,'X-FinGence-Generation':currentGeneration};if(reference.generation)headers['X-FinGence-Operation-Generation']=reference.generation;
    const response=await fetch(endpoint+'?action=retire',{method:'POST',headers});const receipt=await response.json();if(epoch!==accessEpoch.current)return;if(!response.ok)throw new Error();
    archiveRetiredOperation(localStorage,raw,receipt,currentGeneration);setPending(null);setRetirementAvailable(false);setMessage('Original reference archived. Nothing was retried. Select a sample and explicitly process a fresh operation if needed.');
   }catch{if(epoch===accessEpoch.current)setMessage('Retirement was not confirmed. The pending reference remains protected. Check it again.');}finally{setBusy(false);}
  });
 }
 async function download(){const fresh=await retrieve(selected);if(!fresh?.report)return;const url=URL.createObjectURL(new Blob([fresh.report],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='fingence-synthetic-report.json';link.click();URL.revokeObjectURL(url);}
 async function ask(){if(question.trim().toLowerCase()!=='what is the sum of signed source amounts?'){setAnswer('Unsupported question. Revenue, expense, cash flow and forecasts are unavailable.');return;}const fresh=await retrieve(selected);if(!fresh?.answer)return;setAnswer(`Deterministic source sum: ${fresh.answer.value} ${fresh.answer.currency}. See the same source references in the report.`);}
 return <div className="space-y-5"><PageHeader title="Synthetic financial intelligence" description="Local, deterministic demonstration · no live AI"/>
 <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Only the registered synthetic CSV/XLSX samples are accepted. Local sessions protect this demonstration; Production identity is not configured. The temporary database is lost on server restart.</div>
 <Panel title="1. Process a synthetic file"><div className="space-y-3 p-5">
 {!authenticated?<><label className="block text-sm">Local demonstration access code<input type="password" autoComplete="off" className="mt-2 block w-full rounded-lg border p-2" value={token} onChange={e=>setToken(e.target.value)}/></label><button className="min-h-11 rounded-lg border px-4" disabled={busy||!token} onClick={login}>Start local session</button></>:<p className="text-sm">{connected?'Local session active':'Checking local session…'} <button className="ml-3 underline" onClick={logout}>Sign out</button></p>}
 <label className="block text-sm">Sample file<input disabled={busy} type="file" accept=".csv,.xlsx" className="mt-2 block w-full" onChange={e=>{generation.current++;setFile(e.target.files?.[0]??null);setResult(null);setAnswer('');}}/></label>
 <button className="min-h-11 rounded-lg bg-teal-800 px-4 text-white disabled:opacity-50" disabled={!file||!connected||busy||!ready||!!pending} onClick={process}>{busy?'Processing…':'Process sample'}</button>{pending&&<button className="ml-2 min-h-11 rounded-lg border px-4" disabled={busy||!connected} onClick={investigate}>Check operation</button>}{pending&&retirementAvailable&&<button className="ml-2 min-h-11 rounded-lg border px-4" disabled={busy||!connected} onClick={retire}>Archive reference without retry</button>}{message&&<p role="status" className="text-sm">{message}</p>}</div></Panel>
 <Panel title="2. Select a processed batch"><div className="space-y-3 p-5"><label className="block text-sm">Batch<select disabled={!connected||busy} value={selected} className="mt-2 block w-full rounded border p-2" onChange={e=>retrieve(e.target.value)}><option value="">Select a batch</option>{batches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{!result&&<p className="text-sm">No accessible result selected.</p>}{result&&<><p>{result.batch.rows_received} checked · {result.batch.valid_count} valid · {result.batch.warning_count} warning · {result.batch.rejected_count} rejected · {result.records.length} accepted</p><p className="text-sm">Source: {result.batch.source_file}. Rejected records are excluded; unresolved is not a C1 record status.</p>{result.records.map(r=><p key={r.id} className="break-all text-sm">{r.reference??'No reference'} · {r.source_amount??'Amount unavailable'} {r.currency??''} · {r.ingestion_status} · {r.source_row_id}</p>)}</>}</div></Panel>
 <Panel title="3. Financial intelligence"><div className="space-y-3 p-5">{result?.report?<><p>Source-signed sum: {result.calculation.value} {result.calculation.currency}</p><p className="text-sm">VALID rows only; WARNING rows are excluded. Exact source arithmetic only; not revenue, expenses, net income or cash flow.</p><button className="min-h-11 rounded-lg border px-4" onClick={download}>Download JSON report</button><label className="block text-sm">Deterministic question<input className="mt-2 block w-full rounded border p-2" value={question} onChange={e=>{setQuestion(e.target.value);setAnswer('');}} placeholder="What is the sum of signed source amounts?"/></label><button className="min-h-11 rounded-lg border px-4" onClick={ask}>Ask</button>{answer&&<p role="status">{answer}</p>}</>:<p className="text-sm">Calculation and report are unavailable for this batch or until access is verified.</p>}<p className="text-sm text-slate-600">Live AI, forecasting and accounting interpretations are unavailable.</p></div></Panel>
 </div>;
}
