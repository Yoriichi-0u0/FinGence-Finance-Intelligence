'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDemoProcessing } from './context';

/** Always-visible demo identity: what mode this is and which processing the page reflects. */
export function DemoBanner() {
    const { status, context } = useDemoProcessing(), pathname = usePathname(), s = context?.scope;
    return <aside aria-label="Synthetic demo notice" className="mb-5 flex flex-col gap-1 rounded-lg border border-teal-200 bg-[var(--teal-soft)] px-4 py-3 text-sm text-[var(--ink)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 print:hidden">
        <strong>FinGence 2.0 · synthetic demo</strong>
        <span className="text-[var(--muted-strong)]">No sign-in · processed in your browser · fictional data · not live AI</span>
        {status === 'ready' && context ? s ? <span className="sm:ml-auto">Showing processing <code className="text-xs">{context.processingId}</code> · {s.businessId} · {s.period}</span> : <span className="sm:ml-auto">Last documents quarantined</span>
            : pathname !== '/data' && status !== 'loading' ? <Link href="/data" className="font-semibold underline sm:ml-auto">No documents processed · open Data</Link> : null}
    </aside>;
}
