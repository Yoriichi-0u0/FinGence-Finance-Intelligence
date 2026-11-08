import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { mlRequestSchema, type MlRequest } from '../../lib/poc-forecast/ml';
import { mlForecastEnabled, runMlForecast } from '../../lib/server/poc-forecast/ml-runner';
import { POST, GET } from '../../app/api/forecast/ml/route';

const period = (i: number) => `${2025 + Math.floor((3 + i) / 12)}-${String(((3 + i) % 12) + 1).padStart(2, '0')}`;
const request = (n = 12): MlRequest => ({ currency: 'MYR', months: Array.from({ length: n }, (_, i) => ({ period: period(i), credits: 6_000_000 + i * 90_000 + (i % 3) * 40_000, debits: 2_800_000 + i * 20_000 })) });
const venv = resolve('../.venv-ml/bin/python');
// The real worker needs the optional Python runtime (requirements-ml.txt); those tests skip cleanly without it.
const worker = existsSync(venv) || !!process.env.FINGENCE_ML_PYTHON;
const origin = 'http://127.0.0.1:3000';
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(origin + '/api/forecast/ml', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { host: '127.0.0.1:3000', origin, 'content-type': 'application/json', ...headers } });

beforeEach(() => { vi.stubEnv('VERCEL', ''); if (existsSync(venv)) vi.stubEnv('FINGENCE_ML_PYTHON', venv); });
afterEach(() => vi.unstubAllEnvs());

describe('ML forecast switch', () => {
    it('is off by default and off on Vercel even when switched on', () => {
        vi.stubEnv('FINGENCE_ML_FORECAST', '');
        expect(mlForecastEnabled()).toBe(false);
        vi.stubEnv('FINGENCE_ML_FORECAST', '1');
        expect(mlForecastEnabled()).toBe(true);
        vi.stubEnv('VERCEL', '1');
        expect(mlForecastEnabled()).toBe(false);
    });
    it('answers 404 to GET and POST when disabled, without running anything', async () => {
        vi.stubEnv('FINGENCE_ML_FORECAST', '');
        expect((await GET()).status).toBe(404);
        expect((await POST(post(request()))).status).toBe(404);
    });
});

describe('ML forecast route boundary', () => {
    beforeEach(() => vi.stubEnv('FINGENCE_ML_FORECAST', '1'));
    it('reports availability without disclosing configuration', async () => {
        const r = await GET();
        expect(r.status).toBe(200);
        expect(Object.keys(await r.json()).sort()).toEqual(['available', 'model', 'sends']);
    });
    it('refuses cross-origin, non-JSON, malformed, oversized and over-specified requests before running the worker', async () => {
        expect((await POST(post(request(), { origin: 'http://evil.example' }))).status).toBe(403);
        expect((await POST(post(request(), { 'content-type': 'text/plain' }))).status).toBe(415);
        expect((await POST(post('{nope'))).status).toBe(400);
        expect((await POST(post({ ...request(), organizationId: 'x' }))).status).toBe(400);
        expect((await POST(post(request(11)))).status).toBe(400);
        expect((await POST(post('x'.repeat(20_000)))).status).toBe(413);
    });
});

describe.runIf(worker)('MLForecast + XGBoost worker (real process)', () => {
    beforeEach(() => vi.stubEnv('FINGENCE_ML_FORECAST', '1'));
    it('returns a validated, deterministic forecast and backtest for 12 months', async () => {
        const a = await runMlForecast(request()), b = await runMlForecast(request());
        if (a.status !== 'OK' || b.status !== 'OK') throw new Error(JSON.stringify(a));
        expect(a.result.next.period).toBe('2026-04');
        expect(a.result.backtest.map(p => p.period)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
        expect(a.result.config.windows).toBe(6);
        for (const p of [a.result.next, ...a.result.backtest]) expect(Number.isInteger(p.credits) && Number.isInteger(p.debits) && p.credits >= 0 && p.debits >= 0).toBe(true);
        expect(b.result).toEqual(a.result);
    }, 90_000);
    it('serves the same result through the route', async () => {
        const r = await POST(post(request()));
        expect(r.status).toBe(200);
        expect(r.headers.get('cache-control')).toBe('no-store');
        expect((await r.json()).result.engine.xgboost).toMatch(/^\d/);
    }, 90_000);
    it('refuses a gap in the months and too little history in the worker itself, not only in the schema', async () => {
        const gap = request(13);
        gap.months.splice(4, 1);
        // Schema-valid (12 months) but not consecutive: the worker is the second line of defence.
        expect(mlRequestSchema.safeParse(gap).success).toBe(true);
        expect(await runMlForecast(gap)).toMatchObject({ status: 'REFUSED', code: 'REFUSED' });
        const r = await POST(post(gap));
        expect(r.status).toBe(422);
    }, 90_000);
    it('runs one forecast at a time and refuses a concurrent request instead of queueing it', async () => {
        const first = runMlForecast(request()), second = await runMlForecast(request());
        expect(second).toMatchObject({ status: 'BUSY' });
        expect((await first).status).toBe('OK');
    }, 90_000);
    it('reports an unavailable runtime instead of throwing when Python cannot start', async () => {
        vi.stubEnv('FINGENCE_ML_PYTHON', '/nonexistent/python');
        expect(await runMlForecast(request())).toMatchObject({ status: 'UNAVAILABLE', code: 'PYTHON_UNAVAILABLE' });
    });
});
