'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Download, Printer, Send } from 'lucide-react';
import { LineChart } from '@/components/charts';
import { PageHeader, Panel } from '@/components/ui';
import { RULES, type RuleId } from '@/lib/poc-anomalies/detector';
import { fromCents, toCents } from '@/lib/poc-anomalies/source';
import { cashTotals } from '@/lib/poc-insights/model';
import { reconciliationStatuses, type ReconciliationStatus } from '@/lib/poc-reconciliation/contracts';
import { answerQuestion, suggestions, MAX_QUESTION, type QaAnswer } from '@/lib/poc-finance-qa/answer';
import { qaFacts } from '@/lib/demo/questions';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { DecisionBadge, SourceStrip, Stat, Table, Unavailable, button, usesOwnDocuments, money, outflow, primaryButton } from './shared';

export type DemoView = 'overview' | 'transactions' | 'reconciliation' | 'analytics' | 'anomalies' | 'forecasting' | 'reports' | 'ask';
type Ready = ProcessingContext & { scope: NonNullable<ProcessingContext['scope']>; outputs: ProcessingContext['outputs'] & { reconciliation: NonNullable<ProcessingContext['outputs']['reconciliation']>; totals: NonNullable<ProcessingContext['outputs']['totals']>; forecast: NonNullable<ProcessingContext['outputs']['forecast']>; report: NonNullable<ProcessingContext['outputs']['report']> } };
export const isReady = (c: ProcessingContext | null): c is Ready => !!c?.scope && !!c.outputs.reconciliation && !!c.outputs.totals && !!c.outputs.forecast && !!c.outputs.report;

const STATUS_LABEL: Record<ReconciliationStatus, string> = { MATCH_EXACT: 'Exact match', MATCH_DATE_SHIFT: 'Posting-date shift', BANK_ONLY: 'Bank only', LEDGER_ONLY: 'Ledger only', AMOUNT_MISMATCH_REVIEW: 'Amount review', AMBIGUOUS_DUPLICATE_LEDGER: 'Duplicate ambiguity', REFERENCE_MISMATCH_REVIEW: 'Reference review' };
const matched = (s: ReconciliationStatus) => s === 'MATCH_EXACT' || s === 'MATCH_DATE_SHIFT';
const PAGE = 20;
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    return <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] p-3 text-xs"><button type="button" className={button} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page + 1} of {pages} · {total} rows</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</button></div>;
}

