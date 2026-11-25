/**
 * Cash forecast v2: a category-driven cash plan for the next months, built only from verified bank history.
 *
 * Every category the books use (see lib/cash-classification) gets a monthly series over the verified history.
 * Each series is read by stated rules:
 * - REGULAR: present in at least three quarters of the last twelve months. It is forecast by the six-month average or by
 *   the same month last year scaled by the recent trend, whichever missed less when tested on months already known.
 * - PERIODIC: a fixed gap of 2, 3, 4, 6 or 12 months between occurrences. It is forecast in the months it falls due, at
 *   the average of its last three amounts.
 * - IRREGULAR: present sometimes, with no fixed gap. It is forecast at its monthly average over the last twelve months.
 * - ONE_OFF: seen once or twice, or not explained by the books. It is listed and left out of the forecast.
 *
 * The whole plan is then tested the same way on months already known (rolling origin), which gives its accuracy and
 * the range shown around each month: the average size of its past misses at that distance ahead.
 * Pure and deterministic: integer cents, no I/O, no model.
 */
import { DUPLICATE_BANK, NOT_CLASSIFIED, NOT_IN_BOOKS, activityOf, payeeKey, type Activity, type CashClassification } from '../cash-classification/classify';
import type { SourceRow } from '../poc-anomalies/source';
import { fromCents, toCents } from '../poc-anomalies/source';

export const CASH_FORECAST_VERSION = 'fingence-cash-forecast-v2';
export const MIN_HISTORY = 12;
export const HORIZON = 6;
export type Pattern = 'REGULAR' | 'PERIODIC' | 'IRREGULAR' | 'ONE_OFF';
export type Method = 'SIX_MONTH_AVERAGE' | 'SAME_MONTH_LAST_YEAR' | 'WHEN_DUE' | 'TWELVE_MONTH_AVERAGE' | 'LEFT_OUT';
export const METHOD_LABEL: Record<Method, string> = {
    SIX_MONTH_AVERAGE: 'Average of the last six months', SAME_MONTH_LAST_YEAR: 'Same month last year, adjusted for the recent trend',
    WHEN_DUE: 'Average of its last three amounts, in the months it falls due', TWELVE_MONTH_AVERAGE: 'Monthly average of the last twelve months', LEFT_OUT: 'Not expected to recur; left out',
};
export const PATTERN_LABEL: Record<Pattern, string> = { REGULAR: 'Every month', PERIODIC: 'At fixed intervals', IRREGULAR: 'Now and then', ONE_OFF: 'One-off' };
const UNEXPLAINED = new Set([NOT_IN_BOOKS, NOT_CLASSIFIED, DUPLICATE_BANK]);

export type Series = { key: string; category: string; activity: Activity; direction: 'IN' | 'OUT'; values: bigint[] };
export type CategoryPlan = {
    category: string; activity: Activity; direction: 'IN' | 'OUT'; pattern: Pattern; method: Method; everyMonths: number | null;
    /** Signed cents per forecast month. */
    forecasts: string[];
    occurrences: number; lastSeen: string | null; typical: string;
    /** Steady enough to treat as a commitment: every month with little variation, or due at a fixed interval. */
    committed: boolean;
};
export type ProjectionMonth = { period: string; receipts: string; payments: string; net: string; cumulativeNet: string; range: string | null; balance: string | null; low: string | null; high: string | null };
export type CashForecastPlan =
    | {
        version: typeof CASH_FORECAST_VERSION; status: 'AVAILABLE'; currency: string;
        history: { period: string; receipts: string; payments: string; net: string; balance: string | null }[];
        categories: CategoryPlan[]; projection: ProjectionMonth[];
        oneOffs: { category: string; direction: 'IN' | 'OUT'; total: string; months: string[] }[];
        /** Steady or scheduled payments over the next three months: amount is their three-month total. */
        commitments: { months: string[]; items: { category: string; amount: string; pattern: Pattern; everyMonths: number | null; months: string[] }[]; total: string };
        accuracy: { tests: number; receiptsWape: string | null; paymentsWape: string | null; netMiss: string; baseline: { receiptsWape: string | null; paymentsWape: string | null; netMiss: string } } | null;
        balanceSource: string | null;
    }
    | { version: typeof CASH_FORECAST_VERSION; status: 'UNAVAILABLE'; reason: string };

