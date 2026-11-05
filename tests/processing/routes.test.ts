import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('server-only', () => ({}));
const pending: Promise<unknown>[] = [];
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: (task: () => Promise<unknown>) => { pending.push(task()); } }));
import type { PGlite } from '@electric-sql/pglite';
import { processingDatabase, rpcTransport } from './db';

const URL_ = 'http://127.0.0.1:54329';
const files = ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv'];
const documents = files.map(name => ({ name, provenance: 'PUBLIC_SYNTHETIC_SAMPLE', base64: readFileSync(`public/demo/${name}`).toString('base64') }));
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${path}`, body === undefined ? { headers: { host: 'localhost:3000' } } : { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000', ...headers }, body: JSON.stringify(body) });
async function routes() {
    vi.resetModules();
    return { jobs: await import('../../app/api/processing/jobs/route'), job: await import('../../app/api/processing/jobs/[id]/route'), management: await import('../../app/api/management/route') };
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('server processing routes', () => {
    let db: PGlite;
    beforeEach(async () => {
        db = await processingDatabase(); pending.length = 0;
        const rpc = rpcTransport(db);
        vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith(URL_) ? rpc(input, init) : Promise.reject(new Error('no network in tests')));
        vi.stubEnv('FINGENCE_PROCESSING_JOBS', '1'); vi.stubEnv('FINGENCE_PROCESSING_LOCAL_URL', URL_); vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_GATEWAY', ''); vi.stubEnv('FINGENCE_INGESTION_STORE', ''); vi.stubEnv('FINGENCE_MANAGEMENT_CONSOLE', '');
    }, 30_000);
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('do not exist unless server processing is switched on with a store', async () => {
        vi.stubEnv('FINGENCE_PROCESSING_JOBS', '');
        const r = await routes();
        expect((await r.jobs.GET()).status).toBe(404);
        expect((await r.jobs.POST(request('/api/processing/jobs', { documents }))).status).toBe(404);
        expect((await r.management.GET(request('/api/management'))).status).toBe(404);
        // The local store is honoured only in development, never on a hosted deployment.
        vi.stubEnv('FINGENCE_PROCESSING_JOBS', '1'); vi.stubEnv('NODE_ENV', 'production');
        expect((await (await routes()).jobs.GET()).status).toBe(404);
        vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', '1');
        expect((await (await routes()).management.GET(request('/api/management'))).status).toBe(404);
    });

    it('accept documents as a job, answer 202 at once, and run it after the response', async () => {
        const r = await routes();
        expect(await (await r.jobs.GET()).json()).toEqual({ available: true, processing: { paused: false, reason: null, changedAt: null } });
        const res = await r.jobs.POST(request('/api/processing/jobs', { documents }));
        expect(res.status).toBe(202);
        const { jobId } = await res.json() as { jobId: string };
        await Promise.all(pending);
        const job = await (await r.job.GET(request(`/api/processing/jobs/${jobId}`), params(jobId))).json();
        expect(job).toEqual(expect.objectContaining({ id: jobId, status: 'COMPLETED', outcome: 'COMPLETED', flaggedCount: 0 }));
        expect(job.results).toBeUndefined();
        const detail = await (await r.management.GET(request(`/api/management?job=${jobId}`))).json();
        expect(detail.results.documents.map((d: { decision: string }) => d.decision)).toEqual(['AUTO_ACCEPTED', 'AUTO_ACCEPTED']);
        const o = await (await r.management.GET(request('/api/management'))).json();
        expect(o.jobs.map((j: { id: string }) => j.id)).toEqual([jobId]);
        expect((await r.job.GET(request('/api/processing/jobs/nope'), params('nope'))).status).toBe(404);
    }, 60_000);

    it('refuse cross-origin, malformed and oversized submissions before creating a job', async () => {
        const r = await routes();
        expect((await r.jobs.POST(request('/api/processing/jobs', { documents }, { origin: 'https://evil.example' }))).status).toBe(403);
        expect((await r.jobs.POST(request('/api/processing/jobs', { documents: [] }))).status).toBe(400);
        expect((await r.jobs.POST(request('/api/processing/jobs', { documents: [{ ...documents[0], base64: 'not base64!' }] }))).status).toBe(400);
        expect((await r.jobs.POST(request('/api/processing/jobs', { documents, extra: 1 }))).status).toBe(400);
        const { rows } = await db.query<{ n: number }>('select count(*)::int as n from fingence_processing.jobs');
        expect(rows[0].n).toBe(0);
    });

    it('keep a hosted job under the hosted request limit; a local server takes larger scans', async () => {
        const { maxJobBodyBytes, HOSTED_JOB_BODY_BYTES } = await import('../../lib/server/processing/jobs');
        expect(maxJobBodyBytes({ VERCEL: '1' })).toBe(HOSTED_JOB_BODY_BYTES);
        expect(HOSTED_JOB_BODY_BYTES).toBeLessThan(4_500_000);
        expect(maxJobBodyBytes({})).toBeGreaterThan(8 * 4_000_000 * 4 / 3);
    });

    it('pause with a reason refuses new jobs with 423 and that reason; resume accepts them again', async () => {
        const r = await routes();
        expect((await r.management.POST(request('/api/management', { action: 'pause', reason: '' }))).status).toBe(400);
        expect((await r.management.POST(request('/api/management', { action: 'pause', reason: 'Bank feed check' }, { origin: 'https://evil.example' }))).status).toBe(403);
        expect(await (await r.management.POST(request('/api/management', { action: 'pause', reason: 'Bank feed check' }))).json()).toEqual({ paused: true });
        expect((await (await r.jobs.GET()).json()).processing).toEqual(expect.objectContaining({ paused: true, reason: 'Bank feed check' }));
        const refused = await r.jobs.POST(request('/api/processing/jobs', { documents }));
        expect(refused.status).toBe(423);
        expect(await refused.json()).toEqual(expect.objectContaining({ code: 'PROCESSING_PAUSED', reason: 'Bank feed check' }));
        expect(await (await r.management.POST(request('/api/management', { action: 'resume' }))).json()).toEqual({ paused: false });
        expect((await r.jobs.POST(request('/api/processing/jobs', { documents }))).status).toBe(202);
        await Promise.all(pending);
    }, 60_000);
});
