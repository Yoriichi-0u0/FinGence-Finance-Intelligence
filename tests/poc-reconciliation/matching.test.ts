import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { normalizeCashSource } from '../../lib/server/poc-reconciliation/normalize';
import { reconcileCashSources } from '../../lib/server/poc-reconciliation/match';
import { bank, ledger, csv } from './fixtures';
const run = (b = [bank], l = [ledger]) => reconcileCashSources('test-organization', normalizeCashSource(csv(b), 'bank', 'bank.csv'), normalizeCashSource(csv(l), 'ledger', 'ledger.csv'));
describe('source-specific synthetic bank / GL reconciliation', () => {
    it('preserves distinct hashes, exact cents, source rows and both evidence links', () => {
        const r = run();
        expect(r.version).toBe('finance-poc-reconciliation-v1');
        expect(r.cashMovement).toEqual({ bank: '6380.53', ledger: '6380.53', signedDifference: '0.00' });
        expect(r.counts.MATCH_EXACT).toBe(1);
        expect(r.sources.bank.sha256).not.toBe(r.sources.ledger.sha256);
        expect(r.results[0].bankEvidenceIds.length).toBeGreaterThan(0);
        expect(r.results[0].ledgerEvidenceIds.length).toBeGreaterThan(0);
        expect(r.rows.bank[0].row).toBe(2);
    });
    it('uses a two-day posting window, never matching later dates', () => {
        expect(run([bank], [{ ...ledger, PostingDate: '2026-03-03' }]).counts.MATCH_DATE_SHIFT).toBe(1);
        const late = run([bank], [{ ...ledger, PostingDate: '2026-03-04' }]);
        expect(late.counts.BANK_ONLY).toBe(1); expect(late.counts.LEDGER_ONLY).toBe(1);
    });
    it('retains mismatched amounts and opposite cash signs for review', () => {
        const r = run([bank], [{ ...ledger, CashAccountDebitMYR: '0.00', CashAccountCreditMYR: '6380.53', SignedCashMovementMYR: '-6380.53' }]);
        expect(r.counts.AMOUNT_MISMATCH_REVIEW).toBe(1); expect(r.counts.MATCH_EXACT).toBe(0);
        expect(r.cashMovement.signedDifference).toBe('12761.06');
    });
    it('does not silently clear a reference mismatch or join on transaction ID', () => {
        expect(run([bank], [{ ...ledger, LedgerReference: 'OTHER' }]).counts.REFERENCE_MISMATCH_REVIEW).toBe(1);
    });
    it('never auto-clears duplicate ledger or duplicate bank candidates', () => {
        const l = [ledger, { ...ledger, LedgerEntryID: 'DUPLICATE-2' }];
        expect(run([bank], l).counts.AMBIGUOUS_DUPLICATE_LEDGER).toBe(1);
        const b = [bank, { ...bank, BankTransactionID: 'BANK-2' }];
        const r = run(b, [ledger]); expect(r.counts.MATCH_EXACT).toBe(0);
        expect(r.counts.AMBIGUOUS_DUPLICATE_LEDGER).toBe(2);
        const labels = (r: ReturnType<typeof run>) => r.results.map(({ status, bankRecordId, ledgerRecordIds }) => ({ status, bankRecordId, ledgerRecordIds }));
        expect(labels(run([...b].reverse(), [...l].reverse()))).toEqual(labels(run(b, l)));
    });
    it('keeps ambiguous evidence links stable under reversed traversal of the same evidence', () => {
        const b = normalizeCashSource(csv([bank]), 'bank', 'bank.csv');
        const l = normalizeCashSource(csv([ledger, { ...ledger, LedgerEntryID: 'DUPLICATE-2' }]), 'ledger', 'ledger.csv');
        expect(reconcileCashSources('test-organization', b, { ...l, rows: [...l.rows].reverse() }).results).toEqual(reconcileCashSources('test-organization', b, l).results);
    });
    it.each([
        { ...bank, ValueDate: '2026-02-30' }, { ...bank, ValueDate: '03/01/2026' },
        { ...bank, SignedCashMovementMYR: '6380.54' }, { ...bank, Currency: 'USD' },
        { ...bank, BankAmountMYR: '1.001' }, { ...bank, BankDirection: 'Unknown' },
    ])('fails closed for invalid conventions and monetary contradictions', row => {
        expect(() => run([row])).toThrow();
    });
    it('rejects invalid CSV, duplicate headers/IDs and incompatible scopes', () => {
        expect(() => normalizeCashSource(Buffer.from('x,y\n1,2'), 'bank', 'x.csv')).toThrow();
        expect(() => normalizeCashSource(Buffer.from('x,x\n1,2'), 'bank', 'x.csv')).toThrow();
        expect(() => normalizeCashSource(csv([bank, bank]), 'bank', 'x.csv')).toThrow();
        expect(() => run([bank], [{ ...ledger, BusinessID: 'OTHER' }])).toThrow();
        expect(() => normalizeCashSource(csv([bank]), 'bank', 'x.xlsx')).toThrow();
    });
});
