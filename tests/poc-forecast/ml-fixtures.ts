/** Shared fixtures for the ML challenger tests (not a test file itself). */
import { forecastBusiness, nextPeriod, type BusinessForecast, type ForecastRow } from '../../lib/poc-forecast/forecast';
import { ML_HORIZONS, type MlWorkerResult } from '../../lib/poc-forecast/ml';

export const money = (v: number) => (v / 100).toFixed(2);
/** One credit and one debit per month; values in cents. */
export function rows(start: string, credits: number[], debits: number[], currency = 'MYR'): ForecastRow[] {
    const out: ForecastRow[] = [];
    let period = start;
    credits.forEach((c, i) => {
        out.push({ businessId: 'B', currency, period, direction: 'Credit', amount: money(c), signedAmount: money(c) });
        out.push({ businessId: 'B', currency, period, direction: 'Debit', amount: money(debits[i]), signedAmount: '-' + money(debits[i]) });
        period = nextPeriod(period);
    });
    return out;
}
export const credits = [6000000, 6100000, 6200000, 6150000, 6600000, 6700000, 6400000, 6900000, 6400000, 6800000, 7000000, 6900000, 7100000];
export const debits = [2700000, 2800000, 2700000, 2800000, 2900000, 2900000, 2900000, 3000000, 3000000, 3100000, 3100000, 4000000, 3200000];
export const periods = Array.from({ length: 13 }, (_, i) => { let p = '2025-04'; for (let k = 0; k < i; k++) p = nextPeriod(p); return p; });   // 2025-04 .. 2026-04
export const baseline = (n = 12): BusinessForecast => forecastBusiness(rows('2025-04', credits.slice(0, n), debits.slice(0, n)));

/**
 * A worker result that lines up with `baseline(n)`. Horizon h is tested on target months from index 6 + h - 1 onward;
 * by default the ML backtest is perfect (it returns the actual values), so its error is zero.
 */
export function worker(n = 12, over: Partial<MlWorkerResult> = {}): MlWorkerResult {
    const windows = Object.fromEntries(ML_HORIZONS.map(h => [String(h), n - 6 - h + 1])) as MlWorkerResult['config']['windows'];
    const backtests = Object.fromEntries(ML_HORIZONS.map(h => [String(h), periods.slice(6 + h - 1, n).map((period, i) => ({ period, credits: credits[6 + h - 1 + i], debits: debits[6 + h - 1 + i] }))])) as MlWorkerResult['backtests'];
    let p = periods[n - 1];
    return {
        engine: { mlforecast: '1.1.0', xgboost: '3.4.1', pandas: '2.3.3', numpy: '2.5.4', python: '3.12.3' },
        config: { model: 'XGBRegressor', params: { n_estimators: 80 }, lags: [1, 2, 3], rolling: 'mean of the last 3 months (lag 1)', horizons: [1, 4, 6], strategy: 'recursive', windows, refit: true, perMetric: true },
        path: Array.from({ length: 6 }, (_, i) => ({ period: p = nextPeriod(p), credits: 7000000 + i * 10000, debits: 3500000 })),
        backtests,
        importance: { credits: { lag1: 1 }, debits: { lag1: 1 } },
        ...over,
    };
}
export const withBacktest = (h: 1 | 4 | 6, f: (r: { period: string; credits: number; debits: number }, i: number) => { period: string; credits: number; debits: number }, n = 12) =>
    ({ ...worker(n).backtests, [String(h)]: worker(n).backtests[String(h) as '1'].map(f) }) as MlWorkerResult['backtests'];
