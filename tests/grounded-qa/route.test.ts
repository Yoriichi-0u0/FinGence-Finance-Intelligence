import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { catalogue, groundingIndex, runQueries } from '../../lib/grounded-qa/tools';
import { modelView } from '../../lib/grounded-qa/facts';
import { phase1 } from './tools.test';

const post = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost:3000/api/ai/ask', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const completion = (content: unknown) => ({ id: 'chatcmpl-qa', model: 'openai/gpt-oss-120b', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1800, completion_tokens: 300 } });
const groq = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status }));
async function route() { vi.resetModules(); return import('../../app/api/ai/ask/route'); }
async function bodies() {
    const index = groundingIndex(await phase1())!, cat = catalogue(index), facts = runQueries(index, [{ tool: 'counterparties', direction: 'OUT', limit: 3 }]);
    return {
        cat,
        plan: { stage: 'plan', question: 'Who did we pay the most?', catalogue: cat },
        answer: { stage: 'answer', question: 'Who did we pay the most?', scope: cat.scope, facts: modelView(facts) },
    };
}
const PLAN = { plan: { kind: 'QUERY', queries: [{ tool: 'counterparties', direction: 'OUT', limit: 3 }] }, rationale: 'Rank payees.' };

describe('grounded Q&A gateway', () => {
    beforeEach(() => { vi.stubEnv('GROQ_API_KEY', 'test-key-not-real'); vi.stubEnv('FINGENCE_AI_GATEWAY', '1'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN', ''); });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('does not exist unless the AI gateway is enabled (and, on Vercel, budgeted)', async () => {
        const { plan } = await bodies();
        vi.stubEnv('FINGENCE_AI_GATEWAY', '');
        let r = await route();
        expect([(await r.GET()).status, (await r.POST(post(plan))).status]).toEqual([404, 404]);
        vi.stubEnv('FINGENCE_AI_GATEWAY', '1'); vi.stubEnv('VERCEL', '1');
        r = await route();
        expect([(await r.GET()).status, (await r.POST(post(plan))).status]).toEqual([404, 404]);
    });
    it('plan stage: sends the question and a value-free catalogue once, with catalogue-bound enums in the strict schema', async () => {
        const { plan, cat } = await bodies(), fetch = groq(200, completion(PLAN)); vi.stubGlobal('fetch', fetch);
        const res = await (await route()).POST(post(plan));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ stage: 'plan', content: PLAN, receipt: { provider: 'GROQ', mode: 'LIVE', inputTokens: 1800 } });
        expect(fetch).toHaveBeenCalledTimes(1);
        const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
        expect(sent.response_format.json_schema).toMatchObject({ name: 'qa_plan', strict: true });
        const schema = JSON.stringify(sent.response_format.json_schema.schema);
        for (const name of cat.counterparties) expect(schema).toContain(JSON.stringify(name));
        expect(schema).not.toMatch(/"const"|"oneOf"/);
        expect(sent.messages[1].content).not.toMatch(/\d+\.\d{2}|BANK-DEMO|GL-DEMO/); // no amounts or records leave the browser at this stage
    });
    it('answer stage: sends only the bounded verified facts, with fact IDs as the citation enum', async () => {
        const { answer } = await bodies(), fetch = groq(200, completion({ answer: { kind: 'INSUFFICIENT', missing: 'x' } })); vi.stubGlobal('fetch', fetch);
        expect((await (await route()).POST(post(answer))).status).toBe(200);
        const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
        expect(sent.response_format.json_schema.name).toBe('qa_answer');
        expect(JSON.stringify(sent.response_format.json_schema.schema)).toContain('"F3"');
        expect(JSON.parse(sent.messages[1].content).facts).toHaveLength(3);
    });
    it('refuses advice and allegations before any budget or provider use', async () => {
        const { plan } = await bodies(), fetch = groq(200, completion(PLAN)); vi.stubGlobal('fetch', fetch);
        const r = await route();
        for (let i = 0; i < 8; i++) {
            const res = await r.POST(post({ ...plan, question: i % 2 ? 'Should we invest the cash?' : 'Did the supplier commit fraud?' }));
            expect(res.status).toBe(422);
        }
        expect(fetch).not.toHaveBeenCalled();
        expect((await r.POST(post(plan))).status).toBe(200); // the client's per-minute budget was untouched
    });
    it.each([
        ['an unknown stage', (b: Awaited<ReturnType<typeof bodies>>) => ({ ...b.plan, stage: 'execute' })],
        ['an extra field', (b: Awaited<ReturnType<typeof bodies>>) => ({ ...b.plan, records: [] })],
        ['a question over 300 characters', (b: Awaited<ReturnType<typeof bodies>>) => ({ ...b.plan, question: 'x'.repeat(301) })],
        ['more than 48 facts', (b: Awaited<ReturnType<typeof bodies>>) => ({ ...b.answer, facts: Array(49).fill(b.answer.facts[0]) })],
        ['a malformed fact ID', (b: Awaited<ReturnType<typeof bodies>>) => ({ ...b.answer, facts: [{ ...b.answer.facts[0], id: 'X1' }] })],
    ])('rejects %s before any provider call', async (_, make) => {
        const fetch = groq(200, completion(PLAN)); vi.stubGlobal('fetch', fetch);
        expect((await (await route()).POST(post(make(await bodies())))).status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('shares the request bounds of the layout gateway', async () => {
        const { plan } = await bodies(), fetch = groq(200, completion(PLAN)); vi.stubGlobal('fetch', fetch);
        const r = await route();
        expect((await r.POST(post(plan, { origin: 'null' }))).status).toBe(403);
        expect((await r.POST(post(plan, { 'content-length': '40000' }))).status).toBe(413);
        expect((await r.POST(post('{not json'))).status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('is admitted per client against the shared budget (the same counters as layout interpretation) and maps provider refusals', async () => {
        const { plan } = await bodies(); vi.stubGlobal('fetch', groq(200, completion(PLAN)));
        const r = await route(), statuses = [];
        for (let i = 0; i < 7; i++) statuses.push((await r.POST(post(plan, { 'x-forwarded-for': '203.0.113.9' }))).status);
        expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
        vi.stubGlobal('fetch', groq(429, {}));
        const limited = await r.POST(post(plan, { 'x-forwarded-for': '203.0.113.10' }));
        expect([limited.status, await limited.json()]).toEqual([429, { code: 'RATE_LIMITED', retryAfterSeconds: 20 }]);
        vi.stubGlobal('fetch', groq(400, { error: { code: 'json_validate_failed' } }));
        expect(await (await r.POST(post(plan, { 'x-forwarded-for': '203.0.113.11' }))).json()).toEqual({ code: 'PROVIDER_HTTP_400_JSON_VALIDATE_FAILED' });
    });
});
