import { clientAddress } from '@/lib/server/ai/budget';
import { aiGatewayEnabled, interpreterModel } from '@/lib/server/ai/groq-interpreter';
import { interpretEvidence } from '@/lib/server/ai/interpret';
import { boundedJson, noStoreJson as json } from '@/lib/server/ai/request';
import { aiCaller, processingGate } from '@/lib/server/workspace/session';
import { runAsCaller } from '@/lib/ai-calls';

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
 * a usage receipt. Only the call's metadata is logged (lib/ai-calls); the browser's deterministic gates decide what is accepted.
 */
export async function POST(request: Request) {
    if (!aiGatewayEnabled()) return notFound();
    const read = await boundedJson(request, MAX_BODY_BYTES);
    if ('refusal' in read) return read.refusal;
    const gate = await processingGate(request.headers, { ai: true });
    if ('refusal' in gate) return json({ code: gate.refusal.code, ...(gate.refusal.reason ? { reason: gate.refusal.reason } : {}) }, gate.refusal.status);
    const result = await runAsCaller(aiCaller(gate.principal), () => interpretEvidence(read.body, clientAddress(request.headers)));
    return json(result.body, result.status);
}
