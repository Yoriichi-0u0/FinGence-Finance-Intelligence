'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Building2, Cpu, FileText, Fingerprint, History, ShieldAlert, Sparkles, TriangleAlert } from 'lucide-react';
import { useDemoProcessing } from './context';
import { periodLabel, usesOwnDocuments } from './shared';
import { useTechnicalDetail, useWorkspace } from '@/components/workspace/context';

const chip = 'inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset';
const TONE = {
    plain: 'bg-[var(--surface)] text-[var(--muted-strong)] ring-[var(--border)]',
    brand: 'bg-[var(--brand-soft)] text-[var(--brand-ink)] ring-[var(--brand-line)]',
    warn: 'bg-[var(--warn-soft)] text-[var(--warn-ink)] ring-[var(--warn-line)]',
} as const;
function Chip({ tone = 'plain', icon, title, children }: { tone?: keyof typeof TONE; icon: React.ReactNode; title?: string; children: React.ReactNode }) {
    return <span className={`${chip} ${TONE[tone]}`} title={title}>{icon}<span className="min-w-0 truncate">{children}</span></span>;
}

/**
 * One line of status chips above every page: whose workspace this is, which documents the page reflects, and how
 * they were processed. Processing IDs and model names are shown to Admins and Superadmins only.
 */
export function DemoBanner() {
    const { status, context, savedRun, clear } = useDemoProcessing(), pathname = usePathname(), s = context?.scope;
    const { session } = useWorkspace(), technical = useTechnicalDetail();
    // Only a model whose proposal was ACCEPTED shaped this processing; quarantined proposals did not.
    const aiModels = [...new Set(context?.documents.flatMap(d => d.interpretation?.decision === 'AUTO_ACCEPTED' && d.interpretation.receipt ? [d.interpretation.receipt.model] : []) ?? [])];
    const aiRejected = !aiModels.length && !!context?.documents.some(d => d.interpretation?.receipt);
    if (pathname === '/management') return null;
    const where = context?.job ? 'Processed on the FinGence server and re-checked in your browser' : 'Processed in your browser';
    const method = aiModels.length
        ? <Chip tone="brand" icon={<Sparkles aria-hidden="true" size={13} />} title={where}>{technical ? `AI layout (${aiModels.join(', ')} on Groq), checked by rules` : 'AI read the layout, rules checked every figure'}</Chip>
        : aiRejected ? <Chip tone="warn" icon={<TriangleAlert aria-hidden="true" size={13} />} title={where}>AI proposal quarantined, rules only</Chip>
        : <Chip icon={<Cpu aria-hidden="true" size={13} />} title={where}>{session ? session.ai.enabled ? 'Rule-based processing' : 'AI is off · rules only' : `rule-based processing ${context?.job ? 'on the FinGence server' : 'in your browser'}, not live AI`}</Chip>;
    return <aside aria-label="Processing status" className="-mx-4 mb-5 [scrollbar-width:none] flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:shrink-0 sm:[&>*]:shrink print:hidden">
        {session ? <Chip tone="brand" icon={<Building2 aria-hidden="true" size={13} />}>{session.organization.name}</Chip>
            : <Chip tone="warn" icon={<ShieldAlert aria-hidden="true" size={13} />}>Public demo · do not use confidential or real financial documents</Chip>}
        {savedRun && context ? <span className={`${chip} ${TONE.brand} font-semibold`}><History aria-hidden="true" size={13} />Saved run · {new Date(savedRun.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{savedRun.by ? ` · ${savedRun.by}` : ''}
            <button type="button" onClick={clear} className="ml-1 underline underline-offset-2" aria-label="Close the saved run">Close</button></span> : null}
        {status === 'ready' && context ? s ? <>
            <Chip icon={<FileText aria-hidden="true" size={13} />}>{s.businessName} · {periodLabel(s.period)} · {s.currency} · {usesOwnDocuments(context) ? 'your documents' : 'sample documents'}</Chip>
            {method}
            {technical ? <Chip icon={<Fingerprint aria-hidden="true" size={13} className="text-[var(--brand)]" />} title={context.processingId}>Processing <code className="text-[var(--ink)]">{context.processingId.slice(0, 12)}…</code></Chip> : null}
        </> : <Chip tone="warn" icon={<TriangleAlert aria-hidden="true" size={13} />}>Last documents quarantined</Chip>
            : <>{method}{pathname !== '/data' && status !== 'loading' ? <Link href="/data" className={`touch-target ${chip} ${TONE.brand} font-semibold hover:bg-[var(--surface)]`}>Nothing processed yet · open Data<ArrowRight aria-hidden="true" size={13} /></Link> : null}</>}
    </aside>;
}
