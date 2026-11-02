import { evidenceSchema, InterpreterUnavailable } from '@/lib/interpretation/contracts';
import { admit, clientAddress } from '@/lib/server/ai/budget';
import { aiGatewayEnabled, interpreterModel, proposeLayout, worstCaseUsd } from '@/lib/server/ai/groq-interpreter';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 48_000;
const notFound = () => new Response('Not found', { status: 404 });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Same-origin browser requests only. A missing, opaque ("null") or unparsable Origin is refused, never thrown on. */
function sameOrigin(headers: Headers) {
    const origin = headers.get('origin'), host = headers.get('host'), site = headers.get('sec-fetch-site');
    if (!origin || !host || (site && site !== 'same-origin')) return false;
    if (!URL.canParse(origin)) return false;
    const url = new URL(origin);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host === host.toLowerCase();
}

/** Reads at most `max` bytes: a declared length is checked first, then the stream is counted and cancelled once over. */
async function readBounded(request: Request, max: number): Promise<string | 'TOO_LARGE' | 'INVALID'> {
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) return 'TOO_LARGE';
    if (!request.body) return '';
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) { await reader.cancel().catch(() => undefined); return 'TOO_LARGE'; }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return 'INVALID'; }
}

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
    if (!sameOrigin(request.headers)) return json({ code: 'CROSS_ORIGIN' }, 403);
    if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ code: 'JSON_REQUIRED' }, 415);
    const text = await readBounded(request, MAX_BODY_BYTES);
    if (text === 'TOO_LARGE') return json({ code: 'TOO_LARGE' }, 413);
    let body: unknown;
    try { body = text === 'INVALID' ? undefined : JSON.parse(text); } catch { body = undefined; }
    if (body === undefined) return json({ code: 'INVALID_JSON' }, 400);
    const evidence = evidenceSchema.safeParse((body as { evidence?: unknown } | null)?.evidence);
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
