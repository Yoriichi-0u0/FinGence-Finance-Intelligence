import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSource } from '../../lib/poc-anomalies/source';
import { forecastBusiness, poolBacktests } from '../../lib/poc-forecast/forecast';

/**
 * Compares the TypeScript baseline on the owner-unpacked synthetic feature file (never committed) with the
 * independent standard-library reference figures published in issue #37. Only the feature file is read;
 * no label, ground-truth or expected-results file is opened here or by application code.
 */
const candidates = [process.env.FINGENCE_POC_DATASET_DIR, '../../datasets/poc-2026-03', '.local/datasets/poc-2026-03'].filter(Boolean) as string[];
const directory = candidates.find(d => existsSync(join(d, 'source_transactions_6000.csv')));

describe.skipIf(!directory)('PoC cash forecast against the independent reference (synthetic pack)', () => {
    const rows = () => parseSource(readFileSync(join(directory!, 'source_transactions_6000.csv'))).rows;
    const byBusiness = () => { const all = rows(); return [...new Set(all.map(r => r.businessId))].sort().map(id => forecastBusiness(all.filter(r => r.businessId === id))); };
    it('covers three businesses over twelve consecutive months, Sep 2025 to Aug 2026', () => {
        expect(byBusiness().map(b => [b.currency, b.interval, b.forecast.status])).toEqual(Array(3).fill(['MYR', { first: '2025-09', last: '2026-08', months: 12 }, 'AVAILABLE']));
    });
    it('reproduces the BUS-001 September 2026 next-month baseline from March to August rows', () => {
        expect(byBusiness()[0].forecast).toMatchObject({ period: '2026-09', basis: { first: '2026-03', last: '2026-08' }, credits: '205774.83', debits: '129113.73', net: '76661.10', tests: 6 });
    });
    it('reproduces the pooled 18-test rolling-origin WAPE for every metric and method', () => {
        const pooled = poolBacktests(byBusiness())!, wape = (m: 'credits' | 'debits' | 'net') => pooled[m].methods.map(s => [s.method, s.tests, s.wape]);
        expect(wape('credits')).toEqual([['LAST_MONTH', 18, '23.82'], ['MEAN_3', 18, '20.31'], ['MEAN_6', 18, '18.01']]);
        expect(wape('debits')).toEqual([['LAST_MONTH', 18, '15.33'], ['MEAN_3', 18, '9.89'], ['MEAN_6', 18, '9.81']]);
        expect(wape('net')).toEqual([['LAST_MONTH', 18, '46.90'], ['MEAN_3', 18, '51.81'], ['MEAN_6', 18, '52.85']]);
        // Net movement: the six-month mean does not outperform last month.
        expect([pooled.credits.lowestWape, pooled.debits.lowestWape, pooled.net.lowestWape]).toEqual(['MEAN_6', 'MEAN_6', 'LAST_MONTH']);
    });
});
