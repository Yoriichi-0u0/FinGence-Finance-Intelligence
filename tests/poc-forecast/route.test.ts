import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => { process.env.FINGENCE_POC_LOCAL = '1'; return { enabled: true, runtime: vi.fn() }; });
vi.mock('../../lib/server/poc-reconciliation/runtime', async () => { const { localAccessAllowed } = await import('../../lib/server/ai-ingestion/service');
    return { pocLocalEnabled: () => mock.enabled, pocRequestAllowed: (r: Request) => mock.enabled && localAccessAllowed(r) }; });
vi.mock('../../lib/server/poc-forecast/runtime', () => ({ forecastRuntime: mock.runtime }));
import { GET } from '../../app/api/ai-ingestion/m2/forecast/route';
import * as route from '../../app/api/ai-ingestion/m2/forecast/route';

const session = 'a'.repeat(43), url = 'http://127.0.0.1:3186/api/ai-ingestion/m2/forecast', source = '11111111-1111-4111-8111-111111111111';
const forecast = { sources: vi.fn(), forecast: vi.fn() };
const req = (query: string, { host = '127.0.0.1:3186', cookie = 'fingence_poc_session=' + session } = {}) => new Request(url + '?' + query, { headers: { host, cookie } });
beforeEach(() => { vi.resetAllMocks(); mock.enabled = true; vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_LOCAL', '1'); mock.runtime.mockResolvedValue({ forecast }); });
afterEach(() => vi.unstubAllEnvs());

describe('PoC forecast HTTP boundary', () => {
    it('is read-only: no POST, PUT or DELETE handler exists', () => {
        expect(Object.keys(route).filter(k => /^[A-Z]+$/.test(k))).toEqual(['GET']);
    });
    it('denies before opening the database when the PoC stack is off or the host is not loopback', async () => {
        mock.enabled = false;
        expect((await GET(req('action=sources'))).status).toBe(404);
        mock.enabled = true;
        expect((await GET(req('action=sources', { host: 'example.com' }))).status).toBe(404);
        expect(mock.runtime).not.toHaveBeenCalled();
    });
    it('forwards only the PoC session and typed selection keys; organization, role and user claims are refused', async () => {
        forecast.forecast.mockResolvedValue({ status: 'OK' });
        expect((await GET(req(`action=forecast&source=${source}&business=BUS-001`))).status).toBe(200);
        expect(forecast.forecast).toHaveBeenCalledWith(session, { sourceId: source, businessId: 'BUS-001' });
        expect((await GET(req(`action=forecast&source=${source}`))).status).toBe(200);
        expect(forecast.forecast).toHaveBeenLastCalledWith(session, { sourceId: source });
        for (const query of [`action=forecast&source=${source}&organizationId=x`, `action=forecast&source=${source}&role=Finance`, 'action=forecast&source=../x', `action=forecast&source=${source}&business=BUS 1`, 'action=forecast', `action=sources&source=${source}`, 'action=train'])
            expect((await GET(req(query))).status).toBe(404);
        expect(forecast.forecast).toHaveBeenCalledTimes(2);
        forecast.sources.mockResolvedValue({ status: 'OK', sources: [] });
        await GET(req('action=sources', { cookie: 'fingence_m5_session=other' }));
        expect(forecast.sources).toHaveBeenCalledWith('');
    });
    it('hides refusals and internal errors behind one generic no-store response', async () => {
        forecast.forecast.mockResolvedValue({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const refused = await GET(req(`action=forecast&source=${source}`));
        expect([refused.status, await refused.json(), refused.headers.get('cache-control')]).toEqual([404, { error: 'Unavailable or access denied.' }, 'no-store']);
        forecast.sources.mockRejectedValue(new Error('SESSION_REVOKED private detail'));
        const failed = await GET(req('action=sources'));
        expect(failed.status).toBe(404);
        expect(await failed.text()).not.toContain('private');
    });
});
