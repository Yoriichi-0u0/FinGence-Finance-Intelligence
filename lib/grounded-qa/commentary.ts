/**
 * AI-written management commentary for the Reports page. FinGence (not the model) chooses a fixed set of
 * deterministic queries; the model only words up to five sentences over the resulting verified facts through
 * the same ANSWER stage, and the same gates decide (`verifyAnswer`): every figure is a placeholder filled by
 * code, and anything that fails a gate is withheld. The deterministic management summary never depends on it.
 */
import { InterpreterUnavailable } from '../interpretation/contracts';
import type { GroundedRun, QaModel } from './client';
import { modelView } from './facts';
import { verifyAnswer, type Segment } from './gates';
import { catalogue, runQueries, type GroundingIndex } from './tools';
import type { ToolCall } from './contracts';

export const COMMENTARY_QUESTION = 'Write a short management commentary on this statement period for the business owner: the net cash movement with money in and money out, the bank-versus-ledger difference with how many items were matched and how many remain exceptions, how many anomaly review candidates there are, and the next-month cash baseline.';

export function commentaryQueries(index: GroundingIndex): ToolCall[] {
    return [
        { tool: 'cash_summary', period: index.scope.period },
        { tool: 'reconciliation', status: 'ALL_EXCEPTIONS' },
        { tool: 'anomalies', severity: 'ANY' },
        { tool: 'forecast' },
    ];
}

export async function writeCommentary(index: GroundingIndex, model: QaModel): Promise<GroundedRun> {
    const queries = commentaryQueries(index), facts = runQueries(index, queries), cat = catalogue(index);
    const run: GroundedRun = {
        question: COMMENTARY_QUESTION, status: 'UNAVAILABLE', refusal: null, queries, facts, verdict: null, receipts: [], error: null,
        planChecks: [{ id: 'fixed-queries', label: 'Queries chosen by FinGence, not the model', passed: true, detail: `${queries.length} fixed queries; ${facts.length} verified facts` }],
    };
    try {
        const answered = await model.call({ stage: 'answer', question: COMMENTARY_QUESTION, scope: cat.scope, facts: modelView(facts) });
        run.receipts.push(answered.receipt);
        run.verdict = verifyAnswer(answered.content, facts, { question: COMMENTARY_QUESTION, catalogue: cat });
        return { ...run, status: run.verdict.decision === 'ACCEPTED' ? 'ANSWERED' : run.verdict.decision };
    } catch (error) {
        return { ...run, status: 'UNAVAILABLE', error: error instanceof InterpreterUnavailable ? error.code : 'QA_FAILED' };
    }
}

/** Plain text of accepted sentences (for the JSON evidence), with every figure as FinGence rendered it. */
export const renderedText = (sentences: Segment[][]) => sentences.map(s => s.map(x => 'text' in x ? x.text : x.value).join('').trim());
