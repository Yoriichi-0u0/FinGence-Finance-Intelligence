'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, MessageSquareText, RefreshCw, Send } from 'lucide-react';
import { Panel, PageHeader, EmptyState } from '@/components/ui';
import { M2ClientFence, principalScope, type M2ClientPrincipal } from '@/lib/ai-ingestion/m2-client-state';
import { readSelection, rememberSelection, forgetSelection, browserSelectionStorage, type PocSelection } from '@/lib/poc-insights/selection';
import { groupDigits } from '@/lib/poc-anomalies/format';
import { MAX_QUESTION, type QaAnswer, type Fact } from '@/lib/poc-finance-qa/answer';
import type { QaContext, QaResult } from '@/lib/server/poc-finance-qa/service';
import type { PocSource } from '@/lib/server/poc-anomalies/service';

const auth = '/api/ai-ingestion/m2', api = auth + '/finance-questions';
const scopeKey = (p: M2ClientPrincipal) => JSON.stringify([principalScope(p), p.role, p.membershipVersion]);
const params = (q: PocSelection) => new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
const field = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm';
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
const chip = 'min-h-11 rounded-full border border-[var(--border-strong)] bg-white px-4 py-2 text-left text-sm hover:border-teal-600 hover:bg-teal-50 disabled:opacity-50';
const display = (f: Fact) => f.unit === 'MONEY' ? `${f.currency} ${groupDigits(f.value)}` : f.unit === 'PERCENT' && /\d/.test(f.value) ? `${f.value}%` : f.value;
const tone = { ANSWERED: 'border-teal-200 bg-teal-50 text-teal-900', UNAVAILABLE: 'border-amber-200 bg-amber-50 text-amber-950', REFUSED: 'border-slate-300 bg-slate-100 text-slate-900' } as const;
const statusLabel = { ANSWERED: 'Answered from source', UNAVAILABLE: 'Unavailable', REFUSED: 'Refused' } as const;
type Asked = { id: number; answer: QaAnswer };

