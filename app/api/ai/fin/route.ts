import { finRequestSchema } from '@/lib/fin/contracts';
import { InterpreterUnavailable } from '@/lib/interpretation/contracts';
import { admit, clientAddress } from '@/lib/server/ai/budget';
import { finModel, worstCaseFinUsd } from '@/lib/server/ai/fin';
import { qaModel } from '@/lib/server/ai/grounded-qa';
import { aiGatewayEnabled } from '@/lib/server/ai/groq-interpreter';
import { boundedJson, noStoreJson as json } from '@/lib/server/ai/request';
import { aiCaller, processingGate } from '@/lib/server/workspace/session';
import { runAsCaller } from '@/lib/ai-calls';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 16_000;
const notFound = () => new Response('Not found', { status: 404 });

/** Availability only; behind the same switch and budget as the other AI features. */
export async function GET() {
    if (!aiGatewayEnabled()) return notFound();
    return json({ available: true, provider: 'GROQ', model: qaModel(), sends: 'The conversation\'s words, the page you are on and your latest run\'s business, period and currency; never amounts or records.' });
}

/**
 * Fin: one bounded strict-schema call per message. Fin replies as a guide or hands a self-contained question to the
 * grounded Q&A; it never states a figure. The body is bounded and schema-validated, the caller must be a signed-in
 * member allowed to use AI, and the call is admitted against the shared budget. The browser's gate decides what is shown.
 */
export async function POST(request: Request) {
    if (!aiGatewayEnabled()) return notFound();
    const read = await boundedJson(request, MAX_BODY_BYTES);
    if ('refusal' in read) return read.refusal;
    const gate = await processingGate(request.headers, { ai: true });
    if ('refusal' in gate) return json({ code: gate.refusal.code, ...(gate.refusal.reason ? { reason: gate.refusal.reason } : {}) }, gate.refusal.status);
    // Attributed to this member on the Technical log (metadata only, never the conversation).
    return runAsCaller(aiCaller(gate.principal), () => reply(request, read.body));
}

async function reply(request: Request, body: unknown) {
    const parsed = finRequestSchema.safeParse(body);
    if (!parsed.success) return json({ code: 'INVALID_REQUEST' }, 400);
    const admission = await admit({ client: clientAddress(request.headers), worstCaseUsd: worstCaseFinUsd(parsed.data) });
    if (!admission.admitted) return json({ code: admission.code, ...(admission.retryAfterSeconds ? { retryAfterSeconds: admission.retryAfterSeconds } : {}) }, admission.status);
    try {
        const result = await finModel(parsed.data);
        await admission.settle(result.receipt.estimatedUsd);
        return json(result);
    } catch (error) {
        const code = error instanceof InterpreterUnavailable ? error.code : 'MODEL_FAILED';
        await admission.settle(code === 'RATE_LIMITED' ? 0 : null);
        const retryAfterSeconds = error instanceof InterpreterUnavailable ? error.retryAfterSeconds : undefined;
        return json(code === 'RATE_LIMITED' ? { code, retryAfterSeconds: Math.ceil(retryAfterSeconds ?? 20) } : { code }, code === 'RATE_LIMITED' ? 429 : 502);
    }
}
