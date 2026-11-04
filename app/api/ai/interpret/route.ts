import { evidenceSchema, InterpreterUnavailable } from '@/lib/interpretation/contracts';
import { admit, clientAddress } from '@/lib/server/ai/budget';
import { aiGatewayEnabled, interpreterModel, proposeLayout, worstCaseUsd } from '@/lib/server/ai/groq-interpreter';
import { boundedJson, noStoreJson as json } from '@/lib/server/ai/request';
import { processingRefusal } from '@/lib/server/workspace/session';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 48_000;
const notFound = () => new Response('Not found', { status: 404 });
/** Availability only; no secret, quota or configuration detail beyond the model name is disclosed. */
export async function GET() {
    if (!aiGatewayEnabled()) return notFound();
    return json({ available: true, provider: 'GROQ', model: interpreterModel(), sends: 'Column headings, column profiles and up to 21 lines of an unfamiliar document; never the whole file.' });
}

/**
 * Layout interpretation gateway. Accepts only a bounded evidence window (not a document), admits it against the
 * shared spend budget, forwards it once to Groq with a strict JSON schema and returns the UNTRUSTED proposal plus
 * a usage receipt. Nothing is stored or logged; the browser's deterministic gates decide what is accepted.
 */
export async function POST(request: Request) {
    if (!aiGatewayEnabled()) return notFound();
    const read = await boundedJson(request, MAX_BODY_BYTES);
    if ('refusal' in read) return read.refusal;
    const gate = await processingRefusal(request.headers);
    if (gate) return json({ code: gate.code, ...(gate.reason ? { reason: gate.reason } : {}) }, gate.status);
    const evidence = evidenceSchema.safeParse((read.body as { evidence?: unknown } | null)?.evidence);
    if (!evidence.success) return json({ code: 'INVALID_EVIDENCE' }, 400);
    const admission = await admit({ client: clientAddress(request.headers), worstCaseUsd: worstCaseUsd(evidence.data) });
    if (!admission.admitted) return json({ code: admission.code, ...(admission.retryAfterSeconds ? { retryAfterSeconds: admission.retryAfterSeconds } : {}) }, admission.status);
    try {
        const result = await proposeLayout(evidence.data);
        await admission.settle(result.receipt.estimatedUsd);
        return json(result);
    } catch (error) {
        const code = error instanceof InterpreterUnavailable ? error.code : 'INTERPRETER_FAILED';
        // A provider 429 is refused before processing and not billed; any other failure keeps its full reservation.
        await admission.settle(code === 'RATE_LIMITED' ? 0 : null);
        const retryAfterSeconds = error instanceof InterpreterUnavailable ? error.retryAfterSeconds : undefined;
        return json(code === 'RATE_LIMITED' ? { code, retryAfterSeconds: Math.ceil(retryAfterSeconds ?? 20) } : { code }, code === 'RATE_LIMITED' ? 429 : 502);
    }
}
