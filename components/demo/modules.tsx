'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronRight, ChartNoAxesCombined, Download, FileBarChart, Flag, House, MessageSquareText, Printer, ReceiptText, RefreshCw, Search, Send, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
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
import { useDemoProcessing } from './context';
import { Callout, DecisionBadge, SourceStrip, Stat, Table, Unavailable, button, chip, field, usesOwnDocuments, money, outflow, periodLabel, primaryButton } from './shared';

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

function Ring({ value, total, label }: { value: number; total: number; label: string }) {
    const pct = total ? (value / total) * 100 : 0, r = 42, c = 2 * Math.PI * r;
    return <svg viewBox="0 0 100 100" className="size-28 shrink-0 -rotate-90 sm:size-32" role="img" aria-label={label}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke="url(#ring-gradient)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
        <defs><linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1e40af" /><stop offset="0.55" stopColor="#2563eb" /><stop offset="1" stopColor="#38bdf8" /></linearGradient></defs>
    </svg>;
}

const LINK_ICON: Record<string, typeof House> = { '/transactions': ReceiptText, '/reconciliation': RefreshCw, '/analytics': ChartNoAxesCombined, '/anomalies': AlertTriangle, '/forecasting': TrendingUp, '/reports': FileBarChart, '/ask': MessageSquareText };

/** A signed amount: money in is tinted green and money out stays neutral, so direction reads at a glance; the sign is kept. */
function Amount({ currency, value }: { currency: string; value: string }) {
    return <span className={`whitespace-nowrap font-medium tabular-nums ${value.startsWith('-') ? 'text-[var(--muted-strong)]' : 'text-[var(--good-ink)]'}`}>{money(currency, value)}</span>;
}

