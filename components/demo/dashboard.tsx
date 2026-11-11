'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { Panel } from '@/components/ui';
import { atLeast, plainMessage, useWorkspace } from '@/components/workspace/context';
import { CARDS, DEFAULT_LAYOUT, isDefault, move, normalise, offered, setVisible, type CardId, type Layout } from '@/lib/dashboard/layout';
import { fromCents, toCents, type SourceRow } from '@/lib/poc-anomalies/source';
import { RESOLUTION_LABEL, RESOLUTIONS, type ReconciliationOutcome } from '@/lib/reconciliation/reconcile';
import type { ReconciliationStatus } from '@/lib/poc-reconciliation/contracts';
import { button, money, outflow, primaryButton } from './shared';

/** Without the workspace (no sign-in), the layout is kept in this browser only. */
const BROWSER_KEY = 'fingence-dashboard-v1';
/** The last layout loaded for a signed-in person, so returning to Overview in the same tab does not wait for the network. */
let cached: { email: string; layout: Layout } | null = null;

export type DashboardLayout = {
    layout: Layout;
    /** False until the saved layout is known; the cards are not drawn before, so they never jump. */
    ready: boolean;
    /** Where the layout is kept: the workspace database (follows the person) or this browser. */
    where: 'workspace' | 'browser';
    /** Admin and above (in the role the app is shown as): the Admin-only cards are offered. */
    admin: boolean;
    /** Save a layout, or null to return to the default. Resolves to an error message, or null when saved. */
    save: (next: Layout | null) => Promise<string | null>;
};

function browserLayout(): Layout {
    try { return normalise(JSON.parse(localStorage.getItem(BROWSER_KEY) ?? 'null')); } catch { return DEFAULT_LAYOUT; }
}

/**
 * The signed-in person's own Overview layout, from the workspace database; or, with the workspace off, from this browser.
 * The Overview only mounts in the browser after processing, so a layout kept in this browser (or already loaded in this
 * tab) is known at the first render; one in the database is fetched once and the cards wait for it.
 */