export default function FinanceQuestionsWorkspace() {
    const fence = useRef(new M2ClientFence()), request = useRef({ sequence: 0 }), asked = useRef(0), authenticating = useRef(false), sessionPaused = useRef(false);
    const [principal, setPrincipal] = useState<M2ClientPrincipal | null>(null), [checked, setChecked] = useState(false);
    const [sources, setSources] = useState<PocSource[] | null>(null), [context, setContext] = useState<QaContext | null>(null), [answers, setAnswers] = useState<Asked[]>([]);
    const [loading, setLoading] = useState(false), [asking, setAsking] = useState(false), [error, setError] = useState<string | null>(null), [draft, setDraft] = useState('');
    // Any principal, session or selection change drops every displayed figure and in-flight response.
    const clear = useCallback(() => { request.current.sequence++; setSources(null); setContext(null); setAnswers([]); setLoading(false); setAsking(false); }, []);
    const invalidate = useCallback(() => { forgetSelection(browserSelectionStorage, fence.current.principal); fence.current.invalidate(); clear(); setPrincipal(null); }, [clear]);
    const load = useCallback(async (next: PocSelection) => {
        const p = fence.current.principal; if (!p || p.role !== 'Finance') return;
        const epoch = fence.current.epoch, sequence = ++request.current.sequence;
        setContext(null); setAnswers([]); setAsking(false); setLoading(true); setError(null);
        try {
            const r = await fetch(`${api}?action=context&${params(next)}`, { cache: 'no-store' }); if (!r.ok) throw Error();
            const value = await r.json() as QaContext;
            if (epoch !== fence.current.epoch || sequence !== request.current.sequence) return;
            if (scopeKey(value.scope) !== scopeKey(p) || value.version !== 'poc-finance-questions-v1' || value.selection.sourceId !== next.source
                || (next.business && value.selection.businessId !== next.business) || (next.period && value.selection.period !== next.period) || (next.currency && value.selection.currency !== next.currency)) throw Error();
            const selected = { source: value.selection.sourceId, business: value.selection.businessId, period: value.selection.period, currency: value.selection.currency };
            rememberSelection(browserSelectionStorage, p, selected); setContext(value);
            history.replaceState(null, '', `/finance-questions?${params(selected)}`);
        } catch {
            if (epoch === fence.current.epoch && sequence === request.current.sequence) setError('The selected source is unavailable, or the read could not be authorized and audited. Choose a source or refresh.');
        } finally { if (epoch === fence.current.epoch && sequence === request.current.sequence) setLoading(false); }
    }, []);
    const refresh = useCallback(async () => {
        const p = fence.current.principal; if (!p || p.role !== 'Finance') return;
        const epoch = fence.current.epoch, sequence = ++request.current.sequence;
        setContext(null); setAnswers([]); setLoading(true); setError(null);
        try {
            const r = await fetch(api + '?action=sources', { cache: 'no-store' }); if (!r.ok) throw Error();
            const list = await r.json() as { scope: M2ClientPrincipal; sources: PocSource[] };
            if (epoch !== fence.current.epoch || sequence !== request.current.sequence) return;
            if (scopeKey(list.scope) !== scopeKey(p)) throw Error();
            setSources(list.sources);
            const chosen = readSelection(browserSelectionStorage, p, location.search) ?? (list.sources[0] ? { source: list.sources[0].id } : null);
            if (chosen && !list.sources.some(s => s.id === chosen.source)) throw Error();
            if (chosen) await load(chosen); else setLoading(false);
        } catch {
            if (epoch === fence.current.epoch && sequence === request.current.sequence) { setLoading(false); setError('Source selection is unavailable for this account. Choose an uploaded source or sign in again.'); }
        }
    }, [load]);
    const adopt = useCallback((value: unknown) => {
        const changed = fence.current.observe(value); setPrincipal(fence.current.principal);
        if (changed) { clear(); void refresh(); }
    }, [clear, refresh]);
    useEffect(() => {
        let ended = false;
        const access = fence.current, pending = request.current;
        const check = async () => {
            if (authenticating.current || sessionPaused.current) return;
            const epoch = fence.current.epoch;
            try { const r = await fetch(auth + '?action=session', { cache: 'no-store' }); if (!r.ok) throw Error(); const value = await r.json();
                if (!ended && epoch === fence.current.epoch) { if (value.active) adopt(value); else invalidate(); }
            } catch { if (!ended && epoch === fence.current.epoch) invalidate(); }
            finally { if (!ended) setChecked(true); }
        };
        void check(); const timer = setInterval(() => { void check(); }, 1000); window.addEventListener('focus', check);
        return () => { ended = true; pending.sequence++; access.invalidate(); clearInterval(timer); window.removeEventListener('focus', check); };
    }, [adopt, invalidate]);
    async function ask(question: string) {
        const p = fence.current.principal, c = context; if (!p || p.role !== 'Finance' || !c || !question.trim()) return;
        const epoch = fence.current.epoch, sequence = request.current.sequence;
        setAsking(true); setError(null);
        try {
            const r = await fetch(api + '?action=ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
                body: JSON.stringify({ source: c.selection.sourceId, business: c.selection.businessId, period: c.selection.period, currency: c.selection.currency, question }) });
            if (!r.ok) throw Error();
            const value = await r.json() as QaResult, a = value.answer;
            if (epoch !== fence.current.epoch || sequence !== request.current.sequence) return;
            if (scopeKey(value.scope) !== scopeKey(p) || JSON.stringify(a.selection) !== JSON.stringify(c.selection) || a.answerOrigin !== 'DETERMINISTIC_VERIFIED_SOURCE' || a.liveModel !== false) throw Error();
            setAnswers(list => [{ id: ++asked.current, answer: a }, ...list].slice(0, 8)); setDraft('');
        } catch {
            if (epoch === fence.current.epoch && sequence === request.current.sequence) setError('The question could not be answered for this authorized selection. Nothing was shown; refresh or sign in again.');
        } finally { if (epoch === fence.current.epoch && sequence === request.current.sequence) setAsking(false); }
    }
    async function signIn(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault(); const form = event.currentTarget, fields = new FormData(form);
        authenticating.current = true; sessionPaused.current = true; invalidate(); setError(null);
        try { const r = await fetch(auth + '?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fields.get('email'), password: fields.get('password') }) });
            if (!r.ok) throw Error(); const value = await r.json(); if (value.active !== true) throw Error(); adopt(value); sessionPaused.current = false; form.reset();
        } catch { setError('Sign-in refused. An active local account and membership are required.'); }
        finally { authenticating.current = false; }
    }
    async function signOut() {
        // A failed/lost logout response must not let polling silently restore the old cookie session.
        sessionPaused.current = true; invalidate(); setError(null);
        try { const r = await fetch(auth + '?action=logout', { method: 'POST' }); if (!r.ok) throw Error(); }
        catch { setError('Answers are cleared. Server sign-out could not be confirmed. Sign in explicitly to establish access again.'); }
    }

    const banner = <aside aria-label="Assistant notice" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Rule-based source assistant, not live AI.</strong> Fixed question rules quote figures the server computed from your selected, Finance-authorized synthetic upload. Unsupported questions are refused; no language model is called.
    </aside>;
    const header = <PageHeader title="Finance questions" description="Ask about bank cash movement, reconciliation, anomaly candidates, monthly history and the cash baseline." />;
    if (!checked) return <EmptyState title="Checking local access" description="Financial answers stay hidden until the current session is verified." />;
    if (!principal) return <div className="space-y-5">{header}{banner}
        <Panel title="Finance sign-in"><form className="mx-auto max-w-md space-y-4 p-5" onSubmit={signIn}>
            <label className="block text-sm">Email<input name="email" type="email" autoComplete="username" required className={field} /></label>
            <label className="block text-sm">Password<input name="password" type="password" autoComplete="current-password" required className={field} /></label>
            <button className={button}>Sign in</button>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        </form></Panel></div>;
    if (principal.role !== 'Finance') return <div className="space-y-4">{header}{banner}<EmptyState title="Finance access required" description="Technical (Management) and Admin memberships cannot ask questions about financial source records." /><button className={button} onClick={signOut}>Sign out</button></div>;
    const c = context, busy = loading || asking;
    function select(change: Partial<PocSelection>) {
        const source = change.source ?? c?.selection.sourceId; if (!source) return;
        void load(change.source ? { source } : { source, business: c?.selection.businessId, period: c?.selection.period, currency: c?.selection.currency, ...change });
    }
    return <div className="min-w-0 space-y-5">
        {header}{banner}
        <div className="flex flex-wrap gap-2"><button className={button} onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} /> Refresh</button><button className={button} onClick={signOut}><LogOut size={15} /> Sign out</button></div>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
        <Panel title="Selected source" eyebrow="Server-resolved selection"><div className="grid min-w-0 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <label className="min-w-0 text-sm">Source file<select aria-label="Source file" className={field} value={c?.selection.sourceId ?? ''} disabled={busy || !sources?.length} onChange={e => select({ source: e.target.value })}><option value="" disabled>Choose uploaded source</option>{sources?.map(s => <option key={s.id} value={s.id}>{s.fileName} · {s.rowCount} rows</option>)}</select></label>
            <label className="min-w-0 text-sm">Business<select aria-label="Business" className={field} disabled={busy || !c} value={c?.selection.businessId ?? ''} onChange={e => select({ business: e.target.value, period: undefined, currency: undefined })}>{c?.options.map(o => <option key={o.businessId} value={o.businessId}>{o.businessId} · {o.businessName}</option>)}</select></label>
            <label className="min-w-0 text-sm">Month<select aria-label="Month" className={field} disabled={busy || !c} value={c?.selection.period ?? ''} onChange={e => select({ period: e.target.value })}>{c?.periods.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="min-w-0 text-sm">Currency<select aria-label="Currency" className={field} disabled={busy || !c} value={c?.selection.currency ?? ''} onChange={e => select({ currency: e.target.value, period: undefined })}>{c?.options.find(o => o.businessId === c.selection.businessId)?.currencies.map(x => <option key={x}>{x}</option>)}</select></label>
        </div>{c && !loading && <p className="break-all border-t border-[var(--border)] px-5 py-3 font-mono text-xs text-[var(--muted-strong)]">Source SHA-256: {c.source.sha256} · {c.periods.length} observed month{c.periods.length === 1 ? '' : 's'} · reconciliation {c.reconciliation.toLowerCase()} · forecast {c.forecast.toLowerCase()}</p>}</Panel>
        {loading ? <p role="status" className="p-5 text-sm">Loading the authorized source…</p> : !c ? <EmptyState title={sources?.length ? 'No source selected' : 'No bank source uploaded'} description="Upload the supplied March bank statement or the full synthetic source on Anomalies (and the March bank and ledger pair on Reconciliation), then return here." /> : <>
            <Panel title="Ask a question" eyebrow={`${c.selection.businessId} · ${c.selection.period} · ${c.selection.currency}`}><div className="space-y-4 p-5">
                <div role="group" aria-label="Suggested questions" className="flex flex-wrap gap-2">{c.suggestions.map(q => <button key={q} className={chip} disabled={asking} onClick={() => void ask(q)}>{q}</button>)}</div>
                <form className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end" onSubmit={e => { e.preventDefault(); void ask(draft); }}>
                    <label className="min-w-0 flex-1 text-sm">Your question<input className={field} value={draft} maxLength={MAX_QUESTION} onChange={e => setDraft(e.target.value)} placeholder="For example: How many anomalies were identified?" /></label>
                    <button className={button} disabled={asking || !draft.trim()}><Send size={15} /> Ask</button>
                </form>
                {asking && <p role="status" className="text-sm">Computing the answer from the source…</p>}
            </div></Panel>
            {!answers.length ? <EmptyState title="No question asked yet" description="Choose a suggested question or type one. Answers are cleared when the source, business, month, currency or session changes." />
                : <section aria-label="Answers" aria-live="polite" className="space-y-4">{answers.map(({ id, answer }) => <AnswerCard key={id} answer={answer} />)}</section>}
        </>}
    </div>;
}

