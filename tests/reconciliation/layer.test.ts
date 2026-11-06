import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeCashSourceBytes, reconcileCashSources } from '../../lib/poc-reconciliation/engine';
import type { CashSource, CashSourceKind } from '../../lib/poc-reconciliation/contracts';
import { buildStatement } from '../../lib/poc-reconciliation/statement';
import { entriesCsv, reconcile, RECONCILIATION_SCOPE, type ReconciliationResult } from '../../lib/reconciliation/reconcile';
import { PHASE1_CASH_SCOPE } from '../../lib/poc-reconciliation/engine';
import type { ProcessingContext } from '../../lib/demo/pipeline';
import { phase1 } from '../grounded-qa/fixtures';

type Row = [id: string, date: string, reference: string, amount: string, description?: string];
const SHA = { bank: 'b'.repeat(64), ledger: 'c'.repeat(64) };
/** A verified cash source built directly from records (the layer never re-reads documents). */
function source(kind: CashSourceKind, rows: Row[], currency = 'SGD', businessId = 'BIZ-1'): CashSource {
    const months = [...new Set(rows.map(r => r[1].slice(0, 7)))].sort();
    return {
        kind, sourceId: SHA[kind], sha256: SHA[kind], filename: `${kind}.csv`, businessId, currency, period: months.length > 1 ? `${months[0]}/${months.at(-1)}` : months[0], evidence: {},
        rows: rows.map(([recordId, date, reference, amount, description = 'Transfer'], i) => ({ recordId, sourceId: SHA[kind], row: i + 2, businessId, currency, date, reference, description, signedCents: String(Math.round(Number(amount) * 100)), sourceTransactionId: null, evidenceIds: [] })),
    };
}
const run = (bank: Row[], ledger: Row[], currency = 'SGD') => reconcile(source('bank', bank, currency), source('ledger', ledger, currency), { organizationId: 'test-org' });
const items = (r: ReconciliationResult) => r.periods.flatMap(p => p.items.map(i => [p.period, i.category, i.resolution, i.adjustment]));
const allPassed = (r: ReconciliationResult) => r.checks.every(c => c.passed) && r.periods.every(p => p.checks.every(c => c.passed));

