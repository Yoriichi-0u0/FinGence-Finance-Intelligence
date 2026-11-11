import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { aiCallSchema, type AiCall, type AiCaller } from '../../lib/ai-calls/contract';
const { recordAiRefusal, runAsCaller, setAiCallSink, withAiCall } = await import('../../lib/ai-calls');

function capture() {
    const calls: { call: AiCall; caller: AiCaller | null }[] = [];
    setAiCallSink(async (call, caller) => { calls.push({ call, caller }); });
    return calls;
}
afterEach(() => setAiCallSink(null));

// An OpenAI-compatible chat completion, as groq-sdk and the OpenAI SDK (with Groq's baseURL) return it.
const completion = { id: 'chatcmpl-abc123', model: 'openai/gpt-oss-120b', choices: [{ message: { content: 'secret answer MYR 999.99' } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } };

describe('the AI-call door', () => {
    it('records model, request, tokens, cost and time from an OpenAI-compatible reply, and returns the reply unchanged', async () => {
        const calls = capture();
        const reply = await withAiCall({ feature: 'recon-suggest', model: 'openai/gpt-oss-120b', keyLabel: 'celester-groq' }, async () => completion);
        expect(reply).toBe(completion);
        expect(calls).toHaveLength(1);
        expect(calls[0].call).toMatchObject({ feature: 'recon-suggest', provider: 'GROQ', model: 'openai/gpt-oss-120b', keyLabel: 'celester-groq', requestId: 'chatcmpl-abc123', status: 'OK', inputTokens: 1000, outputTokens: 200 });
        expect(calls[0].call.estimatedUsd).toBeCloseTo((1000 * 0.15 + 200 * 0.6) / 1e6, 10);
    });
    it('never records what the model was sent or answered', async () => {
        const calls = capture();
        await withAiCall({ feature: 'finance-chat', model: 'openai/gpt-oss-120b' }, async () => completion);
        expect(JSON.stringify(calls)).not.toMatch(/secret answer|999\.99/);
        // And the contract itself refuses any extra field, so content cannot be added by mistake.
        expect(aiCallSchema.safeParse({ ...calls[0].call, prompt: 'hello' }).success).toBe(false);
    });
    it('reads a FinGence receipt, and takes the verdict from the feature’s own checks', async () => {
        const calls = capture();
        const receipt = { provider: 'GROQ', model: 'openai/gpt-oss-20b', requestId: 'req_1', latencyMs: 5, mode: 'LIVE', inputTokens: 10, outputTokens: 5, estimatedUsd: 0.000002 };
        await withAiCall({ feature: 'finance-qa', model: 'openai/gpt-oss-120b' }, async () => ({ content: {}, receipt }), () => ({ verdict: 'WITHHELD', reasonCode: 'figure not in facts' }));
        expect(calls[0].call).toMatchObject({ model: 'openai/gpt-oss-20b', requestId: 'req_1', inputTokens: 10, estimatedUsd: 0.000002, verdict: 'WITHHELD', reasonCode: 'FIGURE_NOT_IN_FACTS' });
    });
    it('records a failure with its code and rethrows it', async () => {
        const calls = capture();
        const rateLimited = Object.assign(new Error('slow down'), { status: 429 });
        await expect(withAiCall({ feature: 'report-explain', model: 'openai/gpt-oss-120b' }, async () => { throw rateLimited; })).rejects.toBe(rateLimited);
        await expect(withAiCall({ feature: 'report-explain', model: 'openai/gpt-oss-120b' }, async () => { throw Object.assign(new Error('x'), { code: 'PROVIDER_HTTP_400_JSON_VALIDATE_FAILED' }); })).rejects.toThrow();
        await expect(withAiCall({ feature: 'report-explain', model: 'openai/gpt-oss-120b' }, async () => { throw new Error('network'); })).rejects.toThrow('network');
        expect(calls.map(c => [c.call.status, c.call.reasonCode])).toEqual([['RATE_LIMITED', 'RATE_LIMITED'], ['REFUSED', 'PROVIDER_HTTP_400_JSON_VALIDATE_FAILED'], ['FAILED', 'ERROR']]);
    });
    it('attributes calls to the caller set for the request, however deep they are', async () => {
        const calls = capture(), caller = { organizationId: 'f0e1d2c3-0000-4000-8000-000000000001', memberId: 'f0e1d2c3-0000-4000-8000-000000000002', jobId: null };
        const deep = () => new Promise(resolve => setTimeout(resolve, 1)).then(() => withAiCall({ feature: 'layout-interpretation', model: 'openai/gpt-oss-120b' }, async () => completion));
        await runAsCaller(caller, deep);
        await withAiCall({ feature: 'layout-interpretation', model: 'openai/gpt-oss-120b' }, async () => completion);
        expect(calls.map(c => c.caller)).toEqual([caller, null]);
    });
    it('a logging failure never changes the result', async () => {
        setAiCallSink(async () => { throw new Error('store down'); });
        await expect(withAiCall({ feature: 'forecast-note', model: 'openai/gpt-oss-120b' }, async () => completion)).resolves.toBe(completion);
    });
    it('notes which of several keys paid, and records refusals that never reached a model', async () => {
        const calls = capture();
        await withAiCall({ feature: 'finance-qa', model: 'openai/gpt-oss-120b' }, async note => { note.keyLabel = 'key-2'; return completion; });
        await recordAiRefusal({ feature: 'finance-qa', model: 'openai/gpt-oss-120b' }, 'REFUSED_BEFORE_MODEL');
        expect(calls.map(c => [c.call.keyLabel, c.call.status, c.call.reasonCode, c.call.inputTokens])).toEqual([['key-2', 'OK', null, 1000], [null, 'REFUSED', 'REFUSED_BEFORE_MODEL', null]]);
    });
    it('an unknown model is logged without a guessed cost', async () => {
        const calls = capture();
        await withAiCall({ feature: 'finance-chat', model: 'some/new-model' }, async () => ({ ...completion, model: 'some/new-model' }));
        expect(calls[0].call.estimatedUsd).toBeNull();
    });
});
