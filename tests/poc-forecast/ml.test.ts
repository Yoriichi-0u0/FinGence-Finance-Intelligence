import { describe, expect, it } from 'vitest';
import { forecastBusiness } from '../../lib/poc-forecast/forecast';
import { ML_MIN_MONTHS, buildMlRequest, mlRequestSchema, mlWorkerSchema, scoreMl } from '../../lib/poc-forecast/ml';
import { baseline, credits, debits, rows, worker, withBacktest } from './ml-fixtures';

describe('ML challenger request', () => {
    it('is built from the baseline history in integer cents', () => {
        const built = buildMlRequest(baseline());
        if (!('request' in built)) throw new Error(built.code);
        expect(built.request.currency).toBe('MYR');
        expect(built.request.months).toHaveLength(12);
        expect(built.request.months[0]).toEqual({ period: '2025-04', credits: 6000000, debits: 2700000 });
        expect(mlRequestSchema.safeParse(built.request).success).toBe(true);
    });
    it('is refused when the baseline is unavailable, so it inherits the baseline refusals', () => {
        const mixed = forecastBusiness([...rows('2025-04', credits.slice(0, 12), debits.slice(0, 12)), ...rows('2025-04', [1], [1], 'SGD')]);
        expect(buildMlRequest(mixed)).toMatchObject({ code: 'BASELINE_UNAVAILABLE' });
    });
    it(`is refused below ${ML_MIN_MONTHS} months even when the 7-month baseline is available`, () => {
        expect(baseline(10).forecast.status).toBe('AVAILABLE');
        expect(buildMlRequest(baseline(10))).toMatchObject({ code: 'INSUFFICIENT_HISTORY' });
    });
    it('rejects malformed, extra-key, fractional and negative requests', () => {
        const ok = { currency: 'MYR', months: Array.from({ length: 12 }, (_, i) => ({ period: i < 9 ? `2025-0${i + 1}` : `2025-${i + 1}`, credits: 1, debits: 1 })) };
        expect(mlRequestSchema.safeParse(ok).success).toBe(true);
        expect(mlRequestSchema.safeParse({ ...ok, organizationId: 'x' }).success).toBe(false);
        expect(mlRequestSchema.safeParse({ ...ok, currency: 'myr' }).success).toBe(false);
        expect(mlRequestSchema.safeParse({ ...ok, months: ok.months.slice(1) }).success).toBe(false);
        expect(mlRequestSchema.safeParse({ ...ok, months: ok.months.map((m, i) => i ? m : { ...m, credits: 1.5 }) }).success).toBe(false);
        expect(mlRequestSchema.safeParse({ ...ok, months: ok.months.map((m, i) => i ? m : { ...m, debits: -1 }) }).success).toBe(false);
    });
});

