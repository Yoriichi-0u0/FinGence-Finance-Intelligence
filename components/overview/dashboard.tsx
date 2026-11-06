"use client";
import Link from 'next/link';
import type {ReconciliationOutcome} from '@/lib/reconciliation/reconcile';
import styles from './dashboard-refinement.module.css';
import { ArrowRight, CheckCheck, ClipboardList, TriangleAlert, ChevronDown } from 'lucide-react';
import { DemoProfile } from './demo-profile';
import { ThemeToggle } from './theme';
import { NavigationSearch } from '@/components/navigation/search';
import { FinancialChart } from './financial-chart';
import { KpiCards } from './kpi-cards';
import type { FinancePoCReconciliationV1 } from '@/lib/poc-anomalies/reconciliation';
import type { BankTotals } from '@/lib/poc-insights/model';
export function workspaceDescription(business: string, period: string) {
 const date = new Date(`${period}-01T00:00:00Z`);
 const label = Number.isNaN(date.getTime()) ? period : date.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
 return `${business} · ${label}`;
}
export function OverviewHeader({ children, notice, demoProfile = false }: { children?: React.ReactNode; notice?: React.ReactNode; demoProfile?: boolean }) {
 return <header className={`ov-header ${styles.header}`}><div className="ov-welcome"><div className="ov-heading-row"><div className={styles.title}><h1>Welcome to FinGence 2.0</h1><p className="ov-welcome-subtitle">Your financial workspace at a glance.</p></div>{notice}</div></div><div className="ov-header-tools"><div className="ov-header-actions"><NavigationSearch /><ThemeToggle />{demoProfile && <DemoProfile />}</div>{children && <details className="ov-processing-menu"><summary>Processing Details <ChevronDown size={13} aria-hidden="true" /></summary><div className="ov-processing-popover">{children}</div></details>}</div></header>;
}
export function OverviewDashboard({ currency, description, processing, notice, navigation, bank, bankTotals, reconciliation, months, anomalies, selection = '', local = false, resolution = null, anomaliesFlagged }: {
 currency: string; description: string; processing?: React.ReactNode; notice?: React.ReactNode; navigation?: React.ReactNode; bank: string; bankTotals?: BankTotals; reconciliation: FinancePoCReconciliationV1 | null;
 months: (BankTotals & { period: string })[]; anomalies: number; local?: boolean; selection?: string; resolution?:ReconciliationOutcome|null; anomaliesFlagged?:number;
}) {
 // Missing category counts are unavailable, never implied zero outcomes.
 const r = reconciliation && Array.isArray(reconciliation.results) && [reconciliation.counts?.MATCH_EXACT, reconciliation.counts?.MATCH_DATE_SHIFT].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) ? reconciliation : null;
 const exact = r?.counts.MATCH_EXACT ?? 0, shifted = r?.counts.MATCH_DATE_SHIFT ?? 0;
 const issues = r?.results.filter(x => x.status !== 'MATCH_EXACT' && x.status !== 'MATCH_DATE_SHIFT');
 const flagged=resolution?resolution.attention.length:issues?.length;
 const queue=resolution?resolution.attention.map(x=>({bankRecordId:x.bankRecordId,ledgerRecordIds:x.ledgerRecordIds,reason:x.summary,status:x.resolution})):issues;
 const link = (path: string) => `${path}${selection ? `?${selection}` : ''}`;
 return <div className={`ov-dashboard ${styles.dashboard}`}>
  <OverviewHeader notice={notice} demoProfile={!local}>{processing}</OverviewHeader>
  {navigation}
  <KpiCards source={{currency, bank, bankTotals, reconciliation:r, anomalies}} />
  <div className="ov-main-grid">
   <FinancialChart key={selection || description} months={months} currency={currency} counts={r ? { exact, shifted, unresolved: issues!.length, total: r.results.length } : null} />
   <div className="ov-right-stack">
   <section className="ov-card ov-reconciliation-summary">
    <div className="ov-section-head"><h2>Reconciliation Summary</h2>{r && !flagged ? <CheckCheck size={19} className="ov-accent" aria-label="No unresolved exceptions" /> : <ClipboardList size={19} className="ov-review-icon" aria-label={r ? 'Exceptions require review' : 'Reconciliation unavailable'} />}</div>
    {r ? <>
     <p className="ov-reconciled">{exact + shifted}<span> / {r.results.length}</span></p><p className="ov-muted">Automatically matched outcomes</p>
     <div className="ov-progress" role="img" aria-label={`${exact + shifted} of ${r.results.length} outcomes matched`}><span style={{ width: `${r.results.length ? (exact + shifted) / r.results.length * 100 : 0}%` }} /></div>
     <dl className="ov-counts">{[['Exact matches', exact], ['Date shift matches', shifted], [resolution?'Matcher exceptions':'Unresolved exceptions', issues!.length]].map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{n}</dd></div>)}</dl>
     <div className={`ov-exception-review${flagged ? '' : ' ov-exception-complete'}`}>
      <h3>{flagged ? `${flagged} item${flagged === 1 ? '' : 's'} need${flagged === 1 ? 's' : ''} attention` : 'No pending exception review'}</h3>
      {!flagged && <p>No unresolved exceptions were reported in this processing result.</p>}
      {(flagged??0) > 0 && <Link className="ov-review-action" href={link('/reconciliation')}>Review in Reconciliation <ArrowRight size={15} aria-hidden="true" /></Link>}
     </div>
    </> : <div className="ov-unavailable"><h3>Reconciliation unavailable</h3><p>No verified ledger pair is bound to this exact bank source and selection.</p><Link className="ov-text-link" href={link('/reconciliation')}>Open reconciliation <ArrowRight size={15} aria-hidden="true" /></Link></div>}
   </section>
   <section className="ov-card ov-needs-attention"><div className="ov-section-head"><h2><TriangleAlert size={18} aria-hidden="true" />Needs Attention</h2></div><Link href={link('/reconciliation')} className="ov-attention ov-attention-exceptions"><span><strong>Reconciliation exceptions</strong><small>Unexplained items flagged for the technical team</small></span><b>{flagged ?? '—'}</b></Link><Link href={link('/anomalies')} className="ov-attention"><span><strong>{anomaliesFlagged===undefined?'Anomaly candidates':'Flagged anomaly findings'}</strong><small>Source-backed rule findings</small></span><b>{anomaliesFlagged??anomalies}</b></Link><p className="ov-muted">Flagged items are not established errors or fraud findings.</p></section>
   </div>
  </div>
  <section className="ov-card ov-review-queue"><div className="ov-section-head"><h2>{resolution?'Flagged Items':'Review Queue'}</h2><span className="ov-tag">Source-backed issues</span></div><p className="ov-muted">{resolution?resolution.summary:'Original matcher outcomes. Annotations never clear a discrepancy.'}</p><ul className="ov-queue">{queue?.length ? queue.slice(0, 4).map((issue, i) => <li key={i}><Link href={link('/reconciliation')}><span className="ov-queue-copy"><strong>{issue.bankRecordId ?? issue.ledgerRecordIds.join(', ')}</strong><span>{issue.reason}</span><small>{issue.status.replaceAll('_', ' ').toLowerCase()}</small></span><ArrowRight size={16} aria-hidden="true" /></Link></li>) : <li className="ov-unavailable">{r ? 'No items flagged for this source pair.' : 'Source-backed reconciliation issues are unavailable.'}</li>}</ul>{queue && queue.length > 4 && <Link href={link('/reconciliation')} className="ov-text-link">View all {queue.length} flagged items <ArrowRight size={15} aria-hidden="true" /></Link>}</section>
  <p className="ov-footnote">Bank cash movement is not revenue, expenses or profit. All figures retain their original source scope. No accounting classification is inferred.</p>
 </div>;
}
