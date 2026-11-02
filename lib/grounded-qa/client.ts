/**
 * Browser orchestration of one grounded question: pre-check → PLAN call → plan gate → deterministic tools →
 * ANSWER call → answer gate. The model is an injected `QaModel` (the gateway, or a recorded double in tests).
 * Every outcome other than ACCEPTED leaves the user with the rule-based answer, never with model text.
 */
import { InterpreterUnavailable, type ModelReceipt } from '../interpretation/contracts';
import { modelView, type Fact } from './facts';
import { preCheck, verifyAnswer, verifyPlan, type AnswerVerdict, type GateCheck } from './gates';
import { catalogue, runQueries, type GroundingIndex } from './tools';
import type { AskRequest, Refusal, ToolCall } from './contracts';

export interface QaModel { call(req: AskRequest): Promise<{ content: unknown; receipt: ModelReceipt }> }
export type GroundedRun = {
    question: string;
    status: 'ANSWERED' | 'WITHHELD' | 'INSUFFICIENT' | 'REFUSED' | 'UNAVAILABLE';
    refusal: { reason: Refusal; by: 'PRE_CHECK' | 'MODEL' } | null;
    queries: ToolCall[]; planChecks: GateCheck[]; facts: Fact[]; verdict: AnswerVerdict | null;
    receipts: ModelReceipt[]; error: string | null;
};

export async function askGrounded(index: GroundingIndex, question: string, model: QaModel): Promise<GroundedRun> {
    const run: GroundedRun = { question, status: 'UNAVAILABLE', refusal: null, queries: [], planChecks: [], facts: [], verdict: null, receipts: [], error: null };
    const red = preCheck(question);
    if (red) return { ...run, status: 'REFUSED', refusal: { reason: red, by: 'PRE_CHECK' } };
    const cat = catalogue(index);
    try {
        const planned = await model.call({ stage: 'plan', question, catalogue: cat });
        run.receipts.push(planned.receipt);
        const plan = verifyPlan(planned.content, cat);
        run.planChecks = plan.checks;
        if (plan.kind === 'INVALID') return { ...run, status: 'WITHHELD' };
        if (plan.kind === 'REFUSED') return { ...run, status: 'REFUSED', refusal: { reason: plan.reason, by: 'MODEL' } };
        run.queries = plan.queries;
        run.facts = runQueries(index, plan.queries);
        const answered = await model.call({ stage: 'answer', question, scope: cat.scope, facts: modelView(run.facts) });
        run.receipts.push(answered.receipt);
        run.verdict = verifyAnswer(answered.content, run.facts, { question, catalogue: cat });
        return { ...run, status: run.verdict.decision === 'ACCEPTED' ? 'ANSWERED' : run.verdict.decision };
    } catch (error) {
        return { ...run, status: 'UNAVAILABLE', error: error instanceof InterpreterUnavailable ? error.code : 'QA_FAILED' };
    }
}

export type QaGatewayStatus = { available: true; model: string; sends: string } | { available: false };
export async function qaGatewayStatus(): Promise<QaGatewayStatus> {
    try {
        const response = await fetch('/api/ai/ask', { cache: 'no-store' });
        if (!response.ok) return { available: false };
        const body = await response.json() as { available?: unknown; model?: unknown; sends?: unknown };
        return body.available === true && typeof body.model === 'string' ? { available: true, model: body.model, sends: String(body.sends ?? '') } : { available: false };
    } catch { return { available: false }; }
}

async function post(req: AskRequest) {
    let response: Response;
    try { response = await fetch('/api/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) }); }
    catch { throw new InterpreterUnavailable('GATEWAY_UNREACHABLE'); }
    const body = await response.json().catch(() => null) as { content?: unknown; receipt?: ModelReceipt; code?: string; retryAfterSeconds?: number } | null;
    if (!response.ok || !body?.receipt) throw new InterpreterUnavailable(body?.code ?? `GATEWAY_HTTP_${response.status}`, response.status === 429 ? body?.retryAfterSeconds : undefined);
    return { content: body.content, receipt: body.receipt };
}
/** As in M1: at most one retry, only after an unbilled refusal with Retry-After ≤ 45 s; the retry is budgeted again. */
export const gatewayQaModel: QaModel = {
    async call(req) {
        try { return await post(req); }
        catch (error) {
            const wait = error instanceof InterpreterUnavailable ? error.retryAfterSeconds : undefined;
            if (wait === undefined || wait > 45) throw error;
            await new Promise(resolve => setTimeout(resolve, wait * 1000 + 500));
            return post(req);
        }
    },
};
