import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), enabled: true }));
vi.mock('../../lib/server/poc-reconciliation/runtime', async () => {
    const real = await vi.importActual<typeof import('../../lib/server/poc-reconciliation/runtime')>('../../lib/server/poc-reconciliation/runtime');
    return { pocRequestAllowed: (request: Request) => mocks.enabled && real.pocRequestAllowed(request), reconciliationRuntime: mocks.runtime };
});
import { GET, POST } from '../../app/api/ai-ingestion/m2/reconciliation/reviews/route';
const base = 'http://127.0.0.1:3192/api/ai-ingestion/m2/reconciliation/reviews', id = '11111111-1111-4111-8111-111111111111';
const headers = { host: '127.0.0.1:3192', origin: 'http://127.0.0.1:3192', cookie: 'fingence_poc_session=test-token', 'Content-Type': 'application/json' };
const input = { reconciliationId: id, outcomeKey: 'a'.repeat(64), state: 'EXPLAINED', rationale: 'Source discrepancy explained, not cleared.', expectedVersion: 0 };
const reviews = { get: vi.fn(), review: vi.fn() };
beforeEach(() => {
    vi.resetAllMocks(); mocks.enabled = true;
    for (const name of ['FINGENCE_AI_LOCAL', 'FINGENCE_V2_I1_LOCAL', 'FINGENCE_M2_LOCAL', 'FINGENCE_M3_LOCAL', 'FINGENCE_M4_LOCAL', 'FINGENCE_M5_LOCAL', 'FINGENCE_POC_LOCAL']) vi.stubEnv(name, '1');
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); mocks.runtime.mockResolvedValue({ reviews });
});
afterEach(() => vi.unstubAllEnvs());
it('blocks Production, hosted, disabled, cross-site and wrong-origin writes before initialization', async () => {
    vi.stubEnv('NODE_ENV', 'production'); expect((await GET(new Request(base + '?id=' + id, { headers }))).status).toBe(404);
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', '1'); expect((await POST(new Request(base, { method: 'POST', headers, body: '{}' }))).status).toBe(404);
    vi.stubEnv('VERCEL', '');
    expect((await POST(new Request(base, { method: 'POST', headers: { ...headers, origin: 'https://attacker.invalid' }, body: '{}' }))).status).toBe(404);
    expect((await GET(new Request('https://example.com/api/ai-ingestion/m2/reconciliation/reviews?id=' + id))).status).toBe(404);
    mocks.enabled = false; expect((await GET(new Request(base + '?id=' + id, { headers }))).status).toBe(404);
    expect(mocks.runtime).not.toHaveBeenCalled();
});
it('accepts only one result selector and returns server-scoped annotations with no-store', async () => {
    reviews.get.mockResolvedValue({ status: 'OK', version: 'poc-reconciliation-reviews-v1' });
    const r = await GET(new Request(base + '?id=' + id, { headers })); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('no-store'); expect(reviews.get).toHaveBeenCalledWith('test-token', id);
    for (const q of ['id=invalid', `id=${id}&id=${id}`, `id=${id}&organizationId=other`]) expect((await GET(new Request(base + '?' + q, { headers }))).status).toBe(404);
});
it('rejects clearing/source/identity claims, missing rationale and oversized bodies without a write', async () => {
    for (const v of [{ ...input, state: 'MATCHED' }, { ...input, rationale: '' }, { ...input, bankSha256: '0'.repeat(64) }, { ...input, organizationId: id }])
        expect((await POST(new Request(base, { method: 'POST', headers, body: JSON.stringify(v) }))).status).toBe(404);
    expect((await POST(new Request(base, { method: 'POST', headers, body: 'x'.repeat(4097) }))).status).toBe(404);
    expect(reviews.review).not.toHaveBeenCalled();
});
it('reports optimistic conflicts separately and hides database details or missing authorization', async () => {
    reviews.review.mockResolvedValue({ status: 'REVIEWED', view: { status: 'OK' } });
    expect((await POST(new Request(base, { method: 'POST', headers, body: JSON.stringify(input) }))).status).toBe(200);
    expect(reviews.review).toHaveBeenCalledWith('test-token', input);
    reviews.review.mockResolvedValue({ status: 'REFUSED', code: 'STALE_REVIEW' }); expect((await POST(new Request(base, { method: 'POST', headers, body: JSON.stringify(input) }))).status).toBe(409);
    reviews.review.mockRejectedValue(Error('private SQL detail')); const r = await POST(new Request(base, { method: 'POST', headers, body: JSON.stringify(input) })); expect(r.status).toBe(404); expect(await r.text()).not.toContain('SQL');
    reviews.get.mockResolvedValue({ status: 'REFUSED', code: 'UNAVAILABLE' }); expect((await GET(new Request(base + '?id=' + id, { headers }))).status).toBe(404);
});
