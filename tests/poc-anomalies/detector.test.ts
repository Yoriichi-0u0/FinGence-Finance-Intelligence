import { describe, expect, it } from 'vitest';
import { parseSource, SourceError, toCents, fromCents } from '../../lib/poc-anomalies/source';
import { detectAnomalies, type RuleId } from '../../lib/poc-anomalies/detector';
import { readReconciliation } from '../../lib/poc-anomalies/reconciliation';
import { csv, HEADER, ordinary } from './support';

const rules = (bytes: Uint8Array) => Object.fromEntries(detectAnomalies(parseSource(bytes).rows).map(c => [c.row.rowId, c.findings.map(f => f.ruleId)])) as Record<string, RuleId[]>;
const refusal = (bytes: Uint8Array) => { try { parseSource(bytes); return null; } catch (e) { return e instanceof SourceError ? e.code : 'THROWN'; } };

describe('PoC anomaly source parsing', () => {
    it('reads only feature columns from the normalized layout', () => {
        const { layout, rows } = parseSource(csv([{ id: 'T-1', category: 'Fraud' }]));
        expect(layout).toBe('NORMALIZED_TRANSACTIONS');
        expect(Object.keys(rows[0]).sort()).toEqual(['amount', 'businessId', 'businessName', 'counterparty', 'currency', 'date', 'description', 'direction', 'period', 'reference', 'rowId', 'signedAmount', 'sourceTransactionId']);
        expect(JSON.stringify(rows)).not.toMatch(/Fraud|synthetic test|Groceries/);
    });
    it('accepts the bank statement layout and keeps its source transaction provenance', () => {
        const bank = 'BankTransactionID,BusinessID,BusinessName,AccountNumber,Currency,ValueDate,StatementMonth,BankReference,BankDescription,BankDirection,BankAmountMYR,SignedCashMovementMYR,Counterparty,SourceTransactionID\n'
            + 'BANK-1,BUS-T01,Synthetic Test Cafe,****0000,MYR,2026-03-01,2026-03,S5GWFDM1KYMJ,[credit] Pos Sales Settlement,Credit,6380.53,6380.53,POS Sales Settlement,SRC-1';
        const { layout, rows } = parseSource(new TextEncoder().encode(bank));
        expect(layout).toBe('BANK_STATEMENT');
        expect(rows[0]).toMatchObject({ rowId: 'BANK-1', sourceTransactionId: 'SRC-1', signedAmount: '6380.53', reference: 'S5GWFDM1KYMJ' });
    });
    it('refuses evaluator files, unsupported layouts, invalid encodings and invalid rows', () => {
        expect(refusal(csv([{ id: 'T-1' }], HEADER + ',IsAnomaly'))).toBe('EVALUATOR_FILE');
        expect(refusal(new TextEncoder().encode('SourceTransactionID,BusinessID,AnomalyType\nA,B,C'))).toBe('EVALUATOR_FILE');
        expect(refusal(new TextEncoder().encode('a,b\n1,2'))).toBe('UNSUPPORTED_LAYOUT');
        expect(refusal(new Uint8Array([0xff, 0xfe, 0x00]))).toBe('NOT_UTF8');
        expect(refusal(new TextEncoder().encode(HEADER + '\n'))).toBe('EMPTY');
        for (const bad of [{ amount: '1.5' }, { amount: '-1.00' }, { date: '2026-02-30' }, { counterparty: '' }])
            expect(refusal(csv([{ id: 'X', ...bad }]))).toBe('INVALID_ROWS');
        // A signed amount that contradicts its direction is a review candidate, not a parse error.
        expect(refusal(csv([{ id: 'S', signed: '12.00' }]))).toBeNull();
        expect(refusal(csv([{ id: 'DUP' }, { id: 'DUP' }]))).toBe('INVALID_ROWS');
        const mismatchedMonth = new TextDecoder().decode(csv([{ id: 'M' }])).replace(',2026-03,', ',2026-04,');
        expect(refusal(new TextEncoder().encode(mismatchedMonth))).toBe('INVALID_ROWS');
    });
    it('keeps money exact as integer cents', () => {
        expect(toCents('-570.74')).toBe(-57074n);
        expect(fromCents(toCents('0.10') + toCents('0.20'))).toBe('0.30');
        expect(fromCents(-5n)).toBe('-0.05');
        expect(() => toCents('1.234')).toThrow();
    });
});

