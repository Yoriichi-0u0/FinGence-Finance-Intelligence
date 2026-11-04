import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { buildEvidence, readTable } from '../../lib/interpretation/evidence';
import { verifyProposal, type GateOptions } from '../../lib/interpretation/gates';
import { wordsToTable, type Word } from '../../lib/interpretation/positioned';
import { CORRECT, wire } from './proposals';

/** Layouts real statements use that the first samples did not: each case edits the public bank export. */
const BANK = 'bank-statement-march-2026-export.csv';
const source = readFileSync(`public/demo/unfamiliar/${BANK}`, 'utf8');
const rows = () => Papa.parse<string[]>(source, { skipEmptyLines: false }).data.filter((r, i, all) => i < all.length - 1 || r.some(Boolean));
const table = (rs: string[][]) => readTable(new TextEncoder().encode(Papa.unparse(rs, { newline: '\n' }) + '\n'))!;
const failed = (v: ReturnType<typeof verifyProposal>) => v.checks.filter(c => !c.passed).map(c => c.id);
const INGESTION: GateOptions = { scope: { months: 'MANY', currencies: 'ANY' } };
const without = (rs: string[][], i: number) => [...rs.slice(0, i), ...rs.slice(i + 1)];

describe('totals and balance-forward lines are not transactions', () => {
    it('a totals block printed directly under the table (no blank line) is excluded and disclosed', () => {
        const rs = rows(), blank = rs.findIndex((r, i) => i > 9 && !r.some(Boolean));
        const v = verifyProposal(table(without(rs, blank)), wire(CORRECT[BANK]));
        expect(v.decision).toBe('AUTO_ACCEPTED');
        expect(v.disclosures.join(' ')).toMatch(/excluded: line 67 "Total withdrawals 40,401.31"/);
    });
    it('a "Balance carried forward" line between pages is excluded, the balance still holds across it', () => {
        const rs = rows();
        rs.splice(40, 0, ['', '', '', 'Balance carried forward', '', '', '', rs[39][7]]);
        const v = verifyProposal(table(rs), wire(CORRECT[BANK]));
        expect(v.decision).toBe('AUTO_ACCEPTED');
        expect(v.disclosures.join(' ')).toMatch(/1 balance or total line between transactions excluded/);
    });
    it('a dated line that merely mentions a total is still a transaction (and must parse)', () => {
        const rs = rows();
        rs[20][3] = 'TOTAL TOPUP CREDIT'; // a description, not a footer: the date is valid, so the row stays a transaction
        expect(verifyProposal(table(rs), wire(CORRECT[BANK])).decision).toBe('AUTO_ACCEPTED');
    });
});

describe('a line with no amount on either side', () => {
    const zeroLine = (rs: string[][], at: number, balance: string) => { rs.splice(at, 0, [rs[at - 1][0], 'BANK-DEMO-0999', 'FAILEDTX0001', 'FAILED-INSUFFICIENT FUNDS', 'Demo Bank Berhad', '', '', balance]); return rs; };
    it('is no cash movement when the running balance is unchanged', () => {
        const rs = rows(), v = verifyProposal(table(zeroLine(rs, 20, rows()[19][7])), wire(CORRECT[BANK]));
        expect(v.decision).toBe('AUTO_ACCEPTED');
        expect(v.disclosures.join(' ')).toMatch(/1 line with no amount on either side read as no cash movement, confirmed by the running balance/);
    });
    it('is refused when the balance moves on that line', () => {
        expect(failed(verifyProposal(table(zeroLine(rows(), 20, '1.00')), wire(CORRECT[BANK])))).toEqual(['balance']);
    });
    it('is refused without a running balance to confirm it', () => {
        const v = verifyProposal(table(zeroLine(rows(), 20, '')), wire({ ...CORRECT[BANK], columns: { ...CORRECT[BANK].columns, balance: null } }));
        expect(failed(v)[0]).toBe('amounts');
    });
});