describe('reconciliation layer v1 on the Phase 1 month', () => {
    let c: ProcessingContext, r: ReconciliationResult;
    beforeAll(async () => { c = await phase1(); r = reconcile(c.outputs.bank!, c.outputs.ledger!, { organizationId: 'synthetic-demo', scope: PHASE1_CASH_SCOPE }); });
    it('keeps the matcher snapshot and the statement exactly as Phase 1 produced them', () => {
        expect(r.periods).toHaveLength(1);
        expect(r.periods[0].snapshot).toEqual(reconcileCashSources('synthetic-demo', c.outputs.bank!, c.outputs.ledger!));
        expect(r.periods[0].statement).toEqual(buildStatement(r.periods[0].snapshot));
    });
    it('resolves every exception with no review queue', () => {
        expect(items(r).map(([, category, resolution]) => `${category}:${resolution}`)).toEqual([
            'UNPRESENTED_CHEQUE:TIMING_OPEN', 'DEPOSIT_IN_TRANSIT:TIMING_OPEN',
            'LEDGER_AMOUNT_ERROR:ENTRY_PREPARED', 'DUPLICATE_LEDGER_POSTING:ENTRY_PREPARED', 'LEDGER_AMOUNT_ERROR:ENTRY_PREPARED',
            'BANK_CHARGE_NOT_IN_LEDGER:ENTRY_PREPARED', 'RECEIPT_NOT_IN_LEDGER:ENTRY_PREPARED', 'BANK_CHARGE_NOT_IN_LEDGER:ENTRY_PREPARED',
            'REFERENCE_ONLY:MATCHED_BY_AMOUNT',
        ]);
        expect(r.status).toBe('BALANCED_AFTER_ENTRIES');
        expect(r.attention).toEqual([]);
        expect(r.totals).toMatchObject({ records: 114, matched: 50, entries: 6, unexplained: '0.00' });
        expect(allPassed(r)).toBe(true);
        expect(r.summary).toBe('March 2026: 51 transactions matched, 2 timing differences identified (all expected on the next statement), 6 correcting entries prepared for your books. With these entries your books agree with the bank. Nothing needs your attention.');
    });
    it('prepares balanced correcting entries that carry exactly the ledger corrections', () => {
        expect(r.entries.map(e => [e.category, e.cashEffect, e.debit.account, e.credit.account])).toEqual([
            ['LEDGER_AMOUNT_ERROR', '-3.60', 'Account of GL-DEMO-0004 (correction)', 'Cash at bank (1000-BANK)'],
            ['DUPLICATE_LEDGER_POSTING', '-2569.94', 'Account of GL-DEMO-0006 (reversal)', 'Cash at bank (1000-BANK)'],
            ['LEDGER_AMOUNT_ERROR', '-0.90', 'Account of GL-DEMO-0012 (correction)', 'Cash at bank (1000-BANK)'],
            ['BANK_CHARGE_NOT_IN_LEDGER', '-7.35', 'Bank charges', 'Cash at bank (1000-BANK)'],
            ['RECEIPT_NOT_IN_LEDGER', '1319.77', 'Cash at bank (1000-BANK)', 'Receipts to be identified'],
            ['BANK_CHARGE_NOT_IN_LEDGER', '-18.50', 'Bank charges', 'Cash at bank (1000-BANK)'],
        ]);
        expect(r.entries.every(e => e.debit.amount === e.credit.amount && !e.debit.amount.startsWith('-'))).toBe(true);
        const s = r.periods[0].statement;
        expect((Number(s.ledger.movement) + r.entries.reduce((n, e) => n + Number(e.cashEffect), 0)).toFixed(2)).toBe(s.ledger.adjusted);
        expect(r.periods[0].items.find(i => i.category === 'DUPLICATE_LEDGER_POSTING')!.note).toMatch(/is kept .* is reversed\.$/);
    });
    it('exports the entries as CSV with formula-like cells neutralised', () => {
        const lines = entriesCsv(r.entries).trimEnd().split('\n');
        expect(lines[0]).toBe('Entry,Date,Description,Debit account,Credit account,Amount,Source records');
        expect(lines[2]).toBe('CE-2026-03-002,2026-03-05,Reverse duplicate GL-DEMO-0006 (kept GL-DEMO-0005),Account of GL-DEMO-0006 (reversal),Cash at bank (1000-BANK),2569.94,GL-DEMO-0006 GL-DEMO-0005 BANK-DEMO-0007');
        expect(lines).toHaveLength(7);
        expect(entriesCsv([{ ...r.entries[0], description: '=HYPERLINK("x")' }]).split('\n')[1]).toContain(`"'=HYPERLINK(""x"")"`);
    });
});

