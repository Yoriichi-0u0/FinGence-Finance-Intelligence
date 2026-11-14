'use client';
import GPTSuggestions from '@/components/reconciliation/gpt-suggestions';
import Link from 'next/link';
import { useTechnicalDetail } from '@/components/workspace/context';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, ChartNoAxesCombined, ChevronRight, Download, Flag, MessageSquareText, Printer, ReceiptText, RefreshCw, Search, Send, ShieldCheck, SlidersHorizontal, Sparkles, TrendingUp } from 'lucide-react';
import { LineChart } from '@/components/charts';
import { PageHeader, Panel } from '@/components/ui';
import { RULES, type RuleId } from '@/lib/poc-anomalies/detector';
import { fromCents, toCents } from '@/lib/poc-anomalies/source';
import { cashTotals } from '@/lib/poc-insights/model';
import { reconciliationStatuses, type ReconciliationStatus } from '@/lib/poc-reconciliation/contracts';
import { answerQuestion, suggestions, MAX_QUESTION, type QaAnswer } from '@/lib/poc-finance-qa/answer';
import { qaFacts } from '@/lib/demo/questions';
import { askGrounded, gatewayQaModel, qaGatewayStatus, type GroundedRun, type QaGatewayStatus } from '@/lib/grounded-qa/client';
import { groundingIndex } from '@/lib/grounded-qa/tools';
import { renderedText } from '@/lib/grounded-qa/commentary';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { GroundedAnswer } from './grounded-answer';
import { ReconciliationStatementPanel } from './reconciliation-statement';
import { ReconciliationOutcomePanel } from './reconciliation-outcome';
import { CATEGORY_LABEL as STATEMENT_LABEL } from '@/lib/poc-reconciliation/statement';
import { AiCommentary } from './commentary';
import { MlChallenger } from './ml-forecast';
import { useDemoProcessing } from './context';
import { AtAGlanceCard, CounterpartiesCard, DashboardEditor, LastRunsCard, ReconciliationSummaryCard, useDashboardLayout, type GlanceTile } from './dashboard';
import { ConfidenceCard, CONFIDENCE_DEFINITION } from './confidence';
import { processingConfidence } from '@/lib/confidence';
import { cardSpans, offered, type CardId, type Layout } from '@/lib/dashboard/layout';
import { Callout, DecisionBadge, SourceStrip, Stat, Table, Unavailable, resultsEyebrow, button, chip, field, usesOwnDocuments, money, outflow, periodLabel, primaryButton } from './shared';

export type DemoView = 'overview' | 'transactions' | 'reconciliation' | 'analytics' | 'anomalies' | 'forecasting' | 'reports' | 'ask';
type Ready = ProcessingContext & { scope: NonNullable<ProcessingContext['scope']>; outputs: ProcessingContext['outputs'] & { reconciliation: NonNullable<ProcessingContext['outputs']['reconciliation']>; totals: NonNullable<ProcessingContext['outputs']['totals']>; forecast: NonNullable<ProcessingContext['outputs']['forecast']>; report: NonNullable<ProcessingContext['outputs']['report']> } };
export const isReady = (c: ProcessingContext | null): c is Ready => !!c?.scope && !!c.outputs.reconciliation && !!c.outputs.totals && !!c.outputs.forecast && !!c.outputs.report;

const STATUS_LABEL: Record<ReconciliationStatus, string> = { MATCH_EXACT: 'Exact match', MATCH_DATE_SHIFT: 'Posting-date shift', BANK_ONLY: 'Bank only', LEDGER_ONLY: 'Ledger only', AMOUNT_MISMATCH_REVIEW: 'Amount review', AMBIGUOUS_DUPLICATE_LEDGER: 'Duplicate ambiguity', REFERENCE_MISMATCH_REVIEW: 'Reference review' };
const matched = (s: ReconciliationStatus) => s === 'MATCH_EXACT' || s === 'MATCH_DATE_SHIFT';
const PAGE = 20;
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    return <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5 text-xs sm:px-4"><button type="button" className={`${button} min-h-10 px-3`} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button><span className="text-center text-[var(--muted-strong)]">Page {page + 1} of {pages} · {total} rows</span><button type="button" className={`${button} min-h-10 px-3`} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</button></div>;
}

/** A signed amount: money in is tinted green and money out stays neutral, so direction reads at a glance; the sign is kept. */
function Amount({ currency, value }: { currency: string; value: string }) {
    return <span className={`whitespace-nowrap font-medium tabular-nums ${value.startsWith('-') ? 'text-[var(--muted-strong)]' : 'text-[var(--good-ink)]'}`}>{money(currency, value)}</span>;
}

/** Cumulative net bank movement by day: where the cash position stood through the period. */
function dailyCumulative(rows: Ready['outputs']['bankRows']) {
    const map = new Map<string, bigint>(); for (const r of rows) map.set(r.date, (map.get(r.date) ?? 0n) + toCents(r.signedAmount));
    const points: { d: string; v: number }[] = []; let total = 0n;
    for (const [d, v] of [...map.entries()].sort()) { total += v; points.push({ d, v: Number(total) / 100 }); }
    return points;
}
/** Monthly cash in and out: the accepted history, or else the statement's own months when it covers more than one. */
function monthlyTotals(c: Ready) {
    const o = c.outputs, s = c.scope;
    const rows = o.history.accepted ? o.history.rows : s.months.length > 1 ? o.bankRows : [], months = o.history.accepted ? o.history.months : s.months.length > 1 ? s.months : [];
    return months.map(p => ({ p, ...cashTotals(rows.filter(r => r.period === p)) }));
}

type Attention = { tone: 'warn' | 'brand'; title: string; detail: string; href: string };

