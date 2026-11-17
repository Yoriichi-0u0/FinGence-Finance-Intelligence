import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { structuredCompletion, type GroqTransport } from '../../lib/server/ai/groq';
import { setAiCallSink, type AiCall } from '../../lib/ai-calls';
import type { AiFeature } from '../../lib/ai-calls';

const ok = { status: 200, json: { model: 'openai/gpt-oss-120b', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 2, completion_tokens: 2 } } };
const call = (transport: GroqTransport, feature: AiFeature) => structuredCompletion({ feature, model: 'openai/gpt-oss-120b', system: 'synthetic', user: 'synthetic', schemaName: 'synthetic', schema: {}, maxCompletionTokens: 10, reasoningEffort: 'low', transport });
beforeEach(() => { for (const [k, v] of [['GROQ_API_KEY', 'one'], ['GROQ_API_KEY2', 'two'], ['GROQ_API_KEY3', 'three'], ['GROQ_API_KEY4', 'four']]) vi.stubEnv(k, `synthetic-${v}`); setAiCallSink(async () => {}); });
afterEach(() => { vi.unstubAllEnvs(); setAiCallSink(null); });

it('the Finance chatbot uses only key 4 and logs its label, never the key', async () => {
    const logs: AiCall[] = []; setAiCallSink(async c => { logs.push(c); });
    const used: string[] = [];
    await call(async (_b, _s, key) => { used.push(key); return ok; }, 'finance-chat');
    await call(async (_b, _s, key) => { used.push(key); return ok; }, 'finance-chat');
    expect(used).toEqual(['synthetic-four', 'synthetic-four']);
    expect(logs[0]).toMatchObject({ feature: 'finance-chat', keyLabel: 'key-4' });
    expect(JSON.stringify(logs)).not.toContain('synthetic-four');
});
it('fails closed without key 4, even when the shared keys and a transport exist', async () => {
    vi.stubEnv('GROQ_API_KEY4', '');
    const transport = vi.fn(async () => ok);
    await expect(call(transport, 'finance-chat')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(transport).not.toHaveBeenCalled();
});
it('leaves the shared rotation and AI06 key 3 unchanged', async () => {
    const keys: string[] = []; const capture: GroqTransport = async (_b, _s, key) => { keys.push(key); return ok; };
    await call(capture, 'finance-qa'); await call(capture, 'finance-chat'); await call(capture, 'recon-suggest'); await call(capture, 'finance-qa');
    expect(new Set([keys[0], keys[3]])).toEqual(new Set(['synthetic-one', 'synthetic-two']));
    expect(keys.slice(1, 3)).toEqual(['synthetic-four', 'synthetic-three']);
});
