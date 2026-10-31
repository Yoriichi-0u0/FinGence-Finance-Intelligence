'use client';
import Link from 'next/link';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useDemoProcessing } from './context';
import { DemoModule, isReady, type DemoView } from './modules';
import { primaryButton } from './shared';

const TITLES: Record<DemoView, string> = { overview: 'Overview', transactions: 'Transactions', reconciliation: 'Reconciliation', analytics: 'Analytics', anomalies: 'Anomalies', forecasting: 'Forecasting', reports: 'Reports', ask: 'Finance Q&A' };

/**
 * Hosted and default local pages: the connected view of the current processing context, or a clear
 * "nothing processed yet" state. The original illustrative page is kept, collapsed and labelled, so
 * sample figures are never presented as processed results. Local authenticated modes render the
 * illustrative child unchanged (their pages choose the local workspaces before reaching this gate).
 */
export function DemoGate({ view, illustrative }: { view: DemoView; illustrative?: React.ReactNode }) {
    const { enabled, status, context } = useDemoProcessing();
    if (!enabled) return <>{illustrative}</>;
    if (isReady(context)) return <DemoModule key={context.processingId} view={view} context={context} />;
    const quarantined = status === 'ready' && context;
    return <>
        <header className="mb-5"><h1 className="text-[27px] font-semibold tracking-[-0.035em] sm:text-[30px]">{TITLES[view]}</h1></header>
        <section className="panel-shadow rounded-xl border border-[var(--border)] bg-white p-5 sm:p-6">
            {status === 'loading' || status === 'processing' ? <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" className="animate-spin" size={16} />{status === 'processing' ? 'Processing documents…' : 'Loading the processing context…'}</p> : <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--teal)]">Synthetic demo · no sign-in</p>
                <h2 className="mt-1 text-lg font-semibold">{quarantined ? 'The last documents were quarantined' : 'No documents processed yet'}</h2>
                <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{quarantined ? 'They did not pass identification or verification, so no figures are shown. Open Data to see the exact checks.' : 'Process a bank statement and general ledger once on the Data page. This page then shows results from that same verified processing, computed in your browser.'}</p>
                <Link href="/data" className={`${primaryButton} mt-4`}>Open Data and process documents<ArrowRight aria-hidden="true" size={16} /></Link>
            </>}
        </section>
        {illustrative ? <details className="mt-5 rounded-xl border border-dashed border-[var(--border-strong)] bg-white/60 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--muted-strong)]">Original illustrative design preview (sample figures, not processed results)</summary>
            <div className="mt-4">{illustrative}</div>
        </details> : null}
    </>;
}
