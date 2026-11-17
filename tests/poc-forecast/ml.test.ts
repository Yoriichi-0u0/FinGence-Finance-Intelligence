import { describe, expect, it } from 'vitest';
import { forecastBusiness, nextPeriod, type BusinessForecast, type ForecastRow } from '../../lib/poc-forecast/forecast';
import { ML_MIN_MONTHS, buildMlRequest, mlRequestSchema, mlWorkerSchema, scoreMl, type MlWorkerResult } from '../../lib/poc-forecast/ml';

const money = (v: number) => (v / 100).toFixed(2);
/** One credit and one debit per month; values in cents. */
function rows(start: string, credits: number[], debits: number[], currency = 'MYR'): ForecastRow[] {
    const out: ForecastRow[] = [];
    let period = start;
    credits.forEach((c, i) => {
        out.push({ businessId: 'B', currency, period, direction: 'Credit', amount: money(c), signedAmount: money(c) });
        out.push({ businessId: 'B', currency, period, direction: 'Debit', amount: money(debits[i]), signedAmount: '-' + money(debits[i]) });
        period = nextPeriod(period);
    });
    return out;
}
const credits = [6000000, 6100000, 6200000, 6150000, 6600000, 6700000, 6400000, 6900000, 6400000, 6800000, 7000000, 6900000];
const debits = [2700000, 2800000, 2700000, 2800000, 2900000, 2900000, 2900000, 3000000, 3000000, 3100000, 3100000, 4000000];
const TESTED = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
const baseline = (n = 12): BusinessForecast => forecastBusiness(rows('2025-04', credits.slice(0, n), debits.slice(0, n)));

/** A worker result that lines up with `baseline()`: tests are months 7..12 (index 6 onward). */
const worker = (over: Partial<MlWorkerResult> = {}): MlWorkerResult => ({
    engine: { mlforecast: '1.1.0', xgboost: '3.4.1', pandas: '2.3.3', numpy: '2.5.4', python: '3.12.3' },
    config: { model: 'XGBRegressor', params: { n_estimators: 80 }, lags: [1, 2, 3], rolling: 'mean of the last 3 months (lag 1)', windows: 6, horizon: 1, refit: true, perMetric: true },
    next: { period: '2026-04', credits: 7000000, debits: 3500000 },
    backtest: credits.slice(6).map((c, i) => ({ period: TESTED[i], credits: c, debits: debits[6 + i] })),
    importance: { credits: { lag1: 1 }, debits: { lag1: 1 } },
    ...over,
});

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
        const mixed = forecastBusiness([...rows('2025-04', credits, debits), ...rows('2025-04', [1], [1], 'SGD')]);
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

describe('ML challenger scoring', () => {
    it('scores the ML forecast and the baseline on identical months in exact cents', () => {
        const b = baseline(), result = scoreMl(b, worker());
        expect(result).toMatchObject({ period: '2026-04', credits: '70000.00', debits: '35000.00', net: '35000.00', tests: 6, currency: 'MYR' });
        // A perfect ML backtest has zero error, so it is strictly lower than any baseline with error.
        const credit = result.scores.find(s => s.metric === 'credits')!;
        expect(credit).toMatchObject({ mlWape: '0.00', mlMae: '0.00', lowerWape: 'ML' });
        expect(Number(credit.baselineWape)).toBeGreaterThan(0);
        expect(result.points.map(p => p.period)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
        expect(result.points[0].baseline.credits).toBe(b.forecast.status === 'AVAILABLE' ? b.forecast.backtest.credits.points[0].forecasts.MEAN_6 : '');
    });
    it('derives net from ML credits minus ML debits and reports a baseline win when ML is worse', () => {
        const bad = worker({ backtest: worker().backtest.map(p => ({ ...p, credits: 0, debits: 0 })) });
        const result = scoreMl(baseline(), bad);
        expect(result.scores.map(s => s.lowerWape)).toEqual(['BASELINE', 'BASELINE', 'BASELINE']);
        expect(result.points[0].ml).toEqual({ credits: '0.00', debits: '0.00', net: '0.00' });
    });
    it('refuses a result whose months, period or window count do not match the baseline', () => {
        const b = baseline();
        expect(() => scoreMl(b, worker({ backtest: worker().backtest.slice(1) }))).toThrow('ML_BACKTEST_MONTHS_MISMATCH');
        expect(() => scoreMl(b, worker({ backtest: worker().backtest.map((p, i) => i ? p : { ...p, period: '2025-09' }) }))).toThrow('ML_BACKTEST_MONTHS_MISMATCH');
        expect(() => scoreMl(b, worker({ next: { period: '2026-05', credits: 1, debits: 1 } }))).toThrow('ML_PERIOD_MISMATCH');
        expect(() => scoreMl(b, worker({ config: { ...worker().config, windows: 5 } }))).toThrow('ML_WINDOW_MISMATCH');
        expect(() => scoreMl(forecastBusiness([]), worker())).toThrow('ML_BASELINE_UNAVAILABLE');
    });
    it('validates the untrusted worker contract strictly', () => {
        expect(mlWorkerSchema.safeParse(worker()).success).toBe(true);
        expect(mlWorkerSchema.safeParse({ ...worker(), extra: 1 }).success).toBe(false);
        expect(mlWorkerSchema.safeParse({ ...worker(), next: { period: '2026-04', credits: -1, debits: 1 } }).success).toBe(false);
        expect(mlWorkerSchema.safeParse({ ...worker(), next: { period: '2026-13', credits: 1, debits: 1 } }).success).toBe(false);
    });
});
