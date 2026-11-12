'use client';
import Link from 'next/link';
import { useId, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Gauge, Info } from 'lucide-react';
import { BANDS, processingConfidence, type Band } from '@/lib/confidence';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { useTechnicalDetail } from '@/components/workspace/context';
import { groupDigits } from '@/lib/poc-anomalies/format';

const BAND: Record<Band, { label: string; line: string; tone: string; ring: string; bar: string }> = {
    HIGH: { label: 'High confidence', line: 'Nearly all of the money was read, checked and explained. Nothing needs you.', tone: 'text-[var(--good-ink)]', ring: 'ring-[var(--good-line)] bg-[var(--good-soft)]', bar: 'bg-[var(--good)]' },
    CHECK: { label: 'Check advised', line: 'Most of the money is accounted for. Look at what fell short below.', tone: 'text-[var(--warn-ink)]', ring: 'ring-[var(--warn-line)] bg-[var(--warn-soft)]', bar: 'bg-[var(--warn)]' },
    LOW: { label: 'Low confidence', line: 'A large share of the money could not be fully accounted for. Do not rely on these figures yet.', tone: 'text-[var(--bad-ink)]', ring: 'ring-[var(--bad-line)] bg-[var(--bad-soft)]', bar: 'bg-[var(--bad)]' },
};
const money = (currency: string, cents: string) => `${currency} ${groupDigits((Number(cents) / 100).toFixed(2))}`;
export const CONFIDENCE_DEFINITION = 'Confidence is how much of this period’s bank movement, by value, FinGence read reliably, checked and explained. It is not a probability of being right.';

/**
 * FinGence's confidence in one processing, for a Finance user: one percentage and what it means. Hovering over it
 * (mouse) shows how it is measured and exactly what fell short; clicking, tapping or Enter keeps that open or closes it.
 */
export function ConfidenceCard({ context, className = '' }: { context: ProcessingContext; className?: string }) {
    const c = useMemo(() => processingConfidence(context), [context]), technical = useTechnicalDetail();
    const [pinned, setPinned] = useState(false), [hover, setHover] = useState(false), open = pinned || hover, id = useId();
    const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
    const band = c.status === 'MEASURED' ? BAND[c.band] : null;
    return <section aria-label="Processing confidence" className={`relative rounded-2xl p-4 ring-1 ring-inset sm:p-5 ${band ? band.ring : 'bg-[var(--surface-subtle)] ring-[var(--border)]'} ${className}`}
        onMouseEnter={() => { if (leave.current) clearTimeout(leave.current); setHover(true); }} onMouseLeave={() => { leave.current = setTimeout(() => setHover(false), 150); }}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <span className={`grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)] ${band?.tone ?? 'text-[var(--muted)]'}`}><Gauge aria-hidden="true" size={22} /></span>
            <div className="min-w-0 flex-[1_1_14rem]">
                <p className="text-[12px] font-medium text-[var(--muted)]">Processing confidence</p>
                {c.status === 'MEASURED'
                    ? <p className="flex flex-wrap items-baseline gap-x-3"><span className="text-[34px] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{c.percent}%</span><span className={`text-sm font-semibold ${band!.tone}`}>{band!.label}</span></p>
                    : <p className="text-xl font-semibold leading-tight">Incomplete</p>}
                <p className="mt-0.5 text-sm text-[var(--muted-strong)]">{c.status === 'MEASURED' ? band!.line : c.reason}</p>
            </div>
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => { setPinned(p => !p); setHover(false); }}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--brand-ink)] ring-1 ring-inset ring-[var(--border)] hover:bg-[var(--canvas)]">
                <Info aria-hidden="true" size={15} />How is this measured?
            </button>
        </div>
        {c.status === 'MEASURED' ? <div aria-hidden="true" className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)]"><span className={`block h-full rounded-full ${band!.bar}`} style={{ width: `${c.percent}%` }} /></div> : null}
        {open ? <div id={id} role="region" aria-label="How confidence is measured" className="mt-4 space-y-3 rounded-xl bg-[var(--surface)] p-4 text-sm shadow-[var(--shadow-panel)] ring-1 ring-inset ring-[var(--border)]">
            <p className="text-[var(--muted-strong)]">{CONFIDENCE_DEFINITION}</p>
            <ul className="space-y-2.5">
                <Condition ok={c.status === 'MEASURED' && c.read.records === 0} title="Read reliably"
                    detail={c.status !== 'MEASURED' ? '—' : c.read.records === 0 ? 'Every bank record came from a document read by a known layout, by an AI layout that passed every check, or by OCR at 90% confidence or more with its amounts confirmed.' : `${money(c.currency, c.read.cents)} across ${c.read.records} record${c.read.records === 1 ? '' : 's'} not counted: ${c.read.reasons.join('; ')}.`} />
                <Condition ok={c.status === 'MEASURED'} title="Checked"
                    detail={`${c.checks.passed} of ${c.checks.total} automated checks behind the figures passed.${c.status === 'MEASURED' ? '' : ' Without every check passing, FinGence gives no percentage.'}`} />
                <Condition ok={c.status === 'MEASURED' && c.explained.records === 0} title="Explained by your books"
                    detail={c.status !== 'MEASURED' ? '—' : c.explained.records === 0 ? 'Every bank record is matched to the books or resolved by a stated rule.' : `${c.explained.reasons.join('; ')}.`} />
            </ul>
            <p className="text-xs text-[var(--muted)]">Bands: {BANDS.HIGH}% and above High · {BANDS.CHECK}% to {BANDS.HIGH}% Check advised · below {BANDS.CHECK}% Low. <Link href="/reconciliation" className="font-semibold text-[var(--brand-ink)] underline underline-offset-2">Reconciliation</Link> · <Link href="/anomalies" className="font-semibold text-[var(--brand-ink)] underline underline-offset-2">Anomalies</Link></p>
            {technical && c.status === 'MEASURED' ? <p className="text-xs text-[var(--muted)] tabular-nums">Counted {c.counted} of {c.records} bank records · {money(c.currency, c.countedCents)} of {money(c.currency, c.totalCents)} absolute movement (lib/confidence).</p> : null}
        </div> : null}
    </section>;
}

function Condition({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
    return <li className="flex gap-2.5">
        {ok ? <CircleCheck aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-[var(--good)]" /> : <CircleAlert aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-[var(--warn)]" />}
        <span><strong>{title}</strong><span className="sr-only">{ok ? ' (met)' : ' (fell short)'}</span> <span className="text-[var(--muted-strong)]">{detail}</span></span>
    </li>;
}
