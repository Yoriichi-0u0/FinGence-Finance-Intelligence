'use client';
import Link from 'next/link';
import { ArrowUpRight, Check, CircleSlash, TriangleAlert } from 'lucide-react';
import { AssistantFace } from './mascot';
import { useFace, useFin } from './fin';
import { TypingDots } from '@/components/waiting';
import { FIN_NAME, FIN_PAGES } from '@/lib/fin/contracts';
import { closingLine, traceOf, type TraceLine } from '@/lib/fin/narrate';
import type { Stage } from '@/lib/demo/pipeline';

/**
 * The assistant narrating a processing run, stage by stage, as it happens. Every line comes from code: the stage's own
 * decision, checks and summary (lib/fin/narrate.ts). When the run ends, the assistant's mood says what it means for you.
 * The detailed stage list beside it stays for anyone who wants every check.
 */
export function RunTrace({ stages, processing, ended, failed = false }: { stages: Stage[]; processing: boolean; ended: boolean; failed?: boolean }) {
    const fin = useFin(), face = useFace();
    const name = fin?.name ?? FIN_NAME, lines = traceOf(stages, processing);
    if (!lines.length) return null;
    const mood = fin?.mood, showMood = ended && !failed && mood?.line && !fin?.prefs.quiet && mood.mood !== 'working';
    return <div className="border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
            <span aria-hidden="true" className="relative grid size-11 shrink-0 place-items-center">
                {processing ? <span className="wait-halo absolute inset-0 rounded-full bg-[var(--brand-soft)]" /> : null}
                <AssistantFace size={38} mood={processing ? 'thinking' : face} className="relative" />
            </span>
            <p className="text-sm font-semibold">{processing ? `${name} is running the checks` : `${name}'s run`}</p>
        </div>
        <ol role="log" aria-live="polite" aria-label={`${name}'s narration of this run`} className="mt-3 space-y-2 pl-1">
            {lines.map(line => <TraceItem key={line.id} line={line} />)}
        </ol>
        {ended ? <div className="rise-in mt-3 space-y-2 rounded-2xl bg-[var(--surface-subtle)] px-3.5 py-3 text-sm ring-1 ring-inset ring-[var(--border)]">
            <p className="font-semibold">{closingLine(stages, failed)}</p>
            {showMood && mood ? <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--muted-strong)]">
                <span>{mood.line}</span>
                {mood.link && mood.link !== '/data' ? <Link href={mood.link} className="inline-flex min-h-8 items-center gap-1 font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-line)] underline-offset-2">Open {FIN_PAGES[mood.link].label}<ArrowUpRight aria-hidden="true" size={13} /></Link> : null}
            </p> : null}
        </div> : null}
    </div>;
}

const ICON = {
    done: <span className="grid size-5 place-items-center rounded-full bg-[var(--good-soft)] text-[var(--good)]"><Check size={12} strokeWidth={3} /></span>,
    'set-aside': <span className="grid size-5 place-items-center rounded-full bg-[var(--warn-soft)] text-[var(--warn)]"><TriangleAlert size={12} strokeWidth={2.4} /></span>,
    'not-run': <span className="grid size-5 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--muted)]"><CircleSlash size={12} strokeWidth={2.4} /></span>,
} as const;

function TraceItem({ line }: { line: TraceLine }) {
    if (line.state === 'doing' || line.state === 'waiting') return <li className="rise-in flex items-center gap-2.5 text-sm text-[var(--muted-strong)]">
        <span aria-hidden="true" className="grid size-5 place-items-center"><TypingDots className="text-[var(--brand)]" /></span>{line.text}
    </li>;
    return <li className="rise-in flex gap-2.5">
        <span aria-hidden="true" className="mt-0.5 shrink-0">{ICON[line.state]}</span>
        <div className="min-w-0 text-sm">
            <p><span className="font-medium">{line.text}</span>{line.checks?.total ? <span className="tabular-nums text-[var(--muted)]"> · {line.checks.passed} of {line.checks.total} {line.checks.total === 1 ? 'check' : 'checks'}</span> : null}
                <span className="sr-only">{line.state === 'done' ? ', passed' : line.state === 'set-aside' ? ', set aside' : ', not run'}</span></p>
            {line.detail && line.state !== 'done' ? <p className="mt-0.5 text-[13px] leading-snug text-[var(--muted-strong)]">{line.detail}</p> : null}
        </div>
    </li>;
}
