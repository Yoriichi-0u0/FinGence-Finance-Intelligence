import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput, type ProcessingContext } from '../../lib/demo/pipeline';
import { addMonths, planCash, verifiedClosingBalances, type CashForecastPlan } from '../../lib/cash-forecast/plan';
import type { SourceRow } from '../../lib/poc-anomalies/source';

const doc = (dir: string, name: string, bytes?: Uint8Array): DocumentInput => ({ name, bytes: bytes ?? new Uint8Array(readFileSync(join('public/demo', dir, name))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const FY = ['demo-bank-statement-2025-fy-myr.csv', 'demo-general-ledger-2025-fy-myr.csv', 'demo-bank-history-2024-01-to-2025-12-myr.csv'];
const available = (p: CashForecastPlan | null) => { if (p?.status !== 'AVAILABLE') throw Error(`plan unavailable: ${JSON.stringify(p)}`); return p; };
const c2 = (v: string) => BigInt(v.replace('.', ''));

describe('cash plan on the full-year sample', () => {
    let c: ProcessingContext;
    beforeAll(async () => { c = await processDocuments(FY.map(n => doc('full-year', n))); });

    it('starts from the verified December 2025 balance and plans January to June 2026', () => {
        const p = available(c.outputs.cashPlan);
        expect(p.history).toHaveLength(24);
        expect(p.history.at(-1)).toMatchObject({ period: '2025-12', balance: '417143.16' });
        expect(p.balanceSource).toBe(FY[2]);
        expect(p.projection.map(x => x.period)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
        // Each month's balance is the opening balance plus the planned net movement so far, and its range brackets it.
        let running = c2('417143.16');
        for (const m of p.projection) {
            running += c2(m.net);
            expect(c2(m.balance!)).toBe(running);
            expect(c2(m.receipts) + c2(m.payments)).toBe(c2(m.net));
            expect(c2(m.low!) + c2(m.range!)).toBe(running);
            expect(c2(m.high!) - c2(m.range!)).toBe(running);
        }
        expect(p.projection.at(-1)).toMatchObject({ balance: '662102.12', range: '40926.66' });
        // The range widens with distance ahead.
        const ranges = p.projection.map(m => Number(m.range));
        expect(ranges[5]).toBeGreaterThan(ranges[0]);
    });

    it('reads each category by its pattern and leaves the one-offs out', () => {
        const p = available(c.outputs.cashPlan), by = Object.fromEntries(p.categories.map(x => [`${x.category} · ${x.direction}`, x]));
        expect(by['Rent · OUT']).toMatchObject({ pattern: 'REGULAR', method: 'SIX_MONTH_AVERAGE', committed: true });
        expect(by['Rent · OUT'].forecasts).toEqual(Array(6).fill('-9500.00'));
        expect(by['Loan repayment · OUT'].forecasts).toEqual(Array(6).fill('-4200.00'));
        // SST is paid every second month (even months): due in February, April and June.
        expect(by['Taxes · OUT']).toMatchObject({ pattern: 'PERIODIC', everyMonths: 2, method: 'WHEN_DUE' });
        expect(by['Taxes · OUT'].forecasts.map(f => f !== '0.00')).toEqual([false, true, false, true, false, true]);
        expect(by['Interest received · IN']).toMatchObject({ pattern: 'PERIODIC', everyMonths: 3 });
        expect(p.oneOffs.map(o => [o.category, o.total, o.months])).toEqual([
            ['Equipment', '-86000.00', ['2025-08']], ['Insurance', '-14800.00', ['2025-01']], ['Not in your books', '-9134.20', ['2025-05', '2025-10']], ['Sales refunds', '-2400.00', ['2025-09']],
        ]);
        for (const o of ['Equipment · OUT', 'Insurance · OUT', 'Not in your books · OUT']) expect(by[o]).toMatchObject({ pattern: 'ONE_OFF', method: 'LEFT_OUT' });
        expect(p.commitments.months).toEqual(['2026-01', '2026-02', '2026-03']);
        expect(p.commitments.items.find(i => i.category === 'Taxes')).toMatchObject({ months: ['2026-02'] });
    });

    it('is tested on the twelve months of 2025 and misses less than the plain average', () => {
        const a = available(c.outputs.cashPlan).accuracy!;
        expect(a).toEqual({ tests: 12, receiptsWape: '13.97', paymentsWape: '16.10', netMiss: '23765.67', baseline: { receiptsWape: '17.74', paymentsWape: '16.24', netMiss: '26939.67' } });
    });

    it('never uses a balance the history does not prove', async () => {
        const lines = readFileSync(join('public/demo/full-year', FY[2]), 'utf8').split('\n'), header = lines[0].split(','), col = header.indexOf('RunningBalanceMYR');
        const cells = lines[5].split(','); cells[col] = (Number(cells[col]) + 1).toFixed(2); lines[5] = cells.join(',');
        const tampered = await processDocuments([doc('full-year', FY[0]), doc('full-year', FY[1]), doc('full-year', FY[2], new TextEncoder().encode(lines.join('\n')))]);
        const p = available(tampered.outputs.cashPlan);
        expect(p.projection.every(m => m.balance === null && m.low === null)).toBe(true);
        expect(p.balanceSource).toBeNull();
        expect(p.projection.map(m => m.net)).toEqual(available(c.outputs.cashPlan).projection.map(m => m.net));
    });
});

describe('cash plan elsewhere', () => {
    it('plans the twelve-month samples and tests them from month seven', async () => {
        for (const [dir, names] of [['', ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv', 'demo-bank-history-2025-04-to-2026-03.csv']], ['quarter', ['demo-bank-statement-2026-q1-sgd.csv', 'demo-general-ledger-2026-q1-sgd.csv', 'demo-bank-history-2025-04-to-2026-03-sgd.csv']]] as const) {
            const p = available((await processDocuments(names.map(n => doc(dir, n)))).outputs.cashPlan);
            expect(p.history).toHaveLength(12);
            expect(p.projection[0].period).toBe('2026-04');
            expect(p.accuracy!.tests).toBe(5);
            expect(p.projection.slice(0, 3).every(m => m.range !== null)).toBe(true);
            expect(p.projection.slice(3).every(m => m.range === null)).toBe(true);
        }
    });

    it('refuses without twelve consecutive verified months', async () => {
        const c = await processDocuments([doc('quarter', 'demo-bank-statement-2026-q1-sgd.csv'), doc('quarter', 'demo-general-ledger-2026-q1-sgd.csv')]);
        expect(c.outputs.cashPlan).toMatchObject({ status: 'UNAVAILABLE' });
        expect((c.outputs.cashPlan as { reason: string }).reason).toMatch(/at least 12 consecutive months/);
    });

    it('verifies running balances against every record', () => {
        const rows = [{ period: '2025-01', signedAmount: '100.00' }, { period: '2025-01', signedAmount: '-30.00' }, { period: '2025-02', signedAmount: '5.50' }] as SourceRow[];
        expect(verifiedClosingBalances([{ RunningBalanceMYR: '1100' }, { RunningBalanceMYR: '1070.00' }, { RunningBalanceMYR: '1075.5' }], rows)).toEqual({ '2025-01': 107000n, '2025-02': 107550n });
        expect(verifiedClosingBalances([{ RunningBalanceMYR: '1100.00' }, { RunningBalanceMYR: '1071.00' }, { RunningBalanceMYR: '1076.50' }], rows)).toBeNull();
        expect(verifiedClosingBalances([{ Other: '1' }, { Other: '2' }, { Other: '3' }], rows)).toBeNull();
        expect(addMonths('2025-11', 3)).toBe('2026-02');
        expect(planCash).toBeTypeOf('function');
    });
});
