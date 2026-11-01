import { evidenceSchema, InterpreterUnavailable } from '@/lib/interpretation/contracts';
import { aiGatewayEnabled, interpreterModel, proposeLayout } from '@/lib/server/ai/groq-interpreter';
import { RateLimiter } from '@/lib/server/ai/rate-limit';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 48_000;
const limiter = new RateLimiter([{ windowMs: 60_000, max: 12 }, { windowMs: 86_400_000, max: 400 }]);
const notFound = () => new Response('Not found', { status: 404 });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Availability only; no secret, quota or configuration detail beyond the model name is disclosed. */
export async function GET() {
    if (!aiGatewayEnabled()) return notFound();
    return json({ available: true, provider: 'GROQ', model: interpreterModel(), sends: 'Column headings, column profiles and up to 21 lines of an unfamiliar document; never the whole file.' });
}

/**
 * Layout interpretation gateway. Accepts only a bounded evidence window (not a document), forwards it
 * once to Groq with a strict JSON schema, and returns the UNTRUSTED proposal plus a usage receipt.
 * Nothing is stored or logged; the browser's deterministic gates decide what is accepted.
 */
export async function POST(request: Request) {
    if (!aiGatewayEnabled()) return notFound();
    const origin = request.headers.get('origin'), host = request.headers.get('host');
    if (origin && host && new URL(origin).host !== host) return json({ code: 'CROSS_ORIGIN' }, 403);
    if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ code: 'JSON_REQUIRED' }, 415);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ code: 'TOO_LARGE' }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ code: 'INVALID_JSON' }, 400); }
    const evidence = evidenceSchema.safeParse((body as { evidence?: unknown } | null)?.evidence);
    if (!evidence.success) return json({ code: 'INVALID_EVIDENCE' }, 400);
    if (!limiter.take()) return json({ code: 'RATE_LIMITED' }, 429);
    try {
        return json(await proposeLayout(evidence.data));
    } catch (error) {
        const code = error instanceof InterpreterUnavailable ? error.code : 'INTERPRETER_FAILED';
        return json({ code }, code === 'RATE_LIMITED' ? 429 : 502);
    }
}