function Overview({ c }: { c: Ready }) {
    const { scope: s, outputs: o } = c, r = o.reconciliation, f = o.forecast.forecast;
    const checks = c.stages.flatMap(x => x.checks), exceptions = c.quarantine.filter(q => q.kind === 'RECONCILIATION_EXCEPTION').length;
    const ar = o.anomalyResolution, flaggedAnomalies = ar?.flagged ?? o.anomalies.length, months = s.months.length;
    const matchedCount = r.counts.MATCH_EXACT + r.counts.MATCH_DATE_SHIFT, passedChecks = checks.filter(k => k.passed).length;
    return <>
        <PageHeader eyebrow={`${s.businessId} · ${periodLabel(s.period)}`} title="Overview" description={`Verified results for ${s.businessName}, ${periodLabel(s.period)}, from one processing of your documents.`} />
        <SourceStrip context={c} />
        <section aria-label="Verification at a glance" className="panel-shadow relative mb-5 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
            <div aria-hidden="true" className="ledger-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(110deg,black,transparent_70%)]" />
            <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-7">
                <div className="flex items-center gap-5">
                    <div className="relative grid place-items-center">
                        <Ring value={matchedCount} total={r.results.length} label={`${matchedCount} of ${r.results.length} reconciled automatically`} />
                        <span className="absolute text-center"><span className="block text-2xl font-semibold tracking-[-0.03em] tabular-nums">{r.results.length ? Math.round((matchedCount / r.results.length) * 100) : 0}%</span><span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">matched</span></span>
                    </div>
                    <div className="min-w-0 sm:hidden"><p className="text-lg font-semibold leading-snug">{passedChecks} of {checks.length} checks passed</p><p className="text-sm text-[var(--muted)]">{c.quarantine.length} flagged for the technical team</p></div>
                </div>
                <div className="min-w-0 flex-1">
                    <p className="hidden text-[22px] font-semibold leading-snug tracking-[-0.02em] sm:block">{passedChecks} of {checks.length} automated checks passed across {c.stages.length} stages.</p>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--muted-strong)]">{matchedCount} of {r.results.length} records reconciled automatically{o.resolution ? `, ${o.resolution.totals.timing + o.resolution.totals.resolutions.ENTRY_PREPARED} differences resolved by stated rules` : ''}. No routine manual approval was needed.</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--good-soft)] px-2.5 py-1 text-[var(--good-ink)] ring-1 ring-inset ring-[var(--good-line)]"><ShieldCheck aria-hidden="true" size={13} />{c.stages.filter(x => x.decision === 'AUTO_ACCEPTED').length} of {c.stages.length} stages verified</span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-inset ${c.quarantine.length ? 'bg-[var(--warn-soft)] text-[var(--warn-ink)] ring-[var(--warn-line)]' : 'bg-[var(--good-soft)] text-[var(--good-ink)] ring-[var(--good-line)]'}`}><Flag aria-hidden="true" size={13} />{c.quarantine.length} flagged for the technical team</span>
                    </div>
                </div>
            </div>
        </section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat tone="brand" label="Net signed bank movement" value={money(s.currency, o.totals.net)} detail={`In ${money(s.currency, o.totals.credits)} · out ${outflow(s.currency, o.totals.debits)}`} />
            <Stat tone="brand" label="Bank − ledger difference" value={money(s.currency, r.cashMovement.signedDifference)} detail={`Ledger cash account ${money(s.currency, r.cashMovement.ledger)}${o.periods.length > 1 ? ` · ${o.periods.length} months reconciled` : ''}`} />
            <Stat tone="good" label="Reconciled automatically" value={`${matchedCount} of ${r.results.length}`} detail={o.resolution ? `${o.resolution.totals.timing + o.resolution.totals.resolutions.ENTRY_PREPARED} differences resolved · ${exceptions} flagged` : `${exceptions} exceptions flagged`} />
            <Stat tone="plain" label="Next-month cash baseline" value={f.status === 'AVAILABLE' ? money(s.currency, f.net) : 'Unavailable'} detail={f.status === 'AVAILABLE' ? `${f.period} net · six-month mean, not AI` : f.detail} />
        </div>
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <Panel title="Automated verification" eyebrow="Trust model">
                <div className="space-y-3 p-4 text-sm sm:p-5">
                    <p><strong>{passedChecks} of {checks.length}</strong> automated checks passed across {c.stages.length} stages. No routine manual approval was needed.</p>
                    <p className="text-[var(--muted-strong)]"><strong className="text-[var(--ink)]">{c.quarantine.length}</strong> item{c.quarantine.length === 1 ? ' is' : 's are'} flagged for the technical team: {exceptions} unexplained reconciliation item{exceptions === 1 ? '' : 's'}, {flaggedAnomalies} unusual record{flaggedAnomalies === 1 ? '' : 's'} the books do not confirm{c.quarantine.some(q => q.kind === 'DOCUMENT' || q.kind === 'HISTORY') ? ' and quarantined documents' : ''}. Flagged items are never treated as established facts.</p>
                    <ol className="grid gap-1.5 pt-1">{c.stages.map((x, i) => <li key={x.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-[var(--surface-subtle)] px-3 py-2 ring-1 ring-inset ring-[var(--border)]"><span className="w-4 text-xs font-semibold text-[var(--muted)] tabular-nums">{i + 1}</span><span className="min-w-0 flex-1 text-[13px] font-medium">{x.title}</span><DecisionBadge decision={x.decision} label={x.decision === 'AUTO_ACCEPTED' ? 'Verified' : undefined} /></li>)}</ol>
                </div>
            </Panel>
            <Panel title="Connected results" eyebrow="Same processing context">
                <ul className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">
                    {[['/transactions', 'Transactions', `${o.totals.rows} bank records · ${o.ledger?.rows.length ?? 0} ledger entries`], ['/reconciliation', 'Reconciliation', `${reconciliationStatuses.filter(k => r.counts[k]).length} outcome categories`], ['/analytics', 'Analytics', o.history.accepted ? `${o.history.months.length} months of bank history` : months > 1 ? `${months} statement months` : 'Statement month only'], ['/anomalies', 'Anomalies', ar ? `${ar.corroborated} confirmed by the books · ${ar.flagged} flagged` : `${o.anomalies.length} rule-based candidates`], ['/forecasting', 'Forecasting', f.status === 'AVAILABLE' ? `${f.period} baseline` : 'Unavailable for this input'], ['/reports', 'Reports', 'Management summary and JSON evidence'], ['/ask', 'Finance Q&A', 'Rule-based answers from these figures']].map(([href, label, detail]) => { const Icon = LINK_ICON[href];
                        return <li key={href}><Link href={href} className="group flex min-h-16 items-center gap-3 rounded-xl border border-[var(--border)] px-3.5 py-3 transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)]"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]"><Icon aria-hidden="true" size={17} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-[var(--muted)]">{detail}</span></span><ArrowRight aria-hidden="true" size={15} className="shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5" /></Link></li>; })}
                </ul>
            </Panel>
        </div>
        <p className="mt-5 text-xs text-[var(--muted)]">Bank cash movement is not revenue, expenses or profit. No accounting classification is inferred from bank receipts or payments.</p>
    </>;
}

function Transactions({ c }: { c: Ready }) {
    const [tab, setTab] = useState<'bank' | 'ledger'>('bank'), [search, setSearch] = useState(''), [direction, setDirection] = useState(''), [page, setPage] = useState(0);
    const q = search.trim().toLowerCase(), s = c.scope;
    const bank = c.outputs.bankRows.filter(r => (!direction || r.direction === direction) && (!q || [r.rowId, r.description, r.counterparty, r.reference].some(v => v.toLowerCase().includes(q))));
    const ledger = (c.outputs.ledger?.rows ?? []).filter(r => (!direction || (direction === 'Credit') === !r.signedCents.startsWith('-')) && (!q || [r.recordId, r.description, r.reference].some(v => v.toLowerCase().includes(q))));
    const totals = cashTotals(bank), rows = tab === 'bank' ? bank.length : ledger.length;
    return <>
        <PageHeader eyebrow="Results · records" title="Transactions" description="Normalized records from the verified bank statement and cash-account ledger." />
        <SourceStrip context={c} />
        <div className="mb-5 grid gap-3 sm:grid-cols-3"><Stat tone="brand" label="Bank cash in (credits)" value={money(s.currency, totals.credits)} detail={`${totals.creditRows} records shown`} /><Stat tone="plain" label="Bank cash out (debits)" value={outflow(s.currency, totals.debits)} detail={`${totals.debitRows} records shown`} /><Stat tone="brand" label="Net signed movement" value={money(s.currency, totals.net)} detail={`${totals.rows} of ${c.outputs.bankRows.length} bank records`} /></div>
        <Panel>
            <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 lg:flex-row lg:items-end">
                <div role="tablist" aria-label="Document" className="flex gap-2">{(['bank', 'ledger'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={chip(tab === t)} onClick={() => { setTab(t); setPage(0); }}>{t === 'bank' ? 'Bank statement' : 'General ledger'}</button>)}</div>
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <label className="relative grid min-w-0 gap-1 text-xs font-medium text-[var(--muted-strong)]"><span className="sr-only sm:not-sr-only">Search</span><Search aria-hidden="true" size={16} className="pointer-events-none absolute bottom-3.5 left-3 text-[var(--muted)]" /><input className={`${field} pl-9`} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="ID, description, counterparty or reference" /></label>
                    <label className="grid gap-1 text-xs font-medium text-[var(--muted-strong)]"><span className="sr-only sm:not-sr-only">Direction</span><select className={`${field} w-auto pr-8`} value={direction} onChange={e => { setDirection(e.target.value); setPage(0); }}><option value="">All</option><option value="Credit">Cash in</option><option value="Debit">Cash out</option></select></label>
                </div>
            </div>
            {tab === 'bank' ? <Table caption="Bank statement records" columns={['Date', 'Record', 'Description', 'Counterparty', 'Signed amount']} rows={bank.slice(page * PAGE, page * PAGE + PAGE).map(r => [r.date, <span key="i" className="whitespace-nowrap text-xs">{r.rowId}</span>, <span key="d" className="text-xs">{r.description}</span>, r.counterparty, <Amount key="a" currency={r.currency} value={r.signedAmount} />])} />
                : <Table caption="General ledger cash entries" columns={['Posting date', 'Entry', 'Memo', 'Reference', 'Signed amount']} rows={ledger.slice(page * PAGE, page * PAGE + PAGE).map(r => [r.date, <span key="i" className="whitespace-nowrap text-xs">{r.recordId}</span>, <span key="d" className="text-xs">{r.description}</span>, <span key="r" className="text-xs">{r.reference}</span>, <Amount key="a" currency={r.currency} value={fromCents(BigInt(r.signedCents))} />])} />}
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
        <PageHeader eyebrow="Results · bank against books" title="Reconciliation" description="FinGence matched your bank statement to your books and resolved every difference it could explain by a stated rule. Only what it cannot explain is flagged." />
        <SourceStrip context={c} />
        {c.outputs.resolution ? <div className="mb-5"><ReconciliationOutcomePanel outcome={c.outputs.resolution} /></div> : null}
        <div className="mb-5 grid gap-3 sm:grid-cols-3"><Stat tone="brand" label="Bank cash movement" value={money(s.currency, r.cashMovement.bank)} detail={multi ? `${periods.length} reconciled months` : undefined} /><Stat tone="brand" label="Ledger cash movement" value={money(s.currency, r.cashMovement.ledger)} /><Stat tone={periods.every(p => p.statement.explained) ? 'good' : 'warn'} label="Signed bank − ledger difference" value={money(s.currency, r.cashMovement.signedDifference)} detail={periods.every(p => p.statement.explained) ? 'Explained by the reconciling items below' : 'Cause is not inferred'} /></div>
        {c.outputs.notReconciled.length ? <p className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">Not reconciled, because only one document covers {c.outputs.notReconciled.length === 1 ? 'this month' : 'these months'}: {c.outputs.notReconciled.map(n => `${periodLabel(n.period)} (${n.side === 'BANK' ? 'bank statement only' : 'books only'}, ${n.records} records)`).join('; ')}. These records are shown, never matched against nothing.</p> : null}
        {multi ? <div role="tablist" aria-label="Statement month" className="mb-3 flex flex-wrap items-center gap-2"><span className="mr-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Statement for</span>{periods.map((p, i) => <button key={p.period} type="button" role="tab" aria-selected={month === i} className={chip(month === i)} onClick={() => setMonth(i)}>{periodLabel(p.period)}</button>)}</div> : null}
        {statement ? <div className="mb-5"><ReconciliationStatementPanel statement={statement} /></div> : null}
        <h2 className="mb-3 mt-7 text-lg font-semibold tracking-[-0.02em]">Matcher outcomes</h2>
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
    const s = c.scope, o = c.outputs, days = useMemo(() => { const map = new Map<string, bigint>(); for (const r of o.bankRows) map.set(r.date, (map.get(r.date) ?? 0n) + toCents(r.signedAmount)); const points: { d: string; v: number }[] = []; let total = 0n; for (const [d, v] of [...map.entries()].sort()) { total += v; points.push({ d, v: Number(total) / 100 }); } return points; }, [o.bankRows]);
    // Monthly trend: the accepted history, or else the statement's own months when it covers more than one.
    const trendRows = o.history.accepted ? o.history.rows : s.months.length > 1 ? o.bankRows : [], trendMonths = o.history.accepted ? o.history.months : s.months.length > 1 ? s.months : [];
    const months = trendMonths.map(p => ({ p, ...cashTotals(trendRows.filter(r => r.period === p)) })), multi = s.months.length > 1;
    const parties = useMemo(() => { const map = new Map<string, { in: bigint; out: bigint; n: number }>(); for (const r of o.bankRows) { const e = map.get(r.counterparty) ?? { in: 0n, out: 0n, n: 0 }; const v = toCents(r.signedAmount); if (v >= 0n) e.in += v; else e.out += v; e.n++; map.set(r.counterparty, e); } return [...map.entries()].sort((a, b) => Number((b[1].in - b[1].out) - (a[1].in - a[1].out))).slice(0, 8); }, [o.bankRows]);
    return <>
        <PageHeader eyebrow="Results · cash movement" title="Analytics" description="Exact cash movement metrics and trends calculated from the verified bank records." />
        <SourceStrip context={c} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat tone="brand" label="Bank cash in (credits)" value={money(s.currency, o.totals.credits)} detail={`${o.totals.creditRows} records`} /><Stat tone="plain" label="Bank cash out (debits)" value={outflow(s.currency, o.totals.debits)} detail={`${o.totals.debitRows} records`} /><Stat tone="brand" label="Net signed movement" value={money(s.currency, o.totals.net)} /><Stat label="Observed months" value={String(o.history.accepted ? o.history.months.length : s.months.length)} detail={o.history.accepted ? `${o.history.months[0]} to ${o.history.months.at(-1)}` : multi ? `${s.months[0]} to ${s.months.at(-1)}` : 'Statement month only'} /></div>
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
            <Panel title={`Cumulative net movement, ${periodLabel(s.period)}`} eyebrow="Daily, from bank records"><div className="p-3 sm:p-4"><LineChart ariaLabel={`Cumulative net bank movement by day in ${periodLabel(s.period)}`} labels={days.map(x => multi ? x.d.slice(5) : x.d.slice(8))} series={[{ label: 'Cumulative net', color: 'var(--chart-in)', values: days.map(x => x.v), fill: true }]} formatValue={v => `${Math.round(v / 1000)}K`} /></div></Panel>
            {months.length ? <Panel title="Monthly bank movement" eyebrow={o.history.accepted ? 'Verified history' : 'Statement months'}><div className="p-3"><LineChart ariaLabel="Monthly cash in, cash out and net" labels={months.map(m => m.p.slice(2))} series={[{ label: 'Cash in', color: 'var(--chart-in)', values: months.map(m => Number(m.credits)) }, { label: 'Cash out', color: 'var(--chart-out)', values: months.map(m => -Number(m.debits)) }, { label: 'Net', color: 'var(--chart-net)', values: months.map(m => Number(m.net)), dashed: true }]} /></div></Panel>
                : <Unavailable title="Monthly trend unavailable" detail="Only the statement month is observed. Process an accepted bank history to see monthly trends." />}
        </div>
        <div className="mt-5"><Panel title="Largest counterparties by gross movement" eyebrow={multi ? 'Statement period' : 'Statement month'}><Table caption="Counterparties" columns={['Counterparty', 'Records', 'Cash in', 'Cash out']} rows={parties.map(([name, e]) => { const total = Number(e.in - e.out) || 1; return [<span key="n" className="grid gap-1.5"><span>{name}</span><span aria-hidden="true" className="flex h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-[var(--surface-sunken)]"><span className="bg-[var(--chart-in)]" style={{ width: `${(Number(e.in) / total) * 100}%` }} /><span className="bg-[var(--chart-out)]" style={{ width: `${(Number(-e.out) / total) * 100}%` }} /></span></span>, e.n, <span key="i" className="whitespace-nowrap tabular-nums">{money(s.currency, fromCents(e.in))}</span>, <span key="o" className="whitespace-nowrap tabular-nums">{outflow(s.currency, fromCents(e.out))}</span>]; })} /></Panel></div>
        <p className="mt-4 text-xs text-[var(--muted)]">Receipts and payments are bank cash directions, not revenue or expenses; no ratios or profitability are derived without an accounting classification.</p>
    </>;
}

function Anomalies({ c }: { c: Ready }) {
    const list = c.outputs.anomalies, ids = Object.keys(RULES) as RuleId[], ar = c.outputs.anomalyResolution;
    const resolved = ar?.items ?? list.map(x => ({ ...x, resolution: 'FLAGGED' as const, summary: x.findings.map(f => f.rationale).join(' '), rule: '', booked: null }));
    const groups = [['FLAGGED', 'Flagged for your technical team'], ['CORROBORATED_BY_BOOKS', 'Confirmed by your books: no action needed']] as const;
    return <>
        <PageHeader eyebrow="Results · unusual records" title="Anomalies" description="Transparent rules look for unusual bank records; FinGence then checks each one against your books. Only a record the books cannot confirm is flagged, and a finding is never a fraud conclusion." />
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
        <PageHeader eyebrow="Results · next month" title="Forecasting" description="A next-month cash baseline, shown only when the verified history is long enough to backtest it." />
        <SourceStrip context={c} />
        {f.status === 'UNAVAILABLE' ? <Unavailable title="Forecast unavailable for this input" detail={`${f.detail} Observed: ${bf.history.length} month${bf.history.length === 1 ? '' : 's'}. Add an accepted bank history of at least seven consecutive months for the same business and currency.`} /> : <>
            <div className="grid gap-3 sm:grid-cols-3"><Stat tone="brand" label={`${f.period} bank cash in`} value={money(s.currency, f.credits)} /><Stat tone="plain" label={`${f.period} bank cash out`} value={outflow(s.currency, f.debits)} /><Stat tone="warn" label={`${f.period} net (derived)`} value={money(s.currency, f.net)} detail="Net is the least reliable figure" /></div>
            <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
                <Panel title="History and baseline" eyebrow={`Six-month mean of ${f.basis.first} to ${f.basis.last}`}><div className="p-3"><LineChart ariaLabel="Monthly net movement and next-month baseline" labels={[...bf.history.map(m => m.period.slice(2)), f.period.slice(2)]} series={[{ label: 'Observed net', color: 'var(--chart-in)', values: [...bf.history.map(m => Number(m.net)), null], fill: true }, { label: 'Baseline', color: 'var(--chart-net)', dashed: true, values: [...bf.history.map((_, i) => i === bf.history.length - 1 ? Number(bf.history[i].net) : null), Number(f.net)] }]} /></div></Panel>
                <Panel title="Rolling-origin backtests" eyebrow={`${f.tests} test months`}><Table caption="Backtest error" columns={['Metric', 'Last month WAPE', '3-month mean WAPE', '6-month mean WAPE']} rows={(['credits', 'debits', 'net'] as const).map(m => [m === 'credits' ? 'Cash in' : m === 'debits' ? 'Cash out' : 'Net', ...(['LAST_MONTH', 'MEAN_3', 'MEAN_6'] as const).map(k => { const w = f.backtest[m].methods.find(x => x.method === k)?.wape; return w === null || w === undefined ? 'n/a' : `${w}%`; })])} /></Panel>
            </div>
        </>}
        <p className="mt-4 text-xs text-[var(--muted)]">Deterministic statistical baseline (mean of the last six months) with rolling-origin backtests. No trained or AI forecasting model is used.</p>
    </>;
}

function Reports({ c }: { c: Ready }) {
    const s = c.scope, rep = c.outputs.report, r = c.outputs.reconciliation, periods = c.outputs.periods.length ? c.outputs.periods : c.outputs.statement ? [{ period: s.period, statement: c.outputs.statement }] : [];
    const [accepted, setAccepted] = useState<{ processingId: string; run: GroundedRun } | null>(null);
    function download() {
        // An accepted AI commentary is included as rendered text with its citations and receipt; it is never a source of the figures.
        const commentary = accepted?.processingId === c.processingId ? accepted.run : null;
        const aiCommentary = commentary?.verdict?.sentences ? { model: commentary.receipts[0]?.model ?? null, sentences: renderedText(commentary.verdict.sentences), cites: commentary.verdict.cited.map(id => ({ id, label: commentary.facts.find(f => f.id === id)?.label ?? id })), receipts: commentary.receipts } : null;
        const url = URL.createObjectURL(new Blob([JSON.stringify({ ...rep, ...(aiCommentary ? { aiCommentary } : {}), ...(c.outputs.statement ? { reconciliationStatement: c.outputs.statement } : {}), ...(c.outputs.periods.length > 1 ? { reconciliationStatements: c.outputs.periods.map(p => ({ period: p.period, statement: p.statement })) } : {}), ...(c.outputs.resolution ? { reconciliation: c.outputs.resolution } : {}), ...(c.outputs.anomalyResolution ? { anomalies: c.outputs.anomalyResolution } : {}), stages: c.stages.map(({ id, decision, summary, checks }) => ({ id, decision, summary, checks })), quarantine: c.quarantine }, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `fingence-summary-${c.processingId}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return <>
        <PageHeader eyebrow="Results · management summary" title="Reports" description="Management summary generated from the same processing context as every other page." actions={<div className="flex flex-wrap gap-2 print:hidden"><button type="button" className={button} onClick={download}><Download aria-hidden="true" size={16} />JSON evidence</button><button type="button" className={primaryButton} onClick={() => window.print()}><Printer aria-hidden="true" size={16} />Print or save PDF</button></div>} />
        <SourceStrip context={c} />
        <AiCommentary key={c.processingId} context={c} onResult={run => setAccepted(run ? { processingId: c.processingId, run } : null)} />
        <Panel title={`Management summary · ${s.businessName} · ${periodLabel(s.period)}`} eyebrow={`${usesOwnDocuments(c) ? c.job ? 'Your documents, processed on the FinGence server' : 'Your documents, processed locally' : 'Fictional sample documents'} · not for financial publication`}>
            <div className="space-y-5 p-4 text-sm leading-relaxed sm:p-6 [&>section]:border-b [&>section]:border-[var(--border)] [&>section]:pb-5 [&>section:last-of-type]:border-0 [&_h3]:mb-1 [&_h3]:text-[13px] [&_h3]:uppercase [&_h3]:tracking-[0.08em] [&_h3]:text-[var(--brand-ink)]">
                <section><h3 className="font-semibold">Sources</h3><ul className="mt-1 space-y-1 text-xs">{rep.sources.map(x => <li key={x.sha256} className="break-all">{x.role.replace('_', ' ').toLowerCase()}: {x.name} · SHA-256 {x.sha256}</li>)}</ul></section>
                <section><h3 className="font-semibold">Bank cash movement</h3><p>Cash in {money(s.currency, rep.cash.credits)} ({rep.cash.creditRows} records); cash out {outflow(s.currency, rep.cash.debits)} ({rep.cash.debitRows}); net {money(s.currency, rep.cash.net)}. Not revenue, profit or a cash flow statement.</p></section>
                <section><h3 className="font-semibold">Reconciliation</h3><p>Bank {money(s.currency, r.cashMovement.bank)} − ledger {money(s.currency, r.cashMovement.ledger)} = {money(s.currency, r.cashMovement.signedDifference)}.</p><p className="mt-1 text-xs">Matcher outcomes: {reconciliationStatuses.map(k => `${STATUS_LABEL[k]} ${r.counts[k]}`).join(' · ')}. {c.outputs.resolution ? c.outputs.resolution.summary : ''}</p>{c.outputs.notReconciled.length ? <p className="mt-1 text-xs">Not reconciled (one document only): {c.outputs.notReconciled.map(n => `${n.period} ${n.side === 'BANK' ? 'bank' : 'books'}`).join(', ')}.</p> : null}</section>
                {periods.map(({ period, statement: st }) => <section key={period}><h3 className="font-semibold">Reconciliation statement (proposed){periods.length > 1 ? ` · ${periodLabel(period)}` : ''}</h3><p>{st.explained ? `Adjusted bank ${money(s.currency, st.bank.adjusted)} equals adjusted ledger ${money(s.currency, st.ledger.adjusted)}: the difference is fully explained by ${st.bank.items.length} bank-side timing items and ${st.ledger.items.length} proposed ledger corrections.` : `${money(s.currency, st.unexplained)} of the difference is not explained by any rule.`}</p><ul className="mt-1 space-y-0.5 text-xs">{[...st.bank.items, ...st.ledger.items, ...st.other].map(i => <li key={`${i.bankRecordId}:${i.ledgerRecordIds.join('|')}`}>{STATEMENT_LABEL[i.category]} · {[i.bankRecordId, ...i.ledgerRecordIds].filter(Boolean).join(', ')} · {money(s.currency, i.adjustment)}</li>)}</ul></section>)}
                {periods.length ? <p className="text-xs">Every item comes from a stated rule; correcting entries are prepared for the books, not posted.</p> : null}
                <section><h3 className="font-semibold">Unusual bank records</h3><p>{c.outputs.anomalyResolution ? `${rep.anomalyCandidates} of ${rep.cash.rows} bank records had a rule finding. ${c.outputs.anomalyResolution.summary}` : `${rep.anomalyCandidates} of ${rep.cash.rows} bank records have a rule finding.`} Findings are never fraud conclusions.</p></section>
                <section><h3 className="font-semibold">Forecast</h3><p>{rep.forecast.status === 'AVAILABLE' ? `${rep.forecast.period} baseline: cash in ${money(s.currency, rep.forecast.credits)}, cash out ${outflow(s.currency, rep.forecast.debits)}, derived net ${money(s.currency, rep.forecast.net)} (six-month mean, backtested).` : `Unavailable: ${rep.forecast.detail}`}</p></section>
                <section><h3 className="font-semibold">Verification</h3><p>{c.stages.filter(x => x.decision === 'AUTO_ACCEPTED').length} of {c.stages.length} stages auto-accepted after automated checks; {c.quarantine.length} items quarantined.</p></section>
                <section><h3 className="font-semibold">Limitations</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-xs">{rep.limitations.map(l => <li key={l}>{l}</li>)}</ul></section>
                <p className="text-xs text-[var(--muted)]">Processing {c.processingId} · {c.version}</p>
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
        <PageHeader eyebrow="Ask · verified answers" title="Finance Q&A" description={aiMode ? 'AI-assisted answers grounded in the verified processing context. Every figure is filled in from the records; answers that fail the checks are withheld.' : 'Rule-based answers from the verified processing context. Unsupported questions are refused rather than answered with invented figures.'} />
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
                <div aria-label="Suggested questions" className="flex flex-wrap gap-2"><span className="w-full text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Try asking</span>{(aiMode ? aiSuggestions(c) : suggestions(facts)).map(q => <button key={q} type="button" className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-left text-[13px] font-medium text-[var(--muted-strong)] transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)] hover:text-[var(--ink)] disabled:opacity-50" disabled={busy} onClick={() => ask(q)}>{q}</button>)}</div>
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

export function DemoModule({ view, context }: { view: DemoView; context: Ready }) {
    switch (view) {
        case 'overview': return <Overview c={context} />;
        case 'transactions': return <Transactions c={context} />;
        case 'reconciliation': return <Reconciliation c={context} />;
        case 'analytics': return <Analytics c={context} />;
        case 'anomalies': return <Anomalies c={context} />;
        case 'forecasting': return <Forecasting c={context} />;
        case 'reports': return <Reports c={context} />;
        case 'ask': return <Ask c={context} />;
    }
}
