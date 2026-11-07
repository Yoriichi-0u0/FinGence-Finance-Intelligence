'use client';
import { ChevronRight, Download } from 'lucide-react';
import { Panel } from '@/components/ui';
import { entriesCsv, RESOLUTION_LABEL, RESOLUTIONS, type ReconciliationOutcome, type Resolution } from '@/lib/reconciliation/reconcile';
import { Callout, Table, button, money } from './shared';

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
            <Callout role="status" tone={ok ? 'good' : 'warn'}>{o.summary}</Callout>
            <ul className="grid gap-2 sm:grid-cols-3">
                {[['Transactions matched', String(o.totals.transactions)], ['Differences resolved', String(o.totals.timing + o.totals.resolutions.ENTRY_PREPARED)], ['Flagged for attention', String(o.attention.length)]].map(([label, value]) =>
                    <li key={label} className="rounded-xl bg-[var(--surface-subtle)] px-3.5 py-2.5 ring-1 ring-inset ring-[var(--border)]"><span className="block text-xs text-[var(--muted)]">{label}</span><span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">{value}</span></li>)}
            </ul>
            <div className="space-y-2">{ORDER.filter(r => shown.some(i => i.resolution === r)).map(r => <details key={r} open={r === 'UNEXPLAINED'} className="group rounded-xl border border-[var(--border)]">
                <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-3 py-2"><h3 className={`flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold ${r === 'UNEXPLAINED' ? 'text-[var(--warn-ink)]' : ''}`}><span aria-hidden="true" className={`size-2 rounded-full ${r === 'UNEXPLAINED' ? 'bg-[var(--warn)]' : r === 'ENTRY_PREPARED' || r === 'TIMING_OPEN' ? 'bg-[var(--brand)]' : 'bg-[var(--good)]'}`} />{HEADING[r]}</h3><span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--muted-strong)]">{shown.filter(i => i.resolution === r).length}</span><ChevronRight aria-hidden="true" size={16} className="disclosure-chevron shrink-0 text-[var(--muted)] transition-transform" /></summary>
                <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">{shown.filter(i => i.resolution === r).map(i => <li key={i.id} className="px-3 py-2.5 text-sm leading-relaxed">{i.summary}
                    <details className="mt-0.5 text-xs text-[var(--muted)]"><summary className="inline-flex min-h-8 cursor-pointer items-center font-semibold text-[var(--brand-ink)]">Details</summary><p>{i.date} · {[i.bankRecordId, ...i.ledgerRecordIds].filter(Boolean).join(', ')} · {i.description}</p><p>{RESOLUTION_LABEL[i.resolution]}: {i.rule}{i.note ? ` ${i.note}` : ''}</p></details>
                </li>)}</ul>
            </details>)}</div>
            {o.entries.length ? <section>
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Correcting entries ({o.entries.length})</h3><button type="button" className={button} onClick={download}><Download size={16} aria-hidden="true" />Download entries (CSV)</button></div>
                <div className="mt-2 overflow-hidden rounded-xl border border-[var(--border)]"><Table caption="Correcting entries prepared by FinGence" columns={['Entry', 'Date', 'Debit', 'Credit', 'Amount']} rows={o.entries.map(e => [e.description, <span key="d" className="whitespace-nowrap">{e.date}</span>, e.debit.account, e.credit.account, <span key="a" className="whitespace-nowrap font-medium tabular-nums">{money(currency, e.debit.amount)}</span>])} /></div>
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
