'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Search, RefreshCw, LogOut } from 'lucide-react';
import { Panel, PageHeader, EmptyState } from '@/components/ui';
import SourceChart from '@/components/financial-m3/source-chart';
import { M2ClientFence, principalScope, type M2ClientPrincipal } from '@/lib/ai-ingestion/m2-client-state';
import { readSelection, rememberSelection, forgetSelection, browserSelectionStorage } from '@/lib/poc-insights/selection';
import { groupDigits } from '@/lib/poc-anomalies/format';
import type { InsightsQuery } from '@/lib/poc-insights/model';
import type { PocInsights } from '@/lib/server/poc-insights/service';
import type { PocSource } from '@/lib/server/poc-anomalies/service';

type Query = Partial<InsightsQuery> & { source: string };
const auth = '/api/ai-ingestion/m2', api = auth + '/insights';
const scopeKey = (p: M2ClientPrincipal) => JSON.stringify([principalScope(p), p.role, p.membershipVersion]);
const params = (q: Query) => new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
const field = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm';
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
const money = (currency: string, value: string) => `${currency} ${groupDigits(value)}`;

export default function PocInsightsWorkspace({ view }: { view: 'transactions' | 'analytics' }) {
    const fence = useRef(new M2ClientFence()), request = useRef({ sequence: 0 }), authenticating = useRef(false), sessionPaused = useRef(false);
    const [principal, setPrincipal] = useState<M2ClientPrincipal | null>(null), [checked, setChecked] = useState(false);
    const [sources, setSources] = useState<PocSource[] | null>(null), [data, setData] = useState<PocInsights | null>(null);
    const [query, setQuery] = useState<Query | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
    const clear = useCallback(() => { request.current.sequence++; setSources(null); setData(null); setQuery(null); setLoading(false); }, []);
    const invalidate = useCallback(() => {
        forgetSelection(browserSelectionStorage, fence.current.principal); fence.current.invalidate(); clear(); setPrincipal(null);
    }, [clear]);
    const load = useCallback(async (next: Query) => {
        const p = fence.current.principal; if (!p || p.role !== 'Finance') return;
        const epoch = fence.current.epoch, sequence = ++request.current.sequence;
        setQuery(next); setLoading(true); setError(null);
        try {
            const response = await fetch(api + '?' + params(next), { cache: 'no-store' }); if (!response.ok) throw Error();
            const value = await response.json() as PocInsights;
            if (epoch !== fence.current.epoch || sequence !== request.current.sequence) return;
            if (scopeKey(value.scope) !== scopeKey(p) || value.source.id !== next.source || value.version !== 'poc-financial-insights-v1' || value.publicationEligible !== false
                || (next.business && value.selection.businessId !== next.business) || (next.period && value.selection.period !== next.period) || (next.currency && value.selection.currency !== next.currency)) throw Error();
            const selected = { source: value.source.id, business: value.selection.businessId, period: value.selection.period, currency: value.selection.currency };
            rememberSelection(browserSelectionStorage, p, selected); setQuery({ ...next, ...selected }); setData(value);
            history.replaceState(null, '', `/${view}?${params({ ...next, ...selected })}`);
        } catch {
            if (epoch === fence.current.epoch && sequence === request.current.sequence) { setData(null); setError('The selected source or filters are unavailable, or the read could not be authorized and audited. Choose a source or refresh.'); }
        } finally { if (epoch === fence.current.epoch && sequence === request.current.sequence) setLoading(false); }
    }, [view]);
    const refresh = useCallback(async () => {
        const p = fence.current.principal; if (!p || p.role !== 'Finance') return;
        const epoch = fence.current.epoch, sequence = ++request.current.sequence;
        setData(null); setLoading(true); setError(null);
        try {
            const r = await fetch(api + '?action=sources', { cache: 'no-store' }); if (!r.ok) throw Error();
            const list = await r.json() as { scope: M2ClientPrincipal; sources: PocSource[] };
            if (epoch !== fence.current.epoch || sequence !== request.current.sequence) return;
            if (scopeKey(list.scope) !== scopeKey(p)) throw Error();
            setSources(list.sources);
            const chosen = readSelection(browserSelectionStorage, p, location.search) ?? (list.sources[0] ? { source: list.sources[0].id } : null);
            if (chosen && !list.sources.some(s => s.id === chosen.source)) throw Error();
            if (chosen) await load(chosen); else { setQuery(null); setLoading(false); }
        } catch {
            if (epoch === fence.current.epoch && sequence === request.current.sequence) { setData(null); setLoading(false); setError('Source selection is unavailable for this account. Choose an uploaded source or sign in again.'); }
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
        catch { setError('Financial data is cleared. Server sign-out could not be confirmed. Sign in explicitly to establish access again.'); }
    }
    const title = view === 'transactions' ? 'Transactions' : 'Financial analytics';
    if (!checked) return <EmptyState title="Checking local access" description="Financial data stays hidden until the current session is verified." />;
    if (!principal) return <div className="space-y-5"><PageHeader title={title} description="Explore your organization's uploaded synthetic bank source." />
        <Panel title="Finance sign-in"><form className="mx-auto max-w-md space-y-4 p-5" onSubmit={signIn}>
            <label className="block text-sm">Email<input name="email" type="email" autoComplete="username" required className={field} /></label>
            <label className="block text-sm">Password<input name="password" type="password" autoComplete="current-password" required className={field} /></label>
            <button className={button}>Sign in</button>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        </form></Panel></div>;
    if (principal.role !== 'Finance') return <div className="space-y-4"><EmptyState title="Finance access required" description="Technical (Management) and Admin memberships do not grant access to these financial source records." /><button className={button} onClick={signOut}>Sign out</button></div>;
    const current = data && !loading ? data : null;
    const selected = data ? { source: data.source.id, business: data.selection.businessId, period: data.selection.period, currency: data.selection.currency } : query;
    const scopeQuery = selected ? params(selected) : '';
    function select(change: Partial<Query>) { const source = change.source ?? query?.source; if (source) void load({ source, business: query?.business, period: query?.period, currency: query?.currency, ...change, page: 1 }); }
    return <div className="min-w-0 space-y-5">
        <PageHeader title={title} description="Source-backed synthetic bank records and exact cash movements. No live AI inference or financial publication." />
        <div className="flex flex-wrap items-center gap-2 text-sm"><Link className={button} href={`/transactions?${scopeQuery}`}>Transactions</Link><Link className={button} href={`/analytics?${scopeQuery}`}>Analytics</Link><Link className={button} href={`/forecasting?${scopeQuery}`}>Forecasting</Link><Link className={button} href={`/anomalies?${scopeQuery}`}>Anomalies</Link><Link className={button} href={`/anomalies?${scopeQuery}#management-report`}>Management report</Link>
            <button className={button} onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> Refresh</button><button className={button} onClick={signOut}><LogOut size={15} /> Sign out</button></div>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
        <Panel title="Selected bank source" eyebrow="Finance-owned upload"><div className="grid min-w-0 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <label className="min-w-0 text-sm">Source file<select aria-label="Source file" className={field} value={query?.source ?? ''} disabled={loading || !sources?.length} onChange={e => select({ source: e.target.value, business: undefined, period: undefined, currency: undefined })}><option value="" disabled>Choose uploaded source</option>{sources?.map(s => <option key={s.id} value={s.id}>{s.fileName} · {s.rowCount} rows</option>)}</select></label>
            <label className="min-w-0 text-sm">Business<select aria-label="Business" className={field} disabled={loading || !data} value={query?.business ?? ''} onChange={e => select({ business: e.target.value, currency: undefined, period: undefined })}>{data?.options.map(o => <option key={o.businessId} value={o.businessId}>{o.businessId} · {o.businessName}</option>)}</select></label>
            <label className="min-w-0 text-sm">Month<select aria-label="Month" className={field} disabled={loading || !data} value={query?.period ?? ''} onChange={e => select({ period: e.target.value })}>{data?.periods.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="min-w-0 text-sm">Currency<select aria-label="Currency" className={field} disabled={loading || !data} value={query?.currency ?? ''} onChange={e => select({ currency: e.target.value, period: undefined })}>{data?.options.find(o => o.businessId === query?.business)?.currencies.map(c => <option key={c}>{c}</option>)}</select></label>
        </div>{data && !loading && <p className="break-all border-t border-[var(--border)] px-5 py-3 font-mono text-xs text-[var(--muted-strong)]">Uploaded source SHA-256: {data.source.sha256}</p>}</Panel>
        {loading ? <p role="status" className="p-5 text-sm">Loading authorized source records…</p> : !current ? <EmptyState title={sources?.length ? 'No financial source displayed' : 'No bank source uploaded'} description="Upload the supplied March bank statement or the full synthetic source on Anomalies, then return here. Missing or denied data is never displayed as zero financial results." /> : <>
            <Totals data={current} />
            {view === 'transactions' ? <><Panel title="Find source transactions"><form className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const next = Object.fromEntries([...f].filter(([, v]) => v !== '').map(([k, v]) => [k, String(v)])); void load({ ...query!, ...next, search: String(f.get('search') ?? ''), direction: (f.get('direction') || undefined) as Query['direction'], from: String(f.get('from') || '') || undefined, to: String(f.get('to') || '') || undefined, minAmount: String(f.get('minAmount') || '') || undefined, maxAmount: String(f.get('maxAmount') || '') || undefined, page: 1 }); }} key={scopeQuery}>
                <label className="min-w-0 text-sm">Search source rows<input className={field} name="search" defaultValue={query?.search ?? ''} placeholder="Reference, counterparty, ID or description" maxLength={120} /></label>
                <label className="min-w-0 text-sm">Bank direction<select aria-label="Bank direction" name="direction" className={field} defaultValue={query?.direction ?? ''}><option value="">All directions</option><option>Credit</option><option>Debit</option></select></label>
                <label className="min-w-0 text-sm">From date<input className={field} name="from" type="date" defaultValue={query?.from} /></label><label className="min-w-0 text-sm">To date<input className={field} name="to" type="date" defaultValue={query?.to} /></label>
                <label className="min-w-0 text-sm">Min absolute amount<input className={field} name="minAmount" inputMode="decimal" placeholder="0.00" defaultValue={query?.minAmount} /></label><label className="min-w-0 text-sm">Max absolute amount<input className={field} name="maxAmount" inputMode="decimal" placeholder="0.00" defaultValue={query?.maxAmount} /></label>
                <button className={button}><Search size={15} /> Apply filters</button><button type="button" className={button} onClick={() => select({})}>Clear filters</button>
            </form></Panel><TransactionRows data={current} />
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><button className={button} disabled={current.pagination.page === 1} onClick={() => void load({ ...query!, page: current.pagination.page - 1 })}>Previous</button><span>Page {current.pagination.page} of {current.pagination.pages} · {current.pagination.total} filtered rows</span><button className={button} disabled={current.pagination.page >= current.pagination.pages} onClick={() => void load({ ...query!, page: current.pagination.page + 1 })}>Next</button></div></>
                : <><Panel title="Observed monthly bank movement" eyebrow={`${current.series.length} actual source periods · ${current.selection.currency}`}><div className="p-5"><p className="mb-3 text-sm text-[var(--muted-strong)]">History from this uploaded file, selected business and currency. No missing month is invented and no forecast is produced.</p><SourceChart currency={current.selection.currency} points={current.series.map(p => ({ period: p.period, total: p.net, recordCount: p.rows }))} /></div></Panel><EvidenceSummary data={current} query={scopeQuery} /></>}
            <p className="text-xs leading-relaxed text-[var(--muted-strong)]">{current.basis} Rows are uploaded bank source observations, not accepted C1 records or financially publication-eligible V2 facts. CSV record numbers include the header and refer to parsed records, not physical text-line offsets.</p>
        </>}
    </div>;
}

function Totals({ data: d }: { data: PocInsights }) {
    const items = [['Source rows', String(d.totals.rows), `${d.selection.businessId} · ${d.selection.period}`], ['Bank credits', money(d.selection.currency, d.totals.credits), `${d.totals.creditRows} credit rows`], ['Bank debits', money(d.selection.currency, d.totals.debits), `${d.totals.debitRows} debit rows`], ['Net signed movement', money(d.selection.currency, d.totals.net), 'Selected month; not revenue or profit']];
    return <section aria-label="Selected month cash movement" className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map(([label, value, hint]) => <div key={label} className="min-w-0 rounded-xl border border-[var(--border)] bg-white p-5"><p className="text-xs text-[var(--muted-strong)]">{label}</p><p className="my-2 whitespace-nowrap text-xl font-semibold tabular-nums">{value}</p><p className="text-xs text-[var(--muted)]">{hint}</p></div>)}</section>;
}
function TransactionRows({ data: d }: { data: PocInsights }) {
    return <Panel title="Source transactions" eyebrow={`${d.filteredTotals.rows} filtered rows · net ${money(d.selection.currency, d.filteredTotals.net)}`}>
        {!d.transactions.length ? <EmptyState title="No matching source rows" description="The selected month has no rows matching these filters. Clear filters to restore the source view." /> : <>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[920px] text-left text-sm"><thead><tr className="border-b">{['Date / source row', 'Counterparty / description', 'Reference', 'Bank direction', 'Signed amount'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{d.transactions.map(r => <tr key={r.rowId} className="border-b border-[var(--border)]"><td className="p-3"><strong>{r.date}</strong><span className="mt-1 block text-xs">{r.rowId}</span><span className="text-xs text-[var(--muted)]">CSV record {r.csvRecord}</span></td><td className="max-w-xs p-3"><strong>{r.counterparty}</strong><p className="mt-1 break-words text-xs text-[var(--muted-strong)]">{r.description}</p></td><td className="p-3 font-mono text-xs">{r.reference}</td><td className="p-3">{r.direction}</td><td className="whitespace-nowrap p-3 font-semibold tabular-nums">{money(r.currency, r.signedAmount)}</td></tr>)}</tbody></table></div>
            <div className="divide-y md:hidden">{d.transactions.map(r => <article key={r.rowId} className="min-w-0 space-y-2 p-4 text-sm"><div className="flex items-center justify-between gap-2"><span>{r.date}</span><span className="inline-flex items-center gap-1">{r.direction === 'Credit' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}{r.direction}</span></div><p className="break-words font-semibold">{r.counterparty}</p><p className="font-semibold tabular-nums">{money(r.currency, r.signedAmount)}</p><p className="break-all text-xs">{r.rowId} · CSV record {r.csvRecord}</p><p className="break-all text-xs">Ref {r.reference}</p><p className="break-words text-xs text-[var(--muted-strong)]">{r.description}</p></article>)}</div>
        </>}
    </Panel>;
}
function EvidenceSummary({ data: d, query }: { data: PocInsights; query: string }) {
    return <div className="grid min-w-0 gap-4 lg:grid-cols-2"><Panel title="Anomaly review candidates"><div className="space-y-3 p-5 text-sm"><p className="text-3xl font-semibold">{d.anomalies.candidates}</p><p>{d.anomalies.high} high · {d.anomalies.medium} medium · selected month</p><p>Existing deterministic rules over this uploaded source, not fraud findings or live AI. Different source populations can produce different review counts.</p><Link className={button} href={`/anomalies?${query}`}>Inspect source explanations</Link></div></Panel>
        <Panel title="Source-bound reconciliation"><div className="space-y-3 p-5 text-sm">{d.reconciliation.status === 'AVAILABLE' ? <><p className="font-semibold text-teal-800">Exact uploaded bank source matched</p><dl className="space-y-2">{Object.entries(d.reconciliation.snapshot.cashMovement).map(([label, amount]) => <div className="flex flex-wrap justify-between gap-2" key={label}><dt>{label === 'signedDifference' ? 'Bank − ledger' : label === 'bank' ? 'Bank movement' : 'Ledger movement'}</dt><dd className="font-semibold tabular-nums">{money(d.selection.currency, amount)}</dd></div>)}</dl><p>All seven outcome categories remain source-linked in Reconciliation and the management PDF.</p><Link className={button} href="/reconciliation">Inspect reconciliation</Link></> : <p>Reconciliation unavailable. {d.reconciliation.reason} Matching month or totals alone cannot establish source identity.</p>}<Link className={button} href={`/anomalies?${query}#management-report`}>Open management report</Link></div></Panel></div>;
}
