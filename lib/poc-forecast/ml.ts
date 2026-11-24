import { z } from 'zod';
import { fromCents, toCents } from '../poc-anomalies/source';
import { METHODS, basisPoints, mean, nextPeriod, percent, type BusinessForecast } from './forecast';

/**
 * Experimental MLForecast + XGBoost challenger to the deterministic six-month-mean baseline, at 1, 4 and 6 months ahead.
 * The model runs in `scripts/ml_forecast.py`; this module is pure and client-safe. It builds the request,
 * validates the untrusted result and scores it in exact integer cents with the baseline's own WAPE/MAE maths.
 * The baseline stays the primary forecast; the challenger is shown beside it and never replaces it.
 */
export const ML_FORECAST_VERSION = 'ml-xgboost-forecast-v2';
export const ML_MIN_MONTHS = 12;
export const ML_MAX_MONTHS = 120;
/** Must equal BACKTEST_START in scripts/ml_forecast.py and forecast.ts: both methods are scored on the same months. */
export const ML_BACKTEST_START = 6;
/** Forecast horizons in months; must equal HORIZONS in scripts/ml_forecast.py. */
export const ML_HORIZONS = [1, 4, 6] as const;
export type MlHorizon = typeof ML_HORIZONS[number];
export const ML_MAX_HORIZON = 6;
/** Below this many backtest months a horizon's error is shown as indicative only, never as evidence. */
export const ML_MIN_RELIABLE_TESTS = 3;
const key = (h: MlHorizon) => String(h) as `${MlHorizon}`;
export const ML_METRICS = ['credits', 'debits', 'net'] as const;
export type MlMetric = typeof ML_METRICS[number];

const cents = z.number().int().min(0).max(10 ** 15);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const mlRequestSchema = z.strictObject({
    currency: z.string().regex(/^[A-Z]{3}$/),
    months: z.array(z.strictObject({ period, credits: cents, debits: cents })).min(ML_MIN_MONTHS).max(ML_MAX_MONTHS),
});
export type MlRequest = z.infer<typeof mlRequestSchema>;

/** What the Python worker returns. Untrusted: parsed here before anything is shown. */
const point = z.strictObject({ period, credits: cents, debits: cents });
const backtest = z.array(point).min(1).max(ML_MAX_MONTHS);
export const mlWorkerSchema = z.strictObject({
    engine: z.strictObject({ mlforecast: z.string().max(32), xgboost: z.string().max(32), pandas: z.string().max(32), numpy: z.string().max(32), python: z.string().max(32) }),
    config: z.strictObject({
        model: z.literal('XGBRegressor'), params: z.record(z.string(), z.union([z.number(), z.string()])), lags: z.array(z.number().int()).max(12),
        rolling: z.string().max(80), horizons: z.tuple([z.literal(1), z.literal(4), z.literal(6)]), strategy: z.literal('recursive'),
        windows: z.strictObject({ '1': z.number().int().min(1), '4': z.number().int().min(1), '6': z.number().int().min(1) }),
        refit: z.literal(true), perMetric: z.literal(true),
    }),
    /** Months 1 to 6 after the last observed month; every horizon reads its first h months. */
    path: z.array(point).length(ML_MAX_HORIZON),
    /** For horizon h, one entry per test month: the forecast of that month made h months earlier. */
    backtests: z.strictObject({ '1': backtest, '4': backtest, '6': backtest }),
    importance: z.strictObject({ credits: z.record(z.string(), z.number()), debits: z.record(z.string(), z.number()) }),
});
export type MlWorkerResult = z.infer<typeof mlWorkerSchema>;
export const mlWorkerErrorSchema = z.strictObject({ error: z.strictObject({ code: z.enum(['INVALID_JSON', 'REFUSED', 'MISSING_DEPENDENCY', 'MODEL_ERROR']), detail: z.string().max(400) }) });

