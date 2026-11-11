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
        <header className="mb-6"><p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)]"><span aria-hidden="true" className="brand-gradient h-1 w-6 rounded-full" />FinGence</p><h1 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[34px]">{TITLES[view]}</h1></header>
        <section className="panel-shadow relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-8">
            <div aria-hidden="true" className="ledger-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(120deg,black,transparent_65%)]" />
            <div className="relative">
            {status === 'loading' || status === 'processing' ? <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" className="animate-spin text-[var(--brand)]" size={16} />{status === 'processing' ? 'Processing documents…' : 'Loading the processing context…'}</p> : <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--brand)]">{quarantined ? 'Nothing to show' : 'Start on Data'}</p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{quarantined ? 'The last documents were quarantined' : 'No documents processed yet'}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted-strong)]">{quarantined ? 'They did not pass identification or verification, so no figures are shown. Open Data to see the exact checks.' : 'Process a bank statement and general ledger once on the Data page. This page then shows results from that same verified processing, computed in your browser.'}</p>
                {quarantined ? null : <ol className="mt-5 grid max-w-3xl gap-2 sm:grid-cols-3">{['Choose a sample or your own files', 'Process them once', 'Every page shows the verified results'].map((step, i) => <li key={step} className="flex items-center gap-3 rounded-xl bg-[var(--surface-subtle)] px-3 py-2.5 text-sm ring-1 ring-inset ring-[var(--border)]"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">{i + 1}</span>{step}</li>)}</ol>}
                <Link href="/data" className={`${primaryButton} mt-6`}>Open Data and process documents<ArrowRight aria-hidden="true" size={16} /></Link>
            </>}
            </div>
        </section>
        {illustrative ? <details className="mt-5 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)]/60 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--muted-strong)]">Original illustrative design preview (sample figures, not processed results)</summary>
            <div className="mt-4">{illustrative}</div>
        </details> : null}
    </>;
}
