'use client';
import Link from 'next/link';
import { CheckCircle2, CircleDashed, CircleSlash, Fingerprint, Info, ShieldAlert, TriangleAlert } from 'lucide-react';
import { groupDigits } from '@/lib/poc-anomalies/format';
import type { Decision, ProcessingContext } from '@/lib/demo/pipeline';
import { useTechnicalDetail } from '@/components/workspace/context';

export const money = (currency: string, value: string) => `${currency} ${groupDigits(value)}`;
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "March 2026", or "January 2026 to March 2026" for a multi-month processing (YYYY-MM/YYYY-MM). */
export const periodLabel = (period: string) => { const [a, b] = period.split('/'); return b ? `${monthName(a)} to ${monthName(b)}` : monthName(a); };
/** Labelled cash-out figures are shown as magnitudes; the signed source value stays in tables and JSON. */
export const outflow = (currency: string, value: string) => money(currency, value.replace(/^-/, ''));
/** True when the current processing includes the visitor's own files rather than only the built-in fictional samples. */
export const usesOwnDocuments = (context: ProcessingContext) => context.documents.some(d => d.provenance === 'USER_SUPPLIED');
export const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--border-strong)] disabled:hover:bg-[var(--surface)]';
export const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--brand-solid)] px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgb(79_70_229/0.55)] transition-colors hover:bg-[var(--brand-solid-hover)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';
/** A text input or select. */
export const field = 'min-h-11 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-soft)]';
/** A pill-shaped choice (tabs, filters, segmented controls); pass the selected state. */
export const chip = (selected: boolean) => `inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${selected ? 'border-transparent bg-[var(--ink)] text-[var(--canvas)]' : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted-strong)] hover:border-[var(--brand-line)] hover:text-[var(--ink)]'}`;

const DECISION: Record<Decision, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
    AUTO_ACCEPTED: { label: 'Auto-accepted · verified', className: 'border-[var(--good-line)] bg-[var(--good-soft)] text-[var(--good-ink)]', Icon: CheckCircle2 },
    QUARANTINED: { label: 'Quarantined', className: 'border-[var(--warn-line)] bg-[var(--warn-soft)] text-[var(--warn-ink)]', Icon: ShieldAlert },
    UNAVAILABLE: { label: 'Unavailable', className: 'border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--muted-strong)]', Icon: CircleSlash },
};
export function DecisionBadge({ decision, label }: { decision: Decision; label?: string }) {
    const d = DECISION[decision];
    return <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${d.className}`}><d.Icon aria-hidden="true" size={13} />{label ?? d.label}</span>;
}
export function PendingBadge() {
    return <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]"><CircleDashed aria-hidden="true" size={13} />Waiting</span>;
}

type Tone = 'brand' | 'good' | 'warn' | 'bad' | 'plain';
const TONE: Record<Tone, string> = { brand: 'bg-[var(--brand)]', good: 'bg-[var(--good)]', warn: 'bg-[var(--warn)]', bad: 'bg-[var(--bad)]', plain: 'bg-[var(--border-strong)]' };
/** A key figure. The coloured mark on the left says what kind of figure it is, never whether it is good news. */
export function Stat({ label, value, detail, tone = 'plain', icon }: { label: string; value: string; detail?: string; tone?: Tone; icon?: React.ReactNode }) {
    return <div className="panel-shadow relative min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <span aria-hidden="true" className={`absolute inset-y-4 left-0 w-[3px] rounded-r-full ${TONE[tone]}`} />
        <p className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--muted)]">{icon}{label}</p>
        <p className="mt-2 break-words text-[22px] font-semibold leading-tight tracking-[-0.03em] tabular-nums sm:text-[26px]">{value}</p>
        {detail ? <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{detail}</p> : null}
    </div>;
}

/** For Admins: where every figure on a page comes from (processing ID, business, period and source fingerprints). */
export function SourceStrip({ context }: { context: ProcessingContext }) {
    const s = context.scope, technical = useTechnicalDetail();
    // For a Finance user the status chips above already name the business, period and currency.
    if (!technical) return null;
    return <div className="mb-6 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3.5 py-2.5 text-xs">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-[var(--brand-ink)]"><Fingerprint aria-hidden="true" size={15} className="shrink-0" />Processing <code className="truncate font-medium">{context.processingId}</code></span>
        {s ? <span className="text-[var(--muted-strong)]">{s.businessName} ({s.businessId}) · {periodLabel(s.period)} · {s.currency}</span> : null}
        <span className="flex min-w-0 flex-wrap gap-1.5">{context.documents.filter(d => d.decision === 'AUTO_ACCEPTED').map(d => <span key={d.sha256} className="inline-flex min-w-0 items-center gap-1 rounded-full bg-[var(--surface)] px-2 py-0.5 text-[var(--muted)] ring-1 ring-inset ring-[var(--border)]" title={d.sha256}>{d.role === 'BANK_STATEMENT' ? 'Bank' : d.role === 'GENERAL_LEDGER' ? 'Ledger' : 'History'} <code>{d.sha256.slice(0, 12)}…</code></span>)}</span>
        <Link href="/data" className="font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-line)] underline-offset-2 sm:ml-auto">Processing details</Link>
    </div>;
}

export function Unavailable({ title, detail }: { title: string; detail: string }) {
    return <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-subtle)] p-6 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-[var(--muted)]">{detail}</p>
    </div>;
}

/** A plain-language callout. Tone sets the colour; the words carry the meaning. */
export function Callout({ tone = 'brand', title, children, role, className = '' }: { tone?: 'brand' | 'good' | 'warn' | 'bad'; title?: React.ReactNode; children?: React.ReactNode; role?: 'note' | 'status' | 'alert'; className?: string }) {
    const t = { brand: 'border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--ink)]', good: 'border-[var(--good-line)] bg-[var(--good-soft)] text-[var(--ink)]', warn: 'border-[var(--warn-line)] bg-[var(--warn-soft)] text-[var(--ink)]', bad: 'border-[var(--bad-line)] bg-[var(--bad-soft)] text-[var(--ink)]' }[tone];
    const Icon = tone === 'good' ? CheckCircle2 : tone === 'warn' ? ShieldAlert : tone === 'bad' ? TriangleAlert : Info;
    const ink = { brand: 'text-[var(--brand)]', good: 'text-[var(--good)]', warn: 'text-[var(--warn)]', bad: 'text-[var(--bad)]' }[tone];
    return <div role={role} className={`flex gap-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${t} ${className}`}>
        <Icon aria-hidden="true" size={18} className={`mt-0.5 shrink-0 ${ink}`} />
        <div className="min-w-0">{title ? <p className="font-semibold">{title}</p> : null}{children}</div>
    </div>;
}

/**
 * A table on wider screens; on a phone each row becomes a card with the column names beside the values, so nothing
 * needs sideways scrolling or wraps into narrow columns. The first column is the card's heading.
 */
export function Table({ columns, rows, caption, stack = true }: { columns: string[]; rows: React.ReactNode[][]; caption: string; stack?: boolean }) {
    return <>
        <div className={`thin-scrollbar overflow-x-auto ${stack ? 'hidden md:block' : ''}`}>
            <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">{caption}</caption>
                <thead><tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[11px] uppercase tracking-[0.06em] text-[var(--muted)]">{columns.map(c => <th key={c} scope="col" className="px-4 py-2.5 font-semibold">{c}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--surface-subtle)]">{r.map((cell, j) => <td key={j} className="px-4 py-3 align-top">{cell}</td>)}</tr>)}</tbody>
            </table>
        </div>
        {stack ? <ul aria-label={caption} className="divide-y divide-[var(--border)] md:hidden">
            {rows.map((r, i) => <li key={i} className="px-4 py-3.5 text-sm">
                <div className="mb-2 min-w-0 font-semibold">{r[0]}</div>
                <dl className="grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                    {r.slice(1).map((cell, j) => <div key={j} className="contents"><dt className="text-xs text-[var(--muted)]">{columns[j + 1]}</dt><dd className="min-w-0 break-words">{cell}</dd></div>)}
                </dl>
            </li>)}
        </ul> : null}
    </>;
}
