'use client';
import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CalendarDays } from 'lucide-react';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { fromCents } from '@/lib/poc-anomalies/source';
import { PageHeader, Panel } from '@/components/ui';
import { TradingLineChart } from '@/components/trading-line-chart';
import { financialMoney } from '@/components/chart-readout';
import { SourceStrip, Unavailable } from './shared';
import { analyticsDays, analyticsMonths, analyticsCounterparties, exploreCounterparties } from './analytics-model';
import styles from './analytics.module.css';

export default function Analytics({ c }: { c: ProcessingContext | null }) {
    const [search, setSearch] = useState(''), [sort, setSort] = useState<'gross' | 'in' | 'out'>('gross');
    const days = useMemo(() => c ? analyticsDays(c) : [], [c]), months = useMemo(() => c ? analyticsMonths(c) : [], [c]), parties = useMemo(() => c ? analyticsCounterparties(c) : [], [c]);
    const filtered = exploreCounterparties(parties, search, sort), scope = c?.scope ?? { currency: 'MYR', period: 'unavailable' }, totals = c?.outputs.totals;

    const money = (v: string) => financialMoney(scope.currency, v), axis = (v: number) => `${scope.currency === 'MYR' ? 'RM' : scope.currency} ${(Math.abs(v) >= 1000 ? v / 1000 : v).toLocaleString('en', { maximumFractionDigits: Math.abs(v) >= 1000 ? 1 : 2 })}${Math.abs(v) >= 1000 ? 'k' : ''}`;
    return <div className={styles.analytics}>
        <PageHeader title="Analytics" description="Explore cash movement and counterparties from your verified bank records." />
        <div className={styles.context}>{c ? <SourceStrip compact context={c} /> : <p>No verified financial evidence available.</p>}</div>
        <section className={styles.summary} aria-label={c ? "Verified bank analysis summary" : "Bank analysis unavailable"}>{[
            { label: 'Bank Cash In', value: totals ? money(totals.credits) : '—', detail: `${totals?.creditRows ?? '—'} credit records · incoming magnitude`, Icon: ArrowDownLeft },
            { label: 'Bank Cash Out', value: totals ? money(totals.debits.replace(/^-/, '')) : '—', detail: `${totals?.debitRows ?? '—'} debit records · outgoing magnitude`, Icon: ArrowUpRight },
            { label: 'Net Signed Movement', value: totals ? money(totals.net) : '—', detail: 'Signed bank movement · not profit', Icon: ArrowLeftRight },
            { label: 'Observed Months', value: c ? String(c.outputs.history.accepted ? months.length : 1) : '—', detail: c?.outputs.history.accepted ? `${months[0]?.period} to ${months.at(-1)?.period}` : c ? 'Statement month only' : 'History unavailable', Icon: CalendarDays },
        ].map(({ label, value, detail, Icon }) => <article key={label}><h2><Icon aria-hidden="true" size={16} />{label}</h2><strong>{value}</strong><p>{detail}</p></article>)}</section>
        <div className={styles.charts}>
            <Panel title={`Daily Cumulative Net Movement · ${scope.period}`} eyebrow="Observed statement days"><div className={styles.chart}><TradingLineChart key={c?.processingId ?? 'empty'} presentation="financial" timeScale="day" labels={days.map(d => d.date.slice(8))} pointLabels={days.map(d => d.date)} xValues={days.map(d => Date.parse(`${d.date}T00:00:00Z`))} ariaLabel="Daily cumulative net bank movement" formatAxis={axis} series={[{ label: 'Cumulative Net', values: days.map(d => d.value), exactValues: days.map(d => money(d.exact)), fill: true }]} /></div></Panel>
            {months.length >= 2 ? <Panel title="Monthly Bank Movement" eyebrow="Verified history"><div className={styles.chart}><TradingLineChart key={`${c?.processingId ?? 'empty'}:monthly`} presentation="financial" labels={months.map(m => new Date(`${m.period}-01T00:00:00Z`).toLocaleDateString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }))} pointLabels={months.map(m => m.period)} xValues={months.map(m => Number(m.period.slice(0, 4)) * 12 + Number(m.period.slice(5, 7)))} ariaLabel="Monthly cash in, cash out and net" formatAxis={axis} series={[
                { label: 'Cash In', values: months.map(m => Number(m.credits)), exactValues: months.map(m => money(m.credits)), fill: true },
                { label: 'Cash Out', values: months.map(m => -Number(m.debits)), exactValues: months.map(m => money(m.debits.replace(/^-/, ''))), fill: false },
                { label: 'Net', values: months.map(m => Number(m.net)), exactValues: months.map(m => money(m.net)), dashed: true, fill: false },
            ]} /></div></Panel> : <Panel title="Monthly Bank Movement" eyebrow="Verified history"><Unavailable title="Monthly trend unavailable" detail="At least two verified observed months are needed for a trend. No missing months are generated." /></Panel>}
        </div>
        <section className={styles.parties} aria-labelledby="counterparty-title"><header><div><p>STATEMENT MONTH · TOP 8 BY GROSS MOVEMENT</p><h2 id="counterparty-title">Largest Counterparties by Gross Movement</h2><small>Cash In plus Cash Out magnitude, grouped by exact counterparty name.</small></div><div className={styles.controls}><label>Search counterparty<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search these counterparties" /></label><label>Sort by<select aria-label="Counterparty sort" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="gross">Gross Movement</option><option value="in">Cash In</option><option value="out">Cash Out</option></select></label></div></header>
            <div className={styles.tableScroll}><table><caption className="sr-only">Verified statement counterparties</caption><thead><tr>{['Counterparty', 'Records', 'Cash In ↙', 'Cash Out ↗'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{filtered.map(r => <tr key={r.name}><th scope="row">{r.name}</th><td>{r.records}</td><td>{money(fromCents(r.incoming))}</td><td>{money(fromCents(-r.outgoing))}</td></tr>)}</tbody></table></div>{!filtered.length && <p className={styles.empty}>No counterparties match this search. Clear the search to view the available records.</p>}
        </section>
        <p className={styles.notice}>Receipts and payments are bank cash directions, not revenue or expenses; no ratios or profitability are derived without an accounting classification. Curves connect observed values only; exact tooltips use the verified data points.</p>
    </div>;
}
