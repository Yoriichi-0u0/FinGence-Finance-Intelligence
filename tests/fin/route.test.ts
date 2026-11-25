import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { FIN_VERSION } from '../../lib/fin/contracts';

const post = (body: unknown) => new Request('http://localhost:3000/api/ai/fin', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const completion = (content: unknown) => ({ id: 'chatcmpl-fin', model: 'openai/gpt-oss-120b', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1400, completion_tokens: 120 } });
const groq = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status }));
async function route() { vi.resetModules(); return import('../../app/api/ai/fin/route'); }
const body = { version: FIN_VERSION, name: 'Fin', page: '/reconciliation', turns: [{ role: 'user', text: 'What am I looking at here?' }], run: { businessName: 'Example Bakery', period: '2026-03', currency: 'MYR' } };
const REPLY = { kind: 'GUIDE', reply: 'This is Reconciliation: your bank against your books.', links: ['/reconciliation'], financeQuestion: null };

describe('Fin gateway', () => {
    beforeEach(() => { vi.stubEnv('GROQ_API_KEY', 'test-key-not-real'); vi.stubEnv('FINGENCE_AI_GATEWAY', '1'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN', ''); });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('does not exist unless the AI gateway is enabled', async () => {
        vi.stubEnv('FINGENCE_AI_GATEWAY', '');
        const r = await route();
        expect([(await r.GET()).status, (await r.POST(post(body))).status]).toEqual([404, 404]);
    });
    it('makes one strict-schema call as the fin-assistant feature, sending only words, page and scope', async () => {
        const fetch = groq(200, completion(REPLY)); vi.stubGlobal('fetch', fetch);
        const res = await (await route()).POST(post(body));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ content: REPLY, receipt: { provider: 'GROQ' } });
        expect(fetch).toHaveBeenCalledTimes(1);
        const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
        expect(sent.response_format.json_schema).toMatchObject({ name: 'fin_reply', strict: true });
        expect(sent.messages[0].content).toContain('You are the AI assistant inside FinGence');
        expect(Object.keys(JSON.parse(sent.messages[1].content)).sort()).toEqual(['assistantName', 'conversation', 'latestRun', 'page', 'tone']);
    });
    it('rejects malformed bodies before any provider call', async () => {
        const fetch = groq(200, completion(REPLY)); vi.stubGlobal('fetch', fetch);
        const r = await route();
        for (const bad of [{ ...body, turns: [] }, { ...body, version: 'x' }, { ...body, name: 'Fin 9' }, { ...body, version: 'fingence-fin-v1' }, { ...body, amounts: ['1.00'] }, 'not json'])
            expect((await r.POST(post(bad))).status).toBeGreaterThanOrEqual(400);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('reports a provider failure as unavailable, never as a reply', async () => {
        vi.stubGlobal('fetch', groq(500, { error: { message: 'boom' } }));
        const res = await (await route()).POST(post(body));
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ code: expect.any(String) });
    });
});
