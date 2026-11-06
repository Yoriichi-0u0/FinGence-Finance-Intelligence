import { clientAddress } from '@/lib/server/ai/budget';
import { aiGatewayEnabled, interpreterModel } from '@/lib/server/ai/groq-interpreter';
import { interpretEvidence } from '@/lib/server/ai/interpret';
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
    const result = await interpretEvidence(read.body, clientAddress(request.headers));
    return json(result.body, result.status);
}