describe('several months, any one currency', () => {
    it('clears a deposit in transit against the next month and balances both months', () => {
        const r = run([['B1', '2026-01-10', 'R1', '100.00'], ['B2', '2026-02-02', 'R2', '250.00'], ['B3', '2026-02-12', 'R3', '9.00']], [['L1', '2026-01-10', 'R1', '100.00'], ['L2', '2026-01-30', 'R2', '250.00'], ['L3', '2026-02-12', 'R3', '9.00']]);
        expect(r.scope).toMatchObject({ currency: 'SGD', periods: '2026-01/2026-02', months: ['2026-01', '2026-02'] });
        expect(items(r)).toEqual([['2026-01', 'DEPOSIT_IN_TRANSIT', 'TIMING_CLEARED', '250.00'], ['2026-02', 'CLEARED_PRIOR_PERIOD_ITEM', 'TIMING_CLEARED', '250.00']]);
        expect(r.periods.map(p => [p.status, p.statement.unexplained, p.statement.explained])).toEqual([['BALANCED', '0.00', true], ['BALANCED', '0.00', true]]);
        expect(r.periods[0].items[0]).toMatchObject({ link: { period: '2026-02', side: 'BANK', recordId: 'B2', date: '2026-02-02' }, summary: 'SGD 250.00 you recorded on 30 January 2026 reached the bank on 2 February 2026.' });
        expect(r.entries).toEqual([]);
        expect(allPassed(r)).toBe(true);
    });
    it('names a cheque an unpresented cheque and any other payment a payment in transit', () => {
        const r = run([['B0', '2026-01-05', 'R0', '1.00'], ['B1', '2026-02-20', 'C9', '-80.00'], ['B2', '2026-02-03', 'T1', '-40.00']], [['L0', '2026-01-05', 'R0', '1.00'], ['L1', '2026-01-25', 'C9', '-80.00', 'Cheque 000123 to supplier'], ['L2', '2026-01-29', 'T1', '-40.00'], ['L3', '2026-02-05', 'R5', '2.00']]);
        expect(items(r)).toEqual([
            ['2026-01', 'UNPRESENTED_CHEQUE', 'TIMING_CLEARED', '-80.00'], ['2026-01', 'PAYMENT_IN_TRANSIT', 'TIMING_CLEARED', '-40.00'],
            ['2026-02', 'CLEARED_PRIOR_PERIOD_ITEM', 'TIMING_CLEARED', '-80.00'], ['2026-02', 'CLEARED_PRIOR_PERIOD_ITEM', 'TIMING_CLEARED', '-40.00'],
            ['2026-02', 'UNEXPLAINED', 'UNEXPLAINED', '0.00'],
        ]);
        expect(r.attention.map(i => i.ledgerRecordIds)).toEqual([['L3']]);
        expect(allPassed(r)).toBe(true);
    });
    it('treats a bank record booked in the ledger next month as late booking, with no correcting entry', () => {
        const r = run([['B0', '2026-01-05', 'R0', '1.00'], ['B1', '2026-01-31', 'R5', '60.00'], ['B2', '2026-02-09', 'R6', '3.00']], [['L0', '2026-01-05', 'R0', '1.00'], ['L1', '2026-02-03', 'R5', '60.00'], ['L2', '2026-02-09', 'R6', '3.00']]);
        const january = r.periods[0].items.find(i => i.bankRecordId === 'B1')!;
        expect([january.category, january.resolution, january.side]).toEqual(['LEDGER_POSTED_LATE', 'TIMING_CLEARED', 'LEDGER']);
        expect(r.entries.filter(e => e.sourceRecordIds.includes('B1'))).toEqual([]);
        expect(r.status).toBe('BALANCED');
        expect(allPassed(r)).toBe(true);
    });
    it('matches the same transaction recorded several days apart within one month', () => {
        const r = run([['B1', '2026-03-09', 'R7', '75.10']], [['L1', '2026-03-04', 'R7', '75.10']]);
        expect(items(r)).toEqual([['2026-03', 'LATE_MATCH', 'MATCHED_LATE', '0.00'], ['2026-03', 'LATE_MATCH', 'MATCHED_LATE', '0.00']]);
        expect(r.status).toBe('BALANCED');
        expect(r.summary).toMatch(/^March 2026: 1 transaction matched\. Your bank and your books agree/);
    });
    it('flags a deposit that should have reached the bank and did not, and raises only that for attention', () => {
        const r = run([['B1', '2026-01-10', 'R1', '100.00'], ['B2', '2026-02-10', 'R3', '5.00']], [['L1', '2026-01-10', 'R1', '100.00'], ['L2', '2026-01-30', 'R2', '250.00'], ['L3', '2026-02-10', 'R3', '5.00']]);
        expect(items(r)).toEqual([['2026-01', 'UNEXPLAINED', 'UNEXPLAINED', '0.00']]);
        expect(r.status).toBe('UNEXPLAINED_DIFFERENCE');
        expect(r.attention.map(i => i.ledgerRecordIds)).toEqual([['L2']]);
        expect(r.totals.unexplained).toBe('-250.00');
        expect(r.summary).toMatch(/SGD 250\.00 across 1 item could not be explained and has been flagged for your technical team\.$/);
        expect(allPassed(r)).toBe(true);
    });
    it('links nothing when a record has more than one candidate', () => {
        const r = run([['B1', '2026-02-02', 'R2', '250.00'], ['B2', '2026-02-03', 'R2', '250.00']], [['L1', '2026-01-30', 'R2', '250.00'], ['L2', '2026-02-20', 'R9', '1.00']]);
        expect(r.periods.flatMap(p => p.items).some(i => i.link)).toBe(false);
        expect(allPassed(r)).toBe(true);
    });
    it('is independent of record order', () => {
        const bank: Row[] = [['B1', '2026-01-10', 'R1', '100.00'], ['B2', '2026-02-02', 'R2', '250.00'], ['B3', '2026-02-14', 'FEE', '-3.00', 'Service charge']];
        const ledger: Row[] = [['L1', '2026-01-10', 'R1', '100.00'], ['L2', '2026-01-30', 'R2', '250.00'], ['L3', '2026-02-11', 'R4', '9.00']];
        const reversed = (s: CashSource) => ({ ...s, rows: [...s.rows].reverse() });
        const b = source('bank', bank), l = source('ledger', ledger);
        // Outcomes, not the echoed source rows (which keep each file's own order).
        const outcome = (r: ReconciliationResult) => JSON.stringify([r.status, r.summary, r.totals, r.entries, r.checks, r.periods.map(p => [p.status, p.items, p.statement, p.snapshot.results])]);
        expect(outcome(reconcile(reversed(b), reversed(l), { organizationId: 'o' }))).toBe(outcome(reconcile(b, l, { organizationId: 'o' })));
    });
    it('reports months only one side covers instead of reconciling them against nothing', () => {
        const r = run([['B1', '2026-01-10', 'R1', '100.00'], ['B2', '2026-02-10', 'R2', '7.00']], [['L1', '2026-01-10', 'R1', '100.00']]);
        expect(r.scope.months).toEqual(['2026-01']);
        expect(r.notReconciled).toEqual([{ side: 'BANK', period: '2026-02', records: 1, clearing: 0 }]);
        expect(r.status).toBe('BALANCED');
    });
    it('uses next month\'s bank statement to clear an item even when the ledger stops at the month end', () => {
        const r = run([['B1', '2026-01-10', 'R1', '100.00'], ['B2', '2026-02-02', 'R2', '250.00']], [['L1', '2026-01-10', 'R1', '100.00'], ['L2', '2026-01-30', 'R2', '250.00']]);
        expect(r.scope.months).toEqual(['2026-01']);
        expect(items(r)).toEqual([['2026-01', 'DEPOSIT_IN_TRANSIT', 'TIMING_CLEARED', '250.00']]);
        expect(r.notReconciled).toEqual([{ side: 'BANK', period: '2026-02', records: 1, clearing: 1 }]);
        expect(allPassed(r)).toBe(true);
    });
    it('refuses sources that cannot be reconciled together', () => {
        expect(() => reconcile(source('bank', [['B1', '2026-01-10', 'R1', '1.00']]), source('ledger', [['L1', '2026-01-10', 'R1', '1.00']], 'MYR'), { organizationId: 'o' })).toThrow('CURRENCY_MISMATCH');
        expect(() => reconcile(source('bank', [['B1', '2026-01-10', 'R1', '1.00']]), source('ledger', [['L1', '2026-01-10', 'R1', '1.00']], 'SGD', 'BIZ-2'), { organizationId: 'o' })).toThrow('BUSINESS_MISMATCH');
        expect(() => run([['B1', '2026-01-10', 'R1', '1.00']], [['L1', '2026-02-10', 'R1', '1.00']])).toThrow('NO_COMMON_PERIOD');
        expect(() => reconcile(source('bank', [['B1', '2026-01-10', 'R1', '1.00']]), source('ledger', [['L1', '2026-01-10', 'R1', '1.00']]), { organizationId: 'o', scope: PHASE1_CASH_SCOPE })).toThrow('UNSUPPORTED_CURRENCY_BASIS');
        expect(() => reconcile(source('bank', [['B1', '2026-01-10', 'R1', '1.00'], ['B2', '2026-02-10', 'R2', '1.00']], 'MYR'), source('ledger', [['L1', '2026-01-10', 'R1', '1.00']], 'MYR'), { organizationId: 'o', scope: PHASE1_CASH_SCOPE })).toThrow('MIXED_SOURCE_SCOPE');
    });
});

