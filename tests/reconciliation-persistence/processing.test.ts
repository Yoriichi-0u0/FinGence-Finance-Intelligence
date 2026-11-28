import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { bank, ledger, csv } from '../poc-reconciliation/fixtures';
import { digest, prepareProcessing, SAME_DAY_POLICY, RESEARCH_TWO_DAY_POLICY } from '../../lib/server/reconciliation/processing';
const org = '00000000-0000-4000-8000-000000000001';
export function pair(bs = [bank], ls = [ledger]) {
    const b = csv(bs), l = csv(ls);
    return { b: { bytes: b, filename: 'bank.csv' }, l: { bytes: l, filename: 'ledger.csv' }, registered: { bank: digest(b), ledger: digest(l) } };
}
describe('versioned trusted synthetic cash-source contract', () => {
    it('verifies exact source facts and preserves original decimal literals', () => {
        const p = pair([{ ...bank, BankAmountMYR: '06380.53', SignedCashMovementMYR: '06380.53' }]);
        const result = prepareProcessing(org, p.b, p.l, p.registered);
        expect(result.transactions[0]).toMatchObject({ originalAmount: '06380.53', signedAmount: '6380.53', row: 2 });
        expect(result.proposals[0].decision).toBe('VERIFIED_SUGGESTION');
        expect(Object.values(result.proposals[0].checks).every(Boolean)).toBe(true);
    });
    it('hashes bytes, organization and versioned policy; names do not alter processing identity', () => {
        const p = pair(), first = prepareProcessing(org, p.b, p.l, p.registered);
        expect(prepareProcessing(org, { ...p.b, filename: 'renamed.csv' }, p.l, p.registered).processingId).toBe(first.processingId);
        expect(prepareProcessing('00000000-0000-4000-8000-000000000002', p.b, p.l, p.registered).processingId).not.toBe(first.processingId);
        expect(prepareProcessing(org, p.b, p.l, p.registered, RESEARCH_TWO_DAY_POLICY).processingId).not.toBe(first.processingId);
    });
    it('requires registered bytes, rather than a browser role or source hash claim', () => {
        const p = pair();
        expect(() => prepareProcessing(org, p.b, p.l)).toThrow('REGISTERED_SYNTHETIC');
        expect(() => prepareProcessing(org, p.l, p.b, p.registered)).toThrow('REGISTERED_SYNTHETIC');
    });
    it('rejects conflicting and unsupported schema signatures even for registered bytes', () => {
        for (const row of [{ ...bank, LedgerEntryID: 'conflict' }, { ...bank, Unexpected: 'unsupported' }]) {
            const p = pair([row]);
            expect(() => prepareProcessing(org, p.b, p.l, p.registered)).toThrow('UNSUPPORTED_SOURCE_CLASSIFICATION');
        }
    });
    it.each(['', 'NULL', 'NaN', 'Infinity', '1.001'])('excludes rejected financial rows with %s amount', value => {
        const p = pair([{ ...bank, BankAmountMYR: value, SignedCashMovementMYR: value }]);
        expect(() => prepareProcessing(org, p.b, p.l, p.registered)).toThrow();
    });
    it('checks source accounting direction independently of amount magnitudes', () => {
        const p = pair([{ ...bank, BankDirection: 'Debit', SignedCashMovementMYR: '-6380.53' }]);
        const r = prepareProcessing(org, p.b, p.l, p.registered);
        expect(r.proposals[0]).toMatchObject({ decision: 'UNRESOLVED', checks: { EXACT_AMOUNT: false, DIRECTION: false } });
    });
    it('refuses to clear matching amounts with contradictory counterparties', () => {
        const p = pair([bank], [{ ...ledger, Counterparty: 'Different party' }]);
        expect(prepareProcessing(org, p.b, p.l, p.registered).proposals[0]).toMatchObject({ decision: 'UNRESOLVED', checks: { COUNTERPARTY: false } });
    });
    it('keeps the two-day research window explicit and versioned', () => {
        const p = pair([bank], [{ ...ledger, PostingDate: '2026-03-03' }]);
        expect(prepareProcessing(org, p.b, p.l, p.registered, SAME_DAY_POLICY).proposals[0].decision).toBe('UNRESOLVED');
        expect(prepareProcessing(org, p.b, p.l, p.registered, RESEARCH_TWO_DAY_POLICY).proposals[0].decision).toBe('VERIFIED_SUGGESTION');
        expect(() => prepareProcessing(org, p.b, p.l, p.registered, { version: 'unapproved', maxDays: 20 })).toThrow('UNSUPPORTED_VERIFICATION_POLICY');
    });
    it('keeps duplicate, group and partial evidence unresolved', () => {
        const p = pair([bank], [ledger, { ...ledger, LedgerEntryID: 'duplicate' }]);
        const r = prepareProcessing(org, p.b, p.l, p.registered);
        expect(r.proposals).toHaveLength(0);
        expect(r.cases).toHaveLength(1);
        expect(r.cases[0].reason).toBe('AMBIGUOUS_DUPLICATE_LEDGER');
    });
    it('refuses source scope conflicts and inconsistent raw accounting sides', () => {
        for (const row of [{ ...ledger, BusinessID: 'other' }, { ...ledger, CashAccountCreditMYR: '10.00' }]) {
            const p = pair([bank], [row]);
            expect(() => prepareProcessing(org, p.b, p.l, p.registered)).toThrow();
        }
    });
});
