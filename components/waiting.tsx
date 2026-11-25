'use client';
import { useEffect, useState } from 'react';
import { FinMascot } from '@/components/fin/mascot';

/**
 * Waiting, made calm and alive: the assistant's mascot thinking beside a plain line that says what is loading, typing
 * dots, and a shimmering outline of what is about to appear. If it takes a while, honest lines say so; nothing pretends
 * to know how far along it is. With reduced motion everything stays still. One component for every page-level wait.
 */
export type WaitShape = 'cards' | 'rows' | 'page' | 'none';

/** Whole seconds since the component appeared, ticking once a second up to `max`. */
export function useElapsed(max = 30) {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        const started = Date.now();
        const timer = setInterval(() => {
            const s = Math.min(max, Math.floor((Date.now() - started) / 1000));
            setSeconds(s);
            if (s >= max) clearInterval(timer);
        }, 1000);
        return () => clearInterval(timer);
    }, [max]);
    return seconds;
}

/** What to add while a wait goes on: nothing at first, then plain reassurance, then what you can do. */
export function patience(seconds: number): string | null {
    if (seconds >= 12) return 'This is taking longer than usual. You can keep waiting, or reload the page.';
    if (seconds >= 4) return 'Still loading. The database can take a moment.';
    return null;
}

/** Three dots that take turns rising, like someone typing. Decorative. */
export function TypingDots({ className = '' }: { className?: string }) {
    return <span aria-hidden="true" className={`wait-dots inline-flex items-center gap-[3px] ${className}`}><span /><span /><span /></span>;
}

function Bar({ w, h = 'h-3', className = '' }: { w: string; h?: string; className?: string }) {
    return <span className={`skeleton block rounded-full ${h} ${w} ${className}`} />;
}

const ROW_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-2/3', 'w-1/3', 'w-3/4'];

/** The outline of what is coming: cards for dashboards, rows for lists, a page for documents. */
export function Skeleton({ shape, count }: { shape: Exclude<WaitShape, 'none'>; count: number }) {
    if (shape === 'cards') return <div aria-hidden="true" className="wait-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, i) => <div key={i} style={{ '--i': i } as React.CSSProperties} className="rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-inset ring-[var(--border)]">
            <Bar w="w-1/3" h="h-2.5" /><Bar w="w-2/3" h="h-7" className="mt-4" /><Bar w={ROW_WIDTHS[i % ROW_WIDTHS.length]} h="h-2.5" className="mt-4" /><Bar w="w-2/5" h="h-2.5" className="mt-2" />
        </div>)}
    </div>;
    if (shape === 'page') return <div aria-hidden="true" className="wait-stagger mx-auto max-w-md space-y-3 rounded-2xl bg-[var(--surface)] p-6 ring-1 ring-inset ring-[var(--border)]">
        {Array.from({ length: count }, (_, i) => <Bar key={i} w={i === 0 ? 'w-1/2' : ROW_WIDTHS[i % ROW_WIDTHS.length]} h={i === 0 ? 'h-4' : 'h-2.5'} className={i === 0 ? 'mb-5' : ''} />)}
    </div>;
    return <ul aria-hidden="true" className="wait-stagger divide-y divide-[var(--border)] rounded-2xl bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)]">
        {Array.from({ length: count }, (_, i) => <li key={i} style={{ '--i': i } as React.CSSProperties} className="flex items-center gap-3 px-4 py-3.5">
            <span className="skeleton size-9 shrink-0 rounded-full" />
            <span className="min-w-0 flex-1 space-y-2"><Bar w={ROW_WIDTHS[i % ROW_WIDTHS.length]} /><Bar w="w-1/4" h="h-2.5" /></span>
            <Bar w="w-16" className="hidden sm:block" />
        </li>)}
    </ul>;
}

/**
 * A page or section that is loading. `what` is the plain line ("Loading your saved runs"); screen readers hear it, and
 * the reassurance lines if the wait goes on. The outline below is decorative.
 */
export function Waiting({ what, shape = 'rows', count, className = '' }: { what: string; shape?: WaitShape; count?: number; className?: string }) {
    const note = patience(useElapsed());
    return <div className={`space-y-5 ${className}`} aria-busy="true">
        <div role="status" aria-live="polite" className="rise-in flex items-center gap-3">
            <span aria-hidden="true" className="relative grid size-12 shrink-0 place-items-center">
                <span className="wait-halo absolute inset-0 rounded-full bg-[var(--brand-soft)]" />
                <FinMascot size={40} mood="thinking" className="relative" />
            </span>
            <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">{what}<TypingDots className="text-[var(--brand)]" /></span>
                {note ? <span className="rise-in mt-0.5 block text-xs text-[var(--muted)]">{note}</span> : null}
            </span>
        </div>
        {shape === 'none' ? null : <Skeleton shape={shape} count={count ?? (shape === 'cards' ? 3 : shape === 'page' ? 7 : 4)} />}
    </div>;
}