export type MlRefusalCode = 'BASELINE_UNAVAILABLE' | 'INSUFFICIENT_HISTORY';
/** Builds the worker request from the baseline's own accepted history; null with the reason when ML must not run. */
export function buildMlRequest(forecast: BusinessForecast): { request: MlRequest } | { code: MlRefusalCode; detail: string } {
    if (forecast.forecast.status !== 'AVAILABLE' || !forecast.currency)
        return { code: 'BASELINE_UNAVAILABLE', detail: 'The ML challenger only runs when the deterministic baseline is available, so it inherits its refusals (currency mix, gaps, sign mismatches).' };
    if (forecast.history.length < ML_MIN_MONTHS)
        return { code: 'INSUFFICIENT_HISTORY', detail: `${forecast.history.length} consecutive months found; the ML challenger needs at least ${ML_MIN_MONTHS}.` };
    return { request: { currency: forecast.currency, months: forecast.history.map(m => ({ period: m.period, credits: Number(toCents(m.credits)), debits: Number(toCents(m.debits)) })) } };
}

export type MlWinner = 'ML' | 'BASELINE' | 'TIE';
export type MlMetricScore = { metric: MlMetric; tests: number; mlWape: string | null; baselineWape: string | null; mlMae: string; baselineMae: string; lowerWape: MlWinner | null };
/** One test month for a horizon: the month, the last month known when it was forecast, and what each method said. */
export type MlBacktestPoint = { period: string; madeAfter: string; actual: Record<MlMetric, string>; ml: Record<MlMetric, string>; baseline: Record<MlMetric, string> };
export type MlStep = { period: string; ml: Record<MlMetric, string>; baseline: Record<MlMetric, string> };
export type MlHorizonResult = {
    horizon: MlHorizon; last: string; tests: number; indicative: boolean;
    /** Sum over months 1 to h; the baseline repeats the same average every month. */
    total: { ml: Record<MlMetric, string>; baseline: Record<MlMetric, string> };
    scores: MlMetricScore[]; points: MlBacktestPoint[];
};
export type MlForecastResult = {
    version: typeof ML_FORECAST_VERSION; status: 'AVAILABLE'; currency: string;
    path: MlStep[]; horizons: MlHorizonResult[];
    importance: MlWorkerResult['importance']; engine: MlWorkerResult['engine']; config: MlWorkerResult['config'];
};

const mae = (error: bigint, tests: number) => tests ? (2n * error + BigInt(tests)) / (2n * BigInt(tests)) : 0n;
const abs = (v: bigint) => v < 0n ? -v : v;
const strings = (r: Record<MlMetric, bigint>) => Object.fromEntries(ML_METRICS.map(k => [k, fromCents(r[k])])) as Record<MlMetric, string>;

/**
 * Validates a worker result against the baseline it challenges and scores both on the same months in exact cents.
 * Throws when the worker's months, periods, horizons or window counts do not line up with the baseline, so a mismatched
 * result is never shown. The baseline at every horizon is the same six-month mean of the months known at the origin,
 * so it is flat across the horizon and equals the deterministic backtest at horizon 1.
 */
