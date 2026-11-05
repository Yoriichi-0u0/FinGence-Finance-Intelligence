'use client';

import { EmptyOverview } from '@/components/overview/empty';


import { useDemoProcessing } from './context';
import { DemoModule, isReady, type DemoView } from './modules';

/** Public pages always use source-backed components, including their real empty states.
 * Protected local modes retain their existing route-selected workspace fallback. */
export function DemoGate({ view, illustrative }: { view: DemoView; illustrative?: React.ReactNode }) {
    const { enabled, status, context, error } = useDemoProcessing();
    if (!enabled) return <>{illustrative}</>;
    if (isReady(context)) return <DemoModule key={context.processingId} view={view} context={context} />;
    if (view === 'overview') return <EmptyOverview status={status} context={context} />;
    const message = status==='failed' ? `${error ?? 'Processing failed.'} Financial values remain unavailable; review the error on Data.` : status==='processing' ? 'Processing documents. Verified values are not available yet.' : status==='loading' ? 'Restoring the processing context…' : context?.status==='QUARANTINED' ? 'Documents were quarantined. Financial values remain unavailable.' : null;
    return <>{message && <p role={status==='failed'?'alert':'status'} className="mb-4 text-sm text-[var(--muted-strong)]">{message}</p>}<DemoModule key={`empty:${view}:${status}`} view={view} context={null}/></>;
}
