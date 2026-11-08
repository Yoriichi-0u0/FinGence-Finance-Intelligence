import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => { process.env.FINGENCE_POC_LOCAL = '1'; return { enabled: true, runtime: vi.fn() }; });
vi.mock('../../lib/server/poc-reconciliation/runtime', async () => { const { localAccessAllowed } = await import('../../lib/server/ai-ingestion/service'); return { pocRequestAllowed: (r: Request) => mock.enabled && localAccessAllowed(r) }; });
vi.mock('../../lib/server/poc-insights/runtime', () => ({ insightsRuntime: mock.runtime }));
import { GET } from '../../app/api/ai-ingestion/m2/insights/route';
const service = { sources: vi.fn(), read: vi.fn() }, source = '11111111-1111-4111-8111-111111111111', token = 'a'.repeat(43);
const request = (query: string, host = '127.0.0.1:3188') => new Request(`http://${host}/api/ai-ingestion/m2/insights?${query}`, { headers: { host, cookie: 'fingence_poc_session=' + token } });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_LOCAL', '1'); mock.enabled = true; mock.runtime.mockResolvedValue({ insights: service }); });
afterEach(() => vi.unstubAllEnvs());
describe('local insights read-only HTTP boundary', () => {
    it('rejects hosted/disabled/cross-site requests before database access', async () => {
        mock.enabled = false; expect((await GET(request('action=sources'))).status).toBe(404); mock.enabled = true;
        expect((await GET(request('action=sources', 'example.com'))).status).toBe(404);
        const cross = request('source=' + source); cross.headers.set('sec-fetch-site', 'cross-site'); expect((await GET(cross)).status).toBe(404);
        expect(mock.runtime).not.toHaveBeenCalled();
    });
    it('strictly validates filters without accepting ownership claims or duplicate parameters', async () => {
        for (const query of [`source=${source}&organizationId=${source}`, `source=${source}&page=0`, `source=${source}&from=2026-02-30`, `source=${source}&source=${source}`, 'action=sources&extra=1']) expect((await GET(request(query))).status).toBe(400);
    });
    it('uses the server cookie and returns only acknowledged service results', async () => {
        service.sources.mockResolvedValue({ status: 'OK', sources: [] }); expect((await GET(request('action=sources'))).status).toBe(200);
        expect(service.sources).toHaveBeenCalledWith(token);
        service.read.mockResolvedValue({ status: 'OK', version: 'poc-financial-insights-v1' }); const r = await GET(request('source=' + source)); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('no-store');
        expect(service.read.mock.calls[0][1]).toMatchObject({ source, page: 1, pageSize: 25 });
    });
    it('hides denied existence, query/audit errors and missing sessions', async () => {
        service.read.mockResolvedValue({ status: 'REFUSED', code: 'UNAVAILABLE' }); expect((await GET(request('source=' + source))).status).toBe(404);
        service.read.mockRejectedValue(Error('private SQL failure')); const r = await GET(request('source=' + source)); expect(r.status).toBe(404); expect(await r.text()).not.toContain('SQL');
    });
});