export function useDashboardLayout(initial?: Layout): DashboardLayout {
    const { enabled, loading, session, viewRole } = useWorkspace();
    const email = session?.email ?? null;
    const [state, setState] = useState<{ layout: Layout; ready: boolean }>(() =>
        initial ? { layout: normalise(initial), ready: true }
        : !enabled ? { layout: browserLayout(), ready: true }
        : email && cached?.email === email ? { layout: cached.layout, ready: true }
        : { layout: DEFAULT_LAYOUT, ready: false });
    const { layout, ready } = state;
    const setLayout = (next: Layout) => setState({ layout: next, ready: true });
    useEffect(() => {
        if (ready || !enabled || loading || !email) return;
        let live = true;
        void fetch('/api/workspace/preferences', { cache: 'no-store' })
            .then(async res => res.ok ? normalise((await res.json() as { dashboard: unknown }).dashboard) : DEFAULT_LAYOUT)
            .catch(() => DEFAULT_LAYOUT)
            .then(next => { cached = { email, layout: next }; if (live) setState({ layout: next, ready: true }); });
        return () => { live = false; };
    }, [ready, enabled, loading, email]);
    const save = useCallback(async (next: Layout | null) => {
        const value = next && !isDefault(next) ? next : null;
        if (!enabled) {
            try { if (value) localStorage.setItem(BROWSER_KEY, JSON.stringify(value)); else localStorage.removeItem(BROWSER_KEY); }
            catch { return 'This browser does not allow FinGence to keep the layout. It applies until you leave this page.'; }
            finally { setLayout(value ?? DEFAULT_LAYOUT); }
            return null;
        }
        try {
            const res = await fetch('/api/workspace/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dashboard: value }) });
            if (!res.ok) return plainMessage((await res.json().catch(() => ({})) as { code?: string }).code);
        } catch { return plainMessage('WORKSPACE_UNAVAILABLE'); }
        setLayout(value ?? DEFAULT_LAYOUT);
        if (email) cached = { email, layout: value ?? DEFAULT_LAYOUT };
        return null;
    }, [enabled, email]);
    return { layout, ready, where: enabled ? 'workspace' : 'browser', admin: enabled && atLeast(viewRole ?? undefined, 'ADMIN'), save };
}

/**
 * The editor "Customise dashboard" opens: every card offered to this person, with a show/hide switch and Up/Down buttons.
 * Everything works from the keyboard; focus stays on the button pressed, and each change is announced.
 */
export function DashboardEditor({ draft, admin, where, saving, error, onChange, onDone, onCancel }: {
    draft: Layout; admin: boolean; where: DashboardLayout['where']; saving: boolean; error: string | null;
    /** Takes an update of the current draft, so changes made in quick succession all apply. */
    onChange: (update: (current: Layout) => Layout) => void; onDone: () => void; onCancel: () => void;
}) {
    const cards = offered(draft, admin), [said, say] = useState('');
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => { heading.current?.focus(); }, []);
    const shift = (id: CardId, delta: -1 | 1) => {
        const next = move(draft, id, delta, admin);
        if (next === draft) return;
        onChange(current => move(current, id, delta, admin));
        const position = offered(next, admin).findIndex(c => c.id === id) + 1, total = offered(next, admin).length;
        say(`${CARDS[id].label} moved to position ${position} of ${total}.`);
        // Keep focus on the button pressed; at either end, on the other one.
        requestAnimationFrame(() => {
            const same = document.getElementById(`dashboard-${delta < 0 ? 'up' : 'down'}-${id}`) as HTMLButtonElement | null;
            (same && !same.disabled ? same : document.getElementById(`dashboard-${delta < 0 ? 'down' : 'up'}-${id}`))?.focus();
        });
    };
    const toggle = (id: CardId, visible: boolean) => { onChange(current => setVisible(current, id, !current.cards.find(c => c.id === id)?.visible)); say(`${CARDS[id].label} ${visible ? 'shown' : 'hidden'}.`); };
    const reset = () => { onChange(() => DEFAULT_LAYOUT); say('Default layout restored. Press Done to keep it.'); };
    const iconButton = 'grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--surface)]';
    return <section id="dashboard-editor" aria-labelledby="dashboard-editor-title" className="panel-shadow mb-5 min-w-0 overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3.5 sm:px-5">
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--brand)]">{where === 'workspace' ? 'Only you see this layout · it follows you on any device' : 'Kept in this browser'}</p>
            <h2 id="dashboard-editor-title" ref={heading} tabIndex={-1} className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--ink)] outline-none sm:text-base">Customise dashboard</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">Show or hide cards and move them up or down. The dashboard below changes as you go; press Done to keep it.</p>
        </div>
        <ol className="divide-y divide-[var(--border)]">{cards.map((card, i) => {
            const meta = CARDS[card.id];
            return <li key={card.id} className="flex min-w-0 items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-5">
                <span aria-hidden="true" className="w-5 shrink-0 text-center text-xs font-semibold text-[var(--muted)] tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold ${card.visible ? '' : 'text-[var(--muted-strong)]'}`}>{meta.label}</span>
                    <span className="block text-xs leading-snug text-[var(--muted)]">{meta.detail}</span>
                </span>
                <button type="button" role="switch" aria-checked={card.visible} aria-label={`Show ${meta.label}`} onClick={() => toggle(card.id, !card.visible)}
                    className="group grid min-h-11 shrink-0 place-items-center rounded-xl px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">
                    <span aria-hidden="true" className={`relative block h-6 w-11 rounded-full transition-colors ${card.visible ? 'bg-[var(--brand-solid)]' : 'bg-[var(--border-strong)]'}`}>
                        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${card.visible ? 'left-[22px]' : 'left-0.5'}`} />
                    </span>
                </button>
                <button type="button" id={`dashboard-up-${card.id}`} className={iconButton} disabled={i === 0} aria-label={`Move ${meta.label} up`} onClick={() => shift(card.id, -1)}><ArrowUp aria-hidden="true" size={16} /></button>
                <button type="button" id={`dashboard-down-${card.id}`} className={iconButton} disabled={i === cards.length - 1} aria-label={`Move ${meta.label} down`} onClick={() => shift(card.id, 1)}><ArrowDown aria-hidden="true" size={16} /></button>
            </li>;
        })}</ol>
        <p aria-live="polite" className="sr-only">{said}</p>
        {error ? <p role="alert" className="border-t border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-2.5 text-sm text-[var(--warn-ink)] sm:px-5">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-3 sm:px-5">
            <button type="button" className={button} onClick={reset} disabled={isDefault(draft)}><RotateCcw aria-hidden="true" size={15} />Reset to default</button>
            <span className="ml-auto flex gap-2">
                <button type="button" className={button} onClick={onCancel} disabled={saving}>Cancel</button>
                <button type="button" className={primaryButton} onClick={onDone} disabled={saving}>{saving ? 'Saving…' : 'Done'}</button>
            </span>
        </div>
    </section>;
}

const link = 'text-xs font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-line)] underline-offset-2';

/** Optional card: who paid the business and whom it paid the most, from the verified bank rows. */
export function CounterpartiesCard({ currency, rows }: { currency: string; rows: SourceRow[] }) {
    const top = (direction: SourceRow['direction']) => {
        const by = new Map<string, { cents: bigint; n: number }>();
        for (const r of rows) if (r.direction === direction) { const t = by.get(r.counterparty) ?? { cents: 0n, n: 0 }; by.set(r.counterparty, { cents: t.cents + toCents(r.amount.replace(/^-/, '')), n: t.n + 1 }); }
        return [...by.entries()].sort((a, b) => (b[1].cents > a[1].cents ? 1 : b[1].cents < a[1].cents ? -1 : a[0].localeCompare(b[0]))).slice(0, 5);
    };
    const side = (title: string, list: ReturnType<typeof top>, show: (v: string) => string) => <div className="min-w-0 px-4 py-3 sm:px-5">
        <h3 className="text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--muted)]">{title}</h3>
        {list.length ? <ol className="mt-2 space-y-1.5">{list.map(([name, t]) => <li key={name} className="flex min-w-0 items-baseline gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
            <span className="shrink-0 text-xs text-[var(--muted)] tabular-nums">{t.n}×</span>
            <span className="shrink-0 font-medium tabular-nums">{show(fromCents(t.cents))}</span>
        </li>)}</ol> : <p className="mt-2 text-sm text-[var(--muted)]">None in this period.</p>}
    </div>;
    return <Panel title="Largest counterparties" eyebrow="By total, from the verified bank statement" action={<Link href="/transactions" className={link}>Transactions</Link>} className="h-full">
        <div className="grid divide-y divide-[var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {side('Money in, from', top('Credit'), v => money(currency, v))}
            {side('Money out, to', top('Debit'), v => outflow(currency, v))}
        </div>
    </Panel>;
}

/** Optional card: how every record was matched or resolved. */
export function ReconciliationSummaryCard({ currency, counts, records, resolution }: { currency: string; counts: Record<ReconciliationStatus, number>; records: number; resolution: ReconciliationOutcome | null }) {
    const lines: [string, number][] = [['Matched exactly', counts.MATCH_EXACT], ['Matched, posting dates differ', counts.MATCH_DATE_SHIFT],
        ...(resolution ? RESOLUTIONS.filter(r => r !== 'UNEXPLAINED' && resolution.totals.resolutions[r]).map(r => [RESOLUTION_LABEL[r], resolution.totals.resolutions[r]] as [string, number]) : [])];
    const unexplained = resolution?.totals.resolutions.UNEXPLAINED ?? 0;
    return <Panel title="Reconciliation summary" eyebrow={`${records} records`} action={<Link href="/reconciliation" className={link}>Reconciliation</Link>} className="h-full">
        <dl className="divide-y divide-[var(--border)] text-sm">
            {lines.map(([label, n]) => <div key={label} className="flex items-baseline justify-between gap-3 px-4 py-2 sm:px-5"><dt className="min-w-0 text-[var(--muted-strong)]">{label}</dt><dd className="font-semibold tabular-nums">{n}</dd></div>)}
            <div className="flex items-baseline justify-between gap-3 px-4 py-2 sm:px-5">
                <dt className="min-w-0 text-[var(--muted-strong)]">{RESOLUTION_LABEL.UNEXPLAINED}</dt>
                <dd className={`font-semibold tabular-nums ${unexplained ? 'text-[var(--warn-ink)]' : ''}`}>{unexplained}{unexplained && resolution ? ` · ${outflow(currency, resolution.totals.unexplained)}` : ''}</dd>
            </div>
        </dl>
    </Panel>;
}

type Run = { id: string; at: string; by: string | null; source: 'SERVER' | 'BROWSER'; outcome: string | null; documents: { decision: string; model: string | null }[] };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Optional card, Admin and above: the last five runs of the past 30 days from the Technical log (the role is checked in the database). */
export function LastRunsCard() {
    const [state, setState] = useState<{ runs: Run[] } | { error: string } | null>(null);
    useEffect(() => {
        let live = true;
        void fetch('/api/workspace/log?days=30', { cache: 'no-store' })
            .then(async res => { const body = await res.json().catch(() => ({})) as { runs?: Run[]; code?: string }; return res.ok && Array.isArray(body.runs) ? { runs: body.runs.slice(0, 5) } : { error: plainMessage(body.code) }; })
            .catch(() => ({ error: plainMessage('WORKSPACE_UNAVAILABLE') }))
            .then(next => { if (live) setState(next); });
        return () => { live = false; };
    }, []);
    return <Panel title="Last processing runs" eyebrow="Technical log · for Admins" action={<Link href="/log" className={link}>Technical log</Link>} className="h-full">
        {state === null ? <p className="px-4 py-3.5 text-sm text-[var(--muted)] sm:px-5">Loading…</p>
            : 'error' in state ? <p className="px-4 py-3.5 text-sm text-[var(--muted-strong)] sm:px-5">{state.error}</p>
            : state.runs.length ? <ul className="divide-y divide-[var(--border)]">{state.runs.map(r => {
                const accepted = r.documents.filter(d => d.decision === 'AUTO_ACCEPTED').length, ai = r.documents.filter(d => d.model).length;
                return <li key={r.id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5">
                    <span className="font-medium tabular-nums">{when(r.at)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">{r.by ?? 'Unknown'} · {r.source === 'SERVER' ? 'server' : 'browser'}</span>
                    <span className="text-xs tabular-nums text-[var(--muted-strong)]">{accepted} of {r.documents.length} doc{r.documents.length === 1 ? '' : 's'} accepted{ai ? ` · ${ai} by AI` : ''}</span>
                </li>;
            })}</ul>
            : <p className="px-4 py-3.5 text-sm text-[var(--muted-strong)] sm:px-5">No runs in the last 30 days. Runs appear here as soon as someone processes documents.</p>}
    </Panel>;
}
