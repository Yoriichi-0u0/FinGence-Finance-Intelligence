'use client';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { LineChart } from '@/components/charts';
import { PageHeader, Panel } from '@/components/ui';
import { fromCents } from '@/lib/poc-anomalies/source';
import { ACTIVITY_LABEL, ACTIVITY_RULE, type CashClassification } from '@/lib/cash-classification/classify';
import { biggestChanges, cashFlowStatement, cashRatios, changePercent, customerConcentration, operatingByMonth, type Ratio } from '@/lib/cash-classification/insights';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { SourceStrip, Stat, Unavailable, money, periodLabel, resultsEyebrow } from './shared';

const abs = (v: bigint) => v < 0n ? -v : v;
/** Statement style: payments in brackets, as published accounts show them. */
const acct = (currency: string, cents: bigint) => cents < 0n ? `(${money(currency, fromCents(-cents))})` : money(currency, fromCents(cents));
const pct = (v: number | null, signed = false) => v === null ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const ratioText = (r: Ratio, v: number | null) => v === null ? '—' : r.unit === 'x' ? `${v.toFixed(2)}×` : `${v.toFixed(1)}%`;
const label = (months: string[]) => periodLabel(months.length > 1 ? `${months[0]}/${months.at(-1)}` : months[0]);
const short = (months: string[]) => months.length === 12 && months[0].endsWith('-01') ? months[0].slice(0, 4) : months.length > 1 ? `${months[0].slice(2)}–${months.at(-1)!.slice(2)}` : periodLabel(months[0]);

/** A change in size, coloured by effect: more money in, or less money out, reads as favourable. Nothing before reads as new. */
function Change({ current, prior }: { current: bigint; prior: bigint | null }) {
    if (prior === null) return <span className="text-[var(--muted)]">—</span>;
    if (prior === 0n) return <span className="text-xs font-semibold text-[var(--muted)]">{current === 0n ? '—' : 'New'}</span>;
    const p = changePercent(abs(current), abs(prior))!, better = current > prior || (current === prior);
    if (current === prior) return <span className="tabular-nums text-[var(--muted)]">0.0%</span>;
    return <span className={`whitespace-nowrap font-semibold tabular-nums ${better ? 'text-[var(--good-ink)]' : 'text-[var(--bad-ink)]'}`}>{p > 0 ? '+' : ''}{p.toFixed(1)}%</span>;
}

function Bars({ title, rows, currency, total, priorLabel }: { title: string; rows: { category: string; current: bigint; prior: bigint | null }[]; currency: string; total: bigint; priorLabel: string | null }) {
    const max = rows.reduce((m, r) => abs(r.current) > m ? abs(r.current) : m, 1n);
    return <Panel title={title} eyebrow={`Share of ${money(currency, fromCents(abs(total)))}`}>
        <ul className="space-y-3.5 p-4 sm:p-5">{rows.map(r => {
            const share = total === 0n ? 0 : Number((abs(r.current) * 1000n) / abs(total)) / 10;
            return <li key={r.category}>
                <div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate font-medium">{r.category}</span><span className="shrink-0 tabular-nums"><span className="font-semibold">{money(currency, fromCents(abs(r.current)))}</span><span className="ml-2 text-xs text-[var(--muted)]">{share.toFixed(1)}%</span></span></div>
                <div aria-hidden="true" className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"><div className="h-full rounded-full bg-[var(--chart-in)]" style={{ width: `${Number((abs(r.current) * 1000n) / max) / 10}%` }} /></div>
                {priorLabel && r.prior !== null ? <p className="mt-1 text-xs text-[var(--muted)]">{priorLabel}: {money(currency, fromCents(abs(r.prior)))} · <Change current={r.current} prior={r.prior} /></p> : null}
            </li>;
        })}</ul>
    </Panel>;
}

