/**
 * The AI report: a management report whose prose is written by a language model, section by section, over the
 * verified facts of one processed run. FinGence (not the model) chooses each section's deterministic queries; the
 * model only words sentences with placeholders, and the same answer gate as every grounded answer fills each figure
 * from the records or withholds the paragraph. Works for any run the Data page processed, whatever the document format.
 */
import type { AiFeature } from '../ai-calls/features';
import type { GroundedRun, QaModel } from '../grounded-qa/client';
import { COMMENTARY_QUESTION, writeFixed } from '../grounded-qa/commentary';
import type { ToolCall } from '../grounded-qa/contracts';
import { count, money, type Fact, type Value } from '../grounded-qa/facts';
import { toCents } from '../poc-anomalies/source';
import type { GroundingIndex } from '../grounded-qa/tools';

export const AI_REPORT_VERSION = 'fingence-ai-report-v1';
export type AiReportSectionId = 'summary' | 'cash' | 'reconciliation' | 'review' | 'outlook';

export type AiReportSection = { id: AiReportSectionId; title: string; question: string; queries: (index: GroundingIndex) => ToolCall[]; extra?: (index: GroundingIndex) => Omit<Fact, 'id' | 'query'>[] };

/** The month before a YYYY-MM month. */
export const previousMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
/** The same number of months immediately before the given months (oldest first). */
export function precedingMonths(months: string[]): string[] {
    const out: string[] = [];
    let at = [...months].sort()[0];
    for (let i = 0; i < months.length; i++) { at = previousMonth(at); out.unshift(at); }
    return out;
}
const tenths = (delta: bigint, base: bigint): Value | null => base === 0n ? null : { kind: 'PERCENT', tenths: Number((delta * 1000n) / (base < 0n ? -base : base)) };
/**
 * The preceding period of the same length, and the change to this period, computed by FinGence from the verified
 * bank history (none when the history does not cover every preceding month). Given as ready facts so the model
 * never compares a quarter with a single month.
 */
export function comparisonFacts(index: GroundingIndex): Omit<Fact, 'id' | 'query'>[] {
    const prior = precedingMonths(index.statementMonths), available = new Set(index.history.map(r => r.period));
    if (!prior.length || !prior.every(m => available.has(m))) return [];
    const sum = (rows: typeof index.history) => rows.reduce((t, r) => { const v = toCents(r.signedAmount); return v > 0n ? { ...t, in: t.in + v, n: t.n + 1 } : { ...t, out: t.out - v, n: t.n + 1 }; }, { in: 0n, out: 0n, n: 0 });
    const before = sum(index.history.filter(r => prior.includes(r.period))), now = sum(index.rows), cur = index.currency;
    const range = prior.length > 1 ? `${prior[0]}/${prior.at(-1)}` : prior[0];
    const percent = (a: bigint, b: bigint): Record<string, Value> => { const v = tenths(a - b, b); return v ? { changePercent: v } : {}; };
    return [
        { label: `Preceding period of the same length (${range})`, primary: 'net', fields: { period: { kind: 'PERIOD', ym: range }, moneyIn: money(before.in, cur), moneyOut: money(before.out, cur), net: money(before.in - before.out, cur), transactions: count(before.n) }, sources: [{ kind: 'HISTORY', id: range }] },
        { label: `Change in money in from the preceding period (${range}) to this period`, primary: 'change', fields: { change: money(now.in - before.in, cur), ...percent(now.in, before.in) } as Record<string, Value>, sources: [{ kind: 'HISTORY', id: range }, { kind: 'TOTALS', id: index.scope.period }] },
        { label: `Change in money out from the preceding period (${range}) to this period`, primary: 'change', fields: { change: money(now.out - before.out, cur), ...percent(now.out, before.out) }, sources: [{ kind: 'HISTORY', id: range }, { kind: 'TOTALS', id: index.scope.period }] },
        { label: `Change in net cash movement from the preceding period (${range}) to this period`, primary: 'change', fields: { change: money((now.in - now.out) - (before.in - before.out), cur), ...percent(now.in - now.out, before.in - before.out) }, sources: [{ kind: 'HISTORY', id: range }, { kind: 'TOTALS', id: index.scope.period }] },
    ];
}

/**
 * Laid out like a listed company's quarterly or annual report (management discussion, financial review,
 * controls, matters for review, outlook), within what verified cash records can support: no profit, revenue or
 * balance-sheet claims. Sent as answer-stage questions, so each fits the gateway's question bound and passes its
 * pre-check (tests hold both).
 */
export const AI_REPORT_SECTIONS: readonly AiReportSection[] = [
    {
        id: 'summary', title: 'Review of performance',
        question: 'Open the review of performance in up to four short sentences: net cash movement with money in and out, its change from the preceding period of equal length if listed, how the bank compares with the books, and how many records are marked for review. State facts only, without proposing actions.',
        queries: index => [{ tool: 'cash_summary', period: index.scope.period }, { tool: 'reconciliation', status: 'ALL_EXCEPTIONS' }, { tool: 'anomalies', severity: 'ANY' }],
        extra: comparisonFacts,
    },
    {
        id: 'cash', title: 'Cash received and paid',
        question: 'Write the review of cash received and paid in up to four short sentences: money in, money out and the net, the change in each from the preceding period of the same length where listed, and the largest counterparties in and out.',
        queries: index => [{ tool: 'cash_summary', period: index.scope.period }, { tool: 'counterparties', direction: 'IN', limit: 3 }, { tool: 'counterparties', direction: 'OUT', limit: 3 }],
        extra: comparisonFacts,
    },
    {
        id: 'reconciliation', title: 'Reconciliation with the books',
        question: 'Describe the reconciliation of the bank statement with the books in up to three short sentences, each citing at most three facts: the difference between bank and ledger movement, how many records matched, and how many open items remain.',
        queries: () => [{ tool: 'reconciliation', status: 'ALL_EXCEPTIONS' }],
    },
    {
        id: 'review', title: 'Matters for review',
        question: 'Summarise the bank records marked for review in up to three short sentences: how many there are, how many the books confirm, and the largest one still open. A mark is a reason to review a record, not a finding. State facts only, without proposing actions.',
        queries: () => [{ tool: 'anomalies', severity: 'ANY' }],
    },
    {
        id: 'outlook', title: 'Commentary on prospects',
        question: 'Describe the next-month cash baseline in up to three short sentences: money in, money out and the net, and the months it averages, with a placeholder for every number including the count of months. Say it is an average of recent months, not a prediction.',
        queries: index => [{ tool: 'forecast' }, { tool: 'cash_summary', period: index.scope.period }],
    },
];

const QUESTIONS = new Set(AI_REPORT_SECTIONS.map(s => s.question));

/** The Technical log feature a grounded answer-stage question belongs to (metadata only; never the question). */
export function groundedFeature(question: string): AiFeature {
    if (question === COMMENTARY_QUESTION) return 'report-commentary';
    if (QUESTIONS.has(question)) return 'report-explain';
    return 'finance-qa';
}

/** One section: one bounded call; a reply the provider rejected as malformed JSON is tried once more. */
export async function writeReportSection(index: GroundingIndex, model: QaModel, id: AiReportSectionId): Promise<GroundedRun> {
    const section = AI_REPORT_SECTIONS.find(s => s.id === id)!, extra = section.extra?.(index) ?? [];
    const run = await writeFixed(index, model, section.question, section.queries(index), extra);
    return run.status === 'UNAVAILABLE' && run.error?.includes('JSON_VALIDATE') ? writeFixed(index, model, section.question, section.queries(index), extra) : run;
}