describe('PoC anomaly rules', () => {
    it('flags nothing in an ordinary history', () => {
        expect(rules(csv(ordinary('N')))).toEqual({});
    });
    it('flags a duplicated reference only within the same business', () => {
        const found = rules(csv([...ordinary('A'), { id: 'D1', reference: 'SAMEREF00001' }, { id: 'D2', reference: 'SAMEREF00001' }, { id: 'D3', business: 'BUS-T02', reference: 'OTHERREF0001' }, { id: 'D4', business: 'BUS-T03', reference: 'OTHERREF0001' }]));
        expect(found.D1).toContain('DUPLICATE_REFERENCE');
        expect(found.D2).toContain('DUPLICATE_REFERENCE');
        expect(found.D3).toBeUndefined();
    });
    it('flags a reference that breaks the business reference format', () => {
        const candidates = detectAnomalies(parseSource(csv([...ordinary('A'), { id: 'F1', reference: 'DUP-7L9HZ1WR' }])).rows);
        expect(candidates.map(c => c.row.rowId)).toEqual(['F1']);
        expect(candidates[0].findings[0]).toMatchObject({ ruleId: 'REFERENCE_FORMAT_IRREGULAR', severity: 'MEDIUM' });
        expect(candidates[0].findings[0].rationale).toContain('duplicate marker');
    });
    it('flags direction tags and signed amounts that contradict the bank direction', () => {
        const found = rules(csv([...ordinary('A'), { id: 'X1', direction: 'Credit', description: '[debit] Borneo Food Distributor payment' }, { id: 'X2', direction: 'Debit', signed: '100.00' }]));
        expect(found.X1).toContain('DIRECTION_CONFLICT');
        expect(found.X2).toContain('DIRECTION_CONFLICT');
    });
    it('flags the minority direction of a near-always one-direction counterparty', () => {
        const found = rules(csv([...ordinary('A'), { id: 'U1', direction: 'Credit', amount: '101.00' }]));
        expect(found.U1).toEqual(['UNUSUAL_DIRECTION_FOR_COUNTERPARTY']);
        const mixed = rules(csv([...ordinary('A'), ...Array.from({ length: 5 }, (_, i) => ({ id: `M${i}`, direction: 'Credit' as const, amount: '101.00' }))]));
        expect(mixed).toEqual({});
    });
    it('flags robust amount outliers against comparable rows and grades severity', () => {
        const candidates = detectAnomalies(parseSource(csv([...ordinary('A'), { id: 'O1', amount: '5000.00' }, { id: 'O2', amount: '106.50' }])).rows);
        expect(candidates.map(c => c.row.rowId)).toEqual(['O1']);
        expect(candidates[0]).toMatchObject({ severity: 'HIGH', findings: [{ ruleId: 'AMOUNT_OUTLIER' }] });
        expect(candidates[0].findings[0].rationale).toMatch(/MYR 5000.00 is \d+\.\d robust deviations above the median MYR 102.00 of 22 debits with Borneo Food Distributor/);
    });
    it('flags unverified counterparties and descriptions that do not name the counterparty', () => {
        const found = rules(csv([...ordinary('A'), { id: 'V1', description: '[debit] NEW UNVERIFIED VENDOR IPJMPXK1 Borneo Food Distributor' }, { id: 'C1', description: '[debit] Staff  Health Centre' }]));
        expect(found.V1).toEqual(['UNVERIFIED_COUNTERPARTY']);
        expect(found.C1).toEqual(['DESCRIPTION_COUNTERPARTY_MISMATCH']);
    });
    it('is unaffected by category labels, generation metadata and row order', () => {
        const base = [...ordinary('A'), { id: 'O1', amount: '5000.00' }, { id: 'C1', description: '[debit] Staff Health Centre' }, { id: 'R1', reference: 'DUP-7L9HZ1WR' }];
        const expected = rules(csv(base));
        expect(rules(csv(base.map(r => ({ ...r, category: 'Anomaly', method: 'injected anomaly' }))))).toEqual(expected);
        expect(rules(csv([...base].reverse()))).toEqual(expected);
        expect(Object.keys(expected).sort()).toEqual(['C1', 'O1', 'R1']);
    });
});

describe('FinancePoCReconciliationV1 consumer', () => {
    const scope = { organizationId: 'org-1', businessId: 'BUS-T01', period: '2026-03', currency: 'MYR' };
    const result = (status: string, bank: string | null, ledger: string[]) => ({ status, bankRecordId: bank, ledgerRecordIds: ledger, reason: 'synthetic', bankEvidenceIds: bank ? [bank] : [], ledgerEvidenceIds: ledger });
    const valid = () => ({ version: 'finance-poc-reconciliation-v1', origin: 'DETERMINISTIC_RULES', scope, sources: { bank: { sourceId: 'bank-1', sha256: 'a'.repeat(64) }, ledger: { sourceId: 'gl-1', sha256: 'b'.repeat(64) } },
        cashMovement: { bank: '150.00', ledger: '100.00', signedDifference: '50.00' }, counts: { MATCH_EXACT: 1, BANK_ONLY: 1 }, results: [result('MATCH_EXACT', 'B1', ['L1']), result('BANK_ONLY', 'B2', [])], limitations: ['synthetic'] });
    it('reports reconciliation as unavailable when no snapshot exists', () => {
        expect(readReconciliation(null, scope)).toMatchObject({ status: 'UNAVAILABLE' });
    });
    it('accepts a consistent in-scope snapshot under either row field name', () => {
        const view = readReconciliation(valid(), scope);
        expect(view.status).toBe('AVAILABLE');
        if (view.status === 'AVAILABLE') expect(view.snapshot.counts).toMatchObject({ MATCH_EXACT: 1, BANK_ONLY: 1, LEDGER_ONLY: 0 });
        const { results, ...rest } = valid();
        expect(readReconciliation({ ...rest, items: results }, scope).status).toBe('AVAILABLE');
        expect(readReconciliation({ ...valid(), items: results }, scope).status).toBe('UNAVAILABLE');
    });
    it('refuses snapshots from another scope, with inconsistent counts or difference, or another contract', () => {
        expect(readReconciliation(valid(), { ...scope, organizationId: 'org-2' }).status).toBe('UNAVAILABLE');
        expect(readReconciliation(valid(), { ...scope, period: '2026-04' }).status).toBe('UNAVAILABLE');
        expect(readReconciliation({ ...valid(), counts: { MATCH_EXACT: 2 } }, scope).status).toBe('UNAVAILABLE');
        expect(readReconciliation({ ...valid(), cashMovement: { bank: '150.00', ledger: '100.00', signedDifference: '-50.00' } }, scope).status).toBe('UNAVAILABLE');
        expect(readReconciliation({ ...valid(), version: 'v2' }, scope).status).toBe('UNAVAILABLE');
        expect(readReconciliation({ ...valid(), cashMovement: { bank: 150, ledger: '100.00', signedDifference: '50.00' } }, scope).status).toBe('UNAVAILABLE');
    });
});
