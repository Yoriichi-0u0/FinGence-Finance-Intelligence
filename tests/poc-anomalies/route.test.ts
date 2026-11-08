import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => { process.env.FINGENCE_M5_LOCAL = '1'; return { enabled: true, runtime: vi.fn() }; });
vi.mock('../../lib/server/tenant-admin-m5/flags', async () => { const { localAccessAllowed } = await import('../../lib/server/ai-ingestion/service');
    return { m5LocalEnabled: () => mock.enabled, m5RequestAllowed: (r: Request) => mock.enabled && localAccessAllowed(r) }; });
vi.mock('../../lib/server/poc-anomalies/runtime', () => ({ pocRuntime: mock.runtime }));
import { GET, POST } from '../../app/api/ai-ingestion/m2/anomalies/route';

const session = 'a'.repeat(43), url = 'http://127.0.0.1:3185/api/ai-ingestion/m2/anomalies', source = '11111111-1111-4111-8111-111111111111';
const anomalies = { sources: vi.fn(), upload: vi.fn(), analysis: vi.fn(), review: vi.fn(), report: vi.fn() };
const req = (query: string, body?: BodyInit, extra: Record<string, string> = {}, { origin = 'http://127.0.0.1:3185', host = '127.0.0.1:3185' } = {}) => new Request(url + '?' + query,
    { method: body === undefined ? 'GET' : 'POST', headers: { host, origin, cookie: 'fingence_m5_session=' + session, ...extra }, body });
beforeEach(() => { vi.resetAllMocks(); mock.enabled = true; vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_LOCAL', '1'); mock.runtime.mockResolvedValue({ anomalies }); });
afterEach(() => vi.unstubAllEnvs());

describe('PoC anomaly HTTP boundary', () => {
    it('denies every action before opening the database when M5 is disabled or the host is not loopback', async () => {
        mock.enabled = false;
        expect((await GET(req('action=sources'))).status).toBe(404);
        expect((await POST(req('action=upload', 'x', { 'x-fingence-file-name': 'a.csv' }))).status).toBe(404);
        mock.enabled = true;
        expect((await GET(req('action=sources', undefined, {}, { host: 'example.com' }))).status).toBe(404);
        expect(mock.runtime).not.toHaveBeenCalled();
    });
    it('denies cross-origin uploads and reviews without opening the database', async () => {
        for (const action of ['upload', 'review'])
            expect((await POST(req('action=' + action, '{}', { 'x-fingence-file-name': 'a.csv' }, { origin: 'http://127.0.0.1:9999' }))).status).toBe(404);
        expect(mock.runtime).not.toHaveBeenCalled();
    });
    it('forwards only the session and typed selection keys; organization, role and user claims are refused', async () => {
        anomalies.analysis.mockResolvedValue({ status: 'OK' });
        expect((await GET(req(`action=analysis&source=${source}&business=BUS-001&period=2026-03&currency=MYR`))).status).toBe(200);
        expect(anomalies.analysis).toHaveBeenCalledWith(session, { sourceId: source, businessId: 'BUS-001', period: '2026-03', currency: 'MYR' });
        for (const query of [`source=${source}&organizationId=x`, `source=${source}&role=Finance`, `source=${source}&period=March`, 'source=../etc', `source=${source}&business=BUS 1`])
            expect((await GET(req('action=analysis&' + query))).status).toBe(404);
        expect(anomalies.analysis).toHaveBeenCalledTimes(1);
    });
    it('hides authorization refusals and internal errors behind one generic response', async () => {
        anomalies.analysis.mockResolvedValue({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const refused = await GET(req(`action=analysis&source=${source}`));
        expect([refused.status, await refused.json()]).toEqual([404, { error: 'Unavailable or access denied.' }]);
        anomalies.sources.mockRejectedValue(new Error('ACCESS_DENIED private detail'));
        const failed = await GET(req('action=sources'));
        expect(failed.status).toBe(404);
        expect(await failed.text()).not.toContain('private');
    });
    it('uploads raw CSV bytes with a safe name, enforces the size limit and reports parse refusals', async () => {
        anomalies.upload.mockResolvedValue({ status: 'STORED', sourceId: source });
        expect((await POST(req('action=upload', 'a,b', { 'x-fingence-file-name': encodeURIComponent('source transactions (1).csv') }))).status).toBe(200);
        expect(anomalies.upload).toHaveBeenCalledWith(session, 'source transactions (1).csv', new Uint8Array(Buffer.from('a,b')));
        for (const name of ['../x.csv', 'x.exe', '', '%E0%A4%A'])
            expect((await POST(req('action=upload', 'a', { 'x-fingence-file-name': name }))).status).toBe(404);
        expect((await POST(req('action=upload', new Uint8Array(5 * 1024 * 1024 + 1), { 'x-fingence-file-name': 'big.csv' }))).status).toBe(404);
        expect(anomalies.upload).toHaveBeenCalledTimes(1);
        anomalies.upload.mockResolvedValue({ status: 'REFUSED', code: 'EVALUATOR_FILE', details: [] });
        const evaluator = await POST(req('action=upload', 'a', { 'x-fingence-file-name': 'labels.csv' }));
        expect([evaluator.status, await evaluator.json()]).toEqual([422, { refused: 'EVALUATOR_FILE', details: [] }]);
    });
    it('accepts exact review shapes only and maps a stale decision to 409', async () => {
        const valid = { sourceId: source, rowId: 'BUS-001-V2-00471', state: 'EXPLAINED', expectedVersion: 0 };
        anomalies.review.mockResolvedValue({ status: 'REFUSED', code: 'STALE_REVIEW' });
        const stale = await POST(req('action=review', JSON.stringify(valid)));
        expect([stale.status, await stale.json()]).toEqual([409, { refused: 'STALE_REVIEW' }]);
        for (const body of [{ ...valid, organizationId: 'x' }, { ...valid, state: 'CLEARED' }, { ...valid, expectedVersion: '0' }, { ...valid, expectedVersion: -1 }, [valid]])
            expect((await POST(req('action=review', JSON.stringify(body)))).status).toBe(404);
        expect((await POST(req('action=review', '{"sourceId":"' + 'x'.repeat(4100) + '"}'))).status).toBe(404);
        expect(anomalies.review).toHaveBeenCalledTimes(1);
    });
    it('downloads the PDF or JSON report as an attachment with its hash', async () => {
        anomalies.report.mockResolvedValue({ status: 'OK', report: { selection: { businessId: 'BUS-001', period: '2026-03' }, reportHash: 'f'.repeat(64) }, bytes: new TextEncoder().encode('%PDF-1.7') });
        const pdf = await GET(req(`action=report&format=pdf&source=${source}&business=BUS-001&period=2026-03`));
        expect(pdf.status).toBe(200);
        expect(pdf.headers.get('content-type')).toBe('application/pdf');
        expect(pdf.headers.get('content-disposition')).toBe('attachment; filename="fingence-poc-report-BUS-001-2026-03.pdf"');
        expect(pdf.headers.get('x-fingence-report-hash')).toBe('f'.repeat(64));
        expect(pdf.headers.get('cache-control')).toBe('no-store');
        expect(await pdf.text()).toBe('%PDF-1.7');
        expect((await GET(req(`action=report&format=docx&source=${source}`))).status).toBe(404);
        anomalies.report.mockResolvedValue({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect((await GET(req(`action=report&format=json&source=${source}`))).status).toBe(404);
    });
});
