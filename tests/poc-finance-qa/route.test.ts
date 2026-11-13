import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => { process.env.FINGENCE_POC_LOCAL = '1'; return { enabled: true, runtime: vi.fn() }; });
vi.mock('../../lib/server/poc-reconciliation/runtime', async () => { const { localAccessAllowed } = await import('../../lib/server/ai-ingestion/service');
    return { pocLocalEnabled: () => mock.enabled, pocRequestAllowed: (r: Request) => mock.enabled && localAccessAllowed(r) }; });
vi.mock('../../lib/server/poc-finance-qa/runtime', () => ({ financeQaRuntime: mock.runtime }));
import * as route from '../../app/api/ai-ingestion/m2/finance-questions/route';
import { FinanceChatError } from '../../lib/server/poc-finance-qa/groq-chat';
const { GET, POST } = route;

const session = 'a'.repeat(43), origin = 'http://127.0.0.1:3186', url = origin + '/api/ai-ingestion/m2/finance-questions', source = '11111111-1111-4111-8111-111111111111';
const questions = { sources: vi.fn(), context: vi.fn(), ask: vi.fn() };
const chat = { preview: vi.fn(), send: vi.fn() };
const cookie = 'fingence_poc_session=' + session;
const get = (query: string, host = '127.0.0.1:3186') => new Request(url + '?' + query, { headers: { host, cookie } });
const post = (body: unknown, { query = 'action=ask', from = origin, type = 'application/json' } = {}) =>
    new Request(url + '?' + query, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { host: '127.0.0.1:3186', cookie, origin: from, 'content-type': type } });
