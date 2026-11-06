'use client';
import { Download } from 'lucide-react';
import { Panel } from '@/components/ui';
import { entriesCsv, RESOLUTION_LABEL, RESOLUTIONS, type ReconciliationOutcome, type Resolution } from '@/lib/reconciliation/reconcile';
import { button, money } from './shared';

/** Plain-language order: what needs attention first, then what FinGence did. */
const ORDER: Resolution[] = ['UNEXPLAINED', 'ENTRY_PREPARED', 'TIMING_OPEN', 'TIMING_CLEARED', 'MATCHED_LATE', 'MATCHED_BY_AMOUNT'];
const HEADING: Record<Resolution, string> = {
    UNEXPLAINED: 'Flagged for your technical team', ENTRY_PREPARED: 'Corrections FinGence prepared for your books', TIMING_OPEN: 'On their way: expected on the next statement',
    TIMING_CLEARED: 'Timing differences that have already cleared', MATCHED_LATE: 'Matched, recorded a few days apart', MATCHED_BY_AMOUNT: 'Matched by amount and date',
};

/**
 * What the reconciliation layer did, for a Finance user who need not know accounting terms. Every difference is
 * already resolved; only an unexplained one is flagged, and it is flagged to the technical team, not to this user.
 */
export function ReconciliationOutcomePanel({ outcome: o }: { outcome: ReconciliationOutcome }) {
    const currency = o.scope.currency, items = o.periods.flatMap(p => p.items);
    // A late match is one transaction listed on both sides; show it once.
    const shown = items.filter(i => i.resolution !== 'MATCHED_LATE' || i.bankRecordId);
    const ok = o.status === 'BALANCED' || o.status === 'BALANCED_AFTER_ENTRIES';
    const download = () => {
        const url = URL.createObjectURL(new Blob([entriesCsv(o.entries)], { type: 'text/csv' }));
        const a = document.createElement('a'); a.href = url; a.download = `fingence-correcting-entries-${o.scope.periods.replace('/', '-to-')}.csv`; a.click(); URL.revokeObjectURL(url);
    };
    return <Panel title="What FinGence did" eyebrow="Reconciled automatically · no approval needed">
        <div className="space-y-4 p-4 sm:p-5">
            <p role="status" className={`rounded-lg border px-3 py-2.5 text-sm ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-950'}`}>{o.summary}</p>
            <ul className="grid gap-2 sm:grid-cols-3">
                {[['Transactions matched', String(o.totals.transactions)], ['Differences resolved', String(o.totals.timing + o.totals.resolutions.ENTRY_PREPARED)], ['Flagged for attention', String(o.attention.length)]].map(([label, value]) =>
                    <li key={label} className="rounded-lg border border-[var(--border)] px-3 py-2"><span className="block text-xs text-[var(--muted)]">{label}</span><span className="text-xl font-semibold tabular-nums">{value}</span></li>)}
            </ul>
            {ORDER.filter(r => shown.some(i => i.resolution === r)).map(r => <section key={r}>
                <h3 className="text-sm font-semibold">{HEADING[r]}</h3>
                <ul className="mt-1 divide-y divide-[var(--border)]">{shown.filter(i => i.resolution === r).map(i => <li key={i.id} className="py-2 text-sm">{i.summary}
                    <details className="mt-0.5 text-xs text-[var(--muted)]"><summary className="cursor-pointer">Details</summary><p>{i.date} · {[i.bankRecordId, ...i.ledgerRecordIds].filter(Boolean).join(', ')} · {i.description}</p><p>{RESOLUTION_LABEL[i.resolution]}: {i.rule}{i.note ? ` ${i.note}` : ''}</p></details>
                </li>)}</ul>
            </section>)}
            {o.entries.length ? <section>
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Correcting entries ({o.entries.length})</h3><button type="button" className={button} onClick={download}><Download size={16} aria-hidden="true" />Download entries (CSV)</button></div>
                <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><caption className="sr-only">Correcting entries prepared by FinGence</caption>
                    <thead><tr className="border-b border-[var(--border)] text-[var(--muted)]"><th className="py-1.5 pr-3 font-medium">Date</th><th className="py-1.5 pr-3 font-medium">Entry</th><th className="py-1.5 pr-3 font-medium">Debit</th><th className="py-1.5 pr-3 font-medium">Credit</th><th className="py-1.5 text-right font-medium">Amount</th></tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">{o.entries.map(e => <tr key={e.id}><td className="whitespace-nowrap py-1.5 pr-3">{e.date}</td><td className="py-1.5 pr-3">{e.description}</td><td className="py-1.5 pr-3">{e.debit.account}</td><td className="py-1.5 pr-3">{e.credit.account}</td><td className="whitespace-nowrap py-1.5 text-right tabular-nums">{money(currency, e.debit.amount)}</td></tr>)}</tbody>
                </table></div>
                <p className="mt-1 text-xs text-[var(--muted)]">Prepared for your books. FinGence does not post them to an accounting system.</p>
            </section> : null}
            <details className="text-xs text-[var(--muted)]"><summary className="cursor-pointer font-medium">How FinGence decided (for technical users)</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{o.rules.map(r => <li key={r}>{r}</li>)}</ul>
                <ul className="mt-2 space-y-0.5">{[...o.checks, ...o.periods.flatMap(p => p.checks.map(k => ({ ...k, label: `${p.period}: ${k.label}` })))].map(k => <li key={k.id + k.label}>{k.passed ? '✓' : '!'} {k.label} · {k.detail}</li>)}</ul>
                <p className="mt-2">{RESOLUTIONS.map(r => `${RESOLUTION_LABEL[r]}: ${o.totals.resolutions[r]}`).join(' · ')}</p>
            </details>
        </div>
    </Panel>;
}
