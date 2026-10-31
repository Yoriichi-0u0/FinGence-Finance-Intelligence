import { describe, expect, it } from 'vitest';
import { parseSource } from '../../lib/poc-anomalies/source';
import { csv } from '../poc-anomalies/support';
import { projectSource, insightsQuery } from '../../lib/poc-insights/model';
const id = '11111111-1111-4111-8111-111111111111';
const rows = parseSource(csv([
    { id: 'A', direction: 'Credit', amount: '0.10', date: '2026-03-01', reference: 'REF-A' },
    { id: 'B', direction: 'Credit', amount: '0.20', date: '2026-03-02', reference: 'REF-B' },
    { id: 'C', amount: '0.05', date: '2026-03-03', reference: 'REF-C' },
    { id: 'D', amount: '12.00', date: '2026-02-01', reference: 'REF-D' },
    { id: 'E', amount: '90.00', business: 'BUS-T02' },
])).rows;
describe('source-only exact financial explorer', () => {
    it('keeps cents exact, bank directions distinct and limits totals to the selected business/period/currency', () => {
        const r = projectSource(rows, insightsQuery.parse({ source: id }));
        expect(r.selection).toMatchObject({ businessId: 'BUS-T01', period: '2026-03', currency: 'MYR' });
        expect(r.totals).toEqual({ rows: 3, creditRows: 2, debitRows: 1, credits: '0.30', debits: '-0.05', net: '0.25' });
        expect(r.series.map(p => [p.period, p.rows, p.net])).toEqual([['2026-02', 1, '-12.00'], ['2026-03', 3, '0.25']]);
        expect(r.transactions[0]).toMatchObject({ rowId: 'A', csvRecord: 2, amount: '0.10', signedAmount: '0.10' });
        expect(r).not.toHaveProperty('revenue');
    });
    it('filters search, direction, dates and absolute amount before deterministic pagination', () => {
        const r = projectSource(rows, insightsQuery.parse({ source: id, search: 'ref-', direction: 'Credit', from: '2026-03-01', to: '2026-03-02', minAmount: '0.15', maxAmount: '0.25', pageSize: 1 }));
        expect(r.transactions.map(r => r.rowId)).toEqual(['B']); expect(r.filteredTotals.net).toBe('0.20'); expect(r.totals.net).toBe('0.25');
        const p2 = projectSource(rows, insightsQuery.parse({ source: id, page: 2, pageSize: 2 }));
        expect(p2.transactions.map(r => r.rowId)).toEqual(['C']); expect(p2.pagination.total).toBe(3);
        expect(projectSource(rows, insightsQuery.parse({ source: id, search: 'absent' })).filteredTotals.rows).toBe(0);
    });
    it('never mixes currencies or invents missing months; fails unknown scope', () => {
        const mixed = [...rows, { ...rows[0], rowId: 'USD-1', currency: 'USD', signedAmount: '300.00', amount: '300.00' }];
        expect(projectSource(mixed, insightsQuery.parse({ source: id, currency: 'USD' })).totals.net).toBe('300.00');
        expect(projectSource([rows[0]], insightsQuery.parse({ source: id })).series).toHaveLength(1);
        for (const change of [{ business: 'UNKNOWN' }, { period: '2026-04' }, { currency: 'SGD' }])
            expect(() => projectSource(rows, insightsQuery.parse({ source: id, ...change }))).toThrow('UNAVAILABLE');
    });
    it('rejects malformed dates, money, scopes, pagination and unexpected authority fields', () => {
        for (const change of [{ from: '2026-02-30' }, { from: '2026-03-20', to: '2026-03-01' }, { minAmount: '1.001' }, { minAmount: '2.00', maxAmount: '1.00' }, { page: -1 }, { pageSize: 101 }, { organizationId: id }, { direction: 'Revenue' }])
            expect(insightsQuery.safeParse({ source: id, ...change }).success).toBe(false);
    });
});
