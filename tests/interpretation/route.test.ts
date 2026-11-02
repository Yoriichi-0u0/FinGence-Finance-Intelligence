import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('server-only', () => ({}));
import { buildEvidence, readTable } from '../../lib/interpretation/evidence';
import { CORRECT } from './proposals';

const NAME = 'bank-statement-march-2026-export.csv';
const evidence = buildEvidence(readTable(new Uint8Array(readFileSync(`public/demo/unfamiliar/${NAME}`)))!, 'b'.repeat(64), NAME);
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost:3000/api/ai/interpret', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const groq = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status }));
const completion = { id: 'chatcmpl-test', model: 'openai/gpt-oss-120b', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(CORRECT[NAME]) } }], usage: { prompt_tokens: 3300, completion_tokens: 1200 } };
async function route() { vi.resetModules(); return import('../../app/api/ai/interpret/route'); }

describe('AI interpretation gateway', () => {
    beforeEach(() => { vi.stubEnv('GROQ_API_KEY', 'test-key-not-real'); vi.stubEnv('FINGENCE_AI_GATEWAY', '1'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN', ''); });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('does not exist unless explicitly enabled with a key', async () => {
        vi.stubEnv('FINGENCE_AI_GATEWAY', '');
        const r = await route();
        expect((await r.GET()).status).toBe(404);
        expect((await r.POST(post({ evidence }))).status).toBe(404);
        vi.stubEnv('FINGENCE_AI_GATEWAY', '1'); vi.stubEnv('GROQ_API_KEY', '');
        expect((await r.POST(post({ evidence }))).status).toBe(404);
    });
    it('does not exist on a hosted deployment without a durable shared budget store', async () => {
        const fetch = groq(200, completion); vi.stubGlobal('fetch', fetch); vi.stubEnv('VERCEL', '1');
        const r = await route();
        expect((await r.GET()).status).toBe(404);
        expect((await r.POST(post({ evidence }))).status).toBe(404);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('on a hosted deployment budgets through the durable store and fails closed when it is down', async () => {
        vi.stubEnv('VERCEL', '1'); vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', 'https://budget.example'); vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN', 'store-token');
        let storeUp = true; const counters = new Map<string, number>();
        const fetch = vi.fn(async (url: string, init: RequestInit) => {
            if (url.startsWith('https://budget.example')) {
                if (!storeUp) return new Response('', { status: 503 });
                const [[, key, by]] = JSON.parse(init.body as string) as [string, string, string][];
                counters.set(key, (counters.get(key) ?? 0) + Number(by));
                return Response.json([{ result: counters.get(key) }, { result: 1 }]);
            }
            return new Response(JSON.stringify(completion), { status: 200 });
        });
        vi.stubGlobal('fetch', fetch);
        const r = await route();
        expect((await r.POST(post({ evidence }, { 'x-vercel-forwarded-for': '198.51.100.20' }))).status).toBe(200);
        expect([...counters.keys()].join(' ')).not.toContain('198.51.100.20');
        const day = [...counters.entries()].find(([k]) => k.startsWith('fg:ai:usd:'))![1];
        expect(day).toBe(Math.ceil((3300 * 0.15 + 1200 * 0.6))); // settled to the measured cost, in micro-dollars
        storeUp = false; fetch.mockClear();
        const down = await r.POST(post({ evidence }, { 'x-vercel-forwarded-for': '198.51.100.20' }));
        expect(down.status).toBe(503);
        expect(await down.json()).toEqual({ code: 'BUDGET_UNAVAILABLE' });
        expect(fetch.mock.calls.filter(([u]) => String(u).includes('groq.com'))).toEqual([]);
    });
    it('reports availability without secrets', async () => {
        const body = await (await (await route()).GET()).json();
        expect(body).toMatchObject({ available: true, provider: 'GROQ', model: 'openai/gpt-oss-120b' });
        expect(JSON.stringify(body)).not.toContain('test-key');
    });
    it('forwards a bounded evidence window once and returns the untrusted proposal with a receipt', async () => {
        const fetch = groq(200, completion); vi.stubGlobal('fetch', fetch);
        const response = await (await route()).POST(post({ evidence }));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.proposal).toEqual(CORRECT[NAME]);
        expect(body.receipt).toMatchObject({ provider: 'GROQ', model: 'openai/gpt-oss-120b', inputTokens: 3300, outputTokens: 1200, mode: 'LIVE' });
        expect(body.receipt.estimatedUsd).toBeCloseTo((3300 * 0.15 + 1200 * 0.6) / 1e6, 9);
        expect(fetch).toHaveBeenCalledTimes(1);
        const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
        expect(sent.response_format.json_schema.strict).toBe(true);
        expect(sent.messages[1].content.length).toBeLessThan(12_000);
    });
    it('refuses cross-origin, oversized, malformed and unbounded requests before any provider call', async () => {
        const fetch = groq(200, completion); vi.stubGlobal('fetch', fetch);
        const r = await route();
        expect((await r.POST(post({ evidence }, { origin: 'https://evil.example' }))).status).toBe(403);
        expect((await r.POST(post({ evidence }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
        expect((await r.POST(post('x'.repeat(50_000)))).status).toBe(413);
        expect((await r.POST(post('{not json'))).status).toBe(400);
        expect((await r.POST(post({ evidence: { ...evidence, head: Array(40).fill({ line: 0, cells: [] }) } }))).status).toBe(400);
        expect((await r.POST(post({ document: 'whole file' }))).status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('refuses a missing, opaque or malformed Origin with 403 instead of throwing', async () => {
        const fetch = groq(200, completion); vi.stubGlobal('fetch', fetch);
        const r = await route();
        for (const origin of ['null', 'not a url', 'http://[bad', 'file:///etc/passwd', 'javascript:alert(1)', 'http://localhost:3000.evil.example', ' ']) {
            const response = await r.POST(post({ evidence }, { origin }));
            expect([origin, response.status]).toEqual([origin, 403]);
        }
        const missing = new Request('http://localhost:3000/api/ai/interpret', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3000' }, body: JSON.stringify({ evidence }) });
        expect((await r.POST(missing)).status).toBe(403);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('enforces the size limit before buffering: a declared length is refused unread, a stream is cut off', async () => {
        const fetch = groq(200, completion); vi.stubGlobal('fetch', fetch);
        const r = await route();
        let pulled = 0, cancelled = false;
        const endless = () => new ReadableStream<Uint8Array>({ pull(c) { pulled += 16_384; c.enqueue(new Uint8Array(16_384).fill(32)); }, cancel() { cancelled = true; } });
        const streamed = (extra: Record<string, string> = {}) => new Request('http://localhost:3000/api/ai/interpret', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000', ...extra }, body: endless(), duplex: 'half' } as RequestInit);
        expect((await r.POST(streamed({ 'content-length': '10000000' }))).status).toBe(413);
        expect(pulled).toBeLessThanOrEqual(16_384 * 2); // at most the stream's own read-ahead; never consumed
        pulled = 0;
        expect((await r.POST(streamed())).status).toBe(413);
        expect(pulled).toBeLessThan(48_000 + 16_384 * 3);
        expect(cancelled).toBe(true);
        expect((await r.POST(post({ evidence }, { 'content-length': 'abc' }))).status).toBe(413);
        const invalidUtf8 = new Request('http://localhost:3000/api/ai/interpret', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000' }, body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) });
        expect((await r.POST(invalidUtf8)).status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('maps provider rate limits and failures without retrying', async () => {
        const limited = groq(429, { error: 'rate' }); vi.stubGlobal('fetch', limited);
        const r = await route();
        const response = await r.POST(post({ evidence }));
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ code: 'RATE_LIMITED', retryAfterSeconds: 20 });
        expect(limited).toHaveBeenCalledTimes(1);
        vi.stubGlobal('fetch', groq(500, {}));
        expect((await r.POST(post({ evidence }))).status).toBe(502);
    });
    it('limits each client to 6 per minute and all clients to 10 per minute, before any provider call', async () => {
        const fetch = groq(200, completion); vi.stubGlobal('fetch', fetch);
        const r = await route(), from = (ip: string) => post({ evidence }, { 'x-forwarded-for': ip });
        const one = [];
        for (let i = 0; i < 7; i++) one.push((await r.POST(from('203.0.113.1'))).status);
        expect(one).toEqual([200, 200, 200, 200, 200, 200, 429]);
        expect(fetch).toHaveBeenCalledTimes(6);
        const limited = await r.POST(from('203.0.113.1'));
        expect((await limited.json()).code).toBe('CLIENT_RATE_LIMITED');
        const others = [];
        for (let i = 0; i < 6; i++) others.push((await r.POST(from(`198.51.100.${i}`))).status);
        expect(others).toEqual([200, 200, 200, 200, 429, 429]); // 10 calls in this minute across all clients
        expect(fetch).toHaveBeenCalledTimes(10);
    });
    it('stops dispatching once the daily spend budget is reserved', async () => {
        vi.stubEnv('FINGENCE_AI_DAILY_BUDGET_USD', '0.006');
        const fetch = groq(200, completion); vi.stubGlobal('fetch', fetch);
        const r = await route(), statuses: number[] = [];
        for (let i = 0; i < 6; i++) statuses.push((await r.POST(post({ evidence }, { 'x-forwarded-for': `192.0.2.${i}` }))).status);
        expect(statuses.filter(s => s === 200).length).toBe(fetch.mock.calls.length);
        expect(fetch.mock.calls.length * (3300 * 0.15 + 1200 * 0.6) / 1e6).toBeLessThanOrEqual(0.006);
        const refused = await r.POST(post({ evidence }, { 'x-forwarded-for': '192.0.2.99' }));
        expect(await refused.json()).toMatchObject({ code: 'DAILY_BUDGET_EXHAUSTED' });
    });
});
