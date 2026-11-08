import { fromCents, toCents, type SourceRow } from '../poc-anomalies/source';

/**
 * Deterministic monthly bank cash baseline for one business: exact integer cents, no model, no library.
 * Credits are bank cash receipts, debits are bank payment magnitudes and net is credits minus debits.
 * None of these is revenue, profit, expense or a statutory cash flow statement.
 */
export const FORECAST_VERSION = 'poc-cash-forecast-v1';
export const MIN_MONTHS = 7;
/** Rolling-origin tests forecast month 7 onward, so every method is scored on the same months. */
export const BACKTEST_START = 6;
export const METHODS = { LAST_MONTH: 1, MEAN_3: 3, MEAN_6: 6 } as const;
export const PRIMARY_METHOD = 'MEAN_6' satisfies Method;
export const METRICS = ['credits', 'debits', 'net'] as const;
export type Method = keyof typeof METHODS;
export type Metric = typeof METRICS[number];
export type ForecastRow = Pick<SourceRow, 'businessId' | 'currency' | 'period' | 'direction' | 'amount' | 'signedAmount'>;
export type MonthTotals = { period: string; rows: number; creditRows: number; debitRows: number; credits: string; debits: string; net: string };
export type ForecastRefusal = 'NO_ROWS' | 'CURRENCY_MIX' | 'SIGN_CONVENTION' | 'NONCONSECUTIVE_MONTHS' | 'INSUFFICIENT_HISTORY';
export type MethodScore = { method: Method; window: number; tests: number; absoluteError: string; absoluteActual: string; wape: string | null; mae: string; wapeChangeVsLastMonth: string | null };
export type BacktestPoint = { period: string; actual: string; forecasts: Record<Method, string> };
export type MetricBacktest = { metric: Metric; methods: MethodScore[]; lowestWape: Method | null; points: BacktestPoint[] };
export type Forecast =
    | { status: 'AVAILABLE'; period: string; method: typeof PRIMARY_METHOD; basis: { first: string; last: string; months: number }; credits: string; debits: string; net: string; tests: number; backtest: Record<Metric, MetricBacktest> }
    | { status: 'UNAVAILABLE'; code: ForecastRefusal; detail: string };
export type BusinessForecast = { version: typeof FORECAST_VERSION; currency: string | null; history: MonthTotals[]; interval: { first: string; last: string; months: number } | null; forecast: Forecast };

