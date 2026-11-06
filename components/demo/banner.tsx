'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Fingerprint, ShieldAlert } from 'lucide-react';
import { useDemoProcessing } from './context';
import { periodLabel, usesOwnDocuments } from './shared';
import { useWorkspace } from '@/components/workspace/context';

/** Always-visible demo identity: what mode this is and which processing the page reflects. */
export function DemoBanner() {
    const { status, context } = useDemoProcessing(), pathname = usePathname(), s = context?.scope;
    // Only a model whose proposal was ACCEPTED shaped this processing; quarantined proposals did not.
    const aiModels = [...new Set(context?.documents.flatMap(d => d.interpretation?.decision === 'AUTO_ACCEPTED' && d.interpretation.receipt ? [d.interpretation.receipt.model] : []) ?? [])];
    const { session } = useWorkspace(), lead = session ? `Signed in · runs recorded for ${session.organization.name}` : 'No sign-in';
    const aiRejected = !aiModels.length && !!context?.documents.some(d => d.interpretation?.receipt);
    if (pathname === '/management') return null;
    const where = context?.job ? 'processed on the FinGence server, re-checked in your browser' : null;
    return <aside aria-label="Public demo notice" className="mb-6 flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--ink)] shadow-[var(--shadow-panel)] md:flex-row md:items-center md:gap-3 print:hidden">
        <span className="flex min-w-0 flex-col items-start gap-1.5 md:flex-1 md:flex-row md:items-center md:gap-2.5">
            <strong className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--warn-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warn-ink)] ring-1 ring-inset ring-[var(--warn-line)]"><ShieldAlert aria-hidden="true" size={13} />{session ? `FinGence 2.0 · ${session.organization.name}` : 'FinGence 2.0 · public demo'}</strong>
            <span className="min-w-0 text-[var(--muted-strong)]">{aiModels.length
                ? <>{lead} · AI layout interpretation ({aiModels.join(', ')} on Groq) verified by deterministic checks · {where ?? 'calculations in your browser'} · do not use confidential or real financial documents</>
                : aiRejected ? <>{lead} · an AI layout proposal was quarantined; nothing from the model was accepted · do not use confidential or real financial documents</>
                : <>{lead} · rule-based processing {where ? 'on the FinGence server, re-checked in your browser' : 'in your browser'}, not live AI · do not use confidential or real financial documents</>}</span>
        </span>
        {status === 'ready' && context ? s ? <span className="flex min-w-0 items-center gap-1.5 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)] md:ml-auto md:max-w-[46%] md:border-l md:border-t-0 md:pl-3 md:pt-0"><Fingerprint aria-hidden="true" size={14} className="shrink-0 text-[var(--brand)]" /><span className="min-w-0">Showing processing <code className="text-[var(--ink)]">{context.processingId}</code> · {s.businessId} · {periodLabel(s.period)} · {usesOwnDocuments(context) ? context.job ? 'your documents, processed on the server' : 'your documents, processed locally' : 'fictional sample documents'}</span></span> : <span className="text-xs font-semibold text-[var(--warn-ink)] md:ml-auto">Last documents quarantined</span>
            : pathname !== '/data' && status !== 'loading' ? <Link href="/data" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-ink)] underline underline-offset-2 md:ml-auto">No documents processed · open Data<ArrowRight aria-hidden="true" size={13} /></Link> : null}
    </aside>;
}