function Overview({ c }: { c: Ready }) {
    const { scope: s, outputs: o } = c, r = o.reconciliation, f = o.forecast.forecast;
    const checks = c.stages.flatMap(x => x.checks), exceptions = c.quarantine.filter(q => q.kind === 'RECONCILIATION_EXCEPTION').length;
    return <>
        <PageHeader title="Overview" description={`Verified results for ${s.businessName}, ${s.period}, from one processing of your documents.`} />
        <SourceStrip context={c} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Net signed bank movement" value={money(s.currency, o.totals.net)} detail={`In ${money(s.currency, o.totals.credits)} · out ${outflow(s.currency, o.totals.debits)}`} />
            <Stat label="Bank − ledger difference" value={money(s.currency, r.cashMovement.signedDifference)} detail={`Ledger cash account ${money(s.currency, r.cashMovement.ledger)}`} />
            <Stat label="Reconciled automatically" value={`${r.counts.MATCH_EXACT + r.counts.MATCH_DATE_SHIFT} of ${r.results.length}`} detail={`${exceptions} exceptions quarantined, none cleared`} />
            <Stat label="Next-month cash baseline" value={f.status === 'AVAILABLE' ? money(s.currency, f.net) : 'Unavailable'} detail={f.status === 'AVAILABLE' ? `${f.period} net · six-month mean, not AI` : f.detail} />
        </div>
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
            <Panel title="Automated verification" eyebrow="Trust model">
                <div className="space-y-3 p-4 text-sm sm:p-5">
                    <p><strong>{checks.filter(k => k.passed).length} of {checks.length}</strong> automated checks passed across {c.stages.length} stages. No routine manual approval was needed.</p>
                    <p><strong>{c.quarantine.length}</strong> items are quarantined for exception handling: {exceptions} reconciliation exceptions, {o.anomalies.length} anomaly candidates{c.quarantine.some(q => q.kind === 'DOCUMENT' || q.kind === 'HISTORY') ? ' and quarantined documents' : ''}. Quarantined items are never treated as established facts.</p>
                    <ul className="grid gap-2 sm:grid-cols-2">{c.stages.map(x => <li key={x.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"><span className="min-w-0 text-xs font-medium">{x.title}</span><DecisionBadge decision={x.decision} label={x.decision === 'AUTO_ACCEPTED' ? 'Verified' : undefined} /></li>)}</ul>
                </div>
            </Panel>
            <Panel title="Connected results" eyebrow="Same processing context">
                <ul className="divide-y divide-[var(--border)] text-sm">
                    {[['/transactions', 'Transactions', `${o.totals.rows} bank records · ${o.ledger?.rows.length ?? 0} ledger entries`], ['/reconciliation', 'Reconciliation', `${reconciliationStatuses.filter(k => r.counts[k]).length} outcome categories`], ['/analytics', 'Analytics', o.history.accepted ? `${o.history.months.length} months of bank history` : 'Statement month only'], ['/anomalies', 'Anomalies', `${o.anomalies.length} rule-based candidates`], ['/forecasting', 'Forecasting', f.status === 'AVAILABLE' ? `${f.period} baseline` : 'Unavailable for this input'], ['/reports', 'Reports', 'Management summary and JSON evidence'], ['/ask', 'Finance Q&A', 'Rule-based answers from these figures']].map(([href, label, detail]) =>
                        <li key={href}><Link href={href} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5"><span className="font-semibold">{label}</span><span className="text-right text-xs text-[var(--muted)]">{detail}</span></Link></li>)}
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
        <PageHeader title="Transactions" description="Normalized records from the verified bank statement and cash-account ledger." />
        <SourceStrip context={c} />
        <div className="mb-4 grid gap-3 sm:grid-cols-3"><Stat label="Bank cash in (credits)" value={money(s.currency, totals.credits)} detail={`${totals.creditRows} records shown`} /><Stat label="Bank cash out (debits)" value={outflow(s.currency, totals.debits)} detail={`${totals.debitRows} records shown`} /><Stat label="Net signed movement" value={money(s.currency, totals.net)} detail={`${totals.rows} of ${c.outputs.bankRows.length} bank records`} /></div>
        <Panel>
            <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:flex-wrap sm:items-end">
                <div role="tablist" aria-label="Document" className="flex gap-2">{(['bank', 'ledger'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? primaryButton : button} onClick={() => { setTab(t); setPage(0); }}>{t === 'bank' ? 'Bank statement' : 'General ledger'}</button>)}</div>
                <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium">Search<input className="min-h-11 rounded-lg border border-[var(--border-strong)] px-3 text-sm" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="ID, description, counterparty or reference" /></label>
                <label className="grid gap-1 text-xs font-medium">Direction<select className="min-h-11 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm" value={direction} onChange={e => { setDirection(e.target.value); setPage(0); }}><option value="">All</option><option value="Credit">Cash in</option><option value="Debit">Cash out</option></select></label>
            </div>
            {tab === 'bank' ? <Table caption="Bank statement records" columns={['Date', 'Record', 'Description', 'Counterparty', 'Signed amount']} rows={bank.slice(page * PAGE, page * PAGE + PAGE).map(r => [r.date, <span key="i" className="whitespace-nowrap text-xs">{r.rowId}</span>, <span key="d" className="text-xs">{r.description}</span>, r.counterparty, <span key="a" className="whitespace-nowrap tabular-nums">{money(r.currency, r.signedAmount)}</span>])} />
                : <Table caption="General ledger cash entries" columns={['Posting date', 'Entry', 'Memo', 'Reference', 'Signed amount']} rows={ledger.slice(page * PAGE, page * PAGE + PAGE).map(r => [r.date, <span key="i" className="whitespace-nowrap text-xs">{r.recordId}</span>, <span key="d" className="text-xs">{r.description}</span>, <span key="r" className="text-xs">{r.reference}</span>, <span key="a" className="whitespace-nowrap tabular-nums">{money(r.currency, fromCents(BigInt(r.signedCents)))}</span>])} />}
            <Pager page={page} total={rows} onPage={setPage} />
        </Panel>
    </>;
}

function Reconciliation({ c }: { c: Ready }) {
    const r = c.outputs.reconciliation, s = c.scope, [filter, setFilter] = useState<ReconciliationStatus | 'EXCEPTIONS' | 'ALL'>('EXCEPTIONS'), [page, setPage] = useState(0), [open, setOpen] = useState<number | null>(null);
    const visible = r.results.filter(x => filter === 'ALL' || (filter === 'EXCEPTIONS' ? !matched(x.status) : x.status === filter)), chosen = open === null ? null : visible[open];
    return <>
        <PageHeader title="Reconciliation" description="Deterministic bank-to-ledger matching for the verified source pair. Exceptions stay open; nothing is cleared automatically." />
        <SourceStrip context={c} />
        <div className="mb-4 grid gap-3 sm:grid-cols-3"><Stat label="Bank cash movement" value={money(s.currency, r.cashMovement.bank)} /><Stat label="Ledger cash movement" value={money(s.currency, r.cashMovement.ledger)} /><Stat label="Signed bank − ledger difference" value={money(s.currency, r.cashMovement.signedDifference)} detail="Cause is not inferred" /></div>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{reconciliationStatuses.map(k => <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setPage(0); setOpen(null); }} className={`min-h-11 rounded-lg border p-2.5 text-left ${filter === k ? 'border-[var(--teal)] bg-[var(--teal-soft)]' : 'border-[var(--border)] bg-white'}`}><span className="block text-xs">{STATUS_LABEL[k]}</span><span className="text-xl font-semibold tabular-nums">{r.counts[k]}</span></button>)}</div>
        <div className="mb-3 flex flex-wrap gap-2">{([['EXCEPTIONS', 'Quarantined exceptions'], ['ALL', 'All outcomes']] as const).map(([k, label]) => <button key={k} type="button" className={filter === k ? primaryButton : button} onClick={() => { setFilter(k); setPage(0); setOpen(null); }}>{label}</button>)}</div>
        <Panel>
            <Table caption="Reconciliation outcomes" columns={['Outcome', 'Bank record', 'Ledger record(s)', 'Reason', 'Evidence']} rows={visible.slice(page * PAGE, page * PAGE + PAGE).map((x, i) => [
                <DecisionBadge key="s" decision={matched(x.status) ? 'AUTO_ACCEPTED' : 'QUARANTINED'} label={STATUS_LABEL[x.status]} />, <span key="b" className="whitespace-nowrap text-xs">{x.bankRecordId ?? '—'}</span>, <span key="l" className="text-xs">{x.ledgerRecordIds.length ? x.ledgerRecordIds.map(id => <span key={id} className="block whitespace-nowrap">{id}</span>) : '—'}</span>, <span key="r" className="text-xs">{x.reason}</span>,
                <button key="e" type="button" className="min-h-11 text-xs font-semibold text-[var(--teal-dark)] underline" onClick={() => setOpen(page * PAGE + i)}>Inspect</button>])} />
            <Pager page={page} total={visible.length} onPage={p => { setPage(p); setOpen(null); }} />
        </Panel>
        {chosen ? <div className="mt-4"><Panel title={`${STATUS_LABEL[chosen.status]} · source evidence`}><div className="grid gap-3 p-4 md:grid-cols-2">{(['bank', 'ledger'] as const).map(kind => <section key={kind} className="min-w-0 rounded-lg border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">{kind === 'bank' ? 'Bank statement' : 'General ledger'}</h3>
            {(kind === 'bank' ? chosen.bankEvidenceIds : chosen.ledgerEvidenceIds).filter(id => /:(BankTransactionID|LedgerEntryID|ValueDate|PostingDate|BankReference|LedgerReference|SignedCashMovementMYR|BankDescription|LedgerMemo)$/.test(id)).map(id => { const e = r.evidence[id]; return <p key={id} className="mt-2 break-all text-xs"><strong>CSV record {e.row} · {e.field}</strong>: {e.literal}</p>; })}
            {!(kind === 'bank' ? chosen.bankEvidenceIds : chosen.ledgerEvidenceIds).length ? <p className="mt-2 text-xs text-[var(--muted)]">No record on this side.</p> : null}</section>)}</div></Panel></div> : null}
        <p className="mt-4 text-xs text-[var(--muted)]">Rules: a unique reference with equal signed cents within two days matches; everything else is quarantined as an exception. Persisted human exception review is available in the authenticated local workflow only.</p>
    </>;
}

function Analytics({ c }: { c: Ready }) {
    const s = c.scope, o = c.outputs, days = useMemo(() => { const map = new Map<string, bigint>(); for (const r of o.bankRows) map.set(r.date, (map.get(r.date) ?? 0n) + toCents(r.signedAmount)); const points: { d: string; v: number }[] = []; let total = 0n; for (const [d, v] of [...map.entries()].sort()) { total += v; points.push({ d, v: Number(total) / 100 }); } return points; }, [o.bankRows]);
    const months = o.history.accepted ? o.history.months.map(p => ({ p, ...cashTotals(o.history.rows.filter(r => r.period === p)) })) : [];
    const parties = useMemo(() => { const map = new Map<string, { in: bigint; out: bigint; n: number }>(); for (const r of o.bankRows) { const e = map.get(r.counterparty) ?? { in: 0n, out: 0n, n: 0 }; const v = toCents(r.signedAmount); if (v >= 0n) e.in += v; else e.out += v; e.n++; map.set(r.counterparty, e); } return [...map.entries()].sort((a, b) => Number((b[1].in - b[1].out) - (a[1].in - a[1].out))).slice(0, 8); }, [o.bankRows]);
    return <>
        <PageHeader title="Analytics" description="Exact cash movement metrics and trends calculated from the verified bank records." />
        <SourceStrip context={c} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Bank cash in (credits)" value={money(s.currency, o.totals.credits)} detail={`${o.totals.creditRows} records`} /><Stat label="Bank cash out (debits)" value={outflow(s.currency, o.totals.debits)} detail={`${o.totals.debitRows} records`} /><Stat label="Net signed movement" value={money(s.currency, o.totals.net)} /><Stat label="Observed months" value={String(o.history.accepted ? o.history.months.length : 1)} detail={o.history.accepted ? `${o.history.months[0]} to ${o.history.months.at(-1)}` : 'Statement month only'} /></div>
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
            <Panel title={`Cumulative net movement, ${s.period}`} eyebrow="Daily, from bank records"><div className="p-3"><LineChart ariaLabel={`Cumulative net bank movement by day in ${s.period}`} labels={days.map(x => x.d.slice(8))} series={[{ label: 'Cumulative net', color: 'var(--teal)', values: days.map(x => x.v), fill: true }]} formatValue={v => `${Math.round(v / 1000)}K`} /></div></Panel>
            {months.length ? <Panel title="Monthly bank movement" eyebrow="Verified history"><div className="p-3"><LineChart ariaLabel="Monthly cash in, cash out and net" labels={months.map(m => m.p.slice(2))} series={[{ label: 'Cash in', color: 'var(--teal)', values: months.map(m => Number(m.credits)) }, { label: 'Cash out', color: 'var(--indigo)', values: months.map(m => -Number(m.debits)) }, { label: 'Net', color: 'var(--amber)', values: months.map(m => Number(m.net)), dashed: true }]} /></div></Panel>
                : <Unavailable title="Monthly trend unavailable" detail="Only the statement month is observed. Process an accepted bank history to see monthly trends." />}
        </div>
        <div className="mt-5"><Panel title="Largest counterparties by gross movement" eyebrow="Statement month"><Table caption="Counterparties" columns={['Counterparty', 'Records', 'Cash in', 'Cash out']} rows={parties.map(([name, e]) => [name, e.n, money(s.currency, fromCents(e.in)), outflow(s.currency, fromCents(e.out))])} /></Panel></div>
        <p className="mt-4 text-xs text-[var(--muted)]">Receipts and payments are bank cash directions, not revenue or expenses; no ratios or profitability are derived without an accounting classification.</p>
    </>;
}

function Anomalies({ c }: { c: Ready }) {
    const list = c.outputs.anomalies, ids = Object.keys(RULES) as RuleId[];
    return <>
        <PageHeader title="Anomalies" description="Transparent rule findings on the verified bank records. Candidates are quarantined for review; they are not fraud findings." />
        <SourceStrip context={c} />
        <div className="grid gap-3 sm:grid-cols-3"><Stat label="Anomaly candidates" value={`${list.length} of ${c.outputs.bankRows.length}`} detail="Rows with at least one rule finding" /><Stat label="High severity" value={String(list.filter(x => x.severity === 'HIGH').length)} /><Stat label="Medium severity" value={String(list.filter(x => x.severity === 'MEDIUM').length)} /></div>
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel title="Candidates"><ul className="divide-y divide-[var(--border)]">{list.length ? list.map(x => <li key={x.row.rowId} className="p-4 text-sm sm:px-5"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{x.row.date} · <span className="break-all">{x.row.rowId}</span> · {money(x.row.currency, x.row.signedAmount)}</p><DecisionBadge decision="QUARANTINED" label={`${x.severity === 'HIGH' ? 'High' : 'Medium'} · for review`} /></div><p className="mt-1 text-xs text-[var(--muted)]">{x.row.counterparty} · {x.row.description}</p><ul className="mt-2 space-y-1 text-xs">{x.findings.map(f => <li key={f.ruleId}><strong>{RULES[f.ruleId].title}:</strong> {f.rationale}</li>)}</ul></li>) : <li className="p-5 text-sm">No rule produced a candidate for these records.</li>}</ul></Panel>
            <Panel title="Rules"><ul className="space-y-3 p-4 text-xs sm:p-5">{ids.map(id => <li key={id}><p className="font-semibold">{RULES[id].title} · {list.filter(x => x.findings.some(f => f.ruleId === id)).length}</p><p className="text-[var(--muted)]">{RULES[id].basis}</p></li>)}</ul></Panel>
        </div>
    </>;
}

function Forecasting({ c }: { c: Ready }) {
    const s = c.scope, bf = c.outputs.forecast, f = bf.forecast;
    return <>
        <PageHeader title="Forecasting" description="A next-month cash baseline, shown only when the verified history is long enough to backtest it." />
        <SourceStrip context={c} />
        {f.status === 'UNAVAILABLE' ? <Unavailable title="Forecast unavailable for this input" detail={`${f.detail} Observed: ${bf.history.length} month${bf.history.length === 1 ? '' : 's'}. Add an accepted bank history of at least seven consecutive months for the same business and currency.`} /> : <>
            <div className="grid gap-3 sm:grid-cols-3"><Stat label={`${f.period} bank cash in`} value={money(s.currency, f.credits)} /><Stat label={`${f.period} bank cash out`} value={outflow(s.currency, f.debits)} /><Stat label={`${f.period} net (derived)`} value={money(s.currency, f.net)} detail="Net is the least reliable figure" /></div>
            <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
                <Panel title="History and baseline" eyebrow={`Six-month mean of ${f.basis.first} to ${f.basis.last}`}><div className="p-3"><LineChart ariaLabel="Monthly net movement and next-month baseline" labels={[...bf.history.map(m => m.period.slice(2)), f.period.slice(2)]} series={[{ label: 'Observed net', color: 'var(--teal)', values: [...bf.history.map(m => Number(m.net)), null] }, { label: 'Baseline', color: 'var(--amber)', dashed: true, values: [...bf.history.map((_, i) => i === bf.history.length - 1 ? Number(bf.history[i].net) : null), Number(f.net)] }]} /></div></Panel>
                <Panel title="Rolling-origin backtests" eyebrow={`${f.tests} test months`}><Table caption="Backtest error" columns={['Metric', 'Last month WAPE', '3-month mean WAPE', '6-month mean WAPE']} rows={(['credits', 'debits', 'net'] as const).map(m => [m === 'credits' ? 'Cash in' : m === 'debits' ? 'Cash out' : 'Net', ...(['LAST_MONTH', 'MEAN_3', 'MEAN_6'] as const).map(k => { const w = f.backtest[m].methods.find(x => x.method === k)?.wape; return w === null || w === undefined ? 'n/a' : `${w}%`; })])} /></Panel>
            </div>
        </>}
        <p className="mt-4 text-xs text-[var(--muted)]">Deterministic statistical baseline (mean of the last six months) with rolling-origin backtests. No trained or AI forecasting model is used.</p>
    </>;
}

function Reports({ c }: { c: Ready }) {
    const s = c.scope, rep = c.outputs.report, r = c.outputs.reconciliation;
    function download() {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ ...rep, stages: c.stages.map(({ id, decision, summary, checks }) => ({ id, decision, summary, checks })), quarantine: c.quarantine }, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `fingence-summary-${c.processingId}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return <>
        <PageHeader title="Reports" description="Management summary generated from the same processing context as every other page." actions={<div className="flex flex-wrap gap-2 print:hidden"><button type="button" className={button} onClick={download}><Download aria-hidden="true" size={16} />JSON evidence</button><button type="button" className={primaryButton} onClick={() => window.print()}><Printer aria-hidden="true" size={16} />Print or save PDF</button></div>} />
        <SourceStrip context={c} />
        <Panel title={`Management summary · ${s.businessName} · ${s.period}`} eyebrow={`${usesOwnDocuments(c) ? 'Your documents, processed locally' : 'Fictional sample documents'} · not for financial publication`}>
            <div className="space-y-5 p-4 text-sm sm:p-5">
                <section><h3 className="font-semibold">Sources</h3><ul className="mt-1 space-y-1 text-xs">{rep.sources.map(x => <li key={x.sha256} className="break-all">{x.role.replace('_', ' ').toLowerCase()}: {x.name} · SHA-256 {x.sha256}</li>)}</ul></section>
                <section><h3 className="font-semibold">Bank cash movement</h3><p>Cash in {money(s.currency, rep.cash.credits)} ({rep.cash.creditRows} records); cash out {outflow(s.currency, rep.cash.debits)} ({rep.cash.debitRows}); net {money(s.currency, rep.cash.net)}. Not revenue, profit or a cash flow statement.</p></section>
                <section><h3 className="font-semibold">Reconciliation</h3><p>Bank {money(s.currency, r.cashMovement.bank)} − ledger {money(s.currency, r.cashMovement.ledger)} = {money(s.currency, r.cashMovement.signedDifference)}.</p><p className="mt-1 text-xs">{reconciliationStatuses.map(k => `${STATUS_LABEL[k]} ${r.counts[k]}`).join(' · ')}. Exceptions remain open; none is cleared automatically.</p></section>
                <section><h3 className="font-semibold">Anomaly candidates</h3><p>{rep.anomalyCandidates} of {rep.cash.rows} bank records have a rule finding and are quarantined for review. They are not fraud findings.</p></section>
                <section><h3 className="font-semibold">Forecast</h3><p>{rep.forecast.status === 'AVAILABLE' ? `${rep.forecast.period} baseline: cash in ${money(s.currency, rep.forecast.credits)}, cash out ${outflow(s.currency, rep.forecast.debits)}, derived net ${money(s.currency, rep.forecast.net)} (six-month mean, backtested).` : `Unavailable: ${rep.forecast.detail}`}</p></section>
                <section><h3 className="font-semibold">Verification</h3><p>{c.stages.filter(x => x.decision === 'AUTO_ACCEPTED').length} of {c.stages.length} stages auto-accepted after automated checks; {c.quarantine.length} items quarantined.</p></section>
                <section><h3 className="font-semibold">Limitations</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-xs">{rep.limitations.map(l => <li key={l}>{l}</li>)}</ul></section>
                <p className="text-xs text-[var(--muted)]">Processing {c.processingId} · {c.version}</p>
            </div>
        </Panel>
    </>;
}

const DEMO_LINK: Record<string, string> = { '/transactions': '/transactions', '/anomalies': '/anomalies', '/reconciliation': '/reconciliation', '/forecasting': '/forecasting' };
function Ask({ c }: { c: Ready }) {
    const facts = useMemo(() => qaFacts(c), [c]), [answers, setAnswers] = useState<QaAnswer[]>([]), [question, setQuestion] = useState('');
    if (!facts) return <Unavailable title="Questions unavailable" detail="The processing context has no verified facts." />;
    const ask = (q: string) => { if (!q.trim() || q.length > MAX_QUESTION) return; setAnswers(list => [answerQuestion(facts, q), ...list].slice(0, 8)); setQuestion(''); };
    // Evidence links point at this demo's pages; the management report lives on Reports here.
    const href = (h: string) => h.includes('#management-report') ? '/reports' : DEMO_LINK[h.split(/[?#]/)[0]] ?? '/data';
    return <>
        <PageHeader title="Finance Q&A" description="Rule-based answers from the verified processing context. Unsupported questions are refused rather than answered with invented figures." />
        <p className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--teal-soft)] p-3 text-sm"><strong>Rule-based source assistant, not live AI.</strong> A fixed set of question types is answered with figures copied from this processing; profit, ratio, advice, fraud and cause questions are refused.</p>
        <SourceStrip context={c} />
        <Panel>
            <div className="space-y-3 p-4 sm:p-5">
                <div aria-label="Suggested questions" className="flex flex-wrap gap-2">{suggestions(facts).map(q => <button key={q} type="button" className={button} onClick={() => ask(q)}>{q}</button>)}</div>
                <form className="flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); ask(question); }}><label className="sr-only" htmlFor="demo-question">Question</label><input id="demo-question" className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border-strong)] px-3 text-sm" maxLength={MAX_QUESTION} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about this processing, for example: How many transactions were matched?" /><button className={primaryButton} disabled={!question.trim()}><Send aria-hidden="true" size={16} />Ask</button></form>
            </div>
        </Panel>
        <section aria-label="Answers" className="mt-4 space-y-3">{answers.map((a, i) => <article key={answers.length - i} className="panel-shadow rounded-xl border border-[var(--border)] bg-white p-4 text-sm sm:p-5">
            <header className="flex flex-wrap items-center justify-between gap-2"><p className="text-[var(--muted)]">{a.question}</p><DecisionBadge decision={a.status === 'ANSWERED' ? 'AUTO_ACCEPTED' : a.status === 'REFUSED' ? 'QUARANTINED' : 'UNAVAILABLE'} label={a.status === 'ANSWERED' ? 'Answered from source' : a.status === 'REFUSED' ? 'Refused' : 'Unavailable'} /></header>
            <p className="mt-2 text-base font-semibold">{a.headline}</p><p className="mt-1 leading-relaxed text-[var(--muted-strong)]">{a.interpretation}</p>
            {a.facts.length ? <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{a.facts.filter(f => f.unit !== 'TEXT').map(f => <div key={f.id} className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-xs text-[var(--muted)]">{f.label}</dt><dd className="font-semibold tabular-nums">{f.unit === 'MONEY' ? money(f.currency ?? '', f.value) : f.unit === 'PERCENT' ? `${f.value}%` : f.value}</dd></div>)}</dl> : null}
            {a.evidence.length ? <p className="mt-3 flex flex-wrap gap-3 text-xs">{a.evidence.map(e => <Link key={e.label} href={href(e.href)} className="font-semibold text-[var(--teal-dark)] underline">{e.label}</Link>)}</p> : null}
        </article>)}</section>
    </>;
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
