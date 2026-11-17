import { z } from 'zod';
import { fromCents, toCents } from '../poc-anomalies/source';
import { basisPoints, nextPeriod, percent, type BusinessForecast, type MonthTotals } from './forecast';

/**
 * Experimental MLForecast + XGBoost challenger to the deterministic six-month-mean baseline.
 * The model runs in `scripts/ml_forecast.py`; this module is pure and client-safe. It builds the request,
 * validates the untrusted result and scores it in exact integer cents with the baseline's own WAPE/MAE maths.
 * The baseline stays the primary forecast; the challenger is shown beside it and never replaces it.
 */
export const ML_FORECAST_VERSION = 'ml-xgboost-forecast-v1';
export const ML_MIN_MONTHS = 12;
export const ML_MAX_MONTHS = 120;
/** Must equal BACKTEST_START in scripts/ml_forecast.py and forecast.ts: both methods are scored on the same months. */
export const ML_BACKTEST_START = 6;
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
export const mlWorkerSchema = z.strictObject({
    engine: z.strictObject({ mlforecast: z.string().max(32), xgboost: z.string().max(32), pandas: z.string().max(32), numpy: z.string().max(32), python: z.string().max(32) }),
    config: z.strictObject({
        model: z.literal('XGBRegressor'), params: z.record(z.string(), z.union([z.number(), z.string()])), lags: z.array(z.number().int()).max(12),
        rolling: z.string().max(80), windows: z.number().int().min(1), horizon: z.literal(1), refit: z.literal(true), perMetric: z.literal(true),
    }),
    next: z.strictObject({ period, credits: cents, debits: cents }),
    backtest: z.array(z.strictObject({ period, credits: cents, debits: cents })).min(1).max(ML_MAX_MONTHS),
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
export type MlBacktestPoint = { period: string; actual: Record<MlMetric, string>; ml: Record<MlMetric, string>; baseline: Record<MlMetric, string> };
export type MlForecastResult = {
    version: typeof ML_FORECAST_VERSION; status: 'AVAILABLE'; period: string; currency: string; credits: string; debits: string; net: string;
    tests: number; scores: MlMetricScore[]; points: MlBacktestPoint[]; importance: MlWorkerResult['importance']; engine: MlWorkerResult['engine']; config: MlWorkerResult['config'];
};

const mae = (error: bigint, tests: number) => tests ? (2n * error + BigInt(tests)) / (2n * BigInt(tests)) : 0n;
const abs = (v: bigint) => v < 0n ? -v : v;

/**
 * Validates a worker result against the baseline it challenges and scores both on the same months in exact cents.
 * Throws when the worker's months, period or counts do not line up with the baseline, so a mismatched result is never shown.
 */
export function scoreMl(forecast: BusinessForecast, worker: MlWorkerResult): MlForecastResult {
    const base = forecast.forecast;
    if (base.status !== 'AVAILABLE' || !forecast.currency) throw new Error('ML_BASELINE_UNAVAILABLE');
    const tested = forecast.history.slice(ML_BACKTEST_START);
    if (worker.backtest.length !== tested.length || worker.backtest.some((p, i) => p.period !== tested[i].period)) throw new Error('ML_BACKTEST_MONTHS_MISMATCH');
    if (worker.next.period !== nextPeriod(forecast.history.at(-1)!.period) || worker.next.period !== base.period) throw new Error('ML_PERIOD_MISMATCH');
    if (worker.config.windows !== tested.length) throw new Error('ML_WINDOW_MISMATCH');

    const actual = (m: MonthTotals): Record<MlMetric, bigint> => ({ credits: toCents(m.credits), debits: toCents(m.debits), net: toCents(m.net) });
    const mlAt = (i: number): Record<MlMetric, bigint> => { const p = worker.backtest[i]; return { credits: BigInt(p.credits), debits: BigInt(p.debits), net: BigInt(p.credits) - BigInt(p.debits) }; };
    const points: MlBacktestPoint[] = tested.map((m, i) => {
        const a = actual(m), ml = mlAt(i), at = (metric: MlMetric) => base.backtest[metric].points.find(p => p.period === m.period);
        if (!at('credits') || !at('debits') || !at('net')) throw new Error('ML_BASELINE_POINT_MISSING');
        const s = (r: Record<MlMetric, bigint>) => Object.fromEntries(ML_METRICS.map(k => [k, fromCents(r[k])])) as Record<MlMetric, string>;
        return { period: m.period, actual: s(a), ml: s(ml), baseline: Object.fromEntries(ML_METRICS.map(k => [k, at(k)!.forecasts.MEAN_6])) as Record<MlMetric, string> };
    });
    const scores: MlMetricScore[] = ML_METRICS.map(metric => {
        let mlError = 0n, baseError = 0n, actualSum = 0n;
        points.forEach(p => {
            const a = toCents(p.actual[metric]);
            mlError += abs(toCents(p.ml[metric]) - a); baseError += abs(toCents(p.baseline[metric]) - a); actualSum += abs(a);
        });
        const mlW = percent(mlError, actualSum), baseW = percent(baseError, actualSum);
        return {
            metric, tests: points.length, mlWape: basisPoints(mlW), baselineWape: basisPoints(baseW), mlMae: fromCents(mae(mlError, points.length)), baselineMae: fromCents(mae(baseError, points.length)),
            lowerWape: mlW === null || baseW === null ? null : mlW < baseW ? 'ML' : mlW > baseW ? 'BASELINE' : 'TIE',
        };
    });
    const credits = BigInt(worker.next.credits), debits = BigInt(worker.next.debits);
    return {
        version: ML_FORECAST_VERSION, status: 'AVAILABLE', period: worker.next.period, currency: forecast.currency,
        credits: fromCents(credits), debits: fromCents(debits), net: fromCents(credits - debits), tests: points.length,
        scores, points, importance: worker.importance, engine: worker.engine, config: worker.config,
    };
}

export const ML_LIMITATIONS = [
    'Experimental challenger, not the primary forecast: the deterministic six-month mean stays the baseline and both are always shown together.',
    'XGBoost is trained on only the months in the file (12 or more required), so each backtest window fits on a handful of rows. Tree models cannot extrapolate beyond values seen in training.',
    'Hyper-parameters are fixed in advance and were not tuned on the backtest months. A lower backtest error over a few months is not evidence that the model generalizes.',
    'Credits and debits are modelled separately; net is derived as credits minus debits and is the least reliable figure.',
    'No confidence interval is produced. Amounts are bank cash movements, not revenue, profit, expenses or a statutory cash flow statement.',
];
