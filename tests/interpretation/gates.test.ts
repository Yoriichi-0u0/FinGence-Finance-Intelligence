import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEvidence, readTable } from '../../lib/interpretation/evidence';
import { verifyProposal } from '../../lib/interpretation/gates';
import { evidenceSchema, modelProposalSchema, parseProposal, proposalSchema, type LayoutProposal } from '../../lib/interpretation/contracts';
import { parseAmount, parseDate } from '../../lib/interpretation/formats';
import { CORRECT, wire } from './proposals';

const unfamiliar = (name: string) => readTable(new Uint8Array(readFileSync(join('public/demo/unfamiliar', name))))!;
const fixture = (name: string) => readTable(new Uint8Array(readFileSync(join('tests/fixtures/interpretation', name))))!;
const text = (table: ReturnType<typeof readTable>, change: (t: string) => string) => readTable(new TextEncoder().encode(change(table!.rows.map(r => r.map(v => /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n'))))!;
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

describe('sign conventions without a running balance', () => {
    const DC = 'bank-debit-credit-no-balance.csv', DRCR = 'bank-dr-cr-no-balance.csv', REVERSED = 'signed-amount-reversed-no-balance.csv';
    const exportCanonical = () => new TextDecoder().decode(verifyProposal(unfamiliar(BANK), CORRECT[BANK]).canonical!.bytes);
    it.each([DC, DRCR])('%s: stated headings or tokens confirm direction and reproduce the bank export exactly', name => {
        const r = verifyProposal(fixture(name), CORRECT[name]);
        expect(failed(r)).toEqual([]);
        expect(r.checks.find(c => c.id === 'balance')).toBeUndefined();
        expect(r.checks.find(c => c.id === 'direction')!.detail).toBe('Headings/tokens agree');
        expect(new TextDecoder().decode(r.canonical!.bytes)).toBe(exportCanonical());
    });
    it('bank Debit/Credit headings are the account holder\'s view: reading Credit as money out contradicts', () => {
        expect(failed(verifyProposal(fixture(DC), edit(CORRECT[DC], p => { p.columns.moneyIn = 5; p.columns.moneyOut = 6; })))).toEqual(['direction']);
    });
    it('a bank statement declared as a cash ledger (which would flip Debit/Credit) is refused by its own wording', () => {
        const asLedger = edit(CORRECT[DC], p => { p.role = 'GENERAL_LEDGER'; p.representation = 'DEBIT_CREDIT'; p.columns.debit = 5; p.columns.credit = 6; p.columns.moneyIn = null; p.columns.moneyOut = null; });
        const r = verifyProposal(fixture(DC), asLedger);
        expect(r.checks.find(c => c.id === 'direction')!.passed).toBe(true); // the flipped reading is self-consistent...
        expect(failed(r)).toEqual(['role-evidence']); // ...so only the document's own role evidence stops it
        expect(r.canonical).toBeNull();
        const tokens = edit(CORRECT[DRCR], p => { p.role = 'GENERAL_LEDGER'; p.directionTokens = { inflow: ['DR'], outflow: ['CR'] }; });
        expect(failed(verifyProposal(fixture(DRCR), tokens))).toEqual(['role-evidence']);
    });
    it('a ledger declared as a bank statement is refused the same way', () => {
        const asBank = edit(CORRECT[LEDGER], p => { p.role = 'BANK_STATEMENT'; p.representation = 'SPLIT_IN_OUT'; p.columns.moneyIn = 6; p.columns.moneyOut = 5; p.columns.debit = null; p.columns.credit = null; });
        const r = verifyProposal(unfamiliar(LEDGER), asBank);
        expect(r.checks.find(c => c.id === 'direction')!.passed).toBe(true); // "Cr" as money in is heading-consistent for a bank...
        expect(failed(r)).toEqual(['role-evidence']); // ...and would invert every sign of the ledger
    });
    it('a role the document never states is not taken on the model\'s word', () => {
        const anonymous = text(fixture(DC), t => t.replace('Demo Bank Berhad - Current Account Statement', 'Demo Bank Berhad').replace('Account holder', 'Name').replace('Statement period', 'Period'));
        expect(failed(verifyProposal(anonymous, CORRECT[DC]))).toEqual(['role-evidence']);
    });
    it('an opaque signed column with no balance is quarantined whichever sign convention is assumed', () => {
        const signed = edit(CORRECT[DC], p => { p.representation = 'SIGNED_AMOUNT'; p.columns.amount = 5; p.columns.moneyIn = null; p.columns.moneyOut = null; });
        const r = verifyProposal(fixture(REVERSED), signed);
        expect(failed(r)).toEqual(['direction']);
        expect(r.mapping.find(m => m.field === 'amount')!.agreement).toBe('OPAQUE');
        expect(r.checks.find(c => c.id === 'direction')!.detail).toMatch(/does not state which sign is cash in/);
    });
    it('a one-sided heading cannot be a signed column', () => {
        const relabelled = text(fixture(REVERSED), t => t.replace('Amount (RM)', 'Withdrawal (RM)'));
        const signed = edit(CORRECT[DC], p => { p.representation = 'SIGNED_AMOUNT'; p.columns.amount = 5; p.columns.moneyIn = null; p.columns.moneyOut = null; });
        const r = verifyProposal(relabelled, signed);
        expect(failed(r)).toEqual(['direction']);
        expect(r.mapping.find(m => m.field === 'amount')!.agreement).toBe('CONTRADICTS');
    });
    it('a signed ledger column named only "Amount" without a balance is quarantined; "Net cash movement" is accepted', () => {
        const name = 'ledger-signed-opaque-no-balance.csv', p = edit(CORRECT[SIGNED], p => { p.headerLine = 5; });
        expect(failed(verifyProposal(fixture(name), p))).toEqual(['direction']);
        expect(verifyProposal(unfamiliar(SIGNED), CORRECT[SIGNED]).mapping.find(m => m.field === 'amount')!.agreement).toBe('AGREES');
    });
    it('a running balance still confirms an opaque signed column', () => {
        const withBalance = text(unfamiliar(MALAY), t => t);
        const p = edit(CORRECT[MALAY], p => { p.representation = 'SIGNED_AMOUNT'; p.columns.direction = null; p.directionTokens = { inflow: [], outflow: [] }; });
        // Re-express the Malay statement with signed amounts in the Jumlah column; the balance column is untouched.
        const signed = readTable(new TextEncoder().encode(withBalance.rows.map(r => r.length === 7 && /^(DR|CR)$/.test(r[5]) ? [...r.slice(0, 4), (r[5] === 'DR' ? '-' : '') + r[4], '', r[6]] : r).map(r => r.map(v => /[;"]/.test(v) ? `"${v}"` : v).join(';')).join('\n')))!;
        const r = verifyProposal(signed, p);
        expect(failed(r)).toEqual([]);
        expect(r.checks.find(c => c.id === 'direction')!.detail).toBe('Opaque headings; confirmed by the running balance');
        expect(r.canonical!.net).toBe('28232.01');
    });
});

describe('ledger account identity', () => {
    const ledgerProposal = (headerLine: number, change: (p: LayoutProposal) => void = () => {}) => edit(CORRECT[LEDGER], p => {
        p.headerLine = headerLine; p.scope = { businessId: { line: 1, literal: 'DEMO-001' }, businessName: { line: 0, literal: 'Rimba Demo Kitchen (Synthetic)' }, currency: { line: headerLine - 2, literal: 'RM' }, statementPeriod: { line: headerLine - 3, literal: 'March 2026' } }; change(p);
    });
    it('a double-entry extract with several accounts is refused, mapped or not', () => {
        const name = 'ledger-multiple-accounts.csv';
        const mapped = ledgerProposal(5, p => { p.columns.account = 5; p.columns.debit = 6; p.columns.credit = 7; });
        const r = verifyProposal(fixture(name), mapped);
        expect(failed(r)).toEqual(['account']);
        expect(r.checks.find(c => c.id === 'account')!.detail).toMatch(/^3 accounts: /);
        const unmapped = ledgerProposal(5, p => { p.columns.debit = 6; p.columns.credit = 7; });
        const u = verifyProposal(fixture(name), unmapped);
        expect(failed(u)).toEqual(['account']);
        expect(u.checks.find(c => c.id === 'account')!.detail).toMatch(/in unmapped column "Account"/);
    });
    it.each([
        ['ledger-sales-account.csv', 6, /"Account 4000 Sales - Food" is not a cash or bank account/],
        ['ledger-bank-loan-account.csv', 6, /Bank loan.*is not a cash or bank account/],
        ['ledger-no-account-evidence.csv', 5, /does not name the account/],
    ] as const)('%s is not evidenced as a cash account', (name, headerLine, detail) => {
        const r = verifyProposal(fixture(name), ledgerProposal(headerLine));
        expect(failed(r)).toEqual(['account']);
        expect(r.checks.find(c => c.id === 'account')!.detail).toMatch(detail);
        expect(r.canonical).toBeNull();
    });
    it('a single-valued account column must itself name cash or bank', () => {
        const withColumn = text(unfamiliar(LEDGER), t => t.replace('Dr (RM),Cr (RM)', 'Dr (RM),Cr (RM),Account').replace(/^(\d\d-Mar-2026,.*)$/gm, '$1,4000 Sales'));
        const p = edit(CORRECT[LEDGER], p => { p.columns.account = 7; });
        expect(failed(verifyProposal(withColumn, p))).toEqual(['account']);
        const cash = text(unfamiliar(LEDGER), t => t.replace('Dr (RM),Cr (RM)', 'Dr (RM),Cr (RM),Account').replace(/^(\d\d-Mar-2026,.*)$/gm, '$1,1000 Cash at bank'));
        const ok = verifyProposal(cash, p);
        expect(failed(ok)).toEqual([]);
        expect(ok.disclosures.join(' ')).toMatch(/Cash account "1000 Cash at bank" recorded as 1000-BANK/);
    });
});

describe('the file name never establishes a financial role', () => {
    // verifyProposal has no file-name input at all; the pipeline tests prove the same bytes under any name give the same verdict.
    const AMBIGUOUS = 'bank-ambiguous-debit-credit.csv';
    it('an ambiguous bank statement is not accepted as a ledger (which would invert every sign)', () => {
        const asLedger = edit(CORRECT['bank-debit-credit-no-balance.csv'], p => {
            Object.assign(p, { role: 'GENERAL_LEDGER', representation: 'DEBIT_CREDIT', headerLine: 7 });
            Object.assign(p.columns, { debit: 5, credit: 6, moneyIn: null, moneyOut: null });
            p.scope = { businessId: { line: 2, literal: 'DEMO-001' }, businessName: { line: 1, literal: 'Rimba Demo Kitchen (Synthetic)' }, currency: { line: 5, literal: 'MYR' }, statementPeriod: { line: 4, literal: '01/03/2026 to 31/03/2026' } };
        });
        const r = verifyProposal(fixture(AMBIGUOUS), asLedger);
        expect(r.decision).toBe('QUARANTINED');
        expect(r.canonical).toBeNull();
        expect(failed(r)).toEqual(['role-evidence']);
        expect(r.checks.find(c => c.id === 'role-evidence')!.detail).toBe('Title and headings do not say, or say both');
    });
    it('a ledger stripped of ledger wording is not accepted as a bank statement', () => {
        const stripped = text(unfamiliar(LEDGER), t => t.replace(' - General Ledger Detail', '').replace('Journal Date,Voucher No', 'Date,No'));
        const asBank = edit(CORRECT[LEDGER], p => { p.role = 'BANK_STATEMENT'; p.representation = 'SPLIT_IN_OUT'; p.columns.moneyIn = 6; p.columns.moneyOut = 5; p.columns.debit = null; p.columns.credit = null; });
        const r = verifyProposal(stripped, asBank);
        expect([r.decision, failed(r)]).toEqual(['QUARANTINED', ['role-evidence']]);
    });
});

describe('v2 model contract: contradictory money mappings cannot be expressed', () => {
    const ALL = Object.keys(CORRECT);
    it.each(ALL)('%s round-trips through the v2 wire form and is accepted', name => {
        const parsed = parseProposal(wire(CORRECT[name]));
        expect(parsed).toMatchObject({ success: true, version: 'v2' });
        expect(parsed.success && parsed.data).toEqual(CORRECT[name]);
    });
    it('accepts the v2 form under the gates with the same canonical bytes as the flat form', () => {
        for (const name of [BANK, LEDGER, MALAY, SIGNED]) {
            const a = verifyProposal(unfamiliar(name), CORRECT[name]), b = verifyProposal(unfamiliar(name), wire(CORRECT[name]));
            expect(b.checks[0]).toMatchObject({ id: 'schema', detail: 'Valid' });
            expect(a.checks[0].detail).toBe('Valid (legacy v1 layout)');
            expect(new TextDecoder().decode(b.canonical!.bytes)).toBe(new TextDecoder().decode(a.canonical!.bytes));
            expect(b.mappingKey).toBe(a.mappingKey);
        }
    });
    // Each shape below is one the live models actually produced in the release-readiness evaluation.
    const bank = () => wire(CORRECT['bank-dr-cr-no-balance.csv']) as { layout: Record<string, unknown> };
    it.each([
        ['SPLIT_IN_OUT with amount + direction (both models, DR/CR statement)', () => { const p = bank(); p.layout.money = { representation: 'SPLIT_IN_OUT', amount: 5, direction: 6 }; return p; }],
        ['DR/CR with empty tokens', () => { const p = bank(); p.layout.money = { representation: 'AMOUNT_AND_DIRECTION', amount: 5, direction: 6, inflowTokens: [], outflowTokens: [] }; return p; }],
        ['one column as both money-in and credit (20B, Debit/Credit statement)', () => { const p = bank(); p.layout.money = { representation: 'SPLIT_IN_OUT', moneyIn: 6, moneyOut: 5, debit: 5, credit: 6 }; return p; }],
        ['ledger-only debit/credit on a bank statement (120B)', () => { const p = bank(); p.layout.money = { representation: 'DEBIT_CREDIT', debit: 5, credit: 6 }; return p; }],
        ['SPLIT_IN_OUT on a ledger', () => { const p = wire(CORRECT[LEDGER]) as { layout: Record<string, unknown> }; p.layout.money = { representation: 'SPLIT_IN_OUT', moneyIn: 5, moneyOut: 6 }; return p; }],
        ['no date column', () => { const p = bank(); p.layout.columns = { ...(p.layout.columns as object), date: null }; return p; }],
    ])('rejects %s', (_, make) => {
        const raw = make();
        expect(modelProposalSchema.safeParse(raw).success).toBe(false);
        expect(proposalSchema.safeParse(raw).success).toBe(false);
        const r = verifyProposal(fixture('bank-dr-cr-no-balance.csv'), raw);
        expect(failed(r)).toEqual(['schema']);
        expect(r.canonical).toBeNull();
    });
    it('an abstention needs no layout fields and stops at the role gate', () => {
        expect(failed(verifyProposal(fixture('staff-roster.csv'), { layout: { role: 'UNSUPPORTED' }, rationale: 'A staff roster.', unresolved: [] }))).toEqual(['role']);
    });
    it('legacy flat proposals (stored before v2) still face every gate', () => {
        const legacyWrong = edit(CORRECT[BANK], p => { p.columns.moneyIn = 5; p.columns.moneyOut = 6; });
        expect(failed(verifyProposal(unfamiliar(BANK), legacyWrong))).toEqual(['balance']);
    });
});
