'use client';
import { Panel } from '@/components/ui';
import { CATEGORY_LABEL, type ReconciliationStatement, type StatementItem } from '@/lib/poc-reconciliation/statement';
import { DecisionBadge, money } from './shared';

function Items({ items, currency }: { items: StatementItem[]; currency: string }) {
    if (!items.length) return <p className="text-xs text-[var(--muted)]">No reconciling items on this side.</p>;
    return <ul className="divide-y divide-[var(--border)]">{items.map(i => <li key={`${i.bankRecordId}:${i.ledgerRecordIds.join('|')}`} className="py-2">
        <div className="flex min-w-0 items-baseline justify-between gap-3"><span className="min-w-0 text-sm font-medium">{CATEGORY_LABEL[i.category]}</span><span className="shrink-0 text-sm font-semibold tabular-nums">{i.adjustment.startsWith('-') ? '−' : '+'} {money(currency, i.adjustment.replace(/^-/, ''))}</span></div>
        <p className="text-xs text-[var(--muted)]">{i.date} · {[i.bankRecordId, ...i.ledgerRecordIds].filter(Boolean).join(', ')} · {i.description}</p>
        <p className="text-xs text-[var(--muted-strong)]">{i.rule}{i.note ? ` ${i.note}` : ''}</p>
    </li>)}</ul>;
}

/** Bank-side and ledger-side reconciling items that take both movements to one adjusted figure; a proposal, never a posting. */
export function ReconciliationStatementPanel({ statement: s }: { statement: ReconciliationStatement }) {
    const side = (title: string, movement: string, items: StatementItem[], adjusted: string) => <section className="min-w-0 rounded-lg border border-[var(--border)] p-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="mt-1 flex justify-between gap-3 text-sm"><span>Movement for {s.period}</span><span className="tabular-nums">{money(s.currency, movement)}</span></div>
        <Items items={items} currency={s.currency} />
        <div className="mt-1 flex justify-between gap-3 border-t-2 border-[var(--border-strong)] pt-2 text-sm font-semibold"><span>Adjusted movement</span><span className="tabular-nums">{money(s.currency, adjusted)}</span></div>
    </section>;
    return <Panel title="Bank reconciliation statement (proposed)" eyebrow="Every exception classified by a stated rule · nothing posted">
        <div className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <DecisionBadge decision={s.explained ? 'AUTO_ACCEPTED' : 'QUARANTINED'} label={s.explained ? 'Difference fully explained' : `${money(s.currency, s.unexplained)} unexplained`} />
                <span className="text-[var(--muted-strong)]">{s.explained ? `Adjusted bank ${money(s.currency, s.bank.adjusted)} equals adjusted ledger ${money(s.currency, s.ledger.adjusted)}.` : 'Items no rule explains stay unexplained with their full effect and are flagged for the technical team.'}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
                {side('Bank side: timing items the bank has not yet processed', s.bank.movement, s.bank.items, s.bank.adjusted)}
                {side('Ledger side: corrections to the books (prepared, not posted)', s.ledger.movement, s.ledger.items, s.ledger.adjusted)}
            </div>
            {s.other.length ? <section><h3 className="text-sm font-semibold">{s.other.some(i => i.category === 'UNEXPLAINED') ? 'Unexplained and no-amount items' : 'Items with no amount effect'}</h3><Items items={s.other} currency={s.currency} /></section> : null}
            <ul className="space-y-1 text-xs">{s.checks.map(k => <li key={k.id} className="flex gap-2"><span aria-hidden="true" className={k.passed ? 'text-[var(--green)]' : 'text-amber-700'}>{k.passed ? '✓' : '!'}</span><span><strong>{k.label}</strong> <span className="sr-only">{k.passed ? 'passed' : 'not passed'}</span>· {k.detail}</span></li>)}</ul>
            <p className="text-xs text-[var(--muted)]">Movement basis: the documents give the period&apos;s cash movements, not opening and closing balances. Every item is classified by a stated rule and the matcher&apos;s outcomes stay as recorded. FinGence prepares the correcting entries automatically; they are not posted to any accounting system.</p>
        </div>
    </Panel>;
}
