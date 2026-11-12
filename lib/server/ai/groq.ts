import 'server-only';
import { z } from 'zod';
import { InterpreterUnavailable, type ModelReceipt } from '../../interpretation/contracts';
import { MODEL_PRICES, withAiCall, type AiFeature } from '../../ai-calls/index';

/**
 * One strict-JSON-schema Groq completion, shared by every FinGence AI call (layout interpretation, grounded
 * Q&A). It never retries: a provider 429 (refused, not billed) surfaces as RATE_LIMITED with Retry-After so the
 * browser may make one new, separately budgeted request. The content is returned parsed but UNTRUSTED.
 */
/** Published Groq prices (USD per million tokens), kept with the AI-call door in lib/ai-calls/prices.ts. */
export const GROQ_PRICES = MODEL_PRICES;
export const GROQ_MODELS = Object.keys(GROQ_PRICES);
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

/** Strict-mode friendly JSON schema: no draft marker, and `const` written as a one-value enum. */
export function portableJsonSchema(schema: z.ZodType) {
    const portable = (node: unknown): unknown => Array.isArray(node) ? node.map(portable) : node && typeof node === 'object'
        ? Object.fromEntries(Object.entries(node).filter(([k]) => k !== '$schema').map(([k, v]) => k === 'const' ? ['enum', [v]] : [k, portable(v)]))
        : node;
    return portable(z.toJSONSchema(schema)) as Record<string, unknown>;
}

/** Upper bound on one call's cost, reserved before dispatch: one token per prompt character plus the full completion budget. */
export function worstCaseCompletionUsd(promptChars: number, maxCompletionTokens: number, model: string) {
    const [inPrice, outPrice] = GROQ_PRICES[model] ?? GROQ_PRICES[DEFAULT_GROQ_MODEL];
    return ((promptChars + 64) * inPrice + maxCompletionTokens * outPrice) / 1_000_000;
}

const responseSchema = z.object({
    id: z.string().optional(), model: z.string(),
    choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().nullable() }) })).min(1),
    usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

/** `key` is the API key this attempt uses; transports in tests may ignore it. */
export type GroqTransport = (body: Record<string, unknown>, signal: AbortSignal, key: string) => Promise<{ status: number; json: unknown; retryAfterSeconds?: number }>;
const defaultTransport: GroqTransport = async (body, signal, key) => {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal, redirect: 'error',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const retryAfter = Number(response.headers.get('retry-after'));
    return { status: response.status, json: await response.json().catch(() => null), retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined };
};
/**
 * Configured Groq keys, in order: GROQ_API_KEY, then GROQ_API_KEY2. Groq's rate limits are per organization, so the
 * second key adds capacity only when it belongs to a different organization; in the same one, failover finds the same limit.
 */
export function groqKeys(): string[] {
    return [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY2].filter((k): k is string => !!k);
}
let rotation = 0;

export type StructuredRequest = {
    /** Which feature is calling, for the Technical log (lib/ai-calls/features.ts). */
    feature: AiFeature;
    model: string; system: string; user: string; schemaName: string; schema: Record<string, unknown>;
    maxCompletionTokens: number; reasoningEffort: 'low' | 'medium' | 'high'; transport?: GroqTransport;
};
/** Every call goes through the AI-call door, so it appears on the Technical log with its key, tokens and outcome. */
export function structuredCompletion(req: StructuredRequest): Promise<{ content: unknown; receipt: ModelReceipt }> {
    return withAiCall({ feature: req.feature, model: req.model }, note => completion(req, note));
}
async function completion(req: StructuredRequest, note: { keyLabel?: string | null }): Promise<{ content: unknown; receipt: ModelReceipt }> {
    const keys = groqKeys();
    if (!keys.length && !req.transport) throw new InterpreterUnavailable('NOT_CONFIGURED');
    const body: Record<string, unknown> = {
        model: req.model, temperature: 0, max_completion_tokens: req.maxCompletionTokens,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
        ...(req.model.startsWith('openai/') ? { reasoning_effort: req.reasoningEffort } : { reasoning_effort: 'none' }),
    };
    const started = Date.now();
    let reply: Awaited<ReturnType<GroqTransport>>;
    // Requests alternate between the configured keys. A 429 is a refusal before processing (never billed), so it moves
    // once to each other key; any other outcome, billed or not, is final. At most one completion is ever produced.
    const slots = keys.length ? keys : [''], first = rotation++ % slots.length, signal = AbortSignal.timeout(45_000);
    try {
        for (let attempt = 0; ; attempt++) {
            const slot = (first + attempt) % slots.length;
            // Which configured key answered (GROQ_API_KEY is key-1, GROQ_API_KEY2 is key-2); the key itself is never logged.
            if (keys.length) note.keyLabel = `key-${slot + 1}`;
            reply = await (req.transport ?? defaultTransport)(body, signal, slots[slot]);
            if (reply.status !== 429 || attempt === slots.length - 1) break;
        }
    } catch { throw new InterpreterUnavailable('PROVIDER_UNREACHABLE'); }
    if (reply.status === 429) throw new InterpreterUnavailable('RATE_LIMITED', reply.retryAfterSeconds);
    if (reply.status !== 200) {
        // Keep only the provider's machine code (e.g. json_validate_failed when strict decoding could not satisfy the
        // schema); its message and any failed generation are untrusted text and are not surfaced.
        const code = (reply.json as { error?: { code?: unknown } } | null)?.error?.code;
        throw new InterpreterUnavailable(`PROVIDER_HTTP_${reply.status}${typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? `_${code.toUpperCase()}` : ''}`);
    }
    const parsed = responseSchema.safeParse(reply.json);
    if (!parsed.success) throw new InterpreterUnavailable('PROVIDER_RESPONSE_INVALID');
    const r = parsed.data, text = r.choices[0].message.content;
    let content: unknown = null;
    if (text && text.length <= 32_000) { try { content = JSON.parse(text); } catch { content = null; } }
    const [inPrice, outPrice] = GROQ_PRICES[r.model] ?? GROQ_PRICES[req.model];
    return {
        content,
        receipt: {
            provider: 'GROQ', model: r.model, requestId: r.id ?? null, latencyMs: Date.now() - started, mode: 'LIVE',
            inputTokens: r.usage?.prompt_tokens ?? null, outputTokens: r.usage?.completion_tokens ?? null,
            estimatedUsd: r.usage ? (r.usage.prompt_tokens * inPrice + r.usage.completion_tokens * outPrice) / 1_000_000 : null,
        },
    };
}
