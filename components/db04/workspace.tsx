'use client';
import {useState} from 'react';
import {dashboardContext,type ProcessingDashboardV1} from '@/lib/reconciliation-dashboard';
import ProposalEvidence from './proposal-evidence';
import FinancialViews from './financial-views';
export default function DB04Workspace({view}:{view:'transactions'|'reconciliation'|'analytics'|'forecasting'|'reports'}) {
 const [token,setToken]=useState(''),[result,setResult]=useState<ProcessingDashboardV1|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState(view),[uncertain,setUncertain]=useState(false);
 async function upload(form:FormData){
  setResult(null);setMessage('');setBusy(true);
  try {
   const headers={authorization:`Bearer ${token}`};
   const response=await fetch('/api/db04/processing',{method:'POST',headers,body:form});
   if(response.status===409){setUncertain(true);throw Error('Outcome uncertain. Stop and investigate before retrying.');}
   if(!response.ok)throw Error('Upload was denied or unsupported.');
   const receipt=await response.json();
   const read=await fetch(`/api/db04/processing?processingId=${encodeURIComponent(receipt.processingId)}`,{headers,cache:'no-store'});
   if(!read.ok)throw Error('Persisted result could not be retrieved.');
   setResult(dashboardContext(await read.json(),receipt.processingId));
  }catch(e){setMessage(e instanceof Error?e.message:'Processing unavailable');}finally{setBusy(false);}
 }
 return <section className="p-8 space-y-4"><h1>Local persisted financial processing</h1><p>Registered synthetic CSV documents only. Existing local Finance session required.</p>
 <label>Finance session <input type="password" autoComplete="off" disabled={busy} value={token} onChange={e=>{setToken(e.target.value);setResult(null);}} /></label>
 <form action={upload}><label>BANK and LEDGER CSVs <input type="file" name="documents" accept=".csv" multiple required disabled={busy||uncertain}/></label><button disabled={busy||uncertain||!token}>{busy?'Processing…':'Process documents'}</button></form>
 <p role="status">{message}</p>
 {result&&<><p>Processing ID: {result.processingId}</p>{result.sources.map(s=><p key={String(s.kind)}>{String(s.kind)} SHA256: {String(s.sha256)}</p>)}
 <button onClick={()=>setTab('transactions')}>Transactions</button><button onClick={()=>setTab('reconciliation')}>Reconciliation</button>
 <button onClick={()=>setTab('analytics')}>Analytics</button><button onClick={()=>setTab('forecasting')}>Forecasting</button><button onClick={()=>setTab('reports')}>Reports</button>
 <div hidden={tab!=='transactions'&&tab!=='reconciliation'}>
 {tab==='transactions'?<table><thead><tr><th>Source</th><th>Record</th><th>Date basis</th><th>Date</th><th>Amount</th><th>Currency</th></tr></thead><tbody>{result.transactions.map(t=><tr key={`${t.kind}:${t.record_id}`}><td>{String(t.kind)}</td><td>{String(t.record_id)}</td><td>{String(t.date_basis)}</td><td>{String(t.canonical_date)}</td><td>{String(t.signed_amount)}</td><td>{String(t.currency)}</td></tr>)}</tbody></table>:<><table><thead><tr><th>BANK record</th><th>LEDGER record</th><th>Decision</th></tr></thead><tbody>{result.proposals.map((p,i)=><tr key={i}><td>{String(p.bank_record_id)}</td><td>{String(p.ledger_record_id)}</td><td>{String(p.decision)}</td></tr>)}</tbody></table><p>Unresolved cases: {result.cases.length}</p></>}
 {tab==='reconciliation'&&<ProposalEvidence context={result}/>}
 </div>
 {['analytics','forecasting','reports'].includes(tab)&&<FinancialViews view={tab} data={result.financialViews}/>}
 </> }</section>;
}