describe('cash source scope', () => {
    const header = 'BankTransactionID,BusinessID,Currency,ValueDate,StatementMonth,BankReference,BankDescription,BankDirection,BankAmountMYR,SignedCashMovementMYR,SourceTransactionID';
    const csv = new TextEncoder().encode(`${header}\nB1,BIZ-1,SGD,2026-01-10,2026-01,R1,Deposit,Credit,10.00,10.00,\nB2,BIZ-1,SGD,2026-02-03,2026-02,R2,Card,Debit,4.50,-4.50,\n`);
    it('reads several months and any stated currency under the layer scope', () => {
        const s = normalizeCashSourceBytes(csv, 'bank', 'bank.csv', SHA.bank, RECONCILIATION_SCOPE);
        expect([s.period, s.currency, s.rows.length]).toEqual(['2026-01/2026-02', 'SGD', 2]);
    });
    it('keeps the Phase 1 rule by default', () => {
        expect(() => normalizeCashSourceBytes(csv, 'bank', 'bank.csv', SHA.bank)).toThrow('UNSUPPORTED_CURRENCY_BASIS');
        expect(() => normalizeCashSourceBytes(new TextEncoder().encode(new TextDecoder().decode(csv).replaceAll('SGD', 'MYR')), 'bank', 'bank.csv', SHA.bank)).toThrow('MIXED_SOURCE_SCOPE');
    });
});
