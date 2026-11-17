'use client';
/**
 * Signal ledger: three levels of loudness, so the eye goes to what matters.
 * 1. Needs you: solid attention or caution cards, a count and a verb. Only what a person must act on.
 * 2. Headline: one ledger-navy band with the period's key figures and the report.
 * 3. Routine: a green tick and grey text on one line, for what is already fine.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, Check, FileDown, TriangleAlert } from 'lucide-react';

export type NeedsItem = { level: 'attention' | 'caution'; count?: string; title: string; detail: string; href: string; verb: string };

const SOLID = {
    attention: { card: 'bg-[var(--attention)] shadow-[0_16px_32px_-18px_rgb(196_42_74/0.7)]', verb: 'text-[#a3173a]' },
    caution: { card: 'bg-[var(--caution)] shadow-[0_16px_32px_-18px_rgb(154_79_6/0.65)]', verb: 'text-[#7a3e04]' },
};

/** The items a person must act on, most serious first. Nothing to act on: nothing is drawn. */
export function NeedsYou({ items }: { items: NeedsItem[] }) {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => (a.level === b.level ? 0 : a.level === 'attention' ? -1 : 1));
    return <section aria-labelledby="needs-you" className="mb-6">
        <h2 id="needs-you" className="level-label mb-2.5 text-[var(--bad-ink)]">Needs you · {items.length}</h2>
        <ul className={`grid gap-3 ${items.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {sorted.map((it, i) => <li key={it.title} className="rise-in" style={{ animationDelay: `${i * 60}ms` }}>
                <Link href={it.href} className={`group flex h-full min-h-24 items-center gap-4 rounded-[18px] px-4 py-4 text-[var(--on-solid)] transition-transform hover:-translate-y-0.5 focus-visible:outline-[var(--ink)] sm:gap-5 sm:px-5 ${SOLID[it.level].card}`}>
                    {it.count ? <span className="shrink-0 text-[40px] font-extrabold leading-none tracking-[-0.035em] tabular-nums sm:text-[48px]">{it.count}</span>
                        : <TriangleAlert aria-hidden="true" size={34} className="shrink-0" />}
                    <span className="min-w-0 flex-1">
                        <span className="block text-[17px] font-bold leading-snug">{it.title}</span>
                        <span className="mt-0.5 block text-[14px] leading-snug">{it.detail}</span>
                    </span>
                    <span className={`hidden shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-[15px] font-bold sm:inline-flex ${SOLID[it.level].verb}`}>{it.verb}<ArrowRight aria-hidden="true" size={16} className="transition-transform group-hover:translate-x-0.5" /></span>
                    <ArrowRight aria-hidden="true" size={20} className="shrink-0 sm:hidden" />
                </Link>
            </li>)}
        </ul>
    </section>;
}

export type Figure = { label: string; value: string; detail?: string };

/** The period's key figures on one ledger-navy band, with the reconciled share as a bar and the report beside them. */
export function HeadlineBand({ figures, reconciled, report }: { figures: Figure[]; reconciled: { label: string; percent: number; detail: string }; report?: { href: string; detail: string } }) {
    const pct = Math.max(0, Math.min(100, reconciled.percent));
    return <section aria-label="Headline figures" className="rise-in min-w-0 rounded-[22px] bg-[var(--band)] p-5 text-[var(--band-ink)] shadow-[0_24px_48px_-28px_rgb(11_23_54/0.7)] sm:p-7">
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
            {figures.map(f => <div key={f.label} className="min-w-0">
                <p className="text-[14px] font-semibold text-[var(--band-muted)]">{f.label}</p>
                <p className="mt-1.5 break-words text-[30px] font-extrabold leading-[1.05] tracking-[-0.035em] tabular-nums sm:text-[34px] 2xl:text-[40px]">{f.value}</p>
                {f.detail ? <p className="mt-1.5 text-[13px] leading-snug text-[var(--band-muted)]">{f.detail}</p> : null}
            </div>)}
            <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[var(--band-muted)]">{reconciled.label}</p>
                <p className="mt-1.5 text-[30px] font-extrabold leading-[1.05] tracking-[-0.035em] tabular-nums sm:text-[34px] 2xl:text-[40px]">{pct}%</p>
                <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"><span className="block h-full rounded-full bg-[var(--band-good)]" style={{ width: `${pct}%` }} /></div>
                <p className="mt-2 text-[13px] leading-snug text-[var(--band-muted)]">{reconciled.detail}</p>
            </div>
        </div>
        {report ? <div className="mt-6 flex flex-col gap-3 border-t border-[var(--band-line)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[15px] leading-snug text-[var(--band-muted)]">{report.detail}</p>
            <Link href={report.href} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2.5 rounded-[14px] bg-white px-5 text-[16px] font-extrabold text-[#0b1736] transition-transform hover:-translate-y-0.5 focus-visible:outline-white"><FileDown aria-hidden="true" size={18} />Download report</Link>
        </div> : null}
    </section>;
}

/** What is already fine: a tick and one quiet line each, with the detail one click away. */
export function RoutineLine({ label, items, more }: { label: string; items: ReactNode[]; more?: ReactNode }) {
    return <section aria-label={label} className="flex flex-wrap items-center gap-x-7 gap-y-2 border-y border-[var(--border)] py-3 text-[15px] text-[var(--routine)]">
        {items.map((it, i) => <span key={i} className="flex items-center gap-2"><Check aria-hidden="true" size={16} strokeWidth={2.75} className="shrink-0 text-[var(--tick)]" />{it}</span>)}
        {more ? <span className="sm:ml-auto">{more}</span> : null}
    </section>;
}
