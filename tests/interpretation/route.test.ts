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
    beforeEach(() => { vi.stubEnv('GROQ_API_KEY', 'test-key-not-real'); vi.stubEnv('FINGENCE_AI_GATEWAY', '1'); });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('does not exist unless explicitly enabled with a key', async () => {
        vi.stubEnv('FINGENCE_AI_GATEWAY', '');
        const r = await route();
        expect((await r.GET()).status).toBe(404);
        expect((await r.POST(post({ evidence }))).status).toBe(404);
        vi.stubEnv('FINGENCE_AI_GATEWAY', '1'); vi.stubEnv('GROQ_API_KEY', '');
        expect((await r.POST(post({ evidence }))).status).toBe(404);
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
        expect((await r.POST(post('x'.repeat(50_000)))).status).toBe(413);
        expect((await r.POST(post('{not json'))).status).toBe(400);
        expect((await r.POST(post({ evidence: { ...evidence, head: Array(40).fill({ line: 0, cells: [] }) } }))).status).toBe(400);
        expect((await r.POST(post({ document: 'whole file' }))).status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('maps provider rate limits and failures without retrying', async () => {
        const limited = groq(429, { error: 'rate' }); vi.stubGlobal('fetch', limited);
        const r = await route();
        const response = await r.POST(post({ evidence }));
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ code: 'RATE_LIMITED' });
        expect(limited).toHaveBeenCalledTimes(1);
        vi.stubGlobal('fetch', groq(500, {}));
        expect((await r.POST(post({ evidence }))).status).toBe(502);
    });
    it('limits each server instance to 12 interpretations per minute', async () => {
        vi.stubGlobal('fetch', groq(200, completion));
        const r = await route();
        const statuses = [];
        for (let i = 0; i < 13; i++) statuses.push((await r.POST(post({ evidence }))).status);
        expect(statuses.slice(0, 12).every(s => s === 200)).toBe(true);
        expect(statuses[12]).toBe(429);
    });
});