function Overview({ c, layout: initial }: { c: Ready; layout?: Layout }) {
    const { scope: s, outputs: o } = c, r = o.reconciliation, f = o.forecast.forecast, ar = o.anomalyResolution;
    const checks = c.stages.flatMap(x => x.checks), passedChecks = checks.filter(k => k.passed).length;
    const matchedCount = r.counts.MATCH_EXACT + r.counts.MATCH_DATE_SHIFT, rate = r.results.length ? Math.round((matchedCount / r.results.length) * 100) : 0;
    const days = useMemo(() => dailyCumulative(o.bankRows), [o.bankRows]), months = monthlyTotals(c);
    const unexplained = o.resolution?.attention.length ?? c.quarantine.filter(q => q.kind === 'RECONCILIATION_EXCEPTION').length;
    const flaggedAnomalies = ar?.flagged ?? o.anomalies.length, entries = o.resolution?.totals.entries ?? 0;
    const unusedDocuments = c.quarantine.filter(q => q.kind === 'DOCUMENT' || q.kind === 'HISTORY').length;
    const attention: Attention[] = [
        ...(unexplained ? [{ tone: 'warn' as const, title: `${unexplained} reconciliation item${unexplained === 1 ? '' : 's'} not explained`, detail: o.resolution ? `${money(s.currency, o.resolution.totals.unexplained.replace(/^-/, ''))} in total. Flagged for your technical team.` : 'Flagged for your technical team.', href: '/reconciliation' }] : []),
        ...(flaggedAnomalies ? [{ tone: 'warn' as const, title: `${flaggedAnomalies} unusual bank record${flaggedAnomalies === 1 ? '' : 's'} flagged`, detail: 'Your books could not settle them. Flagged for your technical team, not treated as fact.', href: '/anomalies' }] : []),
        ...(unusedDocuments ? [{ tone: 'warn' as const, title: `${unusedDocuments} document${unusedDocuments === 1 ? '' : 's'} could not be used`, detail: 'See the reason on Data.', href: '/data' }] : []),
        ...(entries ? [{ tone: 'brand' as const, title: `${entries} correcting entr${entries === 1 ? 'y' : 'ies'} prepared for your books`, detail: 'Prepared from stated rules, not posted. Download them on Reconciliation.', href: '/reconciliation' }] : []),
    ];
    const warnings = attention.filter(a => a.tone === 'warn').length;
    // One line per results page, for "Your results at a glance".
    const top = useMemo(() => { const by = new Map<string, { cents: bigint; n: number }>(); for (const row of o.bankRows) { const t = by.get(row.counterparty) ?? { cents: 0n, n: 0 }, v = toCents(row.signedAmount); by.set(row.counterparty, { cents: t.cents + (v < 0n ? -v : v), n: t.n + 1 }); } return [...by.entries()].sort((a, b) => (b[1].cents > a[1].cents ? 1 : b[1].cents < a[1].cents ? -1 : a[0].localeCompare(b[0])))[0] ?? null; }, [o.bankRows]);
    const tiles: GlanceTile[] = [
        { href: '/transactions', label: 'Transactions', icon: <ReceiptText aria-hidden="true" size={14} />, value: `${o.totals.rows} bank records`, detail: `${o.ledger?.rows.length ?? 0} ledger entries · ${o.totals.creditRows} in, ${o.totals.debitRows} out` },
        { href: '/reconciliation', label: 'Reconciliation', icon: <RefreshCw aria-hidden="true" size={14} />, value: `${rate}% matched automatically`, detail: [
            ...(unexplained && o.resolution ? [`${money(s.currency, o.resolution.totals.unexplained.replace(/^-/, ''))} not explained (${unexplained} item${unexplained === 1 ? '' : 's'})`] : []),
            // A month only one document covers is never reconciled: say so, and never claim everything was explained.
            ...(o.notReconciled.length ? [`Not reconciled: ${o.notReconciled.map(n => `${periodLabel(n.period)} (${n.side === 'BANK' ? 'bank statement only' : 'books only'})`).join(', ')}`] : []),
        ].join(' · ') || 'Every difference matched or explained' },
        { href: '/analytics', label: 'Analytics', icon: <ChartNoAxesCombined aria-hidden="true" size={14} />, value: top ? top[0] : 'No counterparties', detail: top ? `Largest counterparty · ${money(s.currency, fromCents(top[1].cents))} across ${top[1].n} record${top[1].n === 1 ? '' : 's'}` : 'No bank records' },
        { href: '/anomalies', label: 'Anomalies', icon: <AlertTriangle aria-hidden="true" size={14} />, value: flaggedAnomalies ? `${flaggedAnomalies} flagged` : 'None flagged', detail: ar ? `${ar.corroborated} unusual record${ar.corroborated === 1 ? '' : 's'} confirmed by your books` : `${o.anomalies.length} rule-based candidates` },
        { href: '/forecasting', label: 'Forecasting', icon: <TrendingUp aria-hidden="true" size={14} />, value: f.status === 'AVAILABLE' ? money(s.currency, f.net) : 'Not available yet', detail: f.status === 'AVAILABLE' ? `Expected net, ${periodLabel(f.period)}` : 'Needs seven months of bank history' },
        { href: '/ask', label: 'Finance Q&A', icon: <MessageSquareText aria-hidden="true" size={14} />, value: 'Ask a question', detail: 'Answers come only from these figures' },
    ];
    const dashboard = useDashboardLayout(initial);
    const [draft, setDraft] = useState<Layout | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null), [status, setStatus] = useState('');
    const customise = useRef<HTMLButtonElement>(null), editing = draft !== null, shown = draft ?? dashboard.layout;
    const close = () => { setDraft(null); setError(null); requestAnimationFrame(() => customise.current?.focus()); };
    const done = async () => {
        if (!draft) return;
        setSaving(true); setError(null);
        const failed = await dashboard.save(draft);
        setSaving(false);
        if (failed) { setError(failed); return; }
        setStatus(dashboard.where === 'workspace' ? 'Layout saved. It follows you on any device.' : 'Layout saved in this browser.');
        close();
    };
    const cards: Record<CardId, ReactNode> = {
        figures: <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat tone="brand" label="Cash in" value={money(s.currency, o.totals.credits)} detail={`${o.totals.creditRows} bank receipts`} />
            <Stat tone="plain" label="Cash out" value={outflow(s.currency, o.totals.debits)} detail={`${o.totals.debitRows} bank payments`} />
            <Stat tone="brand" label="Net movement" value={money(s.currency, o.totals.net)} detail="Cash in minus cash out" />
            <Stat tone="good" label="Reconciled automatically" value={`${rate}%`} detail={`${matchedCount} of ${r.results.length} records matched${o.resolution ? ` · ${o.resolution.totals.timing + o.resolution.totals.resolutions.ENTRY_PREPARED} differences resolved` : ''}`} />
        </div>,
        'cash-chart': months.length > 1
            ? <Panel className="h-full" title="Cash in and out by month" eyebrow={o.history.accepted ? 'Verified bank history' : 'Statement months'} action={<Link href="/analytics" className="text-xs font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-line)] underline-offset-2">Analytics</Link>}>
                <div className="p-3 sm:p-4"><LineChart ariaLabel="Monthly bank cash in and cash out" labels={months.map(m => m.p.slice(2))} series={[{ label: 'Cash in', color: 'var(--chart-in)', values: months.map(m => Number(m.credits)) }, { label: 'Cash out', color: 'var(--chart-out)', values: months.map(m => -Number(m.debits)) }]} /></div>
            </Panel>
            : <Panel className="h-full" title={`Cash position through ${periodLabel(s.period)}`} eyebrow="Running net movement, by day" action={<Link href="/analytics" className="text-xs font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-line)] underline-offset-2">Analytics</Link>}>
                <div className="p-3 sm:p-4"><LineChart ariaLabel={`Running net bank movement by day in ${periodLabel(s.period)}`} labels={days.map(x => s.months.length > 1 ? x.d.slice(5) : x.d.slice(8))} series={[{ label: 'Running net movement', color: 'var(--chart-in)', values: days.map(x => x.v), fill: true }]} /></div>
            </Panel>,
        flagged: <Panel className="h-full" title={warnings ? 'Flagged by FinGence' : 'Nothing flagged'} eyebrow={warnings ? `${warnings} to know about` : 'All clear'}>
            {attention.length ? <ul className="divide-y divide-[var(--border)]">{attention.map(a => <li key={a.title}><Link href={a.href} className="group flex min-h-16 items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-subtle)] sm:px-5">
                <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${a.tone === 'warn' ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--brand-soft)] text-[var(--brand)]'}`}>{a.tone === 'warn' ? <Flag aria-hidden="true" size={16} /> : <ReceiptText aria-hidden="true" size={16} />}</span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{a.title}</span><span className="block text-xs leading-relaxed text-[var(--muted)]">{a.detail}</span></span>
                <ChevronRight aria-hidden="true" size={16} className="mt-1 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5" />
            </Link></li>)}</ul> : null}
            {warnings ? null : <p className="flex items-start gap-2.5 px-4 py-3.5 text-sm text-[var(--muted-strong)] sm:px-5"><ShieldCheck aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[var(--good)]" />FinGence explained every difference with a stated rule. Nothing was sent to your technical team.</p>}
        </Panel>,
        forecast: <Stat tone="plain" label="Next month, expected net" value={f.status === 'AVAILABLE' ? money(s.currency, f.net) : 'Not available yet'} detail={f.status === 'AVAILABLE' ? `${periodLabel(f.period)} · average of the last six months` : f.detail} />,
        checks: <details className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-panel)]">
            <summary className="flex min-h-12 cursor-pointer items-center gap-2.5 px-4 py-3 text-sm sm:px-5">
                <ChevronRight aria-hidden="true" size={16} className="disclosure-chevron shrink-0 text-[var(--muted)] transition-transform" />
                <ShieldCheck aria-hidden="true" size={17} className="shrink-0 text-[var(--good)]" />
                <span className="font-semibold">How FinGence checked these figures</span>
                <span className="ml-auto text-xs text-[var(--muted)] tabular-nums">{passedChecks} of {checks.length} checks passed</span>
            </summary>
            <div className="space-y-3 border-t border-[var(--border)] p-4 text-sm sm:p-5">
                <p className="text-[var(--muted-strong)]">{c.stages.filter(x => x.decision === 'AUTO_ACCEPTED').length} of {c.stages.length} stages passed their automated checks. No manual approval was needed; anything FinGence could not explain is flagged, never treated as fact.</p>
                <ol className="grid gap-1.5 sm:grid-cols-2">{c.stages.map((x, i) => <li key={x.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-[var(--surface-subtle)] px-3 py-2 ring-1 ring-inset ring-[var(--border)]"><span className="w-4 text-xs font-semibold text-[var(--muted)] tabular-nums">{i + 1}</span><span className="min-w-0 flex-1 text-[13px] font-medium">{x.title}</span><DecisionBadge decision={x.decision} label={x.decision === 'AUTO_ACCEPTED' ? 'Verified' : undefined} /></li>)}</ol>
            </div>
        </details>,
        counterparties: <CounterpartiesCard currency={s.currency} rows={o.bankRows} />,
        'reconciliation-summary': <ReconciliationSummaryCard currency={s.currency} counts={r.counts} records={r.results.length} resolution={o.resolution} />,
        'last-runs': <LastRunsCard />,
        confidence: <ConfidenceCard context={c} className="shadow-[var(--shadow-panel)]" />,
        'at-a-glance': <AtAGlanceCard tiles={tiles} report={{ detail: `Management summary for ${s.businessName}, ${periodLabel(s.period)}: every figure, the reconciliation statement, flagged items and the processing confidence.` }} />,
    };
    const visible = offered(shown, dashboard.admin).filter(x => x.visible), spans = cardSpans(visible.map(x => x.id));
    return <>
        <PageHeader eyebrow={`Overview · ${periodLabel(s.period)}`} title={s.businessName} description={`Cash movement and reconciliation for ${periodLabel(s.period)}, in ${s.currency}.`}
            actions={editing ? null : <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:justify-end">
                <p role="status" className="text-xs text-[var(--muted)]">{dashboard.failed ? <>Your saved layout could not be loaded, so the default is shown. <button type="button" className="inline-flex min-h-10 items-center font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-line)] underline-offset-2" onClick={dashboard.retry}>Try again</button></> : status}</p>
                <button ref={customise} type="button" className={button} disabled={!dashboard.ready || dashboard.failed} onClick={() => { setStatus(''); setDraft(dashboard.layout); }}><SlidersHorizontal aria-hidden="true" size={16} />Customise dashboard</button>
            </div>} />
        <SourceStrip context={c} />
        {editing ? <DashboardEditor draft={draft} admin={dashboard.admin} where={dashboard.where} saving={saving} error={error} onChange={update => { if (!saving) setDraft(d => d && update(d)); }} onDone={() => void done()} onCancel={close} /> : null}
        {!dashboard.ready ? <div aria-busy="true" aria-label="Loading your dashboard" className="min-h-[40vh]" />
            : visible.length ? <div className="grid min-w-0 gap-5 xl:grid-cols-3">{visible.map((x, i) => <div key={x.id} data-card={x.id} className={`grid min-w-0 ${spans[i]}`}>{cards[x.id]}</div>)}</div>
            : <p className="rounded-2xl border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-sm text-[var(--muted-strong)]">Every card is hidden. Use Customise dashboard to show them again.</p>}
        <p className="mt-4 text-xs text-[var(--muted)]">Bank cash movement is not revenue, expenses or profit. No accounting classification is inferred from bank receipts or payments.</p>
    </>;
}

function Transactions({ c }: { c: Ready }) {
    const [tab, setTab] = useState<'bank' | 'ledger'>('bank'), [search, setSearch] = useState(''), [direction, setDirection] = useState(''), [page, setPage] = useState(0);
    const q = search.trim().toLowerCase(), s = c.scope;
    const bank = c.outputs.bankRows.filter(r => (!direction || r.direction === direction) && (!q || [r.rowId, r.description, r.counterparty, r.reference].some(v => v.toLowerCase().includes(q))));
    const ledger = (c.outputs.ledger?.rows ?? []).filter(r => (!direction || (direction === 'Credit') === !r.signedCents.startsWith('-')) && (!q || [r.recordId, r.description, r.reference].some(v => v.toLowerCase().includes(q))));
    const totals = cashTotals(bank), rows = tab === 'bank' ? bank.length : ledger.length;
    return <>
        <PageHeader eyebrow={resultsEyebrow(s)} title="Transactions" description="Every bank and ledger record FinGence read and checked." />
        <SourceStrip context={c} />
        <div className="mb-5 grid gap-3 sm:grid-cols-3"><Stat tone="brand" label="Cash in" value={money(s.currency, totals.credits)} detail={`${totals.creditRows} bank receipts shown`} /><Stat tone="plain" label="Cash out" value={outflow(s.currency, totals.debits)} detail={`${totals.debitRows} bank payments shown`} /><Stat tone="brand" label="Net movement" value={money(s.currency, totals.net)} detail={`${totals.rows} of ${c.outputs.bankRows.length} bank records`} /></div>
        <Panel>
            <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 lg:flex-row lg:items-end">
                <div role="tablist" aria-label="Document" className="flex gap-2">{(['bank', 'ledger'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={chip(tab === t)} onClick={() => { setTab(t); setPage(0); }}>{t === 'bank' ? 'Bank statement' : 'General ledger'}</button>)}</div>
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <label className="relative grid min-w-0 gap-1 text-xs font-medium text-[var(--muted-strong)]"><span className="sr-only sm:not-sr-only">Search</span><Search aria-hidden="true" size={16} className="pointer-events-none absolute bottom-3.5 left-3 text-[var(--muted)]" /><input className={`${field} pl-9`} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="ID, description, counterparty or reference" /></label>
                    <label className="grid gap-1 text-xs font-medium text-[var(--muted-strong)]"><span className="sr-only sm:not-sr-only">Direction</span><select className={`${field} w-auto pr-8`} value={direction} onChange={e => { setDirection(e.target.value); setPage(0); }}><option value="">All</option><option value="Credit">Cash in</option><option value="Debit">Cash out</option></select></label>
                </div>
            </div>
            {tab === 'bank' ? <Table caption="Bank statement records" numeric={[4]} columns={['Date', 'Record', 'Description', 'Counterparty', 'Signed amount']} rows={bank.slice(page * PAGE, page * PAGE + PAGE).map(r => [r.date, <span key="i" className="whitespace-nowrap text-xs">{r.rowId}</span>, <span key="d" className="text-xs">{r.description}</span>, r.counterparty, <Amount key="a" currency={r.currency} value={r.signedAmount} />])} />
                : <Table caption="General ledger cash entries" numeric={[4]} columns={['Posting date', 'Entry', 'Memo', 'Reference', 'Signed amount']} rows={ledger.slice(page * PAGE, page * PAGE + PAGE).map(r => [r.date, <span key="i" className="whitespace-nowrap text-xs">{r.recordId}</span>, <span key="d" className="text-xs">{r.description}</span>, <span key="r" className="text-xs">{r.reference}</span>, <Amount key="a" currency={r.currency} value={fromCents(BigInt(r.signedCents))} />])} />}
            <Pager page={page} total={rows} onPage={setPage} />
        </Panel>
    </>;
}

function Reconciliation({ c }: { c: Ready }) {
    const r = c.outputs.reconciliation, s = c.scope, [filter, setFilter] = useState<ReconciliationStatus | 'EXCEPTIONS' | 'ALL'>('EXCEPTIONS'), [page, setPage] = useState(0), [open, setOpen] = useState<number | null>(null);
    const periods = c.outputs.periods, multi = periods.length > 1, [month, setMonth] = useState(periods.length - 1);
    // Every outcome keeps the month it was reconciled in; a multi-month run lists them all with that month.
    const outcomes = periods.length ? periods.flatMap(p => p.snapshot.results.map(x => ({ ...x, period: p.period }))) : r.results.map(x => ({ ...x, period: s.period }));
    const visible = outcomes.filter(x => filter === 'ALL' || (filter === 'EXCEPTIONS' ? !matched(x.status) : x.status === filter)), chosen = open === null ? null : visible[open];
    const statement = multi ? periods[month]?.statement : c.outputs.statement ?? periods[0]?.statement;
    return <>
        <PageHeader eyebrow={resultsEyebrow(s)} title="Reconciliation" description="Your bank statement matched against your books, with every difference explained or flagged." />
        <SourceStrip context={c} />
        {c.outputs.resolution ? <div className="mb-5"><ReconciliationOutcomePanel outcome={c.outputs.resolution} /></div> : null}
        <div className="mb-5 grid gap-3 sm:grid-cols-3"><Stat tone="brand" label="Bank cash movement" value={money(s.currency, r.cashMovement.bank)} detail={multi ? `${periods.length} reconciled months` : undefined} /><Stat tone="brand" label="Ledger cash movement" value={money(s.currency, r.cashMovement.ledger)} /><Stat tone={periods.every(p => p.statement.explained) ? 'good' : 'warn'} label="Bank − ledger difference" value={money(s.currency, r.cashMovement.signedDifference)} detail={periods.every(p => p.statement.explained) ? 'Explained by the reconciling items below' : 'Cause is not inferred'} /></div>
        {c.outputs.notReconciled.length ? <p className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">Not reconciled, because only one document covers {c.outputs.notReconciled.length === 1 ? 'this month' : 'these months'}: {c.outputs.notReconciled.map(n => `${periodLabel(n.period)} (${n.side === 'BANK' ? 'bank statement only' : 'books only'}, ${n.records} records)`).join('; ')}. These records are shown, never matched against nothing.</p> : null}
        {multi ? <div role="tablist" aria-label="Statement month" className="mb-3 flex flex-wrap items-center gap-2"><span className="mr-1 text-xs font-semibold text-[var(--muted)]">Statement for</span>{periods.map((p, i) => <button key={p.period} type="button" role="tab" aria-selected={month === i} className={chip(month === i)} onClick={() => setMonth(i)}>{periodLabel(p.period)}</button>)}</div> : null}
        {statement ? <div className="mb-5"><ReconciliationStatementPanel statement={statement} /></div> : null}
        <GPTSuggestions batchId={c.processingId}/>
        <h2 className="mb-3 mt-7 text-lg font-semibold tracking-[-0.02em]">Every record, matched</h2>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{reconciliationStatuses.map(k => <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setPage(0); setOpen(null); }} className={`min-h-11 rounded-xl border p-3 text-left transition-colors ${filter === k ? 'border-[var(--brand)] bg-[var(--brand-soft)] shadow-[inset_0_0_0_1px_var(--brand)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand-line)]'} ${r.counts[k] ? '' : 'opacity-60'}`}><span className="block text-xs text-[var(--muted-strong)]">{STATUS_LABEL[k]}</span><span className="text-xl font-semibold tabular-nums">{r.counts[k]}</span></button>)}</div>
        <div className="mb-3 flex flex-wrap gap-2">{([['EXCEPTIONS', 'Matcher exceptions'], ['ALL', 'All outcomes']] as const).map(([k, label]) => <button key={k} type="button" className={chip(filter === k)} onClick={() => { setFilter(k); setPage(0); setOpen(null); }}>{label}</button>)}</div>
        <Panel>
            <Table caption="Reconciliation outcomes" columns={[...(multi ? ['Month'] : []), 'Outcome', 'Bank record', 'Ledger record(s)', 'Reason', 'Evidence']} rows={visible.slice(page * PAGE, page * PAGE + PAGE).map((x, i) => [
                ...(multi ? [<span key="m" className="whitespace-nowrap text-xs">{x.period}</span>] : []),
                <DecisionBadge key="s" decision={matched(x.status) ? 'AUTO_ACCEPTED' : 'QUARANTINED'} label={STATUS_LABEL[x.status]} />, <span key="b" className="whitespace-nowrap text-xs">{x.bankRecordId ?? '—'}</span>, <span key="l" className="text-xs">{x.ledgerRecordIds.length ? x.ledgerRecordIds.map(id => <span key={id} className="block whitespace-nowrap">{id}</span>) : '—'}</span>, <span key="r" className="text-xs">{x.reason}</span>,
                <button key="e" type="button" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[var(--brand-ink)] hover:bg-[var(--brand-soft)]" onClick={() => setOpen(page * PAGE + i)}>Inspect<ArrowRight aria-hidden="true" size={13} /></button>])} />
            <Pager page={page} total={visible.length} onPage={p => { setPage(p); setOpen(null); }} />
        </Panel>
        {chosen ? <div className="mt-4"><Panel title={`${STATUS_LABEL[chosen.status]} · source evidence`}><div className="grid gap-3 p-4 md:grid-cols-2">{(['bank', 'ledger'] as const).map(kind => <section key={kind} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3"><h3 className="text-sm font-semibold">{kind === 'bank' ? 'Bank statement' : 'General ledger'}</h3>
            {(kind === 'bank' ? chosen.bankEvidenceIds : chosen.ledgerEvidenceIds).filter(id => /:(BankTransactionID|LedgerEntryID|ValueDate|PostingDate|BankReference|LedgerReference|SignedCashMovementMYR|BankDescription|LedgerMemo)$/.test(id)).map(id => { const e = r.evidence[id]; return <p key={id} className="mt-2 break-all text-xs"><strong>CSV record {e.row} · {e.field}</strong>: {e.literal}</p>; })}
            {!(kind === 'bank' ? chosen.bankEvidenceIds : chosen.ledgerEvidenceIds).length ? <p className="mt-2 text-xs text-[var(--muted)]">No record on this side.</p> : null}</section>)}</div></Panel></div> : null}
        <p className="mt-4 text-xs text-[var(--muted)]">{multi ? 'Each calendar month is matched separately; timing differences are then linked across months. ' : ''}Matcher rule: a unique reference with equal signed cents within two days matches; every other record is an exception, which the reconciliation layer then resolves by the rules shown above. The matcher outcomes in this table are never changed.</p>
    </>;
}

function Analytics({ c }: { c: Ready }) {
    const s = c.scope, o = c.outputs, days = useMemo(() => dailyCumulative(o.bankRows), [o.bankRows]);
    const months = monthlyTotals(c), multi = s.months.length > 1;
    const parties = useMemo(() => { const map = new Map<string, { in: bigint; out: bigint; n: number }>(); for (const r of o.bankRows) { const e = map.get(r.counterparty) ?? { in: 0n, out: 0n, n: 0 }; const v = toCents(r.signedAmount); if (v >= 0n) e.in += v; else e.out += v; e.n++; map.set(r.counterparty, e); } return [...map.entries()].sort((a, b) => Number((b[1].in - b[1].out) - (a[1].in - a[1].out))).slice(0, 8); }, [o.bankRows]);
    return <>
        <PageHeader eyebrow={resultsEyebrow(s)} title="Analytics" description="Where cash came from and went, from the checked bank records." />
        <SourceStrip context={c} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat tone="brand" label="Cash in" value={money(s.currency, o.totals.credits)} detail={`${o.totals.creditRows} bank receipts`} /><Stat tone="plain" label="Cash out" value={outflow(s.currency, o.totals.debits)} detail={`${o.totals.debitRows} bank payments`} /><Stat tone="brand" label="Net movement" value={money(s.currency, o.totals.net)} /><Stat label="Observed months" value={String(o.history.accepted ? o.history.months.length : s.months.length)} detail={o.history.accepted ? `${o.history.months[0]} to ${o.history.months.at(-1)}` : multi ? `${s.months[0]} to ${s.months.at(-1)}` : 'Statement month only'} /></div>
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
            <Panel title={`Cash position through ${periodLabel(s.period)}`} eyebrow="Running net movement, by day"><div className="p-3 sm:p-4"><LineChart ariaLabel={`Cumulative net bank movement by day in ${periodLabel(s.period)}`} labels={days.map(x => multi ? x.d.slice(5) : x.d.slice(8))} series={[{ label: 'Running net movement', color: 'var(--chart-in)', values: days.map(x => x.v), fill: true }]} formatValue={v => `${Math.round(v / 1000)}K`} /></div></Panel>
            {months.length ? <Panel title="Cash in and out by month" eyebrow={o.history.accepted ? 'Verified history' : 'Statement months'}><div className="p-3"><LineChart ariaLabel="Monthly cash in, cash out and net" labels={months.map(m => m.p.slice(2))} series={[{ label: 'Cash in', color: 'var(--chart-in)', values: months.map(m => Number(m.credits)) }, { label: 'Cash out', color: 'var(--chart-out)', values: months.map(m => -Number(m.debits)) }, { label: 'Net', color: 'var(--chart-net)', values: months.map(m => Number(m.net)), dashed: true }]} /></div></Panel>
                : <Unavailable title="No monthly trend yet" detail="Only the statement month is available. Add a bank history file on Data to see month-by-month cash." action={{ href: '/data', label: 'Open Data' }} />}
        </div>
        <div className="mt-5"><Panel title="Largest counterparties" eyebrow={multi ? 'Statement period' : 'Statement month'}><Table caption="Counterparties" numeric={[1, 2, 3]} columns={['Counterparty', 'Records', 'Cash in', 'Cash out']} rows={parties.map(([name, e]) => { const total = Number(e.in - e.out) || 1; return [<span key="n" className="grid gap-1.5"><span>{name}</span><span aria-hidden="true" className="flex h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-[var(--surface-sunken)]"><span className="bg-[var(--chart-in)]" style={{ width: `${(Number(e.in) / total) * 100}%` }} /><span className="bg-[var(--chart-out)]" style={{ width: `${(Number(-e.out) / total) * 100}%` }} /></span></span>, e.n, <span key="i" className="whitespace-nowrap tabular-nums">{money(s.currency, fromCents(e.in))}</span>, <span key="o" className="whitespace-nowrap tabular-nums">{outflow(s.currency, fromCents(e.out))}</span>]; })} /></Panel></div>
        <p className="mt-4 text-xs text-[var(--muted)]">Receipts and payments are bank cash directions, not revenue or expenses; no ratios or profitability are derived without an accounting classification.</p>
    </>;
}

function Anomalies({ c }: { c: Ready }) {
    const list = c.outputs.anomalies, ids = Object.keys(RULES) as RuleId[], ar = c.outputs.anomalyResolution;
    const resolved = ar?.items ?? list.map(x => ({ ...x, resolution: 'FLAGGED' as const, summary: x.findings.map(f => f.rationale).join(' '), rule: '', booked: null }));
    const groups = [['FLAGGED', 'Flagged for your technical team'], ['CORROBORATED_BY_BOOKS', 'Confirmed by your books: no action needed']] as const;
    return <>
        <PageHeader eyebrow={resultsEyebrow(c.scope)} title="Anomalies" description="Unusual bank records, each checked against your books. A finding is never a fraud conclusion." />
        <SourceStrip context={c} />
        {ar ? <Callout role="status" tone={ar.flagged ? 'warn' : 'good'} className="mb-5">{ar.summary}</Callout> : null}
        <div className="grid gap-3 sm:grid-cols-3"><Stat tone="brand" label="Unusual records found" value={`${list.length} of ${c.outputs.bankRows.length}`} detail="Rows with at least one rule finding" /><Stat tone="good" label="Confirmed by your books" value={String(ar?.corroborated ?? 0)} detail="Recorded in the ledger with the same amount" /><Stat tone={(ar?.flagged ?? list.length) ? 'warn' : 'good'} label="Flagged for attention" value={String(ar?.flagged ?? list.length)} detail="Sent to the technical team, not to Finance" /></div>
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel title="What FinGence found and did">{resolved.length ? groups.filter(([g]) => resolved.some(x => x.resolution === g)).map(([g, title]) => <section key={g} className="border-b border-[var(--border)] last:border-b-0">
                <h3 className={`flex items-center gap-2 px-4 pt-4 text-sm font-semibold sm:px-5 ${g === 'FLAGGED' ? 'text-[var(--warn-ink)]' : 'text-[var(--good-ink)]'}`}>{g === 'FLAGGED' ? <Flag aria-hidden="true" size={15} /> : <ShieldCheck aria-hidden="true" size={15} />}{title}</h3>
                <ul className="divide-y divide-[var(--border)]">{resolved.filter(x => x.resolution === g).map(x => <li key={x.row.rowId} className={`p-4 text-sm sm:px-5 ${g === 'FLAGGED' ? 'shadow-[inset_3px_0_0_var(--warn)]' : ''}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{x.row.date} · <span className="break-all">{x.row.rowId}</span> · <span className="tabular-nums">{money(x.row.currency, x.row.signedAmount)}</span></p><DecisionBadge decision={g === 'FLAGGED' ? 'QUARANTINED' : 'AUTO_ACCEPTED'} label={g === 'FLAGGED' ? `${x.severity === 'HIGH' ? 'High' : 'Medium'} · flagged` : 'Confirmed by books'} /></div><p className="mt-1.5 leading-relaxed text-[var(--muted-strong)]">{x.summary}</p>
                    <details className="mt-1.5 text-xs text-[var(--muted)]"><summary className="inline-flex min-h-8 cursor-pointer items-center gap-1 font-semibold text-[var(--brand-ink)]"><ChevronRight aria-hidden="true" size={13} className="disclosure-chevron transition-transform" />Rule findings</summary><p className="mt-1">{x.row.counterparty} · {x.row.description}</p><ul className="mt-1 space-y-1">{x.findings.map(f => <li key={f.ruleId}><strong>{RULES[f.ruleId].title}:</strong> {f.rationale}</li>)}</ul>{x.rule ? <p className="mt-1">Resolution rule: {x.rule}</p> : null}</details></li>)}</ul>
            </section>) : <p className="p-5 text-sm">No rule produced a candidate for these records.</p>}</Panel>
            <Panel title="Rules" eyebrow="How candidates are found"><ul className="space-y-3 p-4 text-xs sm:p-5">{ids.map(id => <li key={id}><p className="font-semibold">{RULES[id].title} · {list.filter(x => x.findings.some(f => f.ruleId === id)).length}</p><p className="text-[var(--muted)]">{RULES[id].basis}</p></li>)}{ar ? <li className="border-t border-[var(--border)] pt-3"><p className="font-semibold">How a finding is resolved</p><ul className="mt-1 list-disc space-y-1 pl-4 text-[var(--muted)]">{ar.rules.slice(1).map(r => <li key={r}>{r}</li>)}</ul></li> : null}</ul></Panel>
        </div>
    </>;
}

function Forecasting({ c }: { c: Ready }) {
    const s = c.scope, bf = c.outputs.forecast, f = bf.forecast;
    return <>
        <PageHeader eyebrow={resultsEyebrow(s)} title="Forecasting" description="Next month's expected cash, shown only when there is enough history to test it." />
        <SourceStrip context={c} />
        {f.status === 'UNAVAILABLE' ? <Unavailable title="No forecast for these documents" detail={`${f.detail} Available: ${bf.history.length} month${bf.history.length === 1 ? '' : 's'}. A bank history of at least seven consecutive months for the same business and currency is needed.`} action={{ href: '/data', label: 'Open Data' }} /> : <>
            <div className="grid gap-3 sm:grid-cols-3"><Stat tone="brand" label="Expected cash in" value={money(s.currency, f.credits)} detail={periodLabel(f.period)} /><Stat tone="plain" label="Expected cash out" value={outflow(s.currency, f.debits)} detail={periodLabel(f.period)} /><Stat tone="brand" label="Expected net" value={money(s.currency, f.net)} detail="Cash in minus cash out; the least reliable of the three" /></div>
            <div className="mt-5 grid min-w-0 gap-5 ">
                <Panel title="Net cash by month, and next month" eyebrow={`Average of ${periodLabel(`${f.basis.first}/${f.basis.last}`)}`}><div className="p-3"><LineChart ariaLabel="Monthly net movement and next-month baseline" labels={[...bf.history.map(m => m.period.slice(2)), f.period.slice(2)]} series={[{ label: 'Observed net', color: 'var(--chart-in)', values: [...bf.history.map(m => Number(m.net)), null], fill: true }, { label: 'Baseline', color: 'var(--chart-net)', dashed: true, values: [...bf.history.map((_, i) => i === bf.history.length - 1 ? Number(bf.history[i].net) : null), Number(f.net)] }]} /></div></Panel>
                <Panel title="How accurate this method has been" eyebrow={`Tested on ${f.tests} months already known`}><p className="border-b border-[var(--border)] px-4 py-3 text-xs leading-relaxed text-[var(--muted-strong)] sm:px-5">Average error when each method predicted a month whose real figures were already known (WAPE; lower is better). The forecast above uses the six-month average.</p><Table caption="Backtest error" numeric={[1, 2, 3]} columns={['Figure', 'Last month', '3-month average', '6-month average']} rows={(['credits', 'debits', 'net'] as const).map(m => [m === 'credits' ? 'Cash in' : m === 'debits' ? 'Cash out' : 'Net', ...(['LAST_MONTH', 'MEAN_3', 'MEAN_6'] as const).map(k => { const w = f.backtest[m].methods.find(x => x.method === k)?.wape; return w === null || w === undefined ? 'n/a' : `${w}%`; })])} /></Panel>
            </div>
            <MlChallenger key={c.processingId} forecast={bf} />
        </>}
        <p className="mt-4 text-xs text-[var(--muted)]">The primary forecast is a deterministic statistical baseline (mean of the last six months) with rolling-origin backtests; no trained or AI model produces it. An optional, clearly labelled XGBoost challenger can be shown beside it when the local ML worker is enabled.</p>
    </>;
}

function Reports({ c }: { c: Ready }) {
    const technical = useTechnicalDetail(), confidence = useMemo(() => processingConfidence(c), [c]);
    // "Download report" on the Overview opens /reports?print=1: the browser's Save as PDF dialog opens on the print-ready report.
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('print') !== '1') return;
        const timer = setTimeout(() => { window.history.replaceState(null, '', '/reports'); window.print(); }, 500);
        return () => clearTimeout(timer);
    }, []);
    const s = c.scope, rep = c.outputs.report, r = c.outputs.reconciliation, periods = c.outputs.periods.length ? c.outputs.periods : c.outputs.statement ? [{ period: s.period, statement: c.outputs.statement }] : [];
    const [accepted, setAccepted] = useState<{ processingId: string; run: GroundedRun } | null>(null);
    function download() {
        // An accepted AI commentary is included as rendered text with its citations and receipt; it is never a source of the figures.
        const commentary = accepted?.processingId === c.processingId ? accepted.run : null;
        const aiCommentary = commentary?.verdict?.sentences ? { model: commentary.receipts[0]?.model ?? null, sentences: renderedText(commentary.verdict.sentences), cites: commentary.verdict.cited.map(id => ({ id, label: commentary.facts.find(f => f.id === id)?.label ?? id })), receipts: commentary.receipts } : null;
        const url = URL.createObjectURL(new Blob([JSON.stringify({ ...rep, processingConfidence: { ...confidence, definition: CONFIDENCE_DEFINITION }, ...(aiCommentary ? { aiCommentary } : {}), ...(c.outputs.statement ? { reconciliationStatement: c.outputs.statement } : {}), ...(c.outputs.periods.length > 1 ? { reconciliationStatements: c.outputs.periods.map(p => ({ period: p.period, statement: p.statement })) } : {}), ...(c.outputs.resolution ? { reconciliation: c.outputs.resolution } : {}), ...(c.outputs.anomalyResolution ? { anomalies: c.outputs.anomalyResolution } : {}), stages: c.stages.map(({ id, decision, summary, checks }) => ({ id, decision, summary, checks })), quarantine: c.quarantine }, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `fingence-summary-${c.processingId}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return <>
        <PageHeader eyebrow={resultsEyebrow(s)} title="Reports" description="A management summary of the same figures, to print or keep." actions={<div className="flex flex-wrap gap-2 print:hidden"><button type="button" className={button} onClick={download}><Download aria-hidden="true" size={16} />JSON evidence</button><button type="button" className={primaryButton} onClick={() => window.print()}><Printer aria-hidden="true" size={16} />Print or save PDF</button></div>} />
        <SourceStrip context={c} />
        <AiCommentary key={c.processingId} context={c} onResult={run => setAccepted(run ? { processingId: c.processingId, run } : null)} />
        <Panel title={`Management summary · ${s.businessName} · ${periodLabel(s.period)}`} eyebrow={`${usesOwnDocuments(c) ? c.job ? 'Your documents, processed on the FinGence server' : 'Your documents, processed locally' : 'Fictional sample documents'} · not for financial publication`}>
            <div className="space-y-5 p-4 text-sm leading-relaxed sm:p-6 [&>section]:border-b [&>section]:border-[var(--border)] [&>section]:pb-5 [&>section:last-of-type]:border-0 [&_h3]:mb-1 [&_h3]:text-[13px] [&_h3]:uppercase [&_h3]:tracking-[0.08em] [&_h3]:text-[var(--brand-ink)]">
                <section><h3 className="font-semibold">Processing confidence</h3><p>{confidence.status === 'MEASURED' ? <><strong className="tabular-nums">{confidence.percent}%</strong> ({confidence.band === 'HIGH' ? 'High' : confidence.band === 'CHECK' ? 'Check advised' : 'Low'}). {[...confidence.read.reasons, ...confidence.explained.reasons].length ? `Fell short: ${[...confidence.read.reasons, ...confidence.explained.reasons].join('; ')}.` : 'Every bank record was read reliably, checked and explained.'}</> : `Incomplete: ${confidence.reason}`}</p><p className="mt-1 text-xs">{CONFIDENCE_DEFINITION}</p></section>
                <section><h3 className="font-semibold">Sources</h3><ul className="mt-1 space-y-1 text-xs">{rep.sources.map(x => <li key={x.sha256} className="break-all">{x.role.replace('_', ' ').toLowerCase()}: {x.name}{technical ? ` · SHA-256 ${x.sha256}` : ''}</li>)}</ul></section>
                <section><h3 className="font-semibold">Bank cash movement</h3><p>Cash in {money(s.currency, rep.cash.credits)} ({rep.cash.creditRows} records); cash out {outflow(s.currency, rep.cash.debits)} ({rep.cash.debitRows}); net {money(s.currency, rep.cash.net)}. Not revenue, profit or a cash flow statement.</p></section>
                <section><h3 className="font-semibold">Reconciliation</h3><p>Bank {money(s.currency, r.cashMovement.bank)} − ledger {money(s.currency, r.cashMovement.ledger)} = {money(s.currency, r.cashMovement.signedDifference)}.</p><p className="mt-1 text-xs">Matcher outcomes: {reconciliationStatuses.map(k => `${STATUS_LABEL[k]} ${r.counts[k]}`).join(' · ')}. {c.outputs.resolution ? c.outputs.resolution.summary : ''}</p>{c.outputs.notReconciled.length ? <p className="mt-1 text-xs">Not reconciled (one document only): {c.outputs.notReconciled.map(n => `${n.period} ${n.side === 'BANK' ? 'bank' : 'books'}`).join(', ')}.</p> : null}</section>
                {periods.map(({ period, statement: st }) => <section key={period}><h3 className="font-semibold">Reconciliation statement (proposed){periods.length > 1 ? ` · ${periodLabel(period)}` : ''}</h3><p>{st.explained ? `Adjusted bank ${money(s.currency, st.bank.adjusted)} equals adjusted ledger ${money(s.currency, st.ledger.adjusted)}: the difference is fully explained by ${st.bank.items.length} bank-side timing items and ${st.ledger.items.length} proposed ledger corrections.` : `${money(s.currency, st.unexplained)} of the difference is not explained by any rule.`}</p><ul className="mt-1 space-y-0.5 text-xs">{[...st.bank.items, ...st.ledger.items, ...st.other].map(i => <li key={`${i.bankRecordId}:${i.ledgerRecordIds.join('|')}`}>{STATEMENT_LABEL[i.category]} · {[i.bankRecordId, ...i.ledgerRecordIds].filter(Boolean).join(', ')} · {money(s.currency, i.adjustment)}</li>)}</ul></section>)}
                {periods.length ? <p className="text-xs">Every item comes from a stated rule; correcting entries are prepared for the books, not posted.</p> : null}
                <section><h3 className="font-semibold">Unusual bank records</h3><p>{c.outputs.anomalyResolution ? `${rep.anomalyCandidates} of ${rep.cash.rows} bank records had a rule finding. ${c.outputs.anomalyResolution.summary}` : `${rep.anomalyCandidates} of ${rep.cash.rows} bank records have a rule finding.`} Findings are never fraud conclusions.</p></section>
                <section><h3 className="font-semibold">Forecast</h3><p>{rep.forecast.status === 'AVAILABLE' ? `${rep.forecast.period} baseline: cash in ${money(s.currency, rep.forecast.credits)}, cash out ${outflow(s.currency, rep.forecast.debits)}, derived net ${money(s.currency, rep.forecast.net)} (six-month mean, backtested).` : `Unavailable: ${rep.forecast.detail}`}</p></section>
                <section><h3 className="font-semibold">Verification</h3><p>{c.stages.filter(x => x.decision === 'AUTO_ACCEPTED').length} of {c.stages.length} stages auto-accepted after automated checks; {c.quarantine.length} items quarantined.</p></section>
                <section><h3 className="font-semibold">Limitations</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-xs">{rep.limitations.map(l => <li key={l}>{l}</li>)}</ul></section>
                {technical ? <p className="text-xs text-[var(--muted)]">Processing {c.processingId} · {c.version}</p> : null}
            </div>
        </Panel>
    </>;
}

const DEMO_LINK: Record<string, string> = { '/transactions': '/transactions', '/anomalies': '/anomalies', '/reconciliation': '/reconciliation', '/forecasting': '/forecasting' };
/** The rule-based answer card (Phase 1); also the fallback under any AI answer that is not accepted. */
function RuleAnswer({ a, href }: { a: QaAnswer; href: (h: string) => string }) {
    return <>
        <header className="flex flex-wrap items-center justify-between gap-2"><p className="text-[var(--muted)]">{a.question}</p><DecisionBadge decision={a.status === 'ANSWERED' ? 'AUTO_ACCEPTED' : a.status === 'REFUSED' ? 'QUARANTINED' : 'UNAVAILABLE'} label={a.status === 'ANSWERED' ? 'Answered from source' : a.status === 'REFUSED' ? 'Refused' : 'Unavailable'} /></header>
        <p className="mt-2 text-base font-semibold">{a.headline}</p><p className="mt-1 leading-relaxed text-[var(--muted-strong)]">{a.interpretation}</p>
        {a.facts.length ? <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{a.facts.filter(f => f.unit !== 'TEXT').map(f => <div key={f.id} className="rounded-xl bg-[var(--surface-subtle)] px-3 py-2 ring-1 ring-inset ring-[var(--border)]"><dt className="text-xs text-[var(--muted)]">{f.label}</dt><dd className="font-semibold tabular-nums">{f.unit === 'MONEY' ? money(f.currency ?? '', f.value) : f.unit === 'PERCENT' ? `${f.value}%` : f.value}</dd></div>)}</dl> : null}
        {a.evidence.length ? <p className="mt-3 flex flex-wrap gap-3 text-xs">{a.evidence.map(e => <Link key={e.label} href={href(e.href)} className="font-semibold text-[var(--teal-dark)] underline">{e.label}</Link>)}</p> : null}
    </>;
}
type AskItem = { key: number } & ({ kind: 'RULE'; answer: QaAnswer } | { kind: 'AI'; question: string; run: GroundedRun | null; fallback: QaAnswer });
function Ask({ c }: { c: Ready }) {
    const facts = useMemo(() => qaFacts(c), [c]), index = useMemo(() => groundingIndex(c), [c]);
    const [items, setItems] = useState<AskItem[]>([]), [question, setQuestion] = useState(''), [busy, setBusy] = useState(false);
    const [ai, setAi] = useState<QaGatewayStatus>({ available: false }), [mode, setMode] = useState<'RULES' | 'AI'>('RULES'), next = useRef(0);
    // Probe the Q&A route only when the layout gateway already answered (same switch); otherwise nothing is requested.
    const gateway = useDemoProcessing().ai?.available ?? false;
    useEffect(() => { let live = true; if (gateway) qaGatewayStatus().then(s => { if (live) setAi(s); }); return () => { live = false; }; }, [gateway]);
    if (!facts) return <Unavailable title="Questions unavailable" detail="The processing context has no verified facts." />;
    const aiMode = mode === 'AI' && ai.available && !!index;
    const ask = async (q: string) => {
        if (!q.trim() || q.length > MAX_QUESTION || busy) return;
        const key = next.current++; setQuestion('');
        if (!aiMode) { setItems(list => [{ key, kind: 'RULE' as const, answer: answerQuestion(facts, q) }, ...list].slice(0, 8)); return; }
        setBusy(true);
        setItems(list => [{ key, kind: 'AI' as const, question: q, run: null, fallback: answerQuestion(facts, q) }, ...list].slice(0, 8));
        const run = await askGrounded(index!, q, gatewayQaModel);
        setItems(list => list.map(i => i.key === key && i.kind === 'AI' ? { ...i, run } : i)); setBusy(false);
    };
    // Evidence links point at this demo's pages; the management report lives on Reports here.
    const href = (h: string) => h.includes('#management-report') ? '/reports' : DEMO_LINK[h.split(/[?#]/)[0]] ?? '/data';
    return <>
        <PageHeader eyebrow={resultsEyebrow(c.scope)} title="Finance Q&A" description={aiMode ? 'Ask about these figures. Every number comes from the records; an answer that fails the checks is withheld.' : 'Ask about these figures. A question the records cannot answer is refused, never guessed.'} />
        {aiMode ? <p className="mb-5 rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-soft)] p-4 text-sm leading-relaxed"><strong>AI-assisted ({ai.available ? ai.model : ''} on Groq), verified by deterministic checks.</strong> The model chooses which verified queries to run and words the answer; it never types an amount, date or reference. FinGence fills every figure from the records and withholds any answer that fails a check. Sent: {ai.available ? ai.sends : ''}</p>
            : <p className="mb-5 rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-soft)] p-4 text-sm leading-relaxed"><strong>Rule-based source assistant, not live AI.</strong> A fixed set of question types is answered with figures copied from this processing; profit, ratio, advice, fraud and cause questions are refused.</p>}
        <SourceStrip context={c} />
        <Panel>
            <div className="space-y-3 p-4 sm:p-5">
                {ai.available && index ? <div role="group" aria-label="Answer mode" className="flex flex-wrap gap-2">
                    <button type="button" aria-pressed={mode === 'RULES'} className={chip(mode === 'RULES')} onClick={() => setMode('RULES')}>Rule-based</button>
                    <button type="button" aria-pressed={mode === 'AI'} className={chip(mode === 'AI')} onClick={() => setMode('AI')}><Sparkles aria-hidden="true" size={14} />AI-assisted (verified)</button>
                </div> : null}
                <form className="flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); ask(question); }}><label className="sr-only" htmlFor="demo-question">Question</label><input id="demo-question" className={`${field} min-h-12 min-w-0 flex-1 text-[15px]`} maxLength={MAX_QUESTION} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about this processing, for example: How many transactions were matched?" /><button className={primaryButton} disabled={!question.trim() || busy}><Send aria-hidden="true" size={16} />{busy ? 'Answering…' : 'Ask'}</button></form>
                <div aria-label="Suggested questions" className="flex flex-wrap gap-2"><span className="w-full text-xs font-semibold text-[var(--muted)]">Try asking</span>{(aiMode ? aiSuggestions(c) : suggestions(facts)).map(q => <button key={q} type="button" className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-left text-[13px] font-medium text-[var(--muted-strong)] transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)] hover:text-[var(--ink)] disabled:opacity-50" disabled={busy} onClick={() => ask(q)}>{q}</button>)}</div>
            </div>
        </Panel>
        <section aria-label="Answers" className="mt-4 space-y-3">{items.map(item => <article key={item.key} className="panel-shadow rise-in rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
            {item.kind === 'RULE' ? <RuleAnswer a={item.answer} href={href} />
                : !item.run ? <p className="text-[var(--muted)]" role="status">{item.question} · Answering from the verified records…</p>
                    : <>
                        <GroundedAnswer run={item.run} />
                        {item.run.status !== 'ANSWERED' ? <div className="mt-3 border-t border-[var(--border)] pt-3"><RuleAnswer a={item.fallback} href={href} /></div> : null}
                    </>}
        </article>)}</section>
    </>;
}
/** Suggestions from this processing: its own period wording and its largest money-in counterparty, never a fixed sample name. */
function aiSuggestions(c: Ready) {
    const span = c.scope.months.length > 1 ? 'over these months' : 'this month';
    const inflow = new Map<string, bigint>(); for (const r of c.outputs.bankRows) if (r.direction === 'Credit') inflow.set(r.counterparty, (inflow.get(r.counterparty) ?? 0n) + toCents(r.amount));
    const top = [...inflow.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))[0]?.[0];
    return [`Who did we pay the most ${span}?`, ...(top ? [`How much did we receive from ${top}?`] : []), 'Which reconciliation items still need review, and what reason was recorded?', 'How much more money came in than went out?'];
}

/** `layout` renders the Overview with a saved layout (tests); otherwise the signed-in person's own layout is loaded. */
export function DemoModule({ view, context, layout }: { view: DemoView; context: Ready; layout?: Layout }) {
    switch (view) {
        case 'overview': return <Overview c={context} layout={layout} />;
        case 'transactions': return <Transactions c={context} />;
        case 'reconciliation': return <Reconciliation c={context} />;
        case 'analytics': return <Analytics c={context} />;
        case 'anomalies': return <Anomalies c={context} />;
        case 'forecasting': return <Forecasting c={context} />;
        case 'reports': return <Reports c={context} />;
        case 'ask': return <Ask c={context} />;
    }
}
