import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { structuredCompletion, type GroqTransport } from '../../lib/server/ai/groq';
import { InterpreterUnavailable } from '../../lib/interpretation/contracts';

const ok = { status: 200, json: { model: 'openai/gpt-oss-120b', choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } };
const refused = { status: 429, json: null, retryAfterSeconds: 7 };
const request = (transport: GroqTransport) => structuredCompletion({ model: 'openai/gpt-oss-120b', system: 's', user: 'u', schemaName: 'x', schema: {}, maxCompletionTokens: 10, reasoningEffort: 'low', transport });
afterEach(() => vi.unstubAllEnvs());

describe('two Groq keys: alternate per request, move to the other key only after an unbilled 429', () => {
    it('consecutive requests use alternate keys', async () => {
        vi.stubEnv('GROQ_API_KEY', 'key-one'); vi.stubEnv('GROQ_API_KEY2', 'key-two');
        const used: string[] = [];
        for (let i = 0; i < 4; i++) await request(async (_, __, key) => { used.push(key); return ok; });
        expect(new Set([used[0], used[1]])).toEqual(new Set(['key-one', 'key-two']));
        expect([used[2], used[3]]).toEqual([used[0], used[1]]);
    });
    it('a 429 on one key is answered by the other key within the same request', async () => {
        vi.stubEnv('GROQ_API_KEY', 'key-one'); vi.stubEnv('GROQ_API_KEY2', 'key-two');
        const used: string[] = [];
        const result = await request(async (_, __, key) => { used.push(key); return used.length === 1 ? refused : ok; });
        expect(used.length).toBe(2);
        expect(new Set(used).size).toBe(2);
        expect(result.content).toEqual({ a: 1 });
    });
    it('when every key refuses, the request is rate limited after one attempt per key', async () => {
        vi.stubEnv('GROQ_API_KEY', 'key-one'); vi.stubEnv('GROQ_API_KEY2', 'key-two');
        let calls = 0;
        const error = await request(async () => { calls++; return refused; }).catch(e => e);
        expect(error).toBeInstanceOf(InterpreterUnavailable);
        expect([error.code, error.retryAfterSeconds, calls]).toEqual(['RATE_LIMITED', 7, 2]);
    });
    it.each([[500, 'PROVIDER_HTTP_500'], [400, 'PROVIDER_HTTP_400']])('a %i is final: never sent to the other key', async (status, code) => {
        vi.stubEnv('GROQ_API_KEY', 'key-one'); vi.stubEnv('GROQ_API_KEY2', 'key-two');
        let calls = 0;
        const error = await request(async () => { calls++; return { status, json: null }; }).catch(e => e);
        expect([error.code, calls]).toEqual([code, 1]);
    });
    it('with one key there is no second attempt', async () => {
        vi.stubEnv('GROQ_API_KEY', 'key-one'); vi.stubEnv('GROQ_API_KEY2', '');
        let calls = 0;
        await request(async () => { calls++; return refused; }).catch(() => null);
        expect(calls).toBe(1);
    });
});
