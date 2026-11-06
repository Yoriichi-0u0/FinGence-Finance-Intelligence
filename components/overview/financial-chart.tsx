"use client";
import { useId, useState } from 'react';
import { ChartReadout } from '../chart-readout';
import financialStyles from '../financial-chart.module.css';
import { CalendarDays } from 'lucide-react';
import { CashHistory } from './history';
import { PERIODS, availablePeriods, defaultPeriod, monthlyWindow, type ChartView, type ChartPeriod, type VerifiedMonth, type ReconciliationCounts } from './chart-model';
const titles: Record<ChartView, string> = { cash: 'Cash In vs Cash Out', net: 'Net Cash Movement', reconciliation: 'Reconciliation Status' };
export function FinancialChart({ months, currency, counts }: { months: VerifiedMonth[]; currency: string; counts: ReconciliationCounts | null }) {
    const [view, setView] = useState<ChartView>('cash'), [requestedPeriod, setPeriod] = useState<ChartPeriod | null>(null);
    const available = availablePeriods(months), period = requestedPeriod && available.includes(requestedPeriod) ? requestedPeriod : defaultPeriod(months);
    const shown = period ? monthlyWindow(months, period) : [];
    const noteId = useId(), status = view === 'reconciliation';
    return <section className="ov-card ov-chart">
        <div className="ov-section-head ov-chart-heading"><div><p className="ov-eyebrow">{status ? 'CURRENT PROCESSING RESULT' : 'VERIFIED BANK HISTORY'}</p><h2>{titles[view]}</h2></div><p className="ov-chart-date" aria-label="Reporting period"><CalendarDays size={15} aria-hidden="true" /><span>{status ? 'Current processing' : reportingRange(shown)}</span></p></div>
        <div className="ov-chart-controls">
            <label>Chart View<select aria-label="Chart View" value={view} onChange={event => setView(event.target.value as ChartView)}>{Object.entries(titles).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
            <label>Time Period<select aria-label="Time Period" value={status ? 'current' : period ?? ''} disabled={status || !available.length} aria-describedby={noteId} onChange={event => setPeriod(Number(event.target.value) as ChartPeriod)}>{status && <option value="current">Current processing result</option>}{!status && !period && <option value="">Insufficient verified history</option>}{PERIODS.map(n => <option key={n} value={n} disabled={!available.includes(n)}>Last {n} months{!available.includes(n) ? ' — unavailable' : ''}</option>)}</select></label>
        </div>
        <p className="ov-chart-explanation" id={noteId}>{status ? 'Current processing result only. Time Period is disabled because verified monthly reconciliation history is not available.' : !period ? 'Monthly history unavailable. At least 3 verified monthly observations in a trailing window are needed. No missing months are filled.' : `${currency === 'MYR' ? 'RM (MYR)' : currency}. ${view === 'net' ? 'Signed monthly bank movement, not profit or net income.' : 'Bank receipts and payment magnitudes, not revenue or expenses.'}${available.length < PERIODS.length ? ' Longer periods are disabled when that trailing window has insufficient verified observations.' : ''}`}</p>
        {status ? <ReconciliationStatusChart counts={counts} /> : <CashHistory key={`${view}:${period ?? 'unavailable'}`} months={shown} currency={currency} mode={view} />}
        {!status && <details className="ov-chart-coverage"><summary>Source coverage</summary><p>{shown.length} monthly observations displayed from {months.length} verified observations in the active source. {shown.length ? `${shown[0].period} to ${shown.at(-1)!.period}. ` : ''}Missing months are never filled.</p></details>}
    </section>;
}
export function reportingRange(months: VerifiedMonth[]) {
    if (!months.length) return 'History unavailable';
    const format = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${format(months[0].period)} to ${format(months.at(-1)!.period)}`;
}
export function ReconciliationStatusChart({ counts }: { counts: ReconciliationCounts | null }) {
    const [active, setActive] = useState<number | null>(null);
    if (!counts) return <div className="ov-unavailable ov-chart-empty"><h3>Reconciliation unavailable</h3><p>No verified outcome counts are available for this source and processing result.</p></div>;
    const categories = [{ label: 'Exact matches', value: counts.exact, color: 'var(--cash-in)' }, { label: 'Date shift matches', value: counts.shifted, color: 'var(--cash-out)' }, { label: 'Matcher exceptions', value: counts.unresolved, color: 'var(--review)' }];
    const max = Math.max(1, ...categories.map(c => c.value));
    return <div className={`ov-status-chart ${financialStyles.status}`} role="group" aria-label="Current reconciliation outcome category counts"><ChartReadout hint="Hover, tap or focus a category for exact outcome counts." title={active === null ? undefined : 'Current processing result'} items={active === null ? [] : [{ label: categories[active].label, value: `${categories[active].value} outcomes`, color: categories[active].color }]} /><p className="ov-muted">Number of outcomes · current result</p>{categories.map((c,i) => <div className="ov-status-category" key={c.label} tabIndex={0} role="button" aria-label={`${c.label}: ${c.value} outcomes`} onPointerEnter={()=>setActive(i)} onPointerLeave={e=>{if(e.pointerType!=='touch'&&!e.currentTarget.contains(document.activeElement))setActive(null);}} onPointerDown={()=>setActive(i)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)} onKeyDown={e=>{if(e.key==='Escape')setActive(null);if(e.key==='Enter'||e.key===' '){e.preventDefault();setActive(i);}}}><div><span>{c.label}</span><strong>{c.value}</strong></div><div className="ov-status-track" role="img" aria-label={`${c.label}: ${c.value} outcomes`}><span style={{ width: `${c.value / max * 100}%`, background: c.color }} /></div></div>)}<p className="ov-status-total">{counts.total} total outcomes · categories describe this result, not a monthly trend.</p></div>;
}
