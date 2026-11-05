'use client';
import Link from 'next/link';
import styles from './dashboard-refinement.module.css';
import { KpiCards } from './kpi-cards';
import { OverviewHeader } from './dashboard';
import type { DemoStatus } from '@/components/demo/context';
import type { ProcessingContext } from '@/lib/demo/pipeline';
export function EmptyOverview({status,context}: {status:DemoStatus;context:ProcessingContext|null}) {
 const failure=status==='failed'||context?.status==='QUARANTINED';
 return <div className={`ov-dashboard ${styles.dashboard}`}><OverviewHeader demoProfile />
 {failure&&<p role="alert" className="ov-card">The documents did not produce verified results. Open Data to inspect processing and quarantine evidence.</p>}
 {(status==='loading'||status==='processing')&&<p role="status">{status==='loading'?'Restoring your workspace…':'Processing documents…'} Financial values appear only after verification.</p>}
 <KpiCards source={null}/>
 <div className="ov-main-grid"><section className="ov-card"><h2>Cash In vs Cash Out</h2><div className="ov-unavailable"><h3>No financial data yet</h3><p>Process a bank statement and general ledger to view your financial trends.</p><Link href="/data" className="ov-button">Open Data</Link></div></section><div className="ov-right-stack"><section className="ov-card"><h2>Reconciliation Summary</h2><div className="ov-unavailable"><strong>—</strong><h3>Reconciliation not available</h3><p>Process bank and ledger documents to view matching results.</p></div></section><section className="ov-card"><h2>Needs Attention</h2><div className="ov-unavailable"><h3>Awaiting financial data</h3><p>Items requiring review will appear after processing.</p></div></section></div></div>
 <section className="ov-card ov-review-queue"><h2>Review Queue</h2><div className="ov-unavailable"><h3>No review items available yet</h3><p>Process financial documents to identify records that may need review.</p></div></section>
</div>;
}
