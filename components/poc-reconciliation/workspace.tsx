'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader, Panel } from '@/components/ui';
import { M2ClientFence, type M2ClientPrincipal } from '@/lib/ai-ingestion/m2-client-state';
import { reconciliationStatuses, type FinancePoCReconciliationV1, type ReconciliationStatus } from '@/lib/poc-reconciliation/contracts';
import type { ReconciliationSelection } from '@/lib/server/poc-reconciliation/service';
import ReconciliationReviewPanel from './review-panel';
const auth = '/api/ai-ingestion/m2', api = auth + '/reconciliation';
const labels: Record<ReconciliationStatus, string> = { MATCH_EXACT: 'Exact matches', MATCH_DATE_SHIFT: 'Posting-date shifts', BANK_ONLY: 'Bank only', LEDGER_ONLY: 'Ledger only', AMOUNT_MISMATCH_REVIEW: 'Amount review', AMBIGUOUS_DUPLICATE_LEDGER: 'Duplicate ambiguity', REFERENCE_MISMATCH_REVIEW: 'Reference review' };
const button = 'min-h-11 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-50';
export default function ReconciliationWorkspace() {
    const fence = useRef(new M2ClientFence()), sequence = useRef(0), signingIn = useRef(false);
    const [principal, setPrincipal] = useState<M2ClientPrincipal | null>(null), [email, setEmail] = useState(''), [password, setPassword] = useState('');
    const [bank, setBank] = useState<File | null>(null), [ledger, setLedger] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [selections, setSelections] = useState<ReconciliationSelection[]>([]), [selected, setSelected] = useState(''), [snapshot, setSnapshot] = useState<FinancePoCReconciliationV1 | null>(null);
    const [filter, setFilter] = useState<ReconciliationStatus | 'ALL'>('ALL'), [page, setPage] = useState(0), [detail, setDetail] = useState<number | null>(null);
    const invalidate = useCallback(() => { fence.current.invalidate(); sequence.current++; setPrincipal(null); setSelections([]); setSelected(''); setSnapshot(null); setBusy(false); setDetail(null); setBank(null); setLedger(null); }, []);
    const load = useCallback(async (id: string) => {
        const epoch = fence.current.epoch, current = ++sequence.current;
        setSelected(id); setSnapshot(null); setDetail(null); setPage(0); setBusy(true); setError('');
        try {
            const r = await fetch(`${api}?id=${encodeURIComponent(id)}`, { cache: 'no-store' }); if (!r.ok) throw Error('Access or durable audit could not be confirmed.');
            const data: FinancePoCReconciliationV1 = await r.json();
            if (epoch !== fence.current.epoch || current !== sequence.current) return;
            if (data.scope.organizationId !== fence.current.principal?.organizationId) throw Error('Account changed. Sign in again.');
            setSnapshot(data);
        } catch (e) { if (epoch === fence.current.epoch && current === sequence.current) { invalidate(); setError(e instanceof Error ? e.message : 'Results unavailable.'); } }
        finally { if (epoch === fence.current.epoch && current === sequence.current) setBusy(false); }
    }, [invalidate]);
    const refresh = useCallback(async () => {
        const epoch = fence.current.epoch;
        const r = await fetch(api, { cache: 'no-store' }); if (!r.ok) throw Error('Saved sources unavailable or access denied.');
        const data = await r.json(); if (epoch !== fence.current.epoch) return;
        setSelections(data.selections); if (data.selections[0]) await load(data.selections[0].id);
    }, [load]);
    useEffect(() => {
        let ended = false;
        const check = async () => {
            if (signingIn.current) return; const epoch = fence.current.epoch;
            try {
                const r = await fetch(auth + '?action=session', { cache: 'no-store' }); if (!r.ok) throw Error(); const p = await r.json();
                if (ended || epoch !== fence.current.epoch) return;
                if (!p.active) { invalidate(); return; }
                const changed = fence.current.observe(p); setPrincipal(fence.current.principal);
                if (changed) { sequence.current++; setSnapshot(null); setSelections([]); setSelected(''); if (p.role === 'Finance') await refresh(); }
            } catch { if (!ended && epoch === fence.current.epoch) invalidate(); }
        };
        void check(); const timer = setInterval(() => void check(), 1000); window.addEventListener('focus', check);
        return () => { ended = true; clearInterval(timer); window.removeEventListener('focus', check); };
    }, [invalidate, refresh]);
    async function signIn() {
        signingIn.current = true; invalidate(); const epoch = fence.current.epoch; setBusy(true); setError('');
        try {
            const r = await fetch(auth + '?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
            if (!r.ok) throw Error('Sign-in failed. Check the local account and active membership.');
            const p = await r.json(); if (epoch !== fence.current.epoch) return;
            fence.current.observe(p); setPrincipal(fence.current.principal); setPassword(''); if (p.role === 'Finance') await refresh();
        } catch (e) { invalidate(); setError(e instanceof Error ? e.message : 'Sign-in unavailable.'); }
        finally { signingIn.current = false; setBusy(false); }
    }
    async function signOut() { signingIn.current = true; invalidate(); try { if (!(await fetch(auth + '?action=logout', { method: 'POST' })).ok) throw Error(); signingIn.current = false; } catch { setError('Display cleared; server sign-out was not confirmed. Sign in explicitly to resume.'); } }
    async function upload() {
        if (!bank || !ledger) return; const epoch = fence.current.epoch, current = ++sequence.current; setBusy(true); setSnapshot(null); setDetail(null); setError('');
        try {
            const data = new FormData(); data.set('bank', bank); data.set('ledger', ledger);
            const r = await fetch(api, { method: 'POST', body: data }); if (!r.ok) throw Error(); await r.json();
            if (epoch === fence.current.epoch && current === sequence.current) await refresh();
        } catch { if (epoch === fence.current.epoch && current === sequence.current) setError('Processing was not confirmed. Refresh saved sources before submitting again. Only the supplied synthetic CSV pair is supported; duplicate source pairs cannot create another result. No automatic retry.'); }
        finally { if (epoch === fence.current.epoch) setBusy(false); }
    }
    async function download() {
        if (!snapshot) return; const epoch = fence.current.epoch, current = sequence.current;
        try {
            const r = await fetch(`${api}?id=${selected}&download=1`, { cache: 'no-store' }); if (!r.ok) throw Error();
            const data = await r.json(); if (epoch !== fence.current.epoch || current !== sequence.current) return;
            if (data.scope.organizationId !== principal?.organizationId || data.sources.bank.sha256 !== snapshot.sources.bank.sha256 || data.sources.ledger.sha256 !== snapshot.sources.ledger.sha256) throw Error();
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = 'fingence-reconciliation.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { invalidate(); setError('Download unavailable or access changed. Sign in again.'); }
    }
    const visible = snapshot?.results.filter(r => filter === 'ALL' || r.status === filter) ?? [], chosen = detail === null ? null : visible[detail];
    return <>
        <PageHeader title="Reconciliation" description="Upload bank and cash-ledger sources. Inspect deterministic matches and unresolved exceptions." />
        <p className="mb-4 rounded-lg bg-[var(--teal-soft)] p-3 text-sm">Local synthetic PoC · DETERMINISTIC_RULES · No live AI or financial publication</p>
        {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {!principal ? <Panel title="Finance sign-in"><form className="grid max-w-lg gap-4 p-5" onSubmit={e => { e.preventDefault(); void signIn(); }}>
            <label className="grid gap-1 text-sm">Email<input className="rounded border p-2" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label className="grid gap-1 text-sm">Password<input className="rounded border p-2" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
            <button className={button} disabled={busy}>Sign in</button><p className="text-xs text-[var(--muted)]">Use an OS-provisioned local account. No fallback user or hosted login.</p>
        </form></Panel> : <>
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm"><span>Signed in · {principal.role}</span><button className={button} onClick={() => void signOut()}>Sign out</button></div>
            {principal.role !== 'Finance' ? <Panel><p className="p-5">Financial records require an active Finance membership. This role has no reconciliation access.</p></Panel> : <>
                <Panel title="Bank + general ledger"><div className="grid gap-4 p-5 sm:grid-cols-2">
                    <label className="grid min-w-0 gap-2 text-sm font-medium">Bank statement CSV<input className="w-full min-w-0 text-xs" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => setBank(e.target.files?.[0] ?? null)} /></label>
                    <label className="grid min-w-0 gap-2 text-sm font-medium">General ledger CSV<input className="w-full min-w-0 text-xs" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => setLedger(e.target.files?.[0] ?? null)} /></label>
                    <button className={button + ' bg-[var(--teal)] text-white'} disabled={busy || !bank || !ledger} onClick={() => void upload()}>{busy ? 'Verifying and saving…' : 'Process both sources'}</button>
                    <button className={button} disabled={busy} onClick={() => void refresh().catch(() => { invalidate(); setError('Saved sources could not be retrieved.'); })}>Refresh saved sources</button>
                    <p className="text-xs text-[var(--muted)] sm:col-span-2">Supplied March 2026 synthetic bank and cash-account CSVs only. Source identity comes from file bytes, not filenames. Re-uploading the same pair retrieves its existing result.</p>
                </div></Panel>
                <label className="my-4 grid gap-2 text-sm">Saved source pair<select className="min-w-0 rounded-lg border bg-white p-3" value={selected} disabled={busy || !selections.length} onChange={e => void load(e.target.value)}><option value="">Choose saved sources</option>{selections.map(s => <option key={s.id} value={s.id}>{s.businessId} · {s.period} · {s.currency} · {s.id.slice(0, 8)}</option>)}</select></label>
                {snapshot ? <>
                    <Panel title={`${snapshot.scope.businessId} · ${snapshot.scope.period} · ${snapshot.scope.currency}`}><div className="grid gap-4 p-5 sm:grid-cols-3">{Object.entries(snapshot.cashMovement).map(([k, v]) => <div key={k}><p className="text-xs text-[var(--muted)]">{k === 'bank' ? 'Bank cash movement' : k === 'ledger' ? 'Ledger cash movement' : 'Signed bank − ledger difference'}</p><p className="mt-1 break-all text-xl font-semibold tabular-nums">MYR {v}</p></div>)}</div><p className="px-5 pb-5 text-xs">{snapshot.rows.bank.length} bank records · {snapshot.rows.ledger.length} ledger cash entries · {snapshot.results.length} reconciliation outcomes. Cash-account source totals, not revenue or profit.</p></Panel>
                    <div className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{reconciliationStatuses.map(s => <button key={s} className={button + ' bg-white text-left'} onClick={() => { setFilter(s); setPage(0); setDetail(null); }}><span className="block text-xs">{labels[s]}</span><span className="text-xl tabular-nums">{snapshot.counts[s]}</span></button>)}</div>
                    <div className="my-4 flex flex-wrap gap-3"><button className={button} onClick={() => { setFilter('ALL'); setPage(0); setDetail(null); }}>All outcomes</button><button className={button} onClick={() => void download()}>Download reconciliation JSON</button></div>
                    <Panel title={filter === 'ALL' ? 'All source-backed outcomes' : labels[filter]}><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Status', 'Bank record', 'Ledger record(s)', 'Evidence'].map(x => <th className="p-3" key={x}>{x}</th>)}</tr></thead><tbody>{visible.slice(page * 20, page * 20 + 20).map((r, i) => <tr className="border-t" key={r.bankRecordId ?? r.ledgerRecordIds.join('|')}><td className="p-3">{labels[r.status]}</td><td className="break-all p-3">{r.bankRecordId ?? '—'}</td><td className="break-all p-3">{r.ledgerRecordIds.join(', ') || '—'}</td><td className="p-3"><button className="min-h-11 underline" onClick={() => setDetail(page * 20 + i)}>Inspect source</button></td></tr>)}</tbody></table></div><div className="flex flex-wrap items-center gap-3 p-3"><button className={button} disabled={!page} onClick={() => { setPage(p => p - 1); setDetail(null); }}>Previous</button><span className="text-xs">Page {page + 1} · {visible.length} outcomes</span><button className={button} disabled={(page + 1) * 20 >= visible.length} onClick={() => { setPage(p => p + 1); setDetail(null); }}>Next</button></div></Panel>
                    <ReconciliationReviewPanel key={`${selected}:${principal.userId}:${principal.organizationId}:${principal.membershipVersion}`} reconciliationId={selected} snapshot={snapshot} principal={principal} outcomeIndex={chosen ? snapshot.results.indexOf(chosen) : null} />
                    {chosen && <div className="mt-4"><Panel title={labels[chosen.status]}><p className="p-4 text-sm">{chosen.reason}</p><div className="grid gap-3 p-4 md:grid-cols-2">{(['bank', 'ledger'] as const).map(kind => <section className="min-w-0 rounded-lg border p-3" key={kind}><h3 className="font-semibold">{kind === 'bank' ? 'Bank source' : 'Ledger source'}</h3>{(kind === 'bank' ? chosen.bankEvidenceIds : chosen.ledgerEvidenceIds).map(id => { const e = snapshot.evidence[id]; return <p key={id} className="mt-2 break-all text-xs"><strong>CSV record {e.row} · {e.field}</strong>: {e.literal}<br /><span className="text-[var(--muted)]">{id}</span></p>; })}</section>)}</div></Panel></div>}
                    <details className="my-4 rounded-lg border p-4 text-xs"><summary>Source identities and limitations</summary><p className="mt-3 break-all">Bank SHA-256: {snapshot.sources.bank.sha256}<br />Ledger SHA-256: {snapshot.sources.ledger.sha256}</p><ul className="mt-3 list-disc pl-5">{snapshot.limitations.map(x => <li key={x}>{x}</li>)}</ul></details>
                </> : <p role="status" className="py-6 text-sm">{busy ? 'Processing source evidence…' : 'Upload both sources or select a saved pair. No illustrative financial figures are shown.'}</p>}
            </>}
        </>}
    </>;
}
