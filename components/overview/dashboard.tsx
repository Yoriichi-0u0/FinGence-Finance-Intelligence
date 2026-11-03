"use client";
import Link from 'next/link';
import { ArrowRight, CheckCheck, Landmark, Scale, ArrowDownLeft, ClipboardList, TriangleAlert, ChevronDown } from 'lucide-react';
import { ThemeToggle } from './theme';
import { NavigationSearch } from '@/components/navigation/search';
import { FinancialChart } from './financial-chart';
import { groupDigits } from '@/lib/poc-anomalies/format';
import type { FinancePoCReconciliationV1 } from '@/lib/poc-anomalies/reconciliation';
import type { BankTotals } from '@/lib/poc-insights/model';
export function workspaceDescription(business: string, period: string) {
 const date = new Date(`${period}-01T00:00:00Z`);
 const label = Number.isNaN(date.getTime()) ? period : date.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
 return `${business} · ${label}`;
}
export function OverviewHeader({ children, notice }: { children?: React.ReactNode; notice?: React.ReactNode }) {
 return <header className="ov-header"><div className="ov-welcome"><h1>Welcome to FinGence 2.0</h1><p className="ov-welcome-subtitle">Your financial workspace at a glance.</p>{notice}</div><div className="ov-header-tools"><div className="ov-header-actions"><NavigationSearch /><ThemeToggle /></div>{children && <details className="ov-processing-menu"><summary>Processing Details <ChevronDown size={13} aria-hidden="true" /></summary><div className="ov-processing-popover">{children}</div></details>}</div></header>;
}
export function OverviewDashboard({ currency, description, processing, notice, bank, reconciliation, months, anomalies, local = false, selection = '' }: {
 currency: string; description: string; processing?: React.ReactNode; notice?: React.ReactNode; bank: string; reconciliation: FinancePoCReconciliationV1 | null;
 months: (BankTotals & { period: string })[]; anomalies: number; local?: boolean; selection?: string;
}) {
 // Missing category counts are unavailable, never implied zero outcomes.
 const r = reconciliation && Array.isArray(reconciliation.results) && [reconciliation.counts?.MATCH_EXACT, reconciliation.counts?.MATCH_DATE_SHIFT].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) ? reconciliation : null;
 const money = (v: string) => `${currency === 'MYR' ? 'RM' : currency} ${groupDigits(v)}`;
 const exact = r?.counts.MATCH_EXACT ?? 0, shifted = r?.counts.MATCH_DATE_SHIFT ?? 0;
 const issues = r?.results.filter(x => x.status !== 'MATCH_EXACT' && x.status !== 'MATCH_DATE_SHIFT');
 const link = (path: string) => `${path}${selection ? `?${selection}` : ''}`;
 const metrics = [
  { label: 'Bank net cash movement', value: money(bank), detail: 'Signed movement · selected statement', icon: ArrowDownLeft },
  { label: 'Ledger cash movement', value: r ? money(r.cashMovement.ledger) : 'Unavailable', detail: 'Verified cash-account ledger', icon: Landmark },
  { label: 'Signed bank − ledger difference', value: r ? money(r.cashMovement.signedDifference) : 'Unavailable', detail: 'Signed difference · cause not inferred', icon: Scale },
  { label: 'Automatically matched', value: r ? `${exact + shifted} / ${r.results.length}` : 'Unavailable', detail: 'Exact + date shift · reconciliation outcomes', icon: CheckCheck },
 ];
 return <div className="ov-dashboard">
  <OverviewHeader notice={notice}>{processing}</OverviewHeader>
  <section className="ov-metrics" aria-label="Financial summary">{metrics.map(({ label, value, detail, icon: Icon }) => <article className="ov-card ov-metric" key={label}><div className="ov-metric-top"><span>{label}</span><span className="ov-icon"><Icon size={18} aria-hidden="true" /></span></div><p className="ov-value">{value}</p><p className="ov-muted">{detail}</p></article>)}</section>
  <div className="ov-main-grid">
   <FinancialChart key={selection || description} months={months} currency={currency} counts={r ? { exact, shifted, unresolved: issues!.length, total: r.results.length } : null} />
   <div className="ov-right-stack">
   <section className="ov-card ov-reconciliation-summary">
    <div className="ov-section-head"><h2>Reconciliation Summary</h2>{r && !issues!.length ? <CheckCheck size={19} className="ov-accent" aria-label="No unresolved exceptions" /> : <ClipboardList size={19} className="ov-review-icon" aria-label={r ? 'Exceptions require review' : 'Reconciliation unavailable'} />}</div>
    {r ? <>
     <p className="ov-reconciled">{exact + shifted}<span> / {r.results.length}</span></p><p className="ov-muted">Automatically matched outcomes</p>
     <div className="ov-progress" role="img" aria-label={`${exact + shifted} of ${r.results.length} outcomes matched`}><span style={{ width: `${r.results.length ? (exact + shifted) / r.results.length * 100 : 0}%` }} /></div>
     <dl className="ov-counts">{[['Exact matches', exact], ['Date shift matches', shifted], ['Unresolved exceptions', issues!.length]].map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{n}</dd></div>)}</dl>
     <div className={`ov-exception-review${issues!.length ? '' : ' ov-exception-complete'}`}>
      <h3>{issues!.length ? `${issues!.length} exception${issues!.length === 1 ? '' : 's'} need${issues!.length === 1 ? 's' : ''} review` : 'No pending exception review'}</h3>
      {!issues!.length && <p>No unresolved exceptions were reported in this processing result.</p>}
      {issues!.length > 0 && <Link className="ov-review-action" href={link('/reconciliation')}>Review in Reconciliation <ArrowRight size={15} aria-hidden="true" /></Link>}
     </div>
    </> : <div className="ov-unavailable"><h3>Reconciliation unavailable</h3><p>No verified ledger pair is bound to this exact bank source and selection.</p><Link className="ov-text-link" href={link('/reconciliation')}>Open reconciliation <ArrowRight size={15} aria-hidden="true" /></Link></div>}
   </section>
   <section className="ov-card ov-needs-attention"><div className="ov-section-head"><h2><TriangleAlert size={18} aria-hidden="true" />Needs Attention</h2></div><Link href={link('/reconciliation')} className="ov-attention ov-attention-exceptions"><span><strong>Reconciliation exceptions</strong><small>Unresolved matcher outcomes</small></span><b>{issues?.length ?? '—'}</b></Link><Link href={link('/anomalies')} className="ov-attention"><span><strong>Anomaly candidates</strong><small>Separate rule findings · may overlap</small></span><b>{anomalies}</b></Link><p className="ov-muted">Candidates require review; they are not established errors or fraud findings.</p></section>
   </div>
  </div>
  <section className="ov-card ov-review-queue"><div className="ov-section-head"><h2>Review Queue</h2><span className="ov-tag">Source-backed issues</span></div><p className="ov-muted">Original matcher outcomes. Annotations never clear a discrepancy.</p><ul className="ov-queue">{issues?.length ? issues.slice(0, 4).map((issue, i) => <li key={i}><Link href={link('/reconciliation')}><span className="ov-queue-copy"><strong>{issue.bankRecordId ?? issue.ledgerRecordIds.join(', ')}</strong><span>{issue.reason}</span><small>{issue.status.replaceAll('_', ' ').toLowerCase()}</small></span><ArrowRight size={16} aria-hidden="true" /></Link></li>) : <li className="ov-unavailable">{r ? 'No reconciliation exceptions in this source pair.' : 'Source-backed reconciliation issues are unavailable.'}</li>}</ul>{issues && issues.length > 4 && <Link href={link('/reconciliation')} className="ov-text-link">Review all {issues.length} exceptions <ArrowRight size={15} aria-hidden="true" /></Link>}</section>
  <section className="ov-card ov-actions"><div><p className="ov-eyebrow">KEEP MOVING</p><h2>Quick Actions</h2></div><nav aria-label="Overview quick actions">{[['/data', 'Data'], ['/reconciliation', 'Reconciliation'], ['/reports', 'Reports'], [local ? '/finance-questions' : '/ask', 'Finance Questions']].map(([href, label]) => <Link key={href} href={link(href)}>{label}<ArrowRight size={14} aria-hidden="true" /></Link>)}</nav></section>
  <p className="ov-footnote">Bank cash movement is not revenue, expenses or profit. All figures retain their original source scope. No accounting classification is inferred.</p>
 </div>;
}
