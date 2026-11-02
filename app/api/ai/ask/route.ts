import { askRequestSchema } from '@/lib/grounded-qa/contracts';
import { preCheck } from '@/lib/grounded-qa/gates';
import { InterpreterUnavailable } from '@/lib/interpretation/contracts';
import { admit, clientAddress } from '@/lib/server/ai/budget';
import { askModel, qaModel, worstCaseQaUsd } from '@/lib/server/ai/grounded-qa';
import { aiGatewayEnabled } from '@/lib/server/ai/groq-interpreter';
import { boundedJson, noStoreJson as json } from '@/lib/server/ai/request';

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
 * the call is admitted against the shared budget. Nothing is stored or logged; the browser's gates decide.
 */
export async function POST(request: Request) {
    if (!aiGatewayEnabled()) return notFound();
    const read = await boundedJson(request, MAX_BODY_BYTES);
    if ('refusal' in read) return read.refusal;
    const parsed = askRequestSchema.safeParse(read.body);
    if (!parsed.success) return json({ code: 'INVALID_REQUEST' }, 400);
    const refusal = preCheck(parsed.data.question);
    if (refusal) return json({ code: 'REFUSED_BEFORE_MODEL', reason: refusal }, 422);
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
