import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput, type ProcessingContext } from '../../lib/demo/pipeline';
import { activityOf, BANK_CHARGES, INTEREST_RECEIVED, NOT_IN_BOOKS } from '../../lib/cash-classification/classify';
import { biggestChanges, cashFlowStatement, cashRatios, customerConcentration, operatingByMonth } from '../../lib/cash-classification/insights';

const doc = (dir: string, name: string, bytes?: Uint8Array): DocumentInput => ({ name, bytes: bytes ?? new Uint8Array(readFileSync(join('public/demo', dir, name))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const FY = ['demo-bank-statement-2025-fy-myr.csv', 'demo-general-ledger-2025-fy-myr.csv', 'demo-bank-history-2024-01-to-2025-12-myr.csv'];
const cents = (v: string) => BigInt(v);

describe('cash classification on the full-year sample', () => {
    let c: ProcessingContext;
    beforeAll(async () => { c = await processDocuments(FY.map(n => doc('full-year', n))); });

    it('classifies every bank record once, from the books, and adds back to the bank movement', () => {
        const k = c.outputs.classification!;
        expect(k.checks.map(x => [x.id, x.passed])).toEqual([['each-once', true], ['activities-total', true], ['categories-total', true], ['books-only-linked', true]]);
        expect(k.booksHaveCategories).toBe(true);
        expect(k.rows).toHaveLength(c.outputs.bankRows.length);
        expect(k.current).toMatchObject({ booksShare: '99.69', classifiedShare: '99.71', netCents: '19390290' });
        expect(Object.fromEntries(Object.entries(k.current.activities).map(([a, v]) => [a, v.netCents]))).toEqual({ OPERATING: '33030290', INVESTING: '-8600000', FINANCING: '-5040000' });
        // Records the books do not show are named by stated bank rules: 12 monthly fees, 4 quarterly interest credits,
        // and the two payments the books lack (the repeated Selangor payment and the unverified payee).
        const own = k.rows.filter(r => r.basis !== 'BOOKS');
        expect(own.filter(r => r.category === BANK_CHARGES)).toHaveLength(12);
        expect(own.filter(r => r.category === INTEREST_RECEIVED)).toHaveLength(4);
        expect(own.filter(r => r.category === NOT_IN_BOOKS).map(r => [r.counterparty, r.signedCents])).toEqual([['Selangor Demo Hardware', '-168420'], ['Kilat Demo Trading', '-745000']]);
        // A books category is only ever the category of the ledger entry the reconciliation settled that record against.
        const ledger = new Map(c.outputs.ledger!.rows.map(r => [r.recordId, r]));
        expect(k.rows.filter(r => r.basis === 'BOOKS').every(r => ledger.has(r.ledgerRecordId!))).toBe(true);
    });

    it('classifies 2024 by payee and direction, with every record covered', () => {
        const k = c.outputs.classification!;
        expect(k.prior!.months).toEqual(Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, '0')}`));
        expect(k.prior).toMatchObject({ classifiedShare: '100.00', netCents: '3824026' });
        // A customer's refund keeps its own category: the payee rule is keyed by direction.
        expect(k.payees['Sinar Demo Office Fitouts · in']).toBe('Trade receipts');
        expect(k.payees['Sinar Demo Office Fitouts · out']).toBe('Sales refunds');
    });

    it('builds a direct-method statement whose activities add up to the bank movement, this year and last', () => {
        const k = c.outputs.classification!, s = cashFlowStatement(k);
        expect(s.map(x => x.activity)).toEqual(['OPERATING', 'INVESTING', 'FINANCING']);
        for (const period of ['current', 'prior'] as const) {
            const lines = s.flatMap(x => [...x.receipts, ...x.payments]).reduce((t, l) => t + (period === 'current' ? l.current : l.prior ?? 0n), 0n);
            expect(lines).toBe(cents(period === 'current' ? k.current.netCents : k.prior!.netCents));
            expect(s.reduce((t, x) => t + (period === 'current' ? x.net.current : x.net.prior!), 0n)).toBe(lines);
        }
        expect(s[1].payments.map(l => [l.category, l.current, l.prior])).toEqual([['Equipment', -8600000n, 0n]]);
        expect(s[2].payments.map(l => [l.category, l.current, l.prior])).toEqual([['Loan repayment', -5040000n, -5040000n]]);
        // The books' categories come before the ones FinGence named.
        const op = s[0].payments.map(l => l.category);
        expect(op.indexOf('Payroll')).toBeLessThan(op.indexOf(BANK_CHARGES));
    });

    it('explains what changed, the cash ratios, concentration and the monthly operating cash', () => {
        const k = c.outputs.classification!;
        expect(biggestChanges(k).slice(0, 3).map(x => [x.category, x.change])).toEqual([['Trade receipts', 32783793n], ['Sales receipts', 14012390n], ['Payroll', -10127399n]]);
        expect(cashRatios(k).map(r => [r.id, r.current, r.prior])).toEqual([['operating-margin', 19.58, 7.28], ['payroll', 33.95, 38.67], ['direct', 31.82, 36.98], ['fixed-cover', 2.16, 1.84]]);
        expect(customerConcentration(k)).toMatchObject({ customers: 5, top: { name: 'Showroom Card Settlement', share: 31.88 }, topThreeShare: 71.12 });
        const months = operatingByMonth(k);
        expect(months).toHaveLength(12);
        expect(months.reduce((t, m) => t + m.net, 0n)).toBe(cents(k.current.activities.OPERATING.netCents));
        expect(months.every(m => m.priorNet !== null)).toBe(true);
    });
});

describe('cash classification fallbacks', () => {
    it('reads the books in the one-month and quarter samples too, and every check passes', async () => {
        for (const [dir, names] of [['', ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv', 'demo-bank-history-2025-04-to-2026-03.csv']], ['quarter', ['demo-bank-statement-2026-q1-sgd.csv', 'demo-general-ledger-2026-q1-sgd.csv', 'demo-bank-history-2025-04-to-2026-03-sgd.csv']]] as const) {
            const k = (await processDocuments(names.map(n => doc(dir, n)))).outputs.classification!;
            expect(k.checks.every(x => x.passed)).toBe(true);
            expect(Number(k.current.booksShare)).toBeGreaterThan(98);
            expect(k.prior!.classifiedShare).toBe('100.00');
        }
    });

    it('without a category column, nothing is taken from the books and the totals still hold', async () => {
        const text = readFileSync(join('public/demo/full-year', FY[1]), 'utf8').split('\n').map(line => line.split(',').slice(0, -1).join(',')).join('\n');
        expect(text.split('\n')[0]).not.toContain('CategoryLabel');
        const c = await processDocuments([doc('full-year', FY[0]), doc('full-year', FY[1], new TextEncoder().encode(text)), doc('full-year', FY[2])]);
        const k = c.outputs.classification!;
        expect(k.booksHaveCategories).toBe(false);
        expect(k.rows.some(r => r.basis === 'BOOKS')).toBe(false);
        expect(k.checks.every(x => x.passed)).toBe(true);
        expect(k.current.booksShare).toBe('0.00');
    });

    it('applies the published activity rule', () => {
        expect(['Equipment', 'CNC machinery', 'Motor vehicles', 'Loan repayment', 'Dividends paid', 'Hire purchase', 'Payroll', 'Rent', 'Sales receipts'].map(activityOf))
            .toEqual(['INVESTING', 'INVESTING', 'INVESTING', 'FINANCING', 'FINANCING', 'FINANCING', 'OPERATING', 'OPERATING', 'OPERATING']);
    });
});

describe('review fixes (#160 follow-up)', () => {
    const row = (rowId: string, period: string, signedAmount: string, counterparty: string) => ({ rowId, sourceTransactionId: null, businessId: 'B', businessName: 'B', currency: 'MYR', date: `${period}-10`, period, description: 'fee', direction: signedAmount.startsWith('-') ? 'Debit' : 'Credit', amount: signedAmount.replace('-', ''), signedAmount, counterparty, reference: rowId }) as const;
    it('keeps one line per category when the books and a bank rule both use it, so the prior total is not doubled', async () => {
        const { classifyCash } = await import('../../lib/cash-classification/classify');
        const k = classifyCash({
            bankRows: [row('B1', '2025-02', '-10.00', 'Bank X'), row('B2', '2025-02', '-5.00', 'Bank X')], months: ['2025-02'], ledger: new Map([['L1', 'Bank charges']]),
            periods: [{ period: '2025-02', snapshot: { results: [{ status: 'MATCH_EXACT', bankRecordId: 'B1', ledgerRecordIds: ['L1'] }] }, items: [{ bankRecordId: 'B2', ledgerRecordIds: [], category: 'BANK_CHARGE_NOT_IN_LEDGER', resolution: 'ENTRY_PREPARED', link: null }] }] as never,
            historyRows: [row('H1', '2025-01', '-8.00', 'Bank X')],
        });
        expect(k.current.categories.map(c => [c.category, c.basis, c.outCents])).toEqual([['Bank charges', 'BOOKS', '-1500']]);
        const lines = cashFlowStatement(k).flatMap(s => s.payments);
        expect(lines.map(l => [l.category, l.current, l.prior])).toEqual([['Bank charges', -1500n, -800n]]);
        expect(lines.reduce((t, l) => t + l.prior!, 0n)).toBe(BigInt(k.prior!.netCents));
    });

    it('shows a sign reversal as a signed change, and a change in size otherwise', async () => {
        const { describeChange } = await import('../../lib/cash-classification/insights');
        expect(describeChange(10000n, -10000n)).toEqual({ kind: 'percent', percent: 200, favourable: true });
        expect(describeChange(5000n, -10000n)).toEqual({ kind: 'percent', percent: 150, favourable: true });
        expect(describeChange(-5000n, 10000n)).toEqual({ kind: 'percent', percent: -150, favourable: false });
        expect(describeChange(-12000n, -10000n)).toEqual({ kind: 'percent', percent: 20, favourable: false });
        expect(describeChange(12000n, 10000n)).toEqual({ kind: 'percent', percent: 20, favourable: true });
        expect(describeChange(5n, 0n)).toEqual({ kind: 'new' });
        expect(describeChange(7n, 7n)).toEqual({ kind: 'same' });
        expect(describeChange(7n, null)).toEqual({ kind: 'none' });
    });
});