const abs = (v: bigint) => v < 0n ? -v : v;
const sum = (v: bigint[]) => v.reduce((t, x) => t + x, 0n);
/** Integer mean rounded half away from zero. */
function mean(v: bigint[]) {
    if (!v.length) return 0n;
    const s = sum(v), n = BigInt(v.length), q = (2n * abs(s) + n) / (2n * n);
    return s < 0n ? -q : q;
}
function median(v: bigint[]) {
    const x = [...v].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), n = x.length;
    return n === 0 ? 0n : n % 2 ? x[(n - 1) / 2] : (x[n / 2 - 1] + x[n / 2]) / 2n;
}
const wape = (error: bigint, actual: bigint) => actual === 0n ? null : (() => { const bp = (error * 20000n + actual) / (2n * actual); return `${bp / 100n}.${(bp % 100n).toString().padStart(2, '0')}`; })();
export function addMonths(period: string, n: number) {
    const [y, m] = period.split('-').map(Number), i = y * 12 + (m - 1) + n;
    return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Monthly series per category and direction: statement months from the classification, earlier months by payee. */
export function categorySeries(k: CashClassification, historyRows: SourceRow[], months: string[]): Series[] {
    const map = new Map<string, Series>(), index = new Map(months.map((m, i) => [m, i]));
    const add = (category: string, activity: Activity, signed: bigint, period: string) => {
        const i = index.get(period); if (i === undefined || signed === 0n) return;
        const direction = signed < 0n ? 'OUT' : 'IN', key = `${category} · ${direction}`;
        const s = map.get(key) ?? { key, category, activity, direction, values: months.map(() => 0n) };
        s.values[i] += signed; map.set(key, s);
    };
    const current = new Set(k.current.months);
    for (const r of k.rows) add(r.category, r.activity, BigInt(r.signedCents), r.period);
    for (const r of historyRows) {
        if (current.has(r.period)) continue;
        const signed = toCents(r.signedAmount), category = k.payees[payeeKey(r.counterparty, signed)] ?? NOT_CLASSIFIED;
        add(category, category === NOT_CLASSIFIED ? 'OPERATING' : activityOf(category), signed, r.period);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The gap between occurrences when it is always the same allowed interval. */
function cycle(values: bigint[]): number | null {
    const at = values.map((v, i) => v !== 0n ? i : -1).filter(i => i >= 0);
    if (at.length < 2) return null;
    const gaps = at.slice(1).map((v, i) => v - at[i]);
    return gaps.every(g => g === gaps[0]) && [2, 3, 4, 6, 12].includes(gaps[0]) && values.length - 1 - at.at(-1)! < gaps[0] ? gaps[0] : null;
}
const trend = (v: bigint[], o: number) => { const recent = sum(v.slice(o - 3, o)), year = sum(v.slice(o - 15, o - 12)); return year === 0n ? null : { recent, year }; };
/** Same month last year scaled by the recent trend, the scale clamped to 0.5–2. */
function seasonal(v: bigint[], o: number, h: number): bigint | null {
    // Two full years known: the last twelve months against the twelve before; otherwise the last three against a year earlier.
    const t = o >= 24 && sum(v.slice(o - 24, o - 12)) !== 0n ? { recent: sum(v.slice(o - 12, o)), year: sum(v.slice(o - 24, o - 12)) } : trend(v, o), base = v[o + h - 1 - 12];
    if (!t || o < 15 || base === undefined) return null;
    let num = t.recent, den = t.year; if (den < 0n) { num = -num; den = -den; }
    const lo = den / 2n, hi = den * 2n; if (num < lo) num = lo; if (num > hi) num = hi;
    const q = (2n * abs(base * num) + den) / (2n * den);
    return base * num < 0n ? -q : q;
}

/** Plans one series from its first `o` months: pattern, method and the next `h` months. */
function planSeries(s: Series, o: number, h: number, months: string[]): CategoryPlan {
    const v = s.values.slice(0, o), window = v.slice(-12), occ = window.filter(x => x !== 0n).length, all = v.filter(x => x !== 0n).length;
    const base = { category: s.category, activity: s.activity, direction: s.direction, occurrences: all, lastSeen: (() => { const i = v.findLastIndex(x => x !== 0n); return i < 0 ? null : months[i]; })() };
    const leaveOut = (pattern: Pattern): CategoryPlan => ({ ...base, pattern, method: 'LEFT_OUT', everyMonths: null, forecasts: Array(h).fill('0.00'), typical: fromCents(mean(v.filter(x => x !== 0n))), committed: false });
    if (UNEXPLAINED.has(s.category) || all === 0) return leaveOut('ONE_OFF');
    if (occ * 4 >= window.length * 3) {
        const avg = (oo: number) => mean(v.slice(Math.max(0, oo - 6), oo));
        // Pick the method by its one-month-ahead misses on the months already known.
        let errAvg = 0n, errSea = 0n, tests = 0;
        for (let t = 15; t < o; t++) { const se = seasonal(v, t, 1); if (se === null) continue; errAvg += abs(v[t] - avg(t)); errSea += abs(v[t] - se); tests++; }
        const useSeasonal = tests >= 3 && errSea < errAvg && Array.from({ length: h }, (_, i) => seasonal(v, o, i + 1)).every(x => x !== null);
        const forecasts = Array.from({ length: h }, (_, i) => useSeasonal ? seasonal(v, o, i + 1)! : avg(o));
        // Steady: paid in each of the last six months, and a typical month within 10% of the usual amount (median based,
        // so one bonus or catch-up month does not hide a commitment).
        const recent = v.slice(-6), med = median(recent), spread = med === 0n ? 100n : (median(recent.map(x => abs(x - med))) * 100n) / abs(med);
        return { ...base, pattern: 'REGULAR', method: useSeasonal ? 'SAME_MONTH_LAST_YEAR' : 'SIX_MONTH_AVERAGE', everyMonths: 1, forecasts: forecasts.map(fromCents), typical: fromCents(avg(o)), committed: recent.every(x => x !== 0n) && spread <= 10n };
    }
    const g = cycle(v);
    if (g) {
        const amounts = v.filter(x => x !== 0n).slice(-3), amount = mean(amounts), last = v.findLastIndex(x => x !== 0n);
        return { ...base, pattern: 'PERIODIC', method: 'WHEN_DUE', everyMonths: g, forecasts: Array.from({ length: h }, (_, i) => (o + i - last) % g === 0 ? fromCents(amount) : '0.00'), typical: fromCents(amount), committed: true };
    }
    if (all <= 2) return leaveOut('ONE_OFF');
    const avg12 = mean(window);
    return { ...base, pattern: 'IRREGULAR', method: 'TWELVE_MONTH_AVERAGE', everyMonths: null, forecasts: Array(h).fill(fromCents(avg12)), typical: fromCents(mean(window.filter(x => x !== 0n))), committed: false };
}

function totals(plans: CategoryPlan[], h: number) {
    return Array.from({ length: h }, (_, i) => {
        let inn = 0n, out = 0n;
        for (const p of plans) { const f = toCents(p.forecasts[i]); if (f > 0n) inn += f; else out += f; }
        return { receipts: inn, payments: out, net: inn + out };
    });
}

/**
 * The cash plan. `historyRows` and `months` are the verified, consecutive history; `closing` is the verified month-end
 * bank balance per month when the history states running balances that agree with its records.
 */
export function planCash(input: { classification: CashClassification; historyRows: SourceRow[]; months: string[]; currency: string; closing?: Record<string, bigint> | null; balanceSource?: string | null }): CashForecastPlan {
    const { months } = input, n = months.length;
    const consecutive = months.every((m, i) => i === 0 || addMonths(months[i - 1], 1) === m);
    if (n < MIN_HISTORY || !consecutive) return { version: CASH_FORECAST_VERSION, status: 'UNAVAILABLE', reason: `The cash plan needs at least ${MIN_HISTORY} consecutive months of verified bank history; ${n} ${consecutive ? '' : 'non-consecutive '}month${n === 1 ? '' : 's'} available.` };
    const series = categorySeries(input.classification, input.historyRows, months);
    const actual = months.map((_, i) => { let inn = 0n, out = 0n; for (const s of series) { const v = s.values[i]; if (v > 0n) inn += v; else out += v; } return { receipts: inn, payments: out, net: inn + out }; });

    // Test the whole plan on months already known: each origin plans only from the months before it.
    const firstOrigin = Math.max(7, n - 12), missByH = Array.from({ length: HORIZON }, () => [] as bigint[]);
    let eIn = 0n, eOut = 0n, aIn = 0n, aOut = 0n, eNet = 0n, bIn = 0n, bOut = 0n, bNet = 0n, tests = 0;
    for (let o = firstOrigin; o < n; o++) {
        const h = Math.min(HORIZON, n - o), t = totals(series.map(s => planSeries(s, o, h, months)), h);
        let cumulative = 0n;
        for (let j = 0; j < h; j++) { cumulative += actual[o + j].net - t[j].net; missByH[j].push(abs(cumulative)); }
        const a = actual[o], f = t[0], bi = mean(actual.slice(o - 6, o).map(x => x.receipts)), bo = mean(actual.slice(o - 6, o).map(x => x.payments));
        eIn += abs(a.receipts - f.receipts); eOut += abs(a.payments - f.payments); eNet += abs(a.net - f.net); aIn += a.receipts; aOut += abs(a.payments);
        bIn += abs(a.receipts - bi); bOut += abs(a.payments - bo); bNet += abs(a.net - (bi + bo)); tests++;
    }
    const range = missByH.map(list => list.length >= 3 ? mean(list) : null);

    const plans = series.map(s => planSeries(s, n, HORIZON, months)), projected = totals(plans, HORIZON), last = months[n - 1];
    const opening = input.closing?.[last] ?? null;
    let cumulative = 0n;
    const projection: ProjectionMonth[] = projected.map((p, i) => {
        cumulative += p.net; const r = range[i], balance = opening === null ? null : opening + cumulative;
        return { period: addMonths(last, i + 1), receipts: fromCents(p.receipts), payments: fromCents(p.payments), net: fromCents(p.net), cumulativeNet: fromCents(cumulative), range: r === null ? null : fromCents(r), balance: balance === null ? null : fromCents(balance), low: balance === null || r === null ? null : fromCents(balance - r), high: balance === null || r === null ? null : fromCents(balance + r) };
    });
    // Steady and scheduled payments over the next three months: what is already as good as committed.
    const window = projection.slice(0, 3).map(p => p.period);
    const committed = plans.filter(p => p.committed && p.direction === 'OUT').map(p => ({ category: p.category, pattern: p.pattern, everyMonths: p.everyMonths, months: window.filter((_, i) => toCents(p.forecasts[i]) !== 0n), amount: fromCents(sum(p.forecasts.slice(0, 3).map(toCents))) }))
        .filter(p => p.months.length).sort((a, b) => Number(toCents(a.amount) - toCents(b.amount)));
    const oneOffs = series.flatMap(s => { const p = plans.find(x => x.category === s.category && x.direction === s.direction)!; return p.pattern === 'ONE_OFF' ? [{ category: s.category, direction: s.direction, total: fromCents(sum(s.values.slice(-12))), months: s.values.map((v, i) => v !== 0n ? months[i] : '').filter(m => m && m >= addMonths(last, -11)) }] : []; }).filter(x => x.months.length);
    const order = (p: CategoryPlan) => abs(sum(p.forecasts.map(toCents)));
    return {
        version: CASH_FORECAST_VERSION, status: 'AVAILABLE', currency: input.currency,
        history: months.map((period, i) => ({ period, receipts: fromCents(actual[i].receipts), payments: fromCents(actual[i].payments), net: fromCents(actual[i].net), balance: input.closing?.[period] === undefined ? null : fromCents(input.closing[period]) })),
        categories: plans.sort((a, b) => (a.pattern === 'ONE_OFF' ? 1 : 0) - (b.pattern === 'ONE_OFF' ? 1 : 0) || (order(b) > order(a) ? 1 : order(b) < order(a) ? -1 : a.category.localeCompare(b.category))),
        projection, oneOffs,
        commitments: { months: window, items: committed, total: fromCents(sum(committed.map(c => toCents(c.amount)))) },
        accuracy: tests ? { tests, receiptsWape: wape(eIn, aIn), paymentsWape: wape(eOut, aOut), netMiss: fromCents(eNet / BigInt(tests)), baseline: { receiptsWape: wape(bIn, aIn), paymentsWape: wape(bOut, aOut), netMiss: fromCents(bNet / BigInt(tests)) } } : null,
        balanceSource: opening === null ? null : input.balanceSource ?? null,
    };
}

/**
 * Month-end bank balances from a history file's running balance column, only when the records are in date order and
 * every record's balance equals the previous balance plus its own signed amount. Otherwise null: a balance is never assumed.
 */
export function verifiedClosingBalances(raw: Record<string, string>[], rows: SourceRow[]): Record<string, bigint> | null {
    const column = ['RunningBalanceMYR', 'RunningBalance', 'Balance'].find(c => raw.length && c in raw[0]);
    if (!column || raw.length !== rows.length) return null;
    const out: Record<string, bigint> = {};
    let previous: bigint | null = null, lastDate = '';
    for (const [i, r] of rows.entries()) {
        // Month-end balances need the records in date order: a record dated before the one above it means the last
        // balance listed in a month need not be that month's closing balance.
        if (r.date < lastDate || r.period !== r.date.slice(0, 7)) return null;
        lastDate = r.date;
        const text = (raw[i][column] ?? '').trim();
        if (!/^-?\d{1,14}(?:\.\d{1,2})?$/.test(text)) return null;
        const [whole, fraction = ''] = text.split('.'), balance = toCents(`${whole}.${fraction.padEnd(2, '0')}`), signed = toCents(r.signedAmount);
        if (previous !== null && balance !== previous + signed) return null;
        previous = balance; out[r.period] = balance;
    }
    return out;
}
