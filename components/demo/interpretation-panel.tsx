'use client';
import { Sparkles } from 'lucide-react';
import { Panel } from '@/components/ui';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { DecisionBadge, Table } from './shared';

const FIELD: Record<string, string> = {
    recordId: 'Record ID', date: 'Date', reference: 'Reference', description: 'Description', counterparty: 'Counterparty', amount: 'Amount', direction: 'Direction',
    moneyIn: 'Money in', moneyOut: 'Money out', debit: 'Debit (cash in)', credit: 'Credit (cash out)', balance: 'Running balance', account: 'Account', currency: 'Currency', businessId: 'Business ID', businessName: 'Business name',
};
const AGREEMENT: Record<string, string> = { AGREES: 'Heading agrees', CONTRADICTS: 'Heading contradicts', OPAQUE: 'Heading unclear', CONVENTION: 'Sign convention' };
const usd = (n: number | null) => n === null ? '—' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;

/** What the model proposed for each unfamiliar document, what it cost, and what the deterministic gates concluded. */
export function InterpretationPanel({ context }: { context: ProcessingContext }) {
    const docs = context.documents.filter(d => d.interpretation);
    if (!docs.length) return null;
    return <Panel title="AI layout interpretation" eyebrow="Model proposal · deterministic acceptance">
        <div className="space-y-6 p-4 sm:p-5">
            <p className="text-sm text-[var(--muted-strong)]">A language model proposed how each unfamiliar document is laid out. It never supplies an amount: every row is re-read from the original file under the proposal, which is accepted only when every check below passes and is otherwise quarantined.</p>
            {docs.map(d => {
                const i = d.interpretation!, r = i.receipt, rationale = (i.proposal as { rationale?: unknown } | null)?.rationale;
                return <section key={d.sha256} aria-label={`AI interpretation of ${d.name}`} className="space-y-3 border-t border-[var(--border)] pt-4 first:border-0 first:pt-0">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <h3 className="inline-flex min-w-0 items-center gap-2 break-all font-semibold"><Sparkles aria-hidden="true" size={16} className="shrink-0 text-[var(--teal)]" />{d.name}</h3>
                        <DecisionBadge decision={i.decision} label={i.decision === 'AUTO_ACCEPTED' ? 'AI proposal · verified' : 'AI proposal · quarantined'} />
                    </div>
                    {r ? <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                        <div><dt className="text-[var(--muted)]">Model</dt><dd className="break-all font-medium">{r.model} · Groq</dd></div>
                        <div><dt className="text-[var(--muted)]">Call</dt><dd className="font-medium">{r.mode === 'REPLAYED' ? 'Replayed after reload (no new call)' : `Live · ${(r.latencyMs / 1000).toFixed(1)} s`}</dd></div>
                        <div><dt className="text-[var(--muted)]">Tokens in / out</dt><dd className="font-medium">{r.inputTokens ?? '—'} / {r.outputTokens ?? '—'}</dd></div>
                        <div><dt className="text-[var(--muted)]">Estimated cost</dt><dd className="font-medium">{usd(r.estimatedUsd)}</dd></div>
                    </dl> : <p className="text-sm text-amber-800">{i.summary}{i.error ? ` (${i.error})` : ''}</p>}
                    {typeof rationale === 'string' && rationale ? <p className="text-xs text-[var(--muted)]"><span className="font-semibold">Model rationale (not evidence):</span> {rationale}</p> : null}
                    {i.mapping.length ? <Table caption={`Proposed column mapping for ${d.name}`} columns={['Source heading', 'Proposed meaning', 'Independent check']} rows={i.mapping.map(m => [
                        <span key="h" className="break-all">{m.heading || `Column ${m.column + 1}`}</span>, FIELD[m.field] ?? m.field,
                        m.agreement ? AGREEMENT[m.agreement] : '—',
                    ])} /> : null}
                    {i.checks.length ? <ul className="space-y-1 text-xs">{i.checks.map(k => <li key={k.id} className="flex gap-2"><span aria-hidden="true" className={k.passed ? 'text-[var(--green)]' : 'text-amber-700'}>{k.passed ? '✓' : '!'}</span><span><strong>{k.label}</strong> <span className="sr-only">{k.passed ? 'passed' : 'not passed'}</span>· {k.detail}</span></li>)}</ul> : null}
                    {i.disclosures.length ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--muted)]">{i.disclosures.map(x => <li key={x}>{x}</li>)}</ul> : null}
                </section>;
            })}
        </div>
    </Panel>;
}
