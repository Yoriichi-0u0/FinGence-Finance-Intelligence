import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEvidence, readTable } from '../../lib/interpretation/evidence';
import { verifyProposal } from '../../lib/interpretation/gates';
import { evidenceSchema, proposalSchema, type LayoutProposal } from '../../lib/interpretation/contracts';
import { parseAmount, parseDate } from '../../lib/interpretation/formats';
import { CORRECT } from './proposals';

const unfamiliar = (name: string) => readTable(new Uint8Array(readFileSync(join('public/demo/unfamiliar', name))))!;
const fixture = (name: string) => readTable(new Uint8Array(readFileSync(join('tests/fixtures/interpretation', name))))!;
const BANK = 'bank-statement-march-2026-export.csv', LEDGER = 'general-ledger-cash-march-2026.csv', MALAY = 'penyata-bank-mac-2026.csv', SIGNED = 'ledger-signed-march-2026.csv';
const failed = (r: ReturnType<typeof verifyProposal>) => r.checks.filter(c => !c.passed).map(c => c.id);
const edit = (p: LayoutProposal, change: (p: LayoutProposal) => void) => { const copy = structuredClone(p); change(copy); return copy; };

describe('strict parsers', () => {
    it('reads declared date and number formats exactly', () => {
        expect(parseDate('05/03/2026', 'DD/MM/YYYY')).toBe('2026-03-05');
        expect(parseDate('05/03/2026', 'MM/DD/YYYY')).toBe('2026-05-03');
        expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
        expect(parseDate('02-Mac-2026', 'DD-Mon-YYYY')).toBe('2026-03-02');
        expect(parseAmount('1,234.56', 'COMMA_THOUSANDS_DOT_DECIMAL')).toBe(123456n);
        expect(parseAmount('1.234,56', 'DOT_THOUSANDS_COMMA_DECIMAL')).toBe(123456n);
        expect(parseAmount('(12.50)', 'PLAIN')).toBe(-1250n);
        expect(parseAmount('1,234.56', 'PLAIN')).toBeNull();
        expect(parseAmount('', 'PLAIN')).toBeUndefined();
    });
});

describe('evidence shown to a model', () => {
    it('is bounded, schema-valid and never the whole document', () => {
        const table = unfamiliar(BANK), evidence = buildEvidence(table, 'a'.repeat(64), BANK);
        expect(evidenceSchema.safeParse(evidence).success).toBe(true);
        expect(evidence.profileHeaderLine).toBe(8);
        expect(evidence.head.length + evidence.tail.length).toBeLessThan(table.rows.length / 2);
        expect(JSON.stringify(evidence).length).toBeLessThan(12_000);
    });
});

describe('correct proposals are accepted and materialized', () => {
    it.each([BANK, LEDGER, MALAY, SIGNED])('%s', name => {
        expect(proposalSchema.safeParse(CORRECT[name]).success).toBe(true);
        const r = verifyProposal(unfamiliar(name), CORRECT[name]);
        expect(failed(r)).toEqual([]);
        expect(r.decision).toBe('AUTO_ACCEPTED');
        expect(r.canonical).toMatchObject({ rows: 57, period: '2026-03', businessId: 'DEMO-001', net: name.includes('bank') || name.includes('penyata') ? '28232.01' : '30924.93' });
    });
    it('confirms direction by headings and the running balance on the bank export', () => {
        const r = verifyProposal(unfamiliar(BANK), CORRECT[BANK]);
        expect(r.checks.find(c => c.id === 'balance')!.detail).toMatch(/^56 of 56/);
        expect(r.mapping.find(m => m.field === 'moneyIn')!.agreement).toBe('AGREES');
        expect(r.disclosures.join(' ')).toMatch(/non-transaction lines excluded/);
    });
    it('uses line-derived IDs when the statement has no ID column', () => {
        const r = verifyProposal(unfamiliar(MALAY), CORRECT[MALAY]);
        expect(new TextDecoder().decode(r.canonical!.bytes).split('\n')[1]).toMatch(/^L8,DEMO-001,/);
    });
});

