import { beforeAll, describe, expect, it } from 'vitest';
import type { FinancePoCReconciliationV1 } from '../../lib/poc-reconciliation/contracts';
import { buildStatement } from '../../lib/poc-reconciliation/statement';
import { phase1 } from '../grounded-qa/fixtures';

let snapshot: FinancePoCReconciliationV1;
beforeAll(async () => { snapshot = (await phase1()).outputs.reconciliation!; });
/** A copy of the Phase 1 snapshot with one source row changed (the matcher's outcomes are kept as recorded). */
function edited(kind: 'bank' | 'ledger', id: string, change: Partial<FinancePoCReconciliationV1['rows']['bank'][number]>) {
    const s = structuredClone(snapshot), row = s.rows[kind].find(r => r.recordId === id)!;
    Object.assign(row, change);
    return s;
}
const categories = (s: ReturnType<typeof buildStatement>) => [...s.bank.items, ...s.ledger.items, ...s.other].map(i => [i.category, i.adjustment]);

describe('proposed bank reconciliation statement', () => {
    it('explains the whole Phase 1 difference with standard reconciling items', () => {
        const s = buildStatement(snapshot);
        expect([s.bank.movement, s.ledger.movement, s.bank.adjusted, s.ledger.adjusted, s.unexplained, s.explained]).toEqual(['28232.01', '30924.93', '29644.41', '29644.41', '0.00', true]);
        expect(categories(s)).toEqual([
            ['UNPRESENTED_CHEQUE', '-733.20'], ['DEPOSIT_IN_TRANSIT', '2145.60'],
            ['LEDGER_AMOUNT_ERROR', '-3.60'], ['DUPLICATE_LEDGER_POSTING', '-2569.94'], ['LEDGER_AMOUNT_ERROR', '-0.90'],
            ['BANK_CHARGE_NOT_IN_LEDGER', '-7.35'], ['RECEIPT_NOT_IN_LEDGER', '1319.77'], ['BANK_CHARGE_NOT_IN_LEDGER', '-18.50'],
            ['REFERENCE_ONLY', '0.00'],
        ]);
        expect(s.checks.map(c => [c.id, c.passed])).toEqual([['effects', true], ['listed', true], ['adjusted', true]]);
        expect(s.ledger.items.filter(i => i.category === 'LEDGER_AMOUNT_ERROR').map(i => i.note)).toEqual([expect.stringMatching(/MYR 3\.60, divisible by 9/), expect.stringMatching(/MYR 0\.90, divisible by 9/)]);
    });
    it('is part of every completed processing', async () => {
        const c = await phase1();
        expect(c.outputs.statement).toEqual(buildStatement(c.outputs.reconciliation!));
    });
    it('never changes the matcher outcomes it reads', () => {
        const before = JSON.stringify(snapshot);
        buildStatement(snapshot);
        expect(JSON.stringify(snapshot)).toBe(before);
    });
    it.each([
        ['a ledger receipt from mid-month is not "in transit"', 'ledger', 'GL-DEMO-0057', { date: '2026-03-20' }, '-2145.60'],
        ['a ledger payment that is not a cheque', 'ledger', 'GL-DEMO-0056', { description: 'Transfer to Borneo Fresh Supplies' }, '733.20'],
    ] as const)('%s stays unexplained with its full effect', (_, kind, id, change, unexplained) => {
        const s = buildStatement(edited(kind, id, change));
        expect([s.explained, s.unexplained]).toEqual([false, unexplained]);
        expect(s.other.find(i => i.category === 'UNEXPLAINED')).toMatchObject({ ledgerRecordIds: [id], effect: unexplained });
        expect(s.checks.every(c => c.passed)).toBe(true); // the identity still holds: adjusted bank − adjusted ledger = unexplained
    });
    it('a bank debit that is not a charge is a payment the ledger lacks', () => {
        const s = buildStatement(edited('bank', 'BANK-DEMO-0029', { description: '[debit] DIRECT DEBIT INSURANCE PREMIUM' }));
        expect(s.ledger.items.find(i => i.bankRecordId === 'BANK-DEMO-0029')).toMatchObject({ category: 'PAYMENT_NOT_IN_LEDGER', adjustment: '-7.35' });
        expect(s.explained).toBe(true);
    });
    it('duplicate candidates that are not identical copies are not reversed', () => {
        const s = buildStatement(edited('ledger', 'GL-DEMO-0006', { signedCents: '256990' }));
        expect(s.other.find(i => i.bankRecordId === 'BANK-DEMO-0007')).toMatchObject({ category: 'UNEXPLAINED', effect: '-2569.90' });
        expect(s.explained).toBe(false);
    });
    it('a snapshot whose exceptions do not add up to the recorded difference fails its own check', () => {
        const s = structuredClone(snapshot); s.cashMovement.signedDifference = '-2692.93';
        expect(buildStatement(s).checks.find(c => c.id === 'effects')!.passed).toBe(false);
        expect(buildStatement(s).explained).toBe(false);
    });
});