const methods = Object.keys(METHODS) as Method[];
/** Integer mean rounded half away from zero, to the cent. */
function mean(values: bigint[]) {
    const sum = values.reduce((a, b) => a + b, 0n), n = BigInt(values.length), abs = sum < 0n ? -sum : sum, q = (2n * abs + n) / (2n * n);
    return sum < 0n ? -q : q;
}
/** Percentage with two decimals, rounded half up; null when the denominator is zero. */
function percent(numerator: bigint, denominator: bigint) {
    return denominator === 0n ? null : (2n * 10000n * numerator + denominator) / (2n * denominator);
}
const basisPoints = (value: bigint | null) => value === null ? null : `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${((value < 0n ? -value : value) % 100n).toString().padStart(2, '0')}`;
export function nextPeriod(period: string) {
    const [y, m] = period.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
const unavailable = (code: ForecastRefusal, detail: string): Forecast => ({ status: 'UNAVAILABLE', code, detail });

/** Scores every method on every month from BACKTEST_START, each forecast using only earlier months. */
function backtest(series: bigint[], periods: string[], metric: Metric): MetricBacktest {
    const points: BacktestPoint[] = [], sums = Object.fromEntries(methods.map(m => [m, 0n])) as Record<Method, bigint>;
    let actualSum = 0n;
    for (let t = BACKTEST_START; t < series.length; t++) {
        const forecasts = Object.fromEntries(methods.map(m => [m, mean(series.slice(t - METHODS[m], t))])) as Record<Method, bigint>;
        for (const m of methods) sums[m] += forecasts[m] > series[t] ? forecasts[m] - series[t] : series[t] - forecasts[m];
        actualSum += series[t] < 0n ? -series[t] : series[t];
        points.push({ period: periods[t], actual: fromCents(series[t]), forecasts: Object.fromEntries(methods.map(m => [m, fromCents(forecasts[m])])) as Record<Method, string> });
    }
    return { metric, points, ...score(Object.fromEntries(methods.map(m => [m, { error: sums[m], actual: actualSum, tests: points.length }])) as Record<Method, Totals>) };
}
type Totals = { error: bigint; actual: bigint; tests: number };
function score(totals: Record<Method, Totals>) {
    const wape = Object.fromEntries(methods.map(m => [m, percent(totals[m].error, totals[m].actual)])) as Record<Method, bigint | null>;
    const scores: MethodScore[] = methods.map(m => ({
        method: m, window: METHODS[m], tests: totals[m].tests, absoluteError: fromCents(totals[m].error), absoluteActual: fromCents(totals[m].actual),
        wape: basisPoints(wape[m]), mae: fromCents(totals[m].tests ? (2n * totals[m].error + BigInt(totals[m].tests)) / (2n * BigInt(totals[m].tests)) : 0n),
        wapeChangeVsLastMonth: wape[m] === null || wape.LAST_MONTH === null ? null : basisPoints(wape[m]! - wape.LAST_MONTH),
    }));
    const ranked = methods.filter(m => wape[m] !== null).sort((a, b) => Number(wape[a]! - wape[b]!));
    // A tie is reported as no single lowest method rather than favouring the longer window.
    const lowestWape = ranked.length && (ranked.length === 1 || wape[ranked[0]] !== wape[ranked[1]]) ? ranked[0] : null;
    return { methods: scores, lowestWape };
}

/** One business's rows (any order). Refuses rather than inventing months, currencies or signs. */
export function forecastBusiness(rows: ForecastRow[]): BusinessForecast {
    const base = { version: FORECAST_VERSION, currency: null, history: [], interval: null } satisfies Omit<BusinessForecast, 'forecast'>;
    if (!rows.length) return { ...base, forecast: unavailable('NO_ROWS', 'No source rows for this business.') };
    const currencies = [...new Set(rows.map(r => r.currency))].sort();
    if (currencies.length > 1) return { ...base, forecast: unavailable('CURRENCY_MIX', `Rows use ${currencies.length} currencies (${currencies.join(', ')}); amounts are never converted or combined.`) };
    const signs = rows.filter(r => toCents(r.signedAmount) !== (r.direction === 'Credit' ? 1n : -1n) * toCents(r.amount)).length;
    if (signs) return { ...base, currency: currencies[0], forecast: unavailable('SIGN_CONVENTION', `${signs} row${signs === 1 ? '' : 's'} have a signed amount that does not match the bank direction (credits positive, debits negative).`) };
    const byPeriod = new Map<string, { rows: number; creditRows: number; debitRows: number; credits: bigint; debits: bigint }>();
    for (const r of rows) {
        const m = byPeriod.get(r.period) ?? { rows: 0, creditRows: 0, debitRows: 0, credits: 0n, debits: 0n }, v = toCents(r.signedAmount);
        m.rows++;
        if (r.direction === 'Credit') { m.creditRows++; m.credits += v; } else { m.debitRows++; m.debits -= v; }
        byPeriod.set(r.period, m);
    }
    const periods = [...byPeriod.keys()].sort(), months = periods.map(p => byPeriod.get(p)!);
    const history = periods.map((period, i) => ({ period, rows: months[i].rows, creditRows: months[i].creditRows, debitRows: months[i].debitRows, credits: fromCents(months[i].credits), debits: fromCents(months[i].debits), net: fromCents(months[i].credits - months[i].debits) }));
    const interval = { first: periods[0], last: periods.at(-1)!, months: periods.length }, known = { ...base, currency: currencies[0], history, interval };
    const gaps = periods.slice(1).filter((p, i) => p !== nextPeriod(periods[i]));
    if (gaps.length) return { ...known, forecast: unavailable('NONCONSECUTIVE_MONTHS', `Source months are not consecutive (gap before ${gaps.join(', ')}); missing months are never filled in.`) };
    if (periods.length < MIN_MONTHS) return { ...known, forecast: unavailable('INSUFFICIENT_HISTORY', `${periods.length} consecutive month${periods.length === 1 ? '' : 's'} found; at least ${MIN_MONTHS} are required so the six-month baseline can be backtested.`) };
    const credits = months.map(m => m.credits), debits = months.map(m => m.debits), net = months.map(m => m.credits - m.debits);
    const window = METHODS[PRIMARY_METHOD], nextCredits = mean(credits.slice(-window)), nextDebits = mean(debits.slice(-window));
    return {
        ...known,
        forecast: {
            status: 'AVAILABLE', period: nextPeriod(interval.last), method: PRIMARY_METHOD, basis: { first: periods.at(-window)!, last: interval.last, months: window },
            credits: fromCents(nextCredits), debits: fromCents(nextDebits), net: fromCents(nextCredits - nextDebits), tests: periods.length - BACKTEST_START,
            backtest: { credits: backtest(credits, periods, 'credits'), debits: backtest(debits, periods, 'debits'), net: backtest(net, periods, 'net') },
        },
    };
}

/** Pools backtest errors across businesses that share one currency. Large businesses dominate the result. */
export function poolBacktests(results: BusinessForecast[]): Record<Metric, Omit<MetricBacktest, 'points'>> | null {
    const available = results.filter(r => r.forecast.status === 'AVAILABLE');
    if (!available.length || new Set(available.map(r => r.currency)).size !== 1) return null;
    return Object.fromEntries(METRICS.map(metric => {
        const totals = Object.fromEntries(methods.map(m => [m, { error: 0n, actual: 0n, tests: 0 }])) as Record<Method, Totals>;
        for (const r of available) {
            if (r.forecast.status !== 'AVAILABLE') continue;
            for (const s of r.forecast.backtest[metric].methods) { totals[s.method].error += toCents(s.absoluteError); totals[s.method].actual += toCents(s.absoluteActual); totals[s.method].tests += s.tests; }
        }
        return [metric, { metric, ...score(totals) }];
    })) as Record<Metric, Omit<MetricBacktest, 'points'>>;
}