beforeEach(() => { vi.resetAllMocks(); mock.enabled = true; vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_LOCAL', '1'); vi.stubEnv('FINGENCE_POC_GROQ', ''); mock.runtime.mockResolvedValue({ questions, chat }); });
afterEach(() => vi.unstubAllEnvs());

describe('PoC Finance questions HTTP boundary', () => {
    it('exposes only GET and POST and denies before opening the database when disabled or not loopback', async () => {
        expect(Object.keys(route).filter(k => /^[A-Z]+$/.test(k)).sort()).toEqual(['GET', 'POST']);
        mock.enabled = false;
        expect((await GET(get('action=sources'))).status).toBe(404);
        expect((await POST(post({ source, question: 'Cash?' }))).status).toBe(404);
        mock.enabled = true;
        expect((await GET(get('action=sources', 'example.com'))).status).toBe(404);
        expect(mock.runtime).not.toHaveBeenCalled();
    });
    it('forwards only the PoC session, selection keys and question text', async () => {
        questions.context.mockResolvedValue({ status: 'OK' }); questions.ask.mockResolvedValue({ status: 'OK', answer: {} }); questions.sources.mockResolvedValue({ status: 'OK' });
        expect((await GET(get('action=sources'))).status).toBe(200);
        expect((await GET(get(`action=context&source=${source}&business=BUS-001&period=2026-03`))).status).toBe(200);
        expect(questions.context).toHaveBeenCalledWith(session, { source, business: 'BUS-001', period: '2026-03' });
        const ok = await POST(post({ source, currency: 'MYR', question: 'How much cash movement was recorded?' }));
        expect(ok.status).toBe(200); expect(ok.headers.get('cache-control')).toBe('no-store');
        expect(questions.ask).toHaveBeenCalledWith(session, { source, currency: 'MYR' }, 'How much cash movement was recorded?');
    });
    it('rejects forged authority keys, figures, wrong types, cross-origin posts and oversized bodies', async () => {
        for (const query of [`action=context&source=${source}&organizationId=x`, `action=context&source=${source}&role=Finance`, 'action=context', `action=sources&source=${source}`, `action=context&source=${source}&source=${source}`, 'action=ask'])
            expect((await GET(get(query))).status).toBe(404);
        for (const body of [{ source, question: 'Cash?', organizationId: 'x' }, { source, question: 'Cash?', role: 'Finance' }, { source, question: 'Cash?', net: '1.00' }, { source, question: 'Cash?', answer: 'x' },
            { source, question: 7 }, { question: 'Cash?' }, { source }, [source], 'not json', { source, question: 'x'.repeat(2100) }])
            expect((await POST(post(body))).status).toBe(404);
        expect((await POST(post({ source, question: 'Cash?' }, { from: 'https://evil.example' }))).status).toBe(404);
        expect((await POST(post({ source, question: 'Cash?' }, { query: 'action=ask&source=' + source }))).status).toBe(404);
        expect((await POST(post({ source, question: 'Cash?' }, { type: 'text/plain' }))).status).toBe(404);
        expect(questions.ask).not.toHaveBeenCalled(); expect(questions.context).not.toHaveBeenCalled();
    });
    it('gates Groq chat routes behind the separate local mode and keeps the API-key status boolean only', async () => {
        const preview = { previewId: 'preview-1', question: 'What was the net cash movement?', passages: [], payloadHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 10000).toISOString() };
        chat.preview.mockResolvedValue(preview);
        chat.send.mockResolvedValue({ status: 'ANSWERED', groqUsed: true, model: 'openai/gpt-oss-20b', citedSections: [] });
        const previewInput = { source, business: 'BUS-001', period: '2026-03', currency: 'MYR', question: 'What was the net cash movement?' };
        const denied = await POST(post(previewInput, { query: 'action=chat-preview' }));
        expect(denied.status).toBe(404);
        expect(chat.preview).not.toHaveBeenCalled();
        const deniedSend = await POST(post({ previewId: 'preview-1', payloadHash: 'a'.repeat(64), consent: true }, { query: 'action=chat-send' }));
        expect(deniedSend.status).toBe(404);
        expect(chat.send).not.toHaveBeenCalled();
        expect((await GET(get('action=chat-status'))).status).toBe(404);

        vi.stubEnv('FINGENCE_POC_GROQ', '1');
        vi.stubEnv('GROQ_API_KEY', 'FAKE_GROQ_KEY_TEST_ONLY');
        const status = await GET(get('action=chat-status'));
        expect(status.status).toBe(200);
        const statusBody = await status.text();
        expect(JSON.parse(statusBody)).toMatchObject({ groqAvailable: true });
        expect(statusBody).not.toContain('FAKE_GROQ_KEY_TEST_ONLY');
        const approvedPreview = await POST(post(previewInput, { query: 'action=chat-preview' }));
        expect(approvedPreview.status).toBe(200);
        expect(chat.preview).toHaveBeenCalledWith(session, { source, business: 'BUS-001', period: '2026-03', currency: 'MYR' }, previewInput.question);
        const sendBody = { previewId: 'preview-1', payloadHash: 'a'.repeat(64), consent: true };
        const sent = await POST(post(sendBody, { query: 'action=chat-send' }));
        expect(sent.status).toBe(200);
        expect(chat.send).toHaveBeenCalledWith(expect.any(Request), session, sendBody);

        const fakeKey = 'FAKE_GROQ_KEY_DO_NOT_RETURN';
        chat.send.mockRejectedValueOnce(new FinanceChatError('GROQ_NOT_CONFIGURED', 503));
        const failure = await POST(post(sendBody, { query: 'action=chat-send' }));
        const failureBody = await failure.text();
        expect(failure.status).toBe(503);
        expect(failureBody).toContain('Groq is unavailable because this local server has no API key configured');
        expect(failureBody).not.toContain(fakeKey);
    });
    it('hides service refusals and errors behind one generic no-store response', async () => {
        questions.ask.mockResolvedValueOnce({ status: 'REFUSED', code: 'UNAVAILABLE' }).mockRejectedValueOnce(Error('ACCESS_DENIED'));
        for (let i = 0; i < 2; i++) {
            const r = await POST(post({ source, question: 'Cash?' }));
            expect(r.status).toBe(404); expect(await r.json()).toEqual({ error: 'Unavailable or access denied.' }); expect(r.headers.get('cache-control')).toBe('no-store');
        }
    });
});

