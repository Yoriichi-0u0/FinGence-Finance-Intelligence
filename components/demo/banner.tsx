'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDemoProcessing } from './context';
import { usesOwnDocuments } from './shared';

/** Always-visible demo identity: what mode this is and which processing the page reflects. */
export function DemoBanner() {
    const { status, context } = useDemoProcessing(), pathname = usePathname(), s = context?.scope;
    // Only a model whose proposal was ACCEPTED shaped this processing; quarantined proposals did not.
    const aiModels = [...new Set(context?.documents.flatMap(d => d.interpretation?.decision === 'AUTO_ACCEPTED' && d.interpretation.receipt ? [d.interpretation.receipt.model] : []) ?? [])];
    const aiRejected = !aiModels.length && !!context?.documents.some(d => d.interpretation?.receipt);
    return <aside aria-label="Public demo notice" className="mb-5 flex flex-col gap-1 rounded-lg border border-teal-200 bg-[var(--teal-soft)] px-4 py-3 text-sm text-[var(--ink)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 print:hidden">
        <strong>FinGence 2.0 · public demo</strong>
        <span className="text-[var(--muted-strong)]">{aiModels.length
            ? <>No sign-in · AI layout interpretation ({aiModels.join(', ')} on Groq) verified by deterministic checks · calculations in your browser · do not use confidential or real financial documents</>
            : aiRejected ? <>No sign-in · an AI layout proposal was quarantined; nothing from the model was accepted · do not use confidential or real financial documents</>
            : <>No sign-in · rule-based processing in your browser, not live AI · do not use confidential or real financial documents</>}</span>
        {status === 'ready' && context ? s ? <span className="sm:ml-auto">Showing processing <code className="text-xs">{context.processingId}</code> · {s.businessId} · {s.period} · {usesOwnDocuments(context) ? 'your documents, processed locally' : 'fictional sample documents'}</span> : <span className="sm:ml-auto">Last documents quarantined</span>
            : pathname !== '/data' && status !== 'loading' ? <Link href="/data" className="font-semibold underline sm:ml-auto">No documents processed · open Data</Link> : null}
    </aside>;
}
