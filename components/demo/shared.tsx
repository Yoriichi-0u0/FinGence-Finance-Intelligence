'use client';
import Link from 'next/link';
import { CheckCircle2, CircleDashed, CircleSlash, Fingerprint, ShieldAlert } from 'lucide-react';
import { groupDigits } from '@/lib/poc-anomalies/format';
import type { Decision, ProcessingContext } from '@/lib/demo/pipeline';

export const money = (currency: string, value: string) => `${currency} ${groupDigits(value)}`;
/** Labelled cash-out figures are shown as magnitudes; the signed source value stays in tables and JSON. */
export const outflow = (currency: string, value: string) => money(currency, value.replace(/^-/, ''));
export const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
export const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--teal)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--teal-dark)] disabled:cursor-not-allowed disabled:opacity-50';

const DECISION: Record<Decision, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
    AUTO_ACCEPTED: { label: 'Auto-accepted · verified', className: 'border-emerald-200 bg-[var(--green-soft)] text-[var(--green)]', Icon: CheckCircle2 },
    QUARANTINED: { label: 'Quarantined', className: 'border-amber-200 bg-[var(--amber-soft)] text-amber-800', Icon: ShieldAlert },
    UNAVAILABLE: { label: 'Unavailable', className: 'border-slate-200 bg-slate-50 text-[var(--muted-strong)]', Icon: CircleSlash },
};
export function DecisionBadge({ decision, label }: { decision: Decision; label?: string }) {
    const d = DECISION[decision];
    return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${d.className}`}><d.Icon aria-hidden="true" size={13} />{label ?? d.label}</span>;
}
export function PendingBadge() {
    return <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-[var(--muted)]"><CircleDashed aria-hidden="true" size={13} />Waiting</span>;
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return <div className="panel-shadow min-w-0 rounded-xl border border-[var(--border)] bg-white p-4">
        <p className="text-[13px] font-medium text-[var(--muted-strong)]">{label}</p>
        <p className="mt-1.5 break-words text-[22px] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{value}</p>
        {detail ? <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p> : null}
    </div>;
}

/** Where every figure on a page comes from: one processing ID and its source fingerprints. */
export function SourceStrip({ context }: { context: ProcessingContext }) {
    const s = context.scope;
    return <div className="mb-5 flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--border)] bg-white p-3 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--teal-dark)]"><Fingerprint aria-hidden="true" size={15} />Processing {context.processingId}</span>
        {s ? <span>{s.businessName} ({s.businessId}) · {s.period} · {s.currency}</span> : null}
        {context.documents.filter(d => d.decision === 'AUTO_ACCEPTED').map(d => <span key={d.sha256} className="min-w-0 break-all text-[var(--muted)]" title={d.sha256}>{d.role === 'BANK_STATEMENT' ? 'Bank' : d.role === 'GENERAL_LEDGER' ? 'Ledger' : 'History'} {d.sha256.slice(0, 12)}…</span>)}
        <Link href="/data" className="font-semibold text-[var(--teal-dark)] underline sm:ml-auto">Processing details</Link>
    </div>;
}

export function Unavailable({ title, detail }: { title: string; detail: string }) {
    return <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-white p-6 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-[var(--muted)]">{detail}</p>
    </div>;
}

export function Table({ columns, rows, caption }: { columns: string[]; rows: React.ReactNode[][]; caption: string }) {
    return <div className="thin-scrollbar overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--muted)]">{columns.map(c => <th key={c} scope="col" className="px-4 py-2.5 font-semibold">{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-[var(--border)] last:border-0">{r.map((cell, j) => <td key={j} className="px-4 py-2.5 align-top">{cell}</td>)}</tr>)}</tbody>
        </table>
    </div>;
}