export function ClassifiedAnalytics({ c, k }: { c: ProcessingContext & { scope: NonNullable<ProcessingContext['scope']> }; k: CashClassification }) {
    const currency = c.scope.currency, prior = k.prior, priorName = prior ? short(prior.months) : null, nowName = short(k.current.months);
    const statement = useMemo(() => cashFlowStatement(k), [k]), changes = useMemo(() => biggestChanges(k), [k]);
    const ratios = useMemo(() => cashRatios(k), [k]), customers = useMemo(() => customerConcentration(k), [k]), months = useMemo(() => operatingByMonth(k), [k]);
    const act = k.current.activities, net = BigInt(k.current.netCents), op = statement.find(s => s.activity === 'OPERATING');
    const payments = (op?.payments ?? []).filter(l => l.current !== 0n).slice(0, 8), receipts = (op?.receipts ?? []).filter(l => l.current !== 0n).slice(0, 6);
    const kpi = (a: 'OPERATING' | 'INVESTING' | 'FINANCING') => { const cur = BigInt(act[a].netCents), was = prior ? BigInt(prior.activities[a].netCents) : null; return { cur, detail: was === null ? undefined : `${priorName}: ${acct(currency, was)}` }; };
    const o = kpi('OPERATING'), i = kpi('INVESTING'), f = kpi('FINANCING');
    type Line = { key: string; label: string; current: bigint; prior: bigint | null; tone: 'head' | 'line' | 'total' | 'grand' };
    const lines: Line[] = [];
    for (const st of statement) {
        lines.push({ key: `${st.activity}-h`, label: `Cash flows from ${ACTIVITY_LABEL[st.activity].toLowerCase()}`, current: 0n, prior: null, tone: 'head' });
        for (const l of [...st.receipts.map(x => ({ ...x, kind: 'Received' })), ...st.payments.map(x => ({ ...x, kind: 'Paid' }))])
            lines.push({ key: `${st.activity}-${l.kind}-${l.category}`, label: `${l.kind}: ${l.category}`, current: l.current, prior: l.prior, tone: 'line' });
        lines.push({ key: `${st.activity}-n`, label: `Net cash ${st.net.current < 0n ? 'used in' : 'from'} ${st.activity.toLowerCase()} activities`, current: st.net.current, prior: st.net.prior, tone: 'total' });
    }
    lines.push({ key: 'net', label: 'Net increase in cash, equal to the bank movement', current: net, prior: prior ? BigInt(prior.netCents) : null, tone: 'grand' });
    const grid = prior ? 'sm:grid-cols-[minmax(0,1fr)_10rem_10rem_5.5rem]' : 'sm:grid-cols-[minmax(0,1fr)_10rem]';
    const statementView = <div role="table" aria-label="Statement of cash flows by category" className="text-sm">
        <div role="row" className={`hidden gap-x-4 border-b border-[var(--border)] px-4 py-2.5 text-xs font-semibold text-[var(--muted)] sm:grid sm:px-5 ${grid}`}><span role="columnheader">In {currency}</span><span role="columnheader" className="text-right">{nowName}</span>{prior ? <><span role="columnheader" className="text-right">{priorName}</span><span role="columnheader" className="text-right">Change</span></> : null}</div>
        {lines.map(l => l.tone === 'head'
            ? <div role="row" key={l.key} className="border-b border-[var(--border)] bg-[var(--surface-subtle)] px-4 pb-2 pt-4 sm:px-5"><span role="rowheader" className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--brand-ink)]">{l.label}</span></div>
            : <div role="row" key={l.key} className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 border-b border-[var(--border)] px-4 py-2.5 sm:px-5 ${grid} ${l.tone === 'line' ? '' : 'font-semibold'} ${l.tone === 'grand' ? 'bg-[var(--brand-soft)]' : ''}`}>
                <span role="rowheader" className={`min-w-0 ${l.tone === 'line' ? 'pl-3 text-[var(--muted-strong)]' : ''}`}>{l.label}</span>
                <span role="cell" className="text-right tabular-nums">{acct(currency, l.current)}</span>
                {prior ? <>
                    <span role="cell" className="col-span-2 text-xs text-[var(--muted)] tabular-nums sm:col-span-1 sm:text-right sm:text-sm sm:text-[var(--muted-strong)]"><span className="sm:hidden">{priorName}: </span>{l.prior === null || l.prior === 0n ? '—' : acct(currency, l.prior)}<span className="ml-2 sm:hidden"><Change current={l.current} prior={l.prior} /></span></span>
                    <span role="cell" className="hidden text-right sm:block"><Change current={l.current} prior={l.prior} /></span>
                </> : null}
            </div>)}
    </div>;

    return <>
        <PageHeader eyebrow={resultsEyebrow(c.scope)} title="Analytics" description="What drove your cash, sorted by the categories your own books use." />
        <SourceStrip context={c} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat tone="brand" label="Net cash from operating activities" value={acct(currency, o.cur)} detail={o.detail} />
            <Stat tone="plain" label="Investing activities" value={acct(currency, i.cur)} detail={i.detail ?? 'Equipment and other long-term assets'} />
            <Stat tone="plain" label="Financing activities" value={acct(currency, f.cur)} detail={f.detail ?? 'Loans, dividends and capital'} />
            <Stat tone="good" label="Net movement in cash" value={acct(currency, net)} detail={`${k.current.booksShare ?? '0'}% of cash classified by your books`} />
        </div>

        <div className="mt-5"><Panel title="Statement of cash flows" eyebrow={`Direct method · cash basis · ${prior ? `${label(k.current.months)} against ${label(prior.months)}` : label(k.current.months)}`}>
            {statementView}
            <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)] sm:px-5">Categories are your books’ own. Payments are shown in brackets. {prior ? 'Earlier months are classified by payee from the same books. ' : ''}This is a cash statement, not a profit and loss statement.</p>
        </Panel></div>

        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
            <Bars title="Where cash went" rows={payments} currency={currency} total={BigInt(act.OPERATING.outCents)} priorLabel={priorName} />
            <div className="min-w-0 space-y-5">
                <Bars title="Where cash came from" rows={receipts} currency={currency} total={BigInt(act.OPERATING.inCents)} priorLabel={priorName} />
                {customers.top ? <Panel title="Customer concentration" eyebrow={`${customers.customers} paying customers and channels`}>
                    <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                        <div><p className="text-[12px] text-[var(--muted)]">Largest source of receipts</p><p className="mt-1 font-semibold">{customers.top.name}</p><p className="text-2xl font-semibold tabular-nums">{pct(customers.top.share)}</p></div>
                        <div><p className="text-[12px] text-[var(--muted)]">Top three together</p><p className="mt-1 text-2xl font-semibold tabular-nums">{pct(customers.topThreeShare)}</p><p className="text-xs text-[var(--muted)]">{(customers.topThreeShare ?? 0) > 75 ? 'Receipts depend heavily on a few sources.' : 'Receipts are spread across several sources.'}</p></div>
                    </div>
                </Panel> : null}
            </div>
        </div>

        <div className={`mt-5 grid min-w-0 gap-5 ${changes.length ? 'xl:grid-cols-2' : ''}`}>
            <Panel title="Key cash ratios" eyebrow={prior ? `${nowName} against ${priorName}` : nowName}>
                <ul className="divide-y divide-[var(--border)]">{ratios.map(r => <li key={r.id} className="flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
                    <div className="min-w-0"><p className="text-sm font-semibold">{r.label}</p><p className="text-xs text-[var(--muted)]">{r.detail}{r.monthly ? ` About ${money(currency, fromCents(r.monthly))} a month.` : ''}</p></div>
                    <div className="shrink-0 text-right"><p className="text-xl font-semibold tabular-nums">{ratioText(r, r.current)}</p>{prior ? <p className="text-xs text-[var(--muted)] tabular-nums">{priorName}: {ratioText(r, r.prior)}</p> : null}</div>
                </li>)}</ul>
            </Panel>
            {changes.length ? <Panel title={`What changed against ${priorName}`} eyebrow="Largest movements by category">
                <ul className="divide-y divide-[var(--border)]">{changes.map(x => {
                    const inflow = x.current > 0n || x.prior > 0n, grew = abs(x.current) > abs(x.prior);
                    return <li key={x.category} className="flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
                        <div className="min-w-0"><p className="text-sm font-semibold">{x.category}</p><p className="text-xs text-[var(--muted)]">{inflow ? 'Received' : 'Paid'} {money(currency, fromCents(abs(x.current)))}, against {money(currency, fromCents(abs(x.prior)))}</p></div>
                        <p className={`shrink-0 text-right text-sm font-semibold tabular-nums ${x.change > 0n ? 'text-[var(--good-ink)]' : 'text-[var(--bad-ink)]'}`}>{grew ? 'Up' : 'Down'} {money(currency, fromCents(abs(abs(x.current) - abs(x.prior))))}<span className="block text-xs font-medium">{x.percent === null ? 'new' : pct(Math.abs(x.percent))}</span></p>
                    </li>;
                })}</ul>
            </Panel> : null}
        </div>

        {months.length > 1 ? <div className="mt-5"><Panel title="Operating cash, month by month" eyebrow={prior ? `Net operating cash against the same month of ${priorName}` : 'Receipts, payments and net'}>
            <div className="p-3 sm:p-4"><LineChart ariaLabel="Operating receipts, payments and net by month" labels={months.map(m => m.period.slice(2))} series={[
                { label: 'Receipts', color: 'var(--chart-in)', values: months.map(m => Number(m.receipts) / 100) },
                { label: 'Payments', color: 'var(--chart-out)', values: months.map(m => Number(-m.payments) / 100) },
                { label: 'Net operating cash', color: 'var(--chart-net)', values: months.map(m => Number(m.net) / 100), fill: true },
                ...(prior ? [{ label: `Net, ${priorName}`, color: 'var(--muted)', dashed: true, values: months.map(m => m.priorNet === null ? null : Number(m.priorNet) / 100) }] : []),
            ]} /></div>
        </Panel></div> : <div className="mt-5"><Unavailable title="No monthly trend yet" detail="Only one month is available. Add a bank history file on Data to see operating cash month by month and against last year." action={{ href: '/data', label: 'Open Data' }} /></div>}

        <details className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
            <summary className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 font-semibold text-[var(--brand-ink)]"><ChevronRight aria-hidden="true" size={15} className="disclosure-chevron transition-transform" />How FinGence classifies cash</summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[var(--muted-strong)]">
                <li>A bank record the reconciliation settled against your books takes the category your books give that entry, word for word. {k.current.booksShare ?? '0'}% of this period’s cash, by value, is classified this way.</li>
                <li>A record your books do not show is named by a stated bank rule (a bank charge, interest credited, a payment the bank repeated) or listed as “Not in your books”.</li>
                <li>{ACTIVITY_RULE}</li>
                {prior ? <li>{prior.payeeRule} {prior.classifiedShare ?? '0'}% of {label(prior.months)} is classified this way.</li> : null}
                {k.checks.map(x => <li key={x.id}>{x.passed ? 'Passed' : 'Failed'}: {x.label} ({x.detail}).</li>)}
            </ul>
        </details>
    </>;
}
