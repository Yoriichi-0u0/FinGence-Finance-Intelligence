import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { mlRequestSchema, type MlRequest } from '../../lib/poc-forecast/ml';
import { mlForecastEnabled, runMlForecast } from '../../lib/server/poc-forecast/ml-runner';
import { POST, GET } from '../../app/api/forecast/ml/route';

const period = (i: number) => `${2025 + Math.floor((3 + i) / 12)}-${String(((3 + i) % 12) + 1).padStart(2, '0')}`;
const request = (n = 12): MlRequest => ({ currency: 'MYR', months: Array.from({ length: n }, (_, i) => ({ period: period(i), credits: 6_000_000 + i * 90_000 + (i % 3) * 40_000, debits: 2_800_000 + i * 20_000 })) });
// The real worker needs the optional Python runtime (requirements-ml.txt); those tests skip cleanly without it.
const rel = process.platform === 'win32' ? '.venv-ml/Scripts/python.exe' : '.venv-ml/bin/python';
const venv = [resolve(rel), resolve('..', rel)].find(existsSync) ?? '';
const worker = !!venv || !!process.env.FINGENCE_ML_PYTHON;
const origin = 'http://127.0.0.1:3000';
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(origin + '/api/forecast/ml', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { host: '127.0.0.1:3000', origin, 'content-type': 'application/json', ...headers } });

beforeEach(() => { vi.stubEnv('VERCEL', ''); if (venv) vi.stubEnv('FINGENCE_ML_PYTHON', venv); });
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
    it('returns a validated, deterministic forecast at 1, 4 and 6 months, with the months each can be tested on', async () => {
        const a = await runMlForecast(request()), b = await runMlForecast(request());
        if (a.status !== 'OK' || b.status !== 'OK') throw new Error(JSON.stringify(a));
        const r = a.result;
        expect(r.path.map(s => s.period)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
        expect(r.config).toMatchObject({ horizons: [1, 4, 6], strategy: 'recursive', windows: { '1': 6, '4': 3, '6': 1 } });
        expect(r.backtests['1'].map(p => p.period)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
        expect(r.backtests['4'].map(p => p.period)).toEqual(['2026-01', '2026-02', '2026-03']);
        expect(r.backtests['6'].map(p => p.period)).toEqual(['2026-03']);
        for (const p of [...r.path, ...r.backtests['1'], ...r.backtests['4'], ...r.backtests['6']]) expect(Number.isInteger(p.credits) && Number.isInteger(p.debits) && p.credits >= 0 && p.debits >= 0).toBe(true);
        expect(b.result).toEqual(r);
    }, 90_000);
    it('tests each horizon on every month it can, however much history there is', async () => {
        const out = await runMlForecast(request(14));   // 14 months: 8, 5 and 3 test months at 1, 4 and 6 months ahead
        if (out.status !== 'OK') throw new Error(JSON.stringify(out));
        expect(out.result.config.windows).toEqual({ '1': 8, '4': 5, '6': 3 });
        expect(out.result.backtests['6'].map(p => p.period)).toEqual(['2026-03', '2026-04', '2026-05']);
        expect(out.result.path[0].period).toBe('2026-06');
    }, 90_000);
    it('keeps the 1-month forecast and backtest exactly as the single-horizon worker produced them', async () => {
        const out = await runMlForecast(request());
        if (out.status !== 'OK') throw new Error(JSON.stringify(out));
        // Golden values (integer cents) from the v1 single-step worker on this same input; adding horizons must not move them.
        expect(out.result.path[0]).toEqual({ period: '2026-04', credits: 7062939, debits: 3018632 });
        expect(out.result.backtests['1'].map(p => [p.credits, p.debits])).toEqual([[6527853, 2899670], [6538603, 2919494], [6666721, 2939291], [6795235, 2959123], [6806919, 2978948], [6934267, 2998780]]);
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