describe('statement shapes beyond the first samples', () => {
    it('a statement without a separate reference column is accepted (references stay empty)', () => {
        const p = structuredClone(CORRECT[BANK]); p.columns.reference = null;
        const v = verifyProposal(table(rows()), wire(p));
        expect(v.decision).toBe('AUTO_ACCEPTED');
        expect(new TextDecoder().decode(v.canonical!.bytes).split('\n')[1].split(',')[7]).toBe('');
    });
    it('several months and a stated non-MYR currency are accepted under the ingestion scope only', () => {
        const rs = rows().map(r => r.map(c => c.replace('Malaysian Ringgit (MYR)', 'Singapore Dollar (SGD)').replace('31/03/2026', '30/04/2026')));
        rs.splice(rs.findIndex(r => r[1] === 'BANK-DEMO-0057') + 1, 0, ['02/04/2026', 'BANK-DEMO-0100', 'APRILREF0001', 'April deposit', 'Customer', '', '100.00', '73,332.01']);
        const p = structuredClone(CORRECT[BANK]); p.scope.currency = { line: 5, literal: 'SGD' }; p.scope.statementPeriod = { line: 4, literal: '01/03/2026 to 30/04/2026' };
        expect(failed(verifyProposal(table(rs), wire(p)))).toEqual(['period']);
        const v = verifyProposal(table(rs), wire(p), INGESTION);
        expect([v.decision, v.canonical?.period]).toEqual(['AUTO_ACCEPTED', '2026-03/2026-04']);
        expect(new TextDecoder().decode(v.canonical!.bytes)).toMatch(/,SGD,2026-04-02,2026-04,APRILREF0001/);
    });
    it('a long letterhead still shows the model the lines around the table header', () => {
        const rs = [...Array.from({ length: 30 }, (_, i) => [`Letterhead line ${i + 1}`]), ...rows()];
        const evidence = buildEvidence(table(rs), 'f'.repeat(64), 'long.csv');
        expect(evidence.head.map(l => l.line)).toContain(38);
        expect(evidence.head.find(l => l.line === 38)!.cells[0]).toBe('Date');
    });
});

describe('heading fragments and wrapped lines in positioned text', () => {
    const w = (text: string, x0: number, y: number): Word => ({ text, x0, x1: x0 + text.length * 5, y0: y, y1: y + 8, page: 1 });
    const line = (cells: [string, number][], y: number) => cells.map(([t, x]) => w(t, x, y));
    const body = [...line([['01/03/2026', 0], ['Payment', 80], ['10.00', 200]], 40), ...line([['02/03/2026', 0], ['Receipt', 80], ['5.00', 200]], 52)];
    it('a two-cell preamble line above the headings is not joined to them', () => {
        // Same block (18 < 1.6 × the 12-point line pitch), but further above the headings than the headings are above the first row.
        const words = [...line([['Currency', 0], ['MYR', 80]], 0), ...line([['Date', 0], ['Details', 80], ['Amount', 200]], 18), ...body.map(x => ({ ...x, y0: x.y0 - 10, y1: x.y1 - 10 }))];
        expect(new TextDecoder().decode(wordsToTable(words).bytes).split('\n').slice(0, 2)).toEqual(['Currency,MYR', 'Date,Details,Amount']);
    });
    it('a heading fragment printed tight above the headings is joined to them', () => {
        const words = [...line([['Posting', 0], ['Transaction', 80]], 20), ...line([['Date', 0], ['Details', 80], ['Amount', 200]], 29), ...body];
        expect(new TextDecoder().decode(wordsToTable(words).bytes).split('\n')[0]).toBe('Posting Date,Transaction Details,Amount');
    });
    it('a description wrapped above its transaction joins it; a totals line is never a continuation', () => {
        const words = [...line([['Date', 0], ['Details', 80], ['Amount', 200]], 0), ...line([['IMPS-1234-HEALTHCARE', 80]], 14), ...line([['01/03/2026', 0], ['PRODUCTS LTD', 80], ['10.00', 200]], 22),
            ...line([['02/03/2026', 0], ['Receipt', 80], ['5.00', 200]], 36), ...line([['Total', 80], ['Rs. 15.00', 200]], 48)];
        expect(new TextDecoder().decode(wordsToTable(words).bytes).trim().split('\n')).toEqual(['Date,Details,Amount', '01/03/2026,IMPS-1234-HEALTHCARE PRODUCTS LTD,10.00', '02/03/2026,Receipt,5.00', ',Total,Rs. 15.00']);
    });
});
