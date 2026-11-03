'use client';
import { Sparkles } from 'lucide-react';
import type { GroundedRun } from '@/lib/grounded-qa/client';
import type { Refusal, ToolCall } from '@/lib/grounded-qa/contracts';
import type { Segment } from '@/lib/grounded-qa/gates';
import { DecisionBadge } from './shared';

const REFUSAL: Record<Refusal, string> = {
    ADVICE: 'Advice is outside what verified cash records can support.', ALLEGATION: 'Allegations such as fraud or theft cannot be established from cash records.',
    CAUSE_NOT_RECORDED: 'The records do not state why this happened.',
    CLASSIFICATION_NOT_RECORDED: 'The records name counterparties but do not classify them (for example as suppliers, customers or employees) or record what a payment was for, so FinGence will not say which counterparty is one. Ask about a named counterparty, or about money paid or received by counterparty.', OUTSIDE_SCOPE: 'The question is about a business, period or currency that is not in this processing.',
    UNSUPPORTED_MEASURE: 'Profit, revenue, accounting expenses, tax and ratios are not established by cash records.', NOT_A_FINANCE_QUESTION: 'This is not a question about these financial records.',
};
const STATUS = {
    ANSWERED: { decision: 'AUTO_ACCEPTED', label: 'AI answer · verified' }, WITHHELD: { decision: 'QUARANTINED', label: 'AI answer withheld' },
    INSUFFICIENT: { decision: 'UNAVAILABLE', label: 'Not answerable from the records' }, REFUSED: { decision: 'QUARANTINED', label: 'Refused' },
    UNAVAILABLE: { decision: 'UNAVAILABLE', label: 'AI unavailable' },
} as const;
const usd = (n: number) => n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;

/** Plain-English description of a deterministic query the model chose. */
export function describeQuery(q: ToolCall): string {
    const dir = (d: string) => d === 'IN' ? 'money in' : d === 'OUT' ? 'money out' : 'all';
    switch (q.tool) {
        case 'cash_summary': return `Cash summary for ${q.period}`;
        case 'transactions': return `${q.sort.toLowerCase()} ${q.limit} ${dir(q.direction)} transactions${q.counterparty ? ` with ${q.counterparty}` : ''}`;
        case 'counterparties': return `Top ${q.limit} counterparties by ${dir(q.direction)}`;
        case 'reconciliation': return `Reconciliation: ${q.status === 'ALL_EXCEPTIONS' ? 'all exceptions' : q.status.toLowerCase().replace(/_/g, ' ')}`;
        case 'anomalies': return `Anomaly review candidates (${q.severity.toLowerCase()})`;
        case 'monthly_history': return 'Monthly history';
        case 'forecast': return 'Next-month cash baseline';
    }
}

function Sentence({ segments }: { segments: Segment[] }) {
    return <>{segments.map((s, i) => 'text' in s ? <span key={i}>{s.text}</span>
        : <mark key={i} title={`${s.label} · ${s.sources.length} source record${s.sources.length === 1 ? '' : 's'}`} className="rounded bg-[var(--teal-soft)] px-1 font-semibold tabular-nums text-[var(--text)]">{s.value}</mark>)} </>;
}

/** One model-assisted answer. Anything but an accepted answer shows why, and the caller shows the rule-based answer. */
export function GroundedAnswer({ run, heading, fallback = 'The rule-based answer is shown below.' }: { run: GroundedRun; heading?: string; fallback?: string }) {
    const st = STATUS[run.status], v = run.verdict, sources = v?.sentences ? [...new Map(v.sentences.flat().flatMap(s => 'value' in s ? [[s.ref, s] as const] : [])).values()] : [];
    const cost = run.receipts.reduce((n, r) => n + (r.estimatedUsd ?? 0), 0), latency = run.receipts.reduce((n, r) => n + r.latencyMs, 0);
    return <div className="space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-2"><p className="text-[var(--muted)]">{heading ?? run.question}</p><DecisionBadge decision={st.decision} label={st.label} /></header>
        {run.status === 'ANSWERED' && v?.sentences ? <p className="text-base leading-relaxed">{v.sentences.map((s, i) => <Sentence key={i} segments={s} />)}</p>
            : <p className="text-sm text-[var(--muted-strong)]">{run.status === 'REFUSED' && run.refusal ? `${REFUSAL[run.refusal.reason]} ${run.refusal.by === 'PRE_CHECK' ? 'Refused before any model call.' : 'The model declined to plan an answer.'}`
                : run.status === 'INSUFFICIENT' ? `The verified facts do not answer this${v?.missing ? `: ${v.missing}` : '.'}`
                    : run.status === 'WITHHELD' ? `The model's answer did not pass the checks below, so it is not shown.`
                        : `The AI service did not answer (${run.error ?? 'unavailable'}).`} {fallback}</p>}
        {sources.length ? <div className="text-xs">
            <p className="font-semibold">Every highlighted figure was filled in by FinGence from these verified facts:</p>
            <ul className="mt-1 space-y-0.5 text-[var(--muted)]">{sources.map(s => <li key={s.ref}><strong className="text-[var(--muted-strong)]">{s.value}</strong> — {s.label}; source: {s.sources.slice(0, 4).map(x => x.id).join(', ')}{s.sources.length > 4 ? ` and ${s.sources.length - 4} more` : ''}</li>)}</ul>
        </div> : null}
        <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-[var(--teal-dark)]"><Sparkles aria-hidden="true" size={12} className="mr-1 inline" />How this was answered</summary>
            <div className="mt-2 space-y-2">
                {run.queries.length ? <p><span className="font-semibold">{run.planChecks.some(k => k.id === 'fixed-queries') ? 'FinGence ran:' : 'The model asked for:'}</span> {run.queries.map(describeQuery).join('; ')}.</p> : null}
                <ul className="space-y-1">{[...run.planChecks, ...(v?.checks ?? [])].map(k => <li key={k.id} className="flex gap-2"><span aria-hidden="true" className={k.passed ? 'text-[var(--green)]' : 'text-amber-700'}>{k.passed ? '✓' : '!'}</span><span><strong>{k.label}</strong> <span className="sr-only">{k.passed ? 'passed' : 'not passed'}</span>· {k.detail}</span></li>)}</ul>
                {run.receipts.length ? <p className="text-[var(--muted)]">{run.receipts.length} call{run.receipts.length === 1 ? '' : 's'} to {run.receipts[0].model} on Groq · {(latency / 1000).toFixed(1)} s · {run.receipts.map(r => `${r.inputTokens ?? '—'}/${r.outputTokens ?? '—'}`).join(' + ')} tokens · {usd(cost)}</p> : null}
            </div>
        </details>
    </div>;
}