describe('wrong proposals are quarantined, never accepted with wrong figures', () => {
    const cases: [string, string, (p: LayoutProposal) => void, string][] = [
        ['swapped deposit/withdrawal', BANK, p => { p.columns.moneyIn = 5; p.columns.moneyOut = 6; }, 'balance'],
        ['swapped debit/credit without a balance', LEDGER, p => { p.columns.debit = 6; p.columns.credit = 5; }, 'direction'],
        ['US date order', BANK, p => { p.dateFormat = 'MM/DD/YYYY'; }, 'dates'],
        ['wrong number format', MALAY, p => { p.numberFormat = 'COMMA_THOUSANDS_DOT_DECIMAL'; }, 'amounts'],
        ['inverted direction tokens', MALAY, p => { p.directionTokens = { inflow: ['DR'], outflow: ['CR'] }; }, 'balance'],
        ['header line off by one', BANK, p => { p.headerLine = 9; }, 'header'],
        ['description mapped to the date column', BANK, p => { p.columns.description = 0; }, 'mapping'],
        ['invented business ID', BANK, p => { p.scope.businessId = { line: 2, literal: 'DEMO-999' }; }, 'scope'],
        ['currency not stated', SIGNED, p => { p.scope.currency = null; }, 'scope'],
        ['wrong stated period', BANK, p => { p.scope.statementPeriod = { line: 4, literal: '01/03/2026 to 31/03/2026' }; p.scope.statementPeriod.literal = 'Mac 2025'; }, 'scope'],
        ['stray money column', BANK, p => { p.columns.amount = 6; }, 'mapping'],
        ['representation not valid for the role', LEDGER, p => { p.representation = 'SPLIT_IN_OUT'; p.columns.moneyIn = 5; p.columns.moneyOut = 6; p.columns.debit = null; p.columns.credit = null; }, 'mapping'],
    ];
    it.each(cases)('%s', (_, name, change, gate) => {
        const r = verifyProposal(unfamiliar(name), edit(CORRECT[name], change));
        expect(r.decision).toBe('QUARANTINED');
        expect(r.canonical).toBeNull();
        expect(failed(r)).toContain(gate);
    });
    it('rejects malformed or abstaining model output', () => {
        expect(failed(verifyProposal(unfamiliar(BANK), { role: 'BANK_STATEMENT' }))).toEqual(['schema']);
        expect(failed(verifyProposal(unfamiliar(BANK), 'not json'))).toEqual(['schema']);
        expect(failed(verifyProposal(unfamiliar(BANK), { ...CORRECT[BANK], role: 'UNSUPPORTED' }))).toEqual(['role']);
    });
});

describe('adversarial documents', () => {
    it('opaque headings without a balance cannot confirm direction', () => {
        const p = edit(CORRECT[BANK], p => { p.headerLine = 3; p.columns.balance = null; p.scope = { businessId: { line: 0, literal: 'DEMO-001' }, businessName: null, currency: { line: 1, literal: 'MYR' }, statementPeriod: null }; });
        expect(failed(verifyProposal(fixture('opaque-headings-no-balance.csv'), p))).toEqual(['direction']);
    });
    it('a corrupted running balance quarantines even a correct mapping', () => {
        expect(failed(verifyProposal(fixture('corrupted-running-balance.csv'), CORRECT[BANK]))).toEqual(['balance']);
    });
    it('mislabelled columns are inconsistent whichever way they are mapped', () => {
        const table = fixture('mislabelled-withdrawal-deposit.csv');
        expect(failed(verifyProposal(table, CORRECT[BANK]))).toEqual(['direction']);
        expect(failed(verifyProposal(table, edit(CORRECT[BANK], p => { p.columns.moneyIn = 5; p.columns.moneyOut = 6; })))).toEqual(['balance']);
    });
    it('a malformed final transaction is never silently dropped', () => {
        const text = readFileSync(join('public/demo/unfamiliar', BANK), 'utf8').replace('DEMO BANK BERHAD MONTHLY ACCOUNT FEE,', 'DEMO BANK BERHAD, MONTHLY ACCOUNT FEE,');
        const r = verifyProposal(readTable(new TextEncoder().encode(text))!, CORRECT[BANK]);
        expect(r.decision).toBe('QUARANTINED');
        expect(failed(r)).toContain('excluded');
    });
    it('foreign currency is refused', () => {
        const p = edit(CORRECT[BANK], p => { p.scope.currency = { line: 5, literal: 'USD' }; });
        expect(failed(verifyProposal(fixture('usd-statement.csv'), p))).toEqual(['scope']);
    });
});
