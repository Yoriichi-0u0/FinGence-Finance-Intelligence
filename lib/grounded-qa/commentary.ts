/**
 * AI-written management commentary for the Reports page. FinGence (not the model) chooses a fixed set of
 * deterministic queries; the model only words up to five sentences over the resulting verified facts through
 * the same ANSWER stage, and the same gates decide (`verifyAnswer`): every figure is a placeholder filled by
 * code, and anything that fails a gate is withheld. The deterministic management summary never depends on it.
 */
import { InterpreterUnavailable } from '../interpretation/contracts';
import type { GroundedRun, QaModel } from './client';
import { modelView, type Fact } from './facts';
import { verifyAnswer, type Segment } from './gates';
import { catalogue, runQueries, type GroundingIndex } from './tools';
import { MAX_FACTS, type ToolCall } from './contracts';

/** Sent as the answer-stage question, so it must fit the gateway's question bound (MAX_QUESTION). */
export const COMMENTARY_QUESTION = 'Write a short management commentary on this period: net cash movement with money in and out, the bank-versus-ledger difference with matched and exception counts, the number of anomaly review candidates, and the next-month cash baseline.';

export function commentaryQueries(index: GroundingIndex): ToolCall[] {
    return [
        { tool: 'cash_summary', period: index.scope.period },
        { tool: 'reconciliation', status: 'ALL_EXCEPTIONS' },
        { tool: 'anomalies', severity: 'ANY' },
        { tool: 'forecast' },
    ];
}

export function writeCommentary(index: GroundingIndex, model: QaModel): Promise<GroundedRun> {
    return writeFixed(index, model, COMMENTARY_QUESTION, commentaryQueries(index));
}

/**
 * One answer-stage call over queries FinGence chose (no model-chosen plan), checked by the same answer gate as
 * every grounded answer. Used by the Reports commentary and by each section of the AI report.
 */
export async function writeFixed(index: GroundingIndex, model: QaModel, question: string, queries: ToolCall[], extra: Omit<Fact, 'id' | 'query'>[] = []): Promise<GroundedRun> {
    const base = runQueries(index, queries), cat = catalogue(index);
    // Facts FinGence computes outside the tool set (e.g. the AI report's preceding-period comparison), numbered after the queries' facts.
    const facts: Fact[] = [...base, ...extra.slice(0, Math.max(0, MAX_FACTS - base.length)).map((d, i) => ({ ...d, id: `F${base.length + i + 1}`, query: queries.length }))];
    const run: GroundedRun = {
        question, status: 'UNAVAILABLE', refusal: null, queries, facts, verdict: null, receipts: [], error: null,
        planChecks: [{ id: 'fixed-queries', label: 'Queries chosen by FinGence, not the model', passed: true, detail: `${queries.length} fixed queries; ${facts.length} verified facts` }],
    };
    try {
        const answered = await model.call({ stage: 'answer', question, scope: cat.scope, facts: modelView(facts) });
        run.receipts.push(answered.receipt);
        run.verdict = verifyAnswer(answered.content, facts, { question, catalogue: cat });
        return { ...run, status: run.verdict.decision === 'ACCEPTED' ? 'ANSWERED' : run.verdict.decision };
    } catch (error) {
        return { ...run, status: 'UNAVAILABLE', error: error instanceof InterpreterUnavailable ? error.code : 'QA_FAILED' };
    }
}

/** Plain text of accepted sentences (for the JSON evidence), with every figure as FinGence rendered it. */
export const renderedText = (sentences: Segment[][]) => sentences.map(s => s.map(x => 'text' in x ? x.text : x.value).join('').trim());
