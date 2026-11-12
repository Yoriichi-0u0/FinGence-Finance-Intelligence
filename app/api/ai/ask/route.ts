import { askRequestSchema } from '@/lib/grounded-qa/contracts';
import { preCheck } from '@/lib/grounded-qa/gates';
import { InterpreterUnavailable } from '@/lib/interpretation/contracts';
import { admit, clientAddress } from '@/lib/server/ai/budget';
import { askModel, qaModel, worstCaseQaUsd } from '@/lib/server/ai/grounded-qa';
import { aiGatewayEnabled } from '@/lib/server/ai/groq-interpreter';
import { boundedJson, noStoreJson as json } from '@/lib/server/ai/request';
import { aiCaller, processingGate } from '@/lib/server/workspace/session';
import { recordAiRefusal, runAsCaller } from '@/lib/ai-calls';
import { COMMENTARY_QUESTION } from '@/lib/grounded-qa/commentary';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 32_000;
const notFound = () => new Response('Not found', { status: 404 });

/** Availability only; behind the same switch and budget as layout interpretation. */
export async function GET() {
    if (!aiGatewayEnabled()) return notFound();
    return json({ available: true, provider: 'GROQ', model: qaModel(), sends: 'Your question, the list of counterparties and months, and then only the verified facts the chosen queries return; never the full records.' });
}

/**
 * Grounded Q&A gateway: one bounded strict-schema call per stage (plan or answer). The question is pre-checked
 * for advice and allegations BEFORE any budget or provider use, the body is bounded and schema-validated, and
 * the call is admitted against the shared budget. Only the call's metadata is logged (lib/ai-calls); the browser's gates decide.
 */
export async function POST(request: Request) {
    if (!aiGatewayEnabled()) return notFound();
    const read = await boundedJson(request, MAX_BODY_BYTES);
    if ('refusal' in read) return read.refusal;
    const gate = await processingGate(request.headers, { ai: true });
    if ('refusal' in gate) return json({ code: gate.refusal.code, ...(gate.refusal.reason ? { reason: gate.refusal.reason } : {}) }, gate.refusal.status);
    // Every model call below is attributed to this member on the Technical log (metadata only, never the question).
    return runAsCaller(aiCaller(gate.principal), () => answer(request, read.body));
}

async function answer(request: Request, body: unknown) {
    const parsed = askRequestSchema.safeParse(body);
    if (!parsed.success) return json({ code: 'INVALID_REQUEST' }, 400);
    // The same deterministic refusals as the browser; counterparties come from the catalogue (plan) or the facts (answer).
    const names = parsed.data.stage === 'plan' ? parsed.data.catalogue.counterparties : [...new Set(parsed.data.facts.flatMap(f => Object.values(f.fields)))];
    const refusal = preCheck(parsed.data.question, names);
    if (refusal) {
        await recordAiRefusal({ feature: parsed.data.question === COMMENTARY_QUESTION ? 'report-commentary' : 'finance-qa', model: qaModel() }, 'REFUSED_BEFORE_MODEL');
        return json({ code: 'REFUSED_BEFORE_MODEL', reason: refusal }, 422);
    }
    const admission = await admit({ client: clientAddress(request.headers), worstCaseUsd: worstCaseQaUsd(parsed.data) });
    if (!admission.admitted) return json({ code: admission.code, ...(admission.retryAfterSeconds ? { retryAfterSeconds: admission.retryAfterSeconds } : {}) }, admission.status);
    try {
        const result = await askModel(parsed.data);
        await admission.settle(result.receipt.estimatedUsd);
        return json(result);
    } catch (error) {
        const code = error instanceof InterpreterUnavailable ? error.code : 'MODEL_FAILED';
        await admission.settle(code === 'RATE_LIMITED' ? 0 : null);
        const retryAfterSeconds = error instanceof InterpreterUnavailable ? error.retryAfterSeconds : undefined;
        return json(code === 'RATE_LIMITED' ? { code, retryAfterSeconds: Math.ceil(retryAfterSeconds ?? 20) } : { code }, code === 'RATE_LIMITED' ? 429 : 502);
    }
}