function AnswerCard({ answer: a }: { answer: QaAnswer }) {
    const s = a.selection;
    return <article className="panel-shadow min-w-0 rounded-xl border border-[var(--border)] bg-white">
        <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-5">
            <p className="flex min-w-0 items-start gap-2 text-sm font-semibold"><MessageSquareText aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-[var(--teal)]" /><span className="min-w-0 break-words">{a.question}</span></p>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tone[a.status]}`}>{statusLabel[a.status]}{a.code ? ` · ${a.code.replaceAll('_', ' ').toLowerCase()}` : ''}</span>
        </header>
        <div className="space-y-4 p-4 sm:p-5">
            <p className="break-words text-base font-semibold leading-snug">{a.headline}</p>
            <p className="break-words text-sm leading-relaxed text-[var(--muted-strong)]">{a.interpretation}</p>
            {a.facts.length > 0 && <dl className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">{a.facts.map(f => <div key={f.id} className="min-w-0 rounded-lg border border-[var(--border)] px-3 py-2"><dt className="text-xs text-[var(--muted-strong)]">{f.label}</dt><dd className={f.unit === 'TEXT' ? 'break-all font-mono text-xs' : 'break-words font-semibold tabular-nums'}>{display(f)}</dd></div>)}</dl>}
            {a.records.map(g => <details key={g.label} className="min-w-0 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"><summary className="cursor-pointer font-semibold">{g.label} · {g.recordIds.length} record{g.recordIds.length === 1 ? '' : 's'}</summary><p className="mt-1 text-xs text-[var(--muted-strong)]">{g.detail}</p><p className="mt-2 break-all font-mono text-xs leading-relaxed">{g.recordIds.join(', ')}</p></details>)}
            {a.evidence.length > 0 && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--teal)]">Evidence</p><ul className="flex flex-wrap gap-2">{a.evidence.map(e => <li key={e.label} className="min-w-0"><Link className={`${button} max-w-full flex-col items-start gap-0 py-2 text-left`} href={e.href}><span>{e.label}</span><span className="break-all text-xs font-normal text-[var(--muted-strong)]">{e.detail}</span></Link></li>)}</ul></div>}
            <p className="break-all border-t border-[var(--border)] pt-3 font-mono text-[11px] leading-relaxed text-[var(--muted)]">{a.answerOrigin} · {a.version} · intent {a.intent ?? 'none'} · {s.fileName} · SHA-256 {s.sha256} · {s.businessId} · {s.period} · {s.currency}</p>
        </div>
    </article>;
}
