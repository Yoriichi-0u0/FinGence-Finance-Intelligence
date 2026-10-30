import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), enabled: true }));
vi.mock('../../lib/server/poc-reconciliation/runtime', async () => { const { localAccessAllowed } = await import('../../lib/server/ai-ingestion/service'); return { pocRequestAllowed: (r: Request) => mocks.enabled && localAccessAllowed(r), reconciliationRuntime: mocks.runtime }; });
import { GET, POST } from '../../app/api/ai-ingestion/m2/reconciliation/route';
import { localSessionCookieName } from '../../lib/server/ai-ingestion/m2/session-cookie';
const service = { get: vi.fn(), list: vi.fn(), ingest: vi.fn() }, identity = { session: vi.fn() };
const base = 'http://127.0.0.1:3186/api/ai-ingestion/m2/reconciliation';
const headers = { host: '127.0.0.1:3186', origin: 'http://127.0.0.1:3186', cookie: 'fingence_poc_session=test-token' };
beforeEach(() => { vi.resetAllMocks(); mocks.enabled = true; vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_LOCAL', '1'); vi.stubEnv('FINGENCE_POC_LOCAL', '1'); mocks.runtime.mockResolvedValue({ identity, reconciliation: service }); });
afterEach(() => vi.unstubAllEnvs());
it('uses a separate local cookie so other M5 servers are untouched', () => { expect(localSessionCookieName()).toBe('fingence_poc_session'); });
it('denies production, cross-site, non-loopback and disabled requests before initialization', async () => {
    vi.stubEnv('NODE_ENV', 'production'); expect((await GET(new Request(base, { headers }))).status).toBe(404);
    vi.stubEnv('NODE_ENV', 'development');
    expect((await POST(new Request(base, { method: 'POST', headers: { ...headers, origin: 'https://attacker.invalid' } }))).status).toBe(404);
    expect((await GET(new Request('http://example.com/api/ai-ingestion/m2/reconciliation'))).status).toBe(404);
    mocks.enabled = false; expect((await POST(new Request(base, { method: 'POST', headers }))).status).toBe(404);
    expect(mocks.runtime).not.toHaveBeenCalled();
});
it('takes only two real file uploads, not browser identity, amounts or verification claims', async () => {
    const form = new FormData(); form.set('bank', new File(['bank'], 'b.csv')); form.set('ledger', new File(['ledger'], 'l.csv'));
    service.ingest.mockResolvedValue({ id: 'original' });
    const response = await POST(new Request(base, { method: 'POST', headers, body: form }));
    expect(response.status).toBe(200); expect(service.ingest).toHaveBeenCalledWith('test-token', new Uint8Array(Buffer.from('bank')), new Uint8Array(Buffer.from('ledger')), 'b.csv', 'l.csv');
    form.set('organizationId', 'attacker'); expect((await POST(new Request(base, { method: 'POST', headers, body: form }))).status).toBe(404);
});
it('returns scoped server results and the real report with no-store, and hides failures', async () => {
    service.get.mockResolvedValue({ version: 'finance-poc-reconciliation-v1', cashMovement: { bank: '6380.53' } });
    const r = await GET(new Request(base + '?id=original&download=1', { headers }));
    expect(service.get).toHaveBeenCalledWith('test-token', 'original', true); expect(r.headers.get('content-disposition')).toContain('attachment'); expect(r.headers.get('cache-control')).toBe('no-store');
    service.get.mockRejectedValue(Error('private database detail')); const denied = await GET(new Request(base + '?id=missing', { headers })); expect(denied.status).toBe(404); expect(await denied.text()).not.toContain('private');
});
it('rejects over-limit bodies and denied sessions before financial ingestion', async () => {
    expect((await POST(new Request(base, { method: 'POST', headers, body: 'x'.repeat(1100001) }))).status).toBe(404);
    identity.session.mockRejectedValue(Error('ACCESS_DENIED'));
    expect((await POST(new Request(base, { method: 'POST', headers, body: '{}' }))).status).toBe(404);
    expect(service.ingest).not.toHaveBeenCalled();
});
