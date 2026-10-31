import { describe, expect, it } from 'vitest';
import { forecastBusiness, nextPeriod, poolBacktests, type ForecastRow } from '../../lib/poc-forecast/forecast';

/** One credit and one debit per month; values in cents. */
function months(start: string, credits: number[], debits: number[], extra: Partial<ForecastRow> = {}): ForecastRow[] {
    const rows: ForecastRow[] = [];
    let period = start;
    credits.forEach((c, i) => {
        const money = (v: number) => (v / 100).toFixed(2);
        rows.push({ businessId: 'BUS-T', currency: 'MYR', period, direction: 'Credit', amount: money(c), signedAmount: money(c), ...extra });
        rows.push({ businessId: 'BUS-T', currency: 'MYR', period, direction: 'Debit', amount: money(debits[i]), signedAmount: '-' + money(debits[i]), ...extra });
        period = nextPeriod(period);
    });
    return rows;
}
const twelve = months('2025-09', [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100].map(v => v * 100), Array(12).fill(50000));
const available = (rows: ForecastRow[]) => { const r = forecastBusiness(rows); if (r.forecast.status !== 'AVAILABLE') throw new Error(r.forecast.code); return { ...r, forecast: r.forecast }; };

describe('monthly bank cash baseline', () => {
    it('aggregates exact cents per month, keeping debits as positive payment magnitudes and net as their difference', () => {
        const r = forecastBusiness([...twelve, { businessId: 'BUS-T', currency: 'MYR', period: '2025-09', direction: 'Debit', amount: '0.10', signedAmount: '-0.10' }, { businessId: 'BUS-T', currency: 'MYR', period: '2025-09', direction: 'Credit', amount: '0.20', signedAmount: '0.20' }]);
        expect(r.history[0]).toEqual({ period: '2025-09', rows: 4, creditRows: 2, debitRows: 2, credits: '1000.20', debits: '500.10', net: '500.10' });
        expect(r.interval).toEqual({ first: '2025-09', last: '2026-08', months: 12 });
    });
    it('forecasts the next month from the previous six months only and derives net as credits minus debits', () => {
        const r = available(twelve);
        expect(r.forecast).toMatchObject({ period: '2026-09', method: 'MEAN_6', basis: { first: '2026-03', last: '2026-08', months: 6 }, credits: '1850.00', debits: '500.00', net: '1350.00', tests: 6 });
    });
    it('rounds means half away from zero to the cent and carries negative net movement', () => {
        const r = available(months('2025-01', [1, 1, 1, 1, 1, 1, 2], [0, 0, 0, 0, 0, 3, 4]));
        // Last six credits: 1,1,1,1,1,2 = 7/6 = 1.1667 -> 1 cent; debits 0,0,0,0,3,4 = 7/6 -> 1 cent.
        expect([r.forecast.credits, r.forecast.debits, r.forecast.net]).toEqual(['0.01', '0.01', '0.00']);
        const loss = available(months('2025-01', Array(7).fill(10000), Array(7).fill(10001)));
        expect([loss.forecast.net, loss.history.at(-1)!.net]).toEqual(['-0.01', '-0.01']);
        const half = available(months('2025-01', [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 2]));
        expect(half.forecast.backtest.debits.points[0].forecasts.MEAN_3).toBe('0.00'); // 1/3 cent rounds to 0
        const exact = available(months('2025-01', Array(7).fill(0), [0, 0, 0, 0, 1, 2, 0])).forecast.backtest;
        expect(exact.debits.points[0].forecasts.MEAN_3).toBe('0.01'); // mean of 0,1,2 cents
        expect(exact.debits.points[0].forecasts.MEAN_6).toBe('0.01'); // 3/6 = half a cent rounds up
        expect(exact.net.points[0].forecasts.MEAN_6).toBe('-0.01'); // and a negative half rounds away from zero
    });
    it('scores every method on the same rolling-origin months with WAPE, MAE and the change from last month', () => {
        const r = available(twelve), credits = r.forecast.backtest.credits;
        expect(credits.points.map(p => p.period)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
        expect(credits.points[0]).toEqual({ period: '2026-03', actual: '1600.00', forecasts: { LAST_MONTH: '1500.00', MEAN_3: '1400.00', MEAN_6: '1250.00' } });
        // Linear growth of 100: errors 100, 200, 350 every month over actuals 1600..2100 (sum 11100).
        expect(credits.methods).toEqual([
            { method: 'LAST_MONTH', window: 1, tests: 6, absoluteError: '600.00', absoluteActual: '11100.00', wape: '5.41', mae: '100.00', wapeChangeVsLastMonth: '0.00' },
            { method: 'MEAN_3', window: 3, tests: 6, absoluteError: '1200.00', absoluteActual: '11100.00', wape: '10.81', mae: '200.00', wapeChangeVsLastMonth: '5.40' },
            { method: 'MEAN_6', window: 6, tests: 6, absoluteError: '2100.00', absoluteActual: '11100.00', wape: '18.92', mae: '350.00', wapeChangeVsLastMonth: '13.51' },
        ]);
        expect(credits.lowestWape).toBe('LAST_MONTH');
        expect(r.forecast.backtest.debits.methods.every(m => m.wape === '0.00')).toBe(true);
        expect(r.forecast.backtest.debits.lowestWape).toBeNull(); // a tie never favours a method
    });
    it('never lets a later month influence an earlier backtest forecast', () => {
        const base = available(twelve), changed = [...twelve];
        changed[22] = { ...changed[22], amount: '999999.00', signedAmount: '999999.00' }; // 2026-08 credit
        const after = available(changed);
        expect(after.forecast.backtest.credits.points.slice(0, 5)).toEqual(base.forecast.backtest.credits.points.slice(0, 5));
        expect(after.forecast.backtest.credits.points[5].forecasts).toEqual(base.forecast.backtest.credits.points[5].forecasts);
        // Months before the six-month basis never change the next-month forecast.
        const early = [...twelve];
        early[0] = { ...early[0], amount: '999999.00', signedAmount: '999999.00' };
        expect(available(early).forecast.credits).toBe(base.forecast.credits);
    });
    it('refuses a March-only file, short history and non-consecutive months without filling gaps', () => {
        const march = forecastBusiness(months('2026-03', [100000], [50000]));
        expect(march.forecast).toMatchObject({ status: 'UNAVAILABLE', code: 'INSUFFICIENT_HISTORY' });
        expect(march.history).toHaveLength(1);
        expect(forecastBusiness(months('2026-01', Array(6).fill(1), Array(6).fill(1))).forecast).toMatchObject({ code: 'INSUFFICIENT_HISTORY' });
        const gap = twelve.filter(r => r.period !== '2026-01');
        const r = forecastBusiness(gap);
        expect(r.forecast).toMatchObject({ code: 'NONCONSECUTIVE_MONTHS' });
        expect(r.history.map(m => m.period)).not.toContain('2026-01');
        expect(r.history).toHaveLength(11);
    });
    it('refuses mixed currencies, sign convention breaks and empty input', () => {
        expect(forecastBusiness([...twelve, { ...twelve[0], currency: 'SGD' }]).forecast).toMatchObject({ code: 'CURRENCY_MIX' });
        expect(forecastBusiness([...twelve, { ...twelve[0], signedAmount: '-1000.00' }]).forecast).toMatchObject({ code: 'SIGN_CONVENTION' });
        expect(forecastBusiness([...twelve, { ...twelve[1], signedAmount: '500.00' }]).forecast).toMatchObject({ code: 'SIGN_CONVENTION' });
        expect(forecastBusiness([...twelve, { ...twelve[0], amount: '1000.01' }]).forecast).toMatchObject({ code: 'SIGN_CONVENTION' });
        expect(forecastBusiness([]).forecast).toMatchObject({ code: 'NO_ROWS' });
    });
    it('reports a null WAPE when observed values are all zero', () => {
        const r = available(months('2025-01', Array(8).fill(0), Array(8).fill(100)));
        expect(r.forecast.backtest.credits.methods.map(m => [m.wape, m.wapeChangeVsLastMonth])).toEqual([[null, null], [null, null], [null, null]]);
        expect(r.forecast.backtest.credits.lowestWape).toBeNull();
    });
    it('pools error sums across businesses of one currency and refuses to pool across currencies', () => {
        const a = forecastBusiness(twelve), b = forecastBusiness(months('2025-09', Array(12).fill(1000), Array(12).fill(500)));
        const pooled = poolBacktests([a, b, forecastBusiness([])])!;
        expect(pooled.credits.methods[0]).toEqual({ method: 'LAST_MONTH', window: 1, tests: 12, absoluteError: '600.00', absoluteActual: '11160.00', wape: '5.38', mae: '50.00', wapeChangeVsLastMonth: '0.00' });
        expect(poolBacktests([a, forecastBusiness(months('2025-09', Array(12).fill(1), Array(12).fill(1), { currency: 'SGD' }))])).toBeNull();
        expect(poolBacktests([forecastBusiness([])])).toBeNull();
    });
});