describe('ML challenger at 1, 4 and 6 months ahead', () => {
    it('reports every horizon, with the months each can be tested on', () => {
        const r = scoreMl(baseline(), worker());
        expect(r.version).toBe('ml-xgboost-forecast-v2');
        expect(r.horizons.map(h => [h.horizon, h.tests, h.last])).toEqual([[1, 6, '2026-04'], [4, 3, '2026-07'], [6, 1, '2026-09']]);
        expect(r.path.map(s => s.period)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
        expect(r.horizons[0].points.map(p => p.period)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
        expect(r.horizons[1].points.map(p => p.period)).toEqual(['2026-01', '2026-02', '2026-03']);
        expect(r.horizons[2].points.map(p => p.period)).toEqual(['2026-03']);
    });
    it('gives the same baseline at horizon 1 as the deterministic engine, month for month', () => {
        const b = baseline(), r = scoreMl(b, worker());
        if (b.forecast.status !== 'AVAILABLE') throw new Error('baseline');
        for (const metric of ['credits', 'debits', 'net'] as const) {
            expect(r.horizons[0].points.map(p => p.baseline[metric])).toEqual(b.forecast.backtest[metric].points.map(p => p.forecasts.MEAN_6));
            expect(r.horizons[0].scores.find(s => s.metric === metric)!.baselineWape).toBe(b.forecast.backtest[metric].methods.find(m => m.method === 'MEAN_6')!.wape);
        }
    });
    it('computes the baseline at longer horizons from only the months known at the origin, in exact cents', () => {
        const r = scoreMl(baseline(), worker()), h4 = r.horizons[1].points, h6 = r.horizons[2].points;
        // Horizon 4: January 2026 is forecast after September 2025 (April..September known), February after October, March after November.
        expect(h4.map(p => p.madeAfter)).toEqual(['2025-09', '2025-10', '2025-11']);
        expect(h4.map(p => p.baseline.credits)).toEqual(['62916.67', '63583.33', '64916.67']);
        expect(h4[0].baseline.debits).toBe('28000.00');
        // Horizon 6: March 2026 is forecast after September 2025, with the same six months known as the first horizon-4 test.
        expect(h6[0]).toMatchObject({ period: '2026-03', madeAfter: '2025-09', actual: { credits: '69000.00' } });
        expect(h6[0].baseline.credits).toBe('62916.67');
    });
    it('sums the forecast over each horizon, and repeats the baseline average every month', () => {
        const r = scoreMl(baseline(), worker()), h4 = r.horizons[1], h1 = r.horizons[0];
        expect(h4.total.ml).toEqual({ credits: '280600.00', debits: '140000.00', net: '140600.00' });
        expect(h4.total.baseline.credits).toBe('269333.32');          // 4 x 67,333.33
        expect(h1.total.ml.credits).toBe('70000.00');
        expect(r.path.every(s => s.baseline.credits === '67333.33' && s.baseline.debits === '31833.33')).toBe(true);
        // Net per month is credits minus debits of that month's forecast, never modelled separately.
        expect(r.path[1].ml.net).toBe('35100.00');
    });
    it('scores each horizon on its own test months and names the lower error', () => {
        const perfect = scoreMl(baseline(), worker());
        for (const h of perfect.horizons) expect(h.scores.every(s => s.mlWape === '0.00' && s.mlMae === '0.00' && s.lowerWape === 'ML')).toBe(true);
        const bad = scoreMl(baseline(), worker(12, { backtests: withBacktest(4, p => ({ ...p, credits: 0, debits: 0 })) }));
        expect(bad.horizons[1].scores.map(s => s.lowerWape)).toEqual(['BASELINE', 'BASELINE', 'BASELINE']);
        expect(bad.horizons[0].scores.map(s => s.lowerWape)).toEqual(['ML', 'ML', 'ML']);   // the other horizons are untouched
    });
    it('marks a horizon indicative when it has fewer than three test months', () => {
        expect(scoreMl(baseline(), worker()).horizons.map(h => h.indicative)).toEqual([false, false, true]);
        expect(scoreMl(baseline(13), worker(13)).horizons.map(h => [h.tests, h.indicative])).toEqual([[7, false], [4, false], [2, true]]);
    });
    it('refuses a result whose months, periods, horizons or window counts do not match the baseline', () => {
        const b = baseline();
        expect(() => scoreMl(b, worker(12, { backtests: withBacktest(4, (p, i) => i ? p : { ...p, period: '2025-12' }) }))).toThrow('ML_BACKTEST_MONTHS_MISMATCH');
        expect(() => scoreMl(b, worker(12, { backtests: { ...worker().backtests, '6': [] } }))).toThrow('ML_BACKTEST_MONTHS_MISMATCH');
        expect(() => scoreMl(b, worker(12, { backtests: { ...worker().backtests, '1': worker().backtests['1'].slice(1) } }))).toThrow('ML_BACKTEST_MONTHS_MISMATCH');
        expect(() => scoreMl(b, worker(12, { path: worker().path.map((s, i) => i ? s : { ...s, period: '2026-05' }) }))).toThrow('ML_PERIOD_MISMATCH');
        expect(() => scoreMl(b, worker(12, { path: worker().path.map((s, i) => i === 3 ? { ...s, period: '2026-12' } : s) }))).toThrow('ML_PERIOD_MISMATCH');
        expect(() => scoreMl(b, worker(12, { config: { ...worker().config, windows: { '1': 6, '4': 3, '6': 2 } } }))).toThrow('ML_WINDOW_MISMATCH');
        expect(() => scoreMl(b, worker(12, { config: { ...worker().config, horizons: [1, 3, 6] as unknown as [1, 4, 6] } }))).toThrow('ML_HORIZON_MISMATCH');
        expect(() => scoreMl(forecastBusiness([]), worker())).toThrow('ML_BASELINE_UNAVAILABLE');
        // A result for 13 months does not line up with a 12-month baseline.
        expect(() => scoreMl(b, worker(13))).toThrow();
    });
    it('validates the untrusted worker contract strictly', () => {
        expect(mlWorkerSchema.safeParse(worker()).success).toBe(true);
        expect(mlWorkerSchema.safeParse({ ...worker(), extra: 1 }).success).toBe(false);
        expect(mlWorkerSchema.safeParse({ ...worker(), path: worker().path.slice(0, 5) }).success).toBe(false);
        expect(mlWorkerSchema.safeParse({ ...worker(), path: [{ period: '2026-04', credits: -1, debits: 1 }, ...worker().path.slice(1)] }).success).toBe(false);
        expect(mlWorkerSchema.safeParse({ ...worker(), path: [{ period: '2026-13', credits: 1, debits: 1 }, ...worker().path.slice(1)] }).success).toBe(false);
        const missing = { '1': worker().backtests['1'], '4': worker().backtests['4'] };   // no horizon-6 backtest
        expect(mlWorkerSchema.safeParse({ ...worker(), backtests: missing }).success).toBe(false);
        expect(mlWorkerSchema.safeParse({ ...worker(), backtests: { ...worker().backtests, '3': [] } }).success).toBe(false);
        expect(mlWorkerSchema.safeParse({ ...worker(), config: { ...worker().config, strategy: 'direct' } }).success).toBe(false);
    });
});
