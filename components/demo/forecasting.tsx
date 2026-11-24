'use client';
import { ChevronRight } from 'lucide-react';
import { LineChart } from '@/components/charts';
import { PageHeader, Panel } from '@/components/ui';
import { toCents } from '@/lib/poc-anomalies/source';
import { HORIZON, METHOD_LABEL, PATTERN_LABEL, type CashForecastPlan } from '@/lib/cash-forecast/plan';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { SourceStrip, Stat, Table, money, outflow, periodLabel, resultsEyebrow } from './shared';

type Plan = Extract<CashForecastPlan, { status: 'AVAILABLE' }>;
const abs = (v: string) => v.replace(/^-/, '');
const signed = (currency: string, v: string) => toCents(v) < 0n ? `−${money(currency, abs(v))}` : money(currency, v);
const short = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const total = (values: string[]) => values.reduce((t, v) => t + toCents(v), 0n);
const cents = (v: bigint) => { const a = v < 0n ? -v : v; return `${v < 0n ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`; };

export function CashPlanView({ c, plan, technical }: { c: ProcessingContext & { scope: NonNullable<ProcessingContext['scope']> }; plan: Plan; technical: React.ReactNode }) {
    const currency = plan.currency, p = plan.projection, next = p[0], end = p.at(-1)!, a = plan.accuracy, hasBalance = next.balance !== null;
    const regular = plan.categories.filter(x => x.pattern !== 'ONE_OFF'), history = plan.history.slice(-12);
    const labels = [...history.map(h => h.period.slice(2)), ...p.map(x => x.period.slice(2))];
    const observed = hasBalance ? history.map(h => h.balance === null ? null : Number(h.balance)) : (() => { let t = 0; return history.map(h => (t += Number(h.net))); })();
    const startAt = observed.at(-1) ?? 0, projected = p.map(x => hasBalance ? Number(x.balance) : startAt + Number(x.cumulativeNet));
    const band = (sign: 1 | -1) => p.map((x, i) => x.range === null ? null : projected[i] + sign * Number(x.range));
    const lead = (arr: (number | null)[]) => [...history.map((_, i) => i === history.length - 1 ? startAt : null), ...arr];

    return <>
        <PageHeader eyebrow={resultsEyebrow(c.scope)} title="Forecasting" description={`Your cash for the next ${HORIZON} months, planned category by category from your verified history, with the range past forecasts actually missed by.`} />
        <SourceStrip context={c} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {hasBalance
                ? <Stat tone="brand" label={`Cash at the end of ${periodLabel(end.period)}`} value={money(currency, end.balance!)} detail={end.low ? `Likely between ${money(currency, end.low)} and ${money(currency, end.high!)}` : `From ${money(currency, plan.history.at(-1)!.balance!)} at the end of ${periodLabel(plan.history.at(-1)!.period)}`} />
                : <Stat tone="brand" label={`Change in cash to ${periodLabel(end.period)}`} value={signed(currency, end.cumulativeNet)} detail="Add a bank history with running balances to see the cash balance" />}
            <Stat tone="good" label={`Expected net, ${periodLabel(next.period)}`} value={signed(currency, next.net)} detail={next.range ? `Typically within ± ${money(currency, next.range)}` : `Receipts ${money(currency, next.receipts)} · payments ${outflow(currency, next.payments)}`} />
            <Stat tone="plain" label="Regular and scheduled payments" value={outflow(currency, plan.commitments.total)} detail={`Next three months, ${periodLabel(`${plan.commitments.months[0]}/${plan.commitments.months.at(-1)}`)}`} />
            <Stat tone="plain" label="Tested accuracy" value={a?.receiptsWape ? `±${Number(a.receiptsWape).toFixed(1)}%` : 'Not yet tested'} detail={a ? `Receipts, over ${a.tests} months already known; a plain average missed by ${a.baseline.receiptsWape ? Number(a.baseline.receiptsWape).toFixed(1) : '—'}%` : 'Needs more months of history'} />
        </div>

        <div className="mt-5"><Panel title={hasBalance ? 'Cash balance, and where it is heading' : 'Cash movement, and where it is heading'} eyebrow={`Last 12 months observed · next ${HORIZON} planned${p.some(x => x.range) ? ' · shaded by the tested range' : ''}`}>
            <div className="p-3 sm:p-4"><LineChart ariaLabel="Observed month-end cash and the planned months ahead with their range" labels={labels} series={[
                { label: hasBalance ? 'Month-end balance' : 'Running net movement', color: 'var(--chart-in)', values: [...observed, ...p.map(() => null)], fill: true },
                { label: 'Planned', color: 'var(--chart-net)', dashed: true, values: lead(projected) },
                ...(p.some(x => x.range) ? [{ label: 'Likely high', color: 'var(--muted)', dashed: true, values: lead(band(1)) }, { label: 'Likely low', color: 'var(--muted)', dashed: true, values: lead(band(-1)) }] : []),
            ]} /></div>
        </Panel></div>

        <div className="mt-5"><Panel title="Month by month" eyebrow="Planned receipts, payments and cash">
            <Table caption="Planned months" numeric={[1, 2, 3, 4]} columns={['Month', 'Receipts', 'Payments', 'Net', hasBalance ? 'Cash at month end' : 'Change since today']} rows={p.map(x => [
                short(x.period), money(currency, x.receipts), outflow(currency, x.payments), <span key="n" className="font-semibold">{signed(currency, x.net)}</span>,
                <span key="b" className="grid justify-items-end"><span className="font-semibold">{hasBalance ? money(currency, x.balance!) : signed(currency, x.cumulativeNet)}</span>{x.range ? <span className="text-xs text-[var(--muted)]">± {money(currency, x.range)}</span> : <span className="text-xs text-[var(--muted)]">range not yet tested</span>}</span>,
            ])} />
        </Panel></div>

        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel title="What the plan assumes" eyebrow="Each category read from your history">
                <Table caption="Category assumptions" numeric={[2, 3]} columns={['Category', 'How it behaves', `${short(next.period)}`, `Next ${HORIZON} months`]} rows={regular.map(x => [
                    <span key="c" className="grid"><span className="font-medium">{x.category}</span><span className="text-xs text-[var(--muted)]">{METHOD_LABEL[x.method]}</span></span>,
                    x.pattern === 'PERIODIC' ? `Every ${x.everyMonths} months` : PATTERN_LABEL[x.pattern],
                    signed(currency, x.forecasts[0]), signed(currency, cents(total(x.forecasts))),
                ])} />
            </Panel>
            <div className="min-w-0 space-y-5">
                <Panel title="Regular and scheduled payments" eyebrow={`Next three months · ${outflow(currency, plan.commitments.total)}`}>
                    <ul className="divide-y divide-[var(--border)]">{plan.commitments.items.map(x => <li key={x.category} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                        <div className="min-w-0"><p className="text-sm font-semibold">{x.category}</p><p className="text-xs text-[var(--muted)]">{x.pattern === 'PERIODIC' ? `Every ${x.everyMonths} months · due ${x.months.map(short).join(', ')}` : 'Every month, steady amount'}</p></div>
                        <p className="shrink-0 text-sm font-semibold tabular-nums">{outflow(currency, x.amount)}</p>
                    </li>)}</ul>
                </Panel>
                {plan.oneOffs.length ? <Panel title="Left out as one-offs" eyebrow="Last 12 months · not expected to recur">
                    <ul className="divide-y divide-[var(--border)]">{plan.oneOffs.map(x => <li key={`${x.category}-${x.direction}`} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                        <div className="min-w-0"><p className="text-sm font-semibold">{x.category}</p><p className="text-xs text-[var(--muted)]">{x.direction === 'IN' ? 'Received' : 'Paid'} in {x.months.map(short).join(', ')}</p></div>
                        <p className="shrink-0 text-sm font-semibold tabular-nums">{money(currency, abs(x.total))}</p>
                    </li>)}</ul>
                </Panel> : null}
            </div>
        </div>

        {a ? <div className="mt-5"><Panel title="How well this has worked" eyebrow={`Tested on ${a.tests} months already known, each planned only from the months before it`}>
            <Table caption="Tested accuracy" numeric={[1, 2]} columns={['', 'This plan', 'Plain six-month average']} rows={[
                ['Receipts, average miss', a.receiptsWape ? `${a.receiptsWape}%` : '—', a.baseline.receiptsWape ? `${a.baseline.receiptsWape}%` : '—'],
                ['Payments, average miss', a.paymentsWape ? `${a.paymentsWape}%` : '—', a.baseline.paymentsWape ? `${a.baseline.paymentsWape}%` : '—'],
                ['Net cash, typical miss in a month', money(currency, a.netMiss), money(currency, a.baseline.netMiss)],
            ]} />
            <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)] sm:px-5">Net cash is the hardest figure: a small difference between two large ones. The range around each planned month is the average size of the plan’s past misses at that distance ahead, so it widens further out.</p>
        </Panel></div> : null}

        <details className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
            <summary className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 font-semibold text-[var(--brand-ink)]"><ChevronRight aria-hidden="true" size={15} className="disclosure-chevron transition-transform" />How the plan is made</summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[var(--muted-strong)]">
                <li>Every bank record carries the category your books give it (see Analytics); earlier months take the category of the same payee.</li>
                <li>A category paid or received in at least nine of the last twelve months is planned by its six-month average, or by the same month last year adjusted for the recent trend, whichever missed less on the months already known.</li>
                <li>A category with a fixed gap (every 2, 3, 4, 6 or 12 months) is planned in the months it falls due, at the average of its last three amounts.</li>
                <li>A category seen only once or twice, or not explained by your books, is left out and listed.</li>
                <li>{hasBalance ? `The starting balance is the month-end balance in ${plan.balanceSource ?? 'the bank history'}, used only because every running balance in that file agrees with its records.` : 'No verified running balance was supplied, so the plan shows the change in cash rather than a balance.'}</li>
                <li>No AI or trained model produces these figures.</li>
            </ul>
        </details>
        {technical}
    </>;
}