export function scoreMl(forecast: BusinessForecast, worker: MlWorkerResult): MlForecastResult {
    const base = forecast.forecast;
    if (base.status !== 'AVAILABLE' || !forecast.currency) throw new Error('ML_BASELINE_UNAVAILABLE');
    const history = forecast.history, n = history.length;
    if (worker.config.horizons.join() !== ML_HORIZONS.join()) throw new Error('ML_HORIZON_MISMATCH');

    let expected = nextPeriod(history[n - 1].period);
    if (worker.path[0].period !== base.period) throw new Error('ML_PERIOD_MISMATCH');
    for (const step of worker.path) {
        if (step.period !== expected) throw new Error('ML_PERIOD_MISMATCH');
        expected = nextPeriod(expected);
    }

    const series: Record<MlMetric, bigint[]> = { credits: history.map(m => toCents(m.credits)), debits: history.map(m => toCents(m.debits)), net: history.map(m => toCents(m.net)) };
    const mlOf = (r: { credits: number; debits: number }): Record<MlMetric, bigint> => ({ credits: BigInt(r.credits), debits: BigInt(r.debits), net: BigInt(r.credits) - BigInt(r.debits) });
    const flat: Record<MlMetric, bigint> = { credits: toCents(base.credits), debits: toCents(base.debits), net: toCents(base.net) };
    const path: MlStep[] = worker.path.map(step => ({ period: step.period, ml: strings(mlOf(step)), baseline: strings(flat) }));

    const horizons = ML_HORIZONS.map((h): MlHorizonResult => {
        const rows = worker.backtests[key(h)], first = ML_BACKTEST_START + h - 1, targets = history.slice(first);
        if (rows.length !== targets.length || rows.some((r, i) => r.period !== targets[i].period)) throw new Error('ML_BACKTEST_MONTHS_MISMATCH');
        if (worker.config.windows[key(h)] !== rows.length) throw new Error('ML_WINDOW_MISMATCH');

        const raw = rows.map((r, i) => {
            const t = first + i, origin = t - h + 1;   // months 0..origin-1 were known when month t was forecast
            const baseline = Object.fromEntries(ML_METRICS.map(k => [k, mean(series[k].slice(origin - METHODS.MEAN_6, origin))])) as Record<MlMetric, bigint>;
            return { period: r.period, madeAfter: history[origin - 1].period, actual: { credits: series.credits[t], debits: series.debits[t], net: series.net[t] }, ml: mlOf(r), baseline };
        });
        const scores: MlMetricScore[] = ML_METRICS.map(metric => {
            let mlError = 0n, baseError = 0n, actualSum = 0n;
            for (const p of raw) { mlError += abs(p.ml[metric] - p.actual[metric]); baseError += abs(p.baseline[metric] - p.actual[metric]); actualSum += abs(p.actual[metric]); }
            const mlW = percent(mlError, actualSum), baseW = percent(baseError, actualSum);
            return {
                metric, tests: raw.length, mlWape: basisPoints(mlW), baselineWape: basisPoints(baseW), mlMae: fromCents(mae(mlError, raw.length)), baselineMae: fromCents(mae(baseError, raw.length)),
                lowerWape: mlW === null || baseW === null ? null : mlW < baseW ? 'ML' : mlW > baseW ? 'BASELINE' : 'TIE',
            };
        });
        const steps = worker.path.slice(0, h).map(mlOf), sum = (k: MlMetric) => steps.reduce((a, r) => a + r[k], 0n);
        return {
            horizon: h, last: worker.path[h - 1].period, tests: raw.length, indicative: raw.length < ML_MIN_RELIABLE_TESTS,
            total: { ml: strings({ credits: sum('credits'), debits: sum('debits'), net: sum('net') }), baseline: strings({ credits: flat.credits * BigInt(h), debits: flat.debits * BigInt(h), net: flat.net * BigInt(h) }) },
            scores,
            points: raw.map(p => ({ period: p.period, madeAfter: p.madeAfter, actual: strings(p.actual), ml: strings(p.ml), baseline: strings(p.baseline) })),
        };
    });
    return { version: ML_FORECAST_VERSION, status: 'AVAILABLE', currency: forecast.currency, path, horizons, importance: worker.importance, engine: worker.engine, config: worker.config };
}

export const ML_LIMITATIONS = [
    'Experimental challenger, not the primary forecast: the deterministic six-month mean stays the baseline and both are always shown together.',
    'XGBoost is trained on only the months in the file (12 or more required), so each backtest window fits on a handful of rows. Tree models cannot extrapolate beyond values seen in training.',
    'Longer horizons are forecast recursively: each month feeds the next, so errors compound and the month-by-month path can zigzag or flatten. With 12 months, 1, 4 and 6 months ahead are tested on only 6, 3 and 1 month. Treat the longer horizons as indicative, not evidence.',
    'Hyper-parameters are fixed in advance and were not tuned on the backtest months. A lower backtest error over a few months is not evidence that the model generalizes.',
    'Credits and debits are modelled separately; net is derived as credits minus debits and is the least reliable figure.',
    'No confidence interval is produced. Amounts are bank cash movements, not revenue, profit, expenses or a statutory cash flow statement.',
];
