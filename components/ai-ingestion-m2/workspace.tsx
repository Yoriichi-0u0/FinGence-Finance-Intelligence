'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader, Panel } from '@/components/ui';
import {M2ClientFence,principalScope,readPending,retainPending,retirePending,migrateOwnedLegacy,legacyPendingKey} from '@/lib/ai-ingestion/m2-client-state';
import type { VerifiedDocumentBatchV1 } from '@/lib/server/ai-ingestion/v2-i1/persistence';
import type { calculateM2Batch } from '@/lib/server/ai-ingestion/m2/pipeline';
type Report = ReturnType<typeof calculateM2Batch>;
type View = {
    job: {
        id: string;
        state: string;
        stages: {
            name: string;
            state: string;
        }[];
    };
    batch: VerifiedDocumentBatchV1 | null;
    report: Report | null;
};
const api = '/api/ai-ingestion/m2';
export default function M2Workspace({financialConsumers=false}:{financialConsumers?:boolean}) {
    const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [active, setActive] = useState(false), [role, setRole] = useState(''), [file, setFile] = useState<File | null>(null), [jobs, setJobs] = useState<{
        id: string;
        state: string;
    }[]>([]), [selected, setSelected] = useState(''), [view, setView] = useState<View | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [stages, setStages] = useState<{
        name: string;
        state: string;
    }[]>([]), [pending, setPending] = useState<string | null>(null), [warnings, setWarnings] = useState<'exclude' | 'include'>('exclude'), [question, setQuestion] = useState(''), [answer, setAnswer] = useState(''), [scope,setScope]=useState(''),[storageBlocked,setStorageBlocked]=useState(false),[recoveringLegacy,setRecoveringLegacy]=useState(false);
    const fence = useRef(new M2ClientFence()), selection = useRef(0), signingIn = useRef(false), working = useRef(false),restoringLegacy=useRef(false);
    const clearFinancialState=useCallback(()=>{selection.current++;setJobs([]);setSelected('');setView(null);setAnswer('');setQuestion('');setStages([]);setPending(null);setFile(null);setWarnings('exclude');restoringLegacy.current=false;setRecoveringLegacy(false);},[]);
    const invalidate=useCallback(()=>{fence.current.invalidate();clearFinancialState();setActive(false);setRole('');setScope('');},[clearFinancialState]);
    const adoptSession=useCallback((value:unknown)=>{
        const changed=fence.current.observe(value),p=fence.current.principal!;
        if(changed){
            clearFinancialState();setScope(JSON.stringify([principalScope(p),p.role,p.membershipVersion]));setMessage('');
            const at=fence.current.epoch;
            try{
                const saved=readPending(sessionStorage,p);setPending(saved);setStorageBlocked(false);
                const legacy=sessionStorage.getItem(legacyPendingKey);
                if(!saved&&legacy&&p.role==='Finance'){restoringLegacy.current=true;setRecoveringLegacy(true);void(async()=>{
                    try{
                        const response=await fetch(api+'?action=reference&id='+encodeURIComponent(legacy),{cache:'no-store'});
                        if(!response.ok)throw new Error('REFERENCE_LOOKUP_UNCONFIRMED');
                        const result=await response.json() as {owned:boolean;ownerUserId:string|null};
                        if(at!==fence.current.epoch||!result.owned||result.ownerUserId!==p.userId)return;
                        migrateOwnedLegacy(sessionStorage,p,legacy,result.ownerUserId);setPending(readPending(sessionStorage,p));
                    }catch{if(at===fence.current.epoch){setStorageBlocked(true);setMessage('Recovery storage could not be confirmed. The original reference remains retained.');}}
                    finally{if(at===fence.current.epoch){restoringLegacy.current=false;setRecoveringLegacy(false);}}
                })();}
            }catch{setStorageBlocked(true);setMessage('Browser storage unavailable. Processing is disabled.');}
        }
        setActive(true);setRole(p.role);
    },[clearFinancialState]);
    useEffect(()=>{
        let ended=false;
        const check=async()=>{if(signingIn.current)return;const at=fence.current.epoch;
            try{const response=await fetch(api+'?action=session',{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();
                if(ended||at!==fence.current.epoch)return;
                if(data.active)adoptSession(data);else invalidate();
            }catch{if(!ended&&at===fence.current.epoch)invalidate();}
        };
        void check();const timer=setInterval(()=>{void check();},1000);return()=>{ended=true;clearInterval(timer);};
    },[invalidate,adoptSession]);
    const refresh=useCallback(async()=>{const at=fence.current.epoch;try{const response=await fetch(api,{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();if(at===fence.current.epoch)setJobs(data.jobs??[]);}catch{if(at===fence.current.epoch)invalidate();}},[invalidate]);
    useEffect(() => { if (active && role === 'Finance')
        void Promise.resolve().then(refresh); }, [active, role, scope, refresh]);
    async function signIn() { signingIn.current = true; invalidate(); const at = fence.current.epoch; setBusy(true); setMessage(''); try {
        const r = await fetch(api + '?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        if (!r.ok)
            throw new Error();
        const d = await r.json();
        if (at !== fence.current.epoch)
            return;
        setPassword('');
        adoptSession(d);
    }
    catch {
        setMessage('Sign-in unavailable. Check your local account or ask the local administrator.');
    }
    finally {
        signingIn.current = false;
        setBusy(false);
    } }
    async function signOut() { invalidate(); await fetch(api + '?action=logout', { method: 'POST' }).catch(() => { setMessage('Local display cleared; server sign-out could not be confirmed.'); }); }
    async function load(id: string, policy = warnings) {
        const at = fence.current.epoch, principal=fence.current.principal, current = ++selection.current;
        setSelected(id);
        setView(null);
        setAnswer('');
        if (!id)
            return;
        try {
            const r = await fetch(`${api}?id=${encodeURIComponent(id)}&warnings=${policy}`, { cache: 'no-store' });
            if (!r.ok)
                throw new Error();
            const d = await r.json() as View;
            if (at !== fence.current.epoch || current !== selection.current)
                return;
            setView(d);
            setStages(d.job.stages ?? []);
            if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(d.job.state) && principal && readPending(sessionStorage,principal) === id) {
                retirePending(sessionStorage,principal!,id);
                setPending(null);
            }
            return d;
        }
        catch {
            if (at === fence.current.epoch && current === selection.current) {
                invalidate();
                setMessage('This operation is unavailable or access was revoked.');
            }
        }
    }
    async function process() {
        if (!file || busy || working.current || restoringLegacy.current || storageBlocked || pending || !active || role !== 'Finance' || !fence.current.principal)
            return;
        working.current = true;
        const at = fence.current.epoch,principal=fence.current.principal!;
        setBusy(true);
        selection.current++;
        setView(null);
        setAnswer('');
        setStages([]);
        setMessage('');
        try {
            if (readPending(sessionStorage,principal))
                throw new Error();
            const reserved = await fetch(api + '?action=reserve', { method: 'POST' });
            if (!reserved.ok)
                throw new Error();
            const { id } = await reserved.json();
            if (at !== fence.current.epoch)
                return;
            retainPending(sessionStorage,principal,id);
            setPending(id);
            setSelected(id);
            const form = new FormData();
            form.append('file', file);
            const r = await fetch(api + '?action=process&id=' + id, { method: 'POST', body: form });
            if (!r.ok || !r.body)
                throw new Error();
            const reader = r.body.getReader(), decoder = new TextDecoder();
            let buffer = '', failed = false;
            while (true) {
                const chunk = await reader.read();
                if (chunk.done)
                    break;
                buffer += decoder.decode(chunk.value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines.filter(Boolean)) {
                    const item = JSON.parse(line);
                    if (at !== fence.current.epoch)
                        continue;
                    if (item.stage)
                        setStages(old => [...old.filter(s => s.name !== item.stage.name), item.stage]);
                    if (item.error)
                        failed = true;
                }
            }
            if (at !== fence.current.epoch)
                return;
            if (buffer.trim() || failed)
                throw new Error();
            await refresh();
            await load(id);
        }
        catch {
            if (at === fence.current.epoch)
                setMessage('Processing was not confirmed. Retrieve the saved operation before any new processing; nothing is retried automatically.');
        }
        finally {
            working.current = false;
            setBusy(false);
        }
    }
    async function investigate() { if (!pending)
        return; setBusy(true); try {
        const r = await fetch(api + '?action=investigate&id=' + pending, { method: 'POST' });
        if (!r.ok)
            throw new Error();
        const d = await r.json();
        setMessage('Investigation: ' + d.outcome + '. No processing was retried.');
        await load(pending);
        await refresh();
    }
    catch {
        setMessage('Investigation is unavailable. The original reference remains retained.');
    }
    finally {
        setBusy(false);
    } }
    async function cancel() { if (!pending)
        return; setBusy(true); try {
        const r = await fetch(api + '?action=cancel&id=' + pending, { method: 'POST' });
        if (!r.ok)
            throw new Error();
        await load(pending);
        await refresh();
    }
    catch {
        setMessage('Cancellation not confirmed. The operation reference remains retained.');
    }
    finally {
        setBusy(false);
    } }
    async function download() { const fresh = await load(selected); if (!fresh?.report)
        return; const url = URL.createObjectURL(new Blob([JSON.stringify(fresh.report, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'fingence-v2-financial-report.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    async function ask() { const at = fence.current.epoch, current = selection.current; setAnswer(''); try {
        const r = await fetch(api + '?action=question&id=' + selected + '&warnings=' + warnings, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
        if (!r.ok)
            throw new Error();
        const d = await r.json();
        if (at !== fence.current.epoch || current !== selection.current)
            return;
        setAnswer(d.status === 'UNSUPPORTED' ? d.reason : d.claims.length ? d.claims.map((g: Report['groups'][number]) => `${g.total} ${g.currency}; ${g.sources.length} source-linked records. Deterministic calculation, not a model answer.`).join('\n') : 'No supported verified source-signed calculation is available.');
    }
    catch {
        if (at === fence.current.epoch)
            invalidate();
    } }
    const batch = view?.batch, verification = batch?.verification;
    return <div className="min-w-0 space-y-5"><PageHeader title="AI ingestion" description="Upload → interpretation → independent verification → financial intelligence"/>
 <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>SIMULATED interpretation · real extraction, verification and local persistence.</strong> No live model has run. Only registered synthetic documents are enabled. Results remain experimental and financially publication-ineligible.</div>
 {!active ? <Panel title="Sign in to your local organization"><div className="space-y-3 p-5"><label className="block">Email<input className="mt-1 block w-full rounded border p-2" type="email" value={email} onChange={e => setEmail(e.target.value)}/></label><label className="block">Password<input className="mt-1 block w-full rounded border p-2" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></label><button className="min-h-11 rounded bg-teal-800 px-4 text-white" disabled={busy || !email || !password} onClick={signIn}>Sign in</button><p className="text-sm text-slate-600">Accounts are provisioned by the local administrator. Hosted identity is not activated.</p></div></Panel> : <>
 <div className="flex flex-wrap items-center gap-3 text-sm"><span>Active role: {role}</span><button className="min-h-11 underline" onClick={signOut}>Sign out</button></div>
 {role !== 'Finance' ? <Panel title="Financial workspace unavailable"><p className="p-5">An active Finance membership is required. Administrative or technical roles do not automatically grant financial access.</p></Panel> : <>
 <Panel title="1. Upload and process"><div className="space-y-3 p-5"><label className="block text-sm">Financial document<input className="mt-2 block w-full max-w-full" key={scope} type="file" accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg" disabled={busy} onChange={e => { selection.current++; setFile(e.target.files?.[0] ?? null); setView(null); setAnswer(''); }}/></label><button className="min-h-11 rounded bg-teal-800 px-4 text-white disabled:opacity-50" disabled={busy || storageBlocked || recoveringLegacy || !file || !!pending} onClick={process}>{busy ? 'Processing…' : 'Process document'}</button>{pending && <button className="ml-2 min-h-11 rounded border px-3" disabled={busy} onClick={() => load(pending)}>Retrieve saved operation</button>}{pending && view?.job.state === 'UNCERTAIN' && <button className="ml-2 min-h-11 rounded border px-3" disabled={busy} onClick={investigate}>Investigate original attempt</button>}{pending && view?.job.state === 'RESERVED' && <button className="ml-2 min-h-11 rounded border px-3" disabled={busy} onClick={cancel}>Cancel unstarted operation</button>}<ol className="grid gap-2 text-sm sm:grid-cols-2">{stages.map(s => <li className="rounded border p-2" key={s.name}>{s.name}: {s.state}</li>)}</ol></div></Panel>
 <Panel title="2. Persisted results"><div className="space-y-3 p-5"><div className="flex flex-wrap gap-2"><select aria-label="Selected operation" className="min-w-0 max-w-full flex-1 rounded border p-2" value={selected} onChange={e => load(e.target.value)}><option value="">Select a processed batch</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.state} · {j.id.slice(0, 8)}</option>)}</select><button className="rounded border px-3" onClick={() => refresh().catch(invalidate)}>Refresh</button></div>
 {view && <p className="text-sm">Operation: {view.job.state}</p>}{batch && <><p className="break-all text-sm">{batch.source.filename} · {batch.source.format} · {batch.source.sha256}</p><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded bg-teal-50 p-3">{verification?.accepted.length ?? 0}<br />verified</div><div className="rounded bg-red-50 p-3">{verification?.rejected.length ?? 0}<br />rejected</div><div className="rounded bg-amber-50 p-3">{verification?.unresolved.length ?? 0}<br />unresolved</div></div><p className="text-sm">Source coverage: {verification?.coverage.rowCountEstablished ? `${verification.coverage.sourceRows} observed rows` : 'Row count not established'}. Document quarantine is separate from record counts.</p>
 {(batch.documentQuarantine || batch.documentFailure) && <p className="rounded bg-amber-50 p-3 text-sm">Document quarantined: {batch.documentQuarantine?.reasons.join(', ') ?? batch.documentFailure?.code}</p>}
 <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Record</th><th>Amount / currency</th><th>Status / source</th></tr></thead><tbody>{verification?.accepted.map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.financial.source_transaction_id ?? 'No source ID'}</td><td>{row.financial.source_amount ?? `Debit ${row.financial.debit ?? '—'} / Credit ${row.financial.credit ?? '—'}`} {row.financial.currency ?? ''}</td><td>{row.status}<details><summary>Evidence</summary>{row.evidenceIds.map(id => { const item = batch.evidence?.items.find(i => i.id === id); return <p className="max-w-xs break-all" key={id}>{item?.text} · {item?.sheet ?? ''} {item?.address ?? ''} {item?.page !== null && item?.page !== undefined ? `page ${item.page}` : ''} {item?.box ? JSON.stringify(item.box) : ''}</p>; })}</details></td></tr>)}</tbody></table></div>
 <details><summary>Quarantined records and verification reasons</summary>{[...(verification?.rejected ?? []), ...(verification?.unresolved ?? [])].map(row => <p className="break-all p-2 text-sm" key={row.id}>{row.id}: {row.reasons.join(', ')} · {row.evidenceIds.join(', ')}</p>)}</details></>}{!view && <p className="text-sm text-slate-600">Select an authorized operation to view its persisted results.</p>}</div></Panel>
 {financialConsumers&&batch&&<Link className="block rounded border bg-teal-800 p-3 text-center text-sm text-white" href={`/transactions?batch=${batch.attemptId}&warnings=${warnings}`}>Open connected Transactions, Analytics and Reports</Link>}
 <Panel title="3. Financial intelligence and report"><div className="space-y-3 p-5"><label className="text-sm">Warning policy <select className="rounded border p-2" value={warnings} onChange={e => { const value = e.target.value as 'include' | 'exclude'; setWarnings(value); setAnswer(''); if (selected)
                void load(selected, value); }}><option value="exclude">Exclude warnings</option><option value="include">Include warnings</option></select></label>{view?.report?.groups.map((g, n) => <div className="rounded border p-3" key={n}><p>{g.status === 'AVAILABLE' ? `${g.total} ${g.currency}` : 'Calculation unavailable'}</p><p className="text-sm">Source-signed amount sum · {g.monetaryBasis ?? 'basis unavailable'} · {g.reason ? 'The source monetary convention does not support a signed-amount total.' : `${g.sources.length} cited verified records`}</p></div>)}{!view?.report?.groups.length && <p>No supported financial total available.</p>}<p className="text-sm text-slate-600">Never revenue, expenses, profit or cash flow. Rejected/unresolved records are excluded. Experimental source arithmetic only.</p><button className="min-h-11 rounded border px-4" disabled={!view?.report} onClick={download}>Download sourced JSON report</button><label className="block text-sm">Ask about verified totals<input className="mt-1 block w-full rounded border p-2" placeholder="What is the source-signed total?" value={question} onChange={e => { setQuestion(e.target.value); setAnswer(''); }}/></label><button className="min-h-11 rounded border px-4" disabled={!view?.report || !question} onClick={ask}>Ask deterministic tool</button>{answer && <p className="whitespace-pre-wrap text-sm" role="status">{answer}</p>}<p className="text-sm">Live Groq, model-backed answers, reconciliation and forecasting are not activated.</p></div></Panel>
 </>}</>}{message && <p className="rounded border p-3 text-sm" role="status">{message}</p>}</div>;
}
