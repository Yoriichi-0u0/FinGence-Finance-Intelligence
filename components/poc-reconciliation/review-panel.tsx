'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '@/components/ui';
import type { M2ClientPrincipal } from '@/lib/ai-ingestion/m2-client-state';
import type { FinancePoCReconciliationV1 } from '@/lib/poc-reconciliation/contracts';
import { reviewStates, type ReconciliationReviewView, type ReviewInput, type ReviewState } from '@/lib/poc-reconciliation/reviews';

const api = '/api/ai-ingestion/m2/reconciliation/reviews';
const button = 'min-h-11 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-50';
const label = (state: ReviewState) => state[0] + state.slice(1).toLowerCase();
type Props = { reconciliationId: string; snapshot: FinancePoCReconciliationV1; principal: M2ClientPrincipal; outcomeIndex: number | null };
export default function ReconciliationReviewPanel({ reconciliationId, snapshot, principal, outcomeIndex }: Props) {
    const counter = useRef({ value: 0 });
    const [view, setView] = useState<ReconciliationReviewView | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(''), [reloadRequired, setReloadRequired] = useState(false);
    const scope = JSON.stringify([principal.userId, principal.organizationId, principal.role, principal.membershipVersion]);
    const bankSha = snapshot.sources.bank.sha256, ledgerSha = snapshot.sources.ledger.sha256;
    const validate = useCallback((v: ReconciliationReviewView) => {
        if (v.version !== 'poc-reconciliation-reviews-v1' || v.reconciliationId !== reconciliationId || JSON.stringify([v.scope.userId, v.scope.organizationId, v.scope.role, v.scope.membershipVersion]) !== scope
            || v.aggregate.sources.bank.sha256 !== bankSha || v.aggregate.sources.ledger.sha256 !== ledgerSha) throw Error('Scope changed');
    }, [scope, reconciliationId, bankSha, ledgerSha]);
    const load = useCallback(() => {
        const request = ++counter.current.value;
        return fetch(`${api}?id=${reconciliationId}`, { cache: 'no-store' }).then(async r => {
            if (!r.ok) throw Error();
            const data = await r.json() as ReconciliationReviewView;
            if (request !== counter.current.value) return; validate(data); setView(data); setReloadRequired(false);
        }).catch(() => { if (request === counter.current.value) { setView(null); setReloadRequired(true); setMessage('Review details are unavailable or access changed. No decisions can be saved until an authorized refresh succeeds.'); } })
            .finally(() => { if (request === counter.current.value) setLoading(false); });
    }, [reconciliationId, validate]);
    useEffect(() => { const requests = counter.current; void load(); return () => { requests.value++; }; }, [load]);
    async function save(input: ReviewInput) {
        const request = ++counter.current.value; setSaving(true); setMessage('');
        try {
            const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
            if (request !== counter.current.value) return;
            if (r.status === 409) { setReloadRequired(true); setMessage('Another Finance session changed this review. Reload review details before saving; your draft has not overwritten their decision.'); return; }
            if (!r.ok) throw Error();
            const data = await r.json() as { status: string; view: ReconciliationReviewView };
            if (request !== counter.current.value) return;
            if (data.status !== 'REVIEWED') throw Error(); validate(data.view); setView(data.view);
            setMessage(`Saved ${label(input.state)}. The original exception, financial totals and source evidence remain unchanged.`);
        } catch { if (request === counter.current.value) { setReloadRequired(true); setMessage('Saving was not confirmed. No automatic retry. Reload review details to investigate the saved version before submitting again.'); } }
        finally { if (request === counter.current.value) setSaving(false); }
    }
    const chosen = view?.outcomes.find(o => o.index === outcomeIndex);
    const original = outcomeIndex === null ? null : snapshot.results[outcomeIndex];
    return <div className="my-4 min-w-0"><Panel title="Human exception review"><div className="space-y-4 p-4 sm:p-5">
        <p className="text-sm text-[var(--muted)]">Annotations do not clear discrepancies, change a matcher status or alter financial records. Exact matches and permitted date-shift matches are not review exceptions.</p>
        <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={loading || saving} onClick={() => { setLoading(true); setView(null); setMessage(''); void load(); }}>Reload review details</button>{loading && <p role="status" className="text-sm">Loading saved decisions…</p>}</div>
        {message && <p role={reloadRequired ? 'alert' : 'status'} className="rounded-lg border bg-slate-50 p-3 text-sm">{message}</p>}
        {view && !loading && <>
            <p className="text-sm"><strong>{view.aggregate.eligible} original exceptions</strong> · reviewer states are separate from matcher counts.</p>
            <ul aria-label="Human review state totals" className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{reviewStates.map(state => <li key={state} className="rounded-lg border p-3">{label(state)} <strong className="block text-xl tabular-nums">{view.aggregate.states[state]}</strong></li>)}</ul>
            {chosen ? <><div className="min-w-0 rounded-lg bg-slate-50 p-3 text-sm"><p><strong>Original outcome: {original?.status.toLowerCase().replaceAll('_', ' ')}</strong></p><p className="mt-1 break-all">Bank: {original?.bankRecordId ?? 'None'} · Ledger: {original?.ledgerRecordIds.join(', ') || 'None'}</p><p className="mt-2">{original?.reason}</p></div><ReviewEditor key={`${chosen.key}:${chosen.review.version}`} item={chosen} reconciliationId={reconciliationId} disabled={saving || reloadRequired} saving={saving} save={save} /></>
                : <p className="text-sm">{outcomeIndex === null ? 'Choose Inspect source on an unmatched or review outcome to record a decision.' : 'This automatically matched outcome is not eligible for exception review.'}</p>}
        </>}
    </div></Panel></div>;
}
function ReviewEditor({ item, reconciliationId, disabled, saving, save }: { item: ReconciliationReviewView['outcomes'][number]; reconciliationId: string; disabled: boolean; saving: boolean; save: (input: ReviewInput) => Promise<void> }) {
    const [state, setState] = useState(item.review.state), [rationale, setRationale] = useState(item.review.rationale);
    const changed = state !== item.review.state || rationale.trim() !== item.review.rationale;
    return <form className="grid min-w-0 gap-3 border-t pt-4" onSubmit={e => { e.preventDefault(); void save({ reconciliationId, outcomeKey: item.key, expectedVersion: item.review.version, state, rationale: rationale.trim() }); }}>
        <p className="break-words text-sm"><strong>Saved decision: {label(item.review.state)}</strong>{item.review.decidedAt ? ` · Finance reviewer ${item.review.reviewerId?.slice(0, 8)} · ${new Date(item.review.decidedAt).toLocaleString()}` : ' · no decision recorded yet'}</p>
        <label className="grid min-w-0 gap-1 text-sm font-medium">Review decision<select aria-label="Review decision" className="min-h-11 min-w-0 rounded-lg border bg-white p-2" value={state} disabled={disabled} onChange={e => setState(e.target.value as ReviewState)}>{reviewStates.map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label>
        <label className="grid min-w-0 gap-1 text-sm font-medium">Explanation<textarea className="min-w-0 rounded-lg border p-3" rows={3} maxLength={600} required={state !== 'OPEN'} disabled={disabled} value={rationale} onChange={e => setRationale(e.target.value)} placeholder="Explain this decision using the source evidence. The discrepancy remains unchanged." /></label>
        <p className="text-xs text-[var(--muted)]">{rationale.length}/600 characters · explanation required unless Open</p>
        <button className={button + ' justify-self-start bg-[var(--teal)] text-white'} disabled={disabled || !changed || (state !== 'OPEN' && !rationale.trim())}>{saving ? 'Saving decision…' : 'Save review decision'}</button>
        {!!item.history.length && <details className="min-w-0 rounded-lg border p-3 text-sm"><summary>Review history ({item.history.length})</summary><ol className="mt-3 space-y-3">{item.history.map(h => <li className="break-words border-t pt-2" key={h.version}><strong>{label(h.state)}</strong> · Finance reviewer {h.reviewerId?.slice(0, 8)} · {h.decidedAt ? new Date(h.decidedAt).toLocaleString() : ''}<p className="mt-1 whitespace-pre-wrap">{h.rationale || 'No explanation recorded.'}</p></li>)}</ol></details>}
    </form>;
}
