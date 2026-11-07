import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { processDocuments, type DocumentInput, type ProcessingContext } from '../../lib/demo/pipeline';
import type { LayoutInterpreter } from '../../lib/interpretation/contracts';
import { extractDocument } from '../../lib/interpretation/extract';
import { stopOcr } from '../../lib/interpretation/ocr';
import { wordsToTable, type Word } from '../../lib/interpretation/positioned';
import { CORRECT, wire } from './proposals';

const DIR = 'public/demo/unfamiliar', BANK_PDF = 'bank-statement-march-2026.pdf', LEDGER_PDF = 'general-ledger-cash-march-2026.pdf', LEDGER_SCAN = 'general-ledger-cash-march-2026-scan.jpg';
const BANK = 'demo-bank-statement-2026-03.csv', LEDGER = 'demo-general-ledger-2026-03.csv', HISTORY = 'demo-bank-history-2025-04-to-2026-03.csv';
const input = (name: string, bytes: Uint8Array): DocumentInput => ({ name, bytes, provenance: 'USER_SUPPLIED' });
const file = (dir: string, name: string) => input(name, new Uint8Array(readFileSync(join(dir, name))));
const receipt = { provider: 'GROQ' as const, model: 'recorded-test', requestId: null, latencyMs: 0, inputTokens: null, outputTokens: null, estimatedUsd: null, mode: 'LIVE' as const };
const recorded: LayoutInterpreter = { async propose(e) { const p = CORRECT[e.fileName]; return { proposal: p ? wire(p) : { layout: { role: 'UNSUPPORTED' }, rationale: '', unresolved: [] }, receipt }; } };
const figures = (c: ProcessingContext) => ({
    status: c.status, scope: c.scope, counts: c.outputs.reconciliation?.counts, cash: c.outputs.reconciliation?.cashMovement, totals: c.outputs.totals,
    anomalies: c.outputs.anomalies.map(a => [a.row.date, a.row.amount, a.severity]), forecast: c.outputs.forecast?.forecast,
});
afterAll(() => stopOcr());

describe('positioned words become a table by geometry alone', () => {
    const w = (text: string, x0: number, y: number, page = 1): Word => ({ text, x0, x1: x0 + text.length * 5, y0: y, y1: y + 10, page });
    it('keeps an empty cell empty by aligning every line to the heading columns', () => {
        const words = [w('Date', 0, 0), w('Ref', 80, 0), w('In', 160, 0), w('Out', 240, 0),
            w('01/03/2026', 0, 14), w('A1', 80, 14), w('10.00', 160, 14), w('02/03/2026', 0, 28), w('A2', 80, 28), w('5.00', 240, 28)];
        expect(new TextDecoder().decode(wordsToTable(words).bytes).trim().split('\n')).toEqual(['Date,Ref,In,Out', '01/03/2026,A1,10.00,', '02/03/2026,A2,,5.00']);
    });
    it('continues a table across pages and drops repeated headings and page numbers, with notes', () => {
        const words = [w('Date', 0, 0), w('Ref', 80, 0), w('Amount', 160, 0), w('01/03/2026', 0, 14), w('A1', 80, 14), w('1.00', 160, 14), w('Page 1 of 2', 80, 200),
            w('Date', 0, 0, 2), w('Ref', 80, 0, 2), w('Amount', 160, 0, 2), w('02/03/2026', 0, 14, 2), w('A2', 80, 14, 2), w('2.00', 160, 14, 2)];
        const t = wordsToTable(words);
        expect(new TextDecoder().decode(t.bytes).trim().split('\n')).toEqual(['Date,Ref,Amount', '01/03/2026,A1,1.00', '02/03/2026,A2,2.00']);
        expect(t.notes).toEqual(['1 page-number line not read ("Page 1 of 2").', '1 repeated column-heading line on later pages not read.']);
    });
    it('reads a tilted scan line as one line', () => {
        const tilt = (word: Word) => ({ ...word, y0: word.y0 + word.x0 * 0.01, y1: word.y1 + word.x0 * 0.01 });
        const words = ['Date', 'Ref', 'Party', 'In', 'Out', 'Balance'].map((h, i) => tilt(w(h, i * 120, 0)))
            .concat(['01/03/2026', 'A1', 'Kedai', '10.00', '', '10.00'].flatMap((v, i) => v ? [tilt(w(v, i * 120, 16))] : []))
            .concat(['02/03/2026', 'A2', 'Kedai', '20.00', '', '30.00'].flatMap((v, i) => v ? [tilt(w(v, i * 120, 32))] : []));
        expect(new TextDecoder().decode(wordsToTable(words).bytes).trim().split('\n')).toEqual(['Date,Ref,Party,In,Out,Balance', '01/03/2026,A1,Kedai,10.00,,10.00', '02/03/2026,A2,Kedai,20.00,,30.00']);
    });
});

describe('PDF documents give exactly the Phase 1 results', () => {
    it('text-layer PDFs of both documents are interpreted, anchored and reconciled to the cent', async () => {
        const baseline = await processDocuments([file('public/demo', BANK), file('public/demo', LEDGER), file('public/demo', HISTORY)]);
        const c = await processDocuments([file(DIR, BANK_PDF), file(DIR, LEDGER_PDF), file('public/demo', HISTORY)], undefined, undefined, { interpreter: recorded });
        expect(figures(c)).toEqual(figures(baseline));
        expect(c.documents.slice(0, 2).map(d => [d.role, d.decision, d.source?.kind])).toEqual([['BANK_STATEMENT', 'AUTO_ACCEPTED', 'PDF_TEXT'], ['GENERAL_LEDGER', 'AUTO_ACCEPTED', 'PDF_TEXT']]);
        expect(c.documents.slice(0, 2).map(d => d.interpretation!.checks.find(k => k.id === 'anchor')!.detail)).toEqual([
            'stated totals equal money in 68633.32 and money out 40401.31; running balance also agrees', 'stated totals equal money in 72029.09 and money out 41104.16',
        ]);
        expect(c.outputs.statement?.explained).toBe(true);
    });
    it('a PDF is never accepted on its headings alone: without the interpreter it is quarantined', async () => {
        const c = await processDocuments([file(DIR, BANK_PDF), file(DIR, LEDGER_PDF)]);
        expect(c.status).toBe('QUARANTINED');
        expect(c.documents[0].reason).toMatch(/PDF text layer/);
    });
    it('a scanned PDF page that is one stored JPEG is read by OCR from the image itself (no canvas needed)', async () => {
        const r = await extractDocument('scan.pdf', new Uint8Array(readFileSync(join(DIR, 'bank-statement-march-2026-scan.pdf'))), 'x');
        expect(r).toMatchObject({ source: { kind: 'OCR', pages: 2 } });
        expect(new TextDecoder().decode((r as { bytes: Uint8Array }).bytes)).toMatch(/Date,Txn ID,Ref No,Particulars,Payee \/ Payer,Withdrawal \(RM\),Deposit \(RM\),Balance \(RM\)/);
    }, 180000);
});

describe('the arithmetic anchor refuses what the gates alone would accept', () => {
    /** The ledger PDF's extracted table with one change, keeping every other line. */
    async function ledgerWithout(change: (lines: string[]) => string[]) {
        const text = (await extractDocument(LEDGER_PDF, file(DIR, LEDGER_PDF).bytes, 'x')) as { bytes: Uint8Array };
        return input(LEDGER_PDF, new TextEncoder().encode(change(new TextDecoder().decode(text.bytes).split('\n')).join('\n')));
    }
    it.each([
        ['a stated total that disagrees', (l: string[]) => l.map(x => x.startsWith('Total debits') ? 'Total debits,"72,029.19"' : x), 'anchor'],
        ['no running balance and no stated totals', (l: string[]) => l.filter(x => !x.startsWith('Total')), 'anchor'],
        ['transactions out of date order', (l: string[]) => { const i = l.findIndex(x => x.startsWith('05-Mar-2026')); [l[i], l[i - 1]] = [l[i - 1], l[i]]; return l; }, 'date-sequence'],
    ])('%s', async (_, change, gate) => {
        // The changed table is judged as an extracted document; only the anchor or date order can differ.
        const changed = await ledgerWithout(change);
        const { verifyProposal } = await import('../../lib/interpretation/gates');
        const { readTable } = await import('../../lib/interpretation/evidence');
        const verdict = verifyProposal(readTable(changed.bytes)!, wire(CORRECT[LEDGER_PDF]), { extracted: 'PDF_TEXT' });
        expect(verdict.decision).toBe('QUARANTINED');
        expect(verdict.checks.filter(k => !k.passed).map(k => k.id)).toEqual([gate]);
        // The same table as a plain CSV (no extraction) is not held to the anchor.
        expect(verifyProposal(readTable(changed.bytes)!, wire(CORRECT[LEDGER_PDF])).checks.some(k => k.id === 'anchor')).toBe(false);
    });
});

describe('OCR of a scanned ledger', () => {
    it('reads every amount; misread references become reconciliation items to review, never silent matches', async () => {
        const baseline = await processDocuments([file('public/demo', BANK), file('public/demo', LEDGER)]);
        const c = await processDocuments([file(DIR, BANK_PDF), file(DIR, LEDGER_SCAN)], undefined, undefined, { interpreter: recorded });
        expect(c.documents[1]).toMatchObject({ role: 'GENERAL_LEDGER', decision: 'AUTO_ACCEPTED', source: { kind: 'OCR', pages: 1 } });
        expect(c.documents[1].interpretation!.checks.find(k => k.id === 'anchor')).toMatchObject({ passed: true, detail: 'stated totals equal money in 72029.09 and money out 41104.16' });
        // Every amount was read correctly (the stated totals prove it), so the cash figures are exactly Phase 1's.
        expect(c.outputs.reconciliation!.cashMovement).toEqual(baseline.outputs.reconciliation!.cashMovement);
        const matched = (x: ProcessingContext) => x.outputs.reconciliation!.counts.MATCH_EXACT + x.outputs.reconciliation!.counts.MATCH_DATE_SHIFT;
        expect(matched(c)).toBeLessThan(matched(baseline));
        expect(c.outputs.reconciliation!.results.length - matched(c)).toBeGreaterThan(9);
    }, 180000);
    it('a PDF with no readable text is quarantined with its reason', async () => {
        const doc = await PDFDocument.create(); doc.addPage([200, 200]);
        const blank = await processDocuments([input('blank.pdf', new Uint8Array(await doc.save())), file(DIR, LEDGER_SCAN)], undefined, undefined, { interpreter: recorded });
        expect(blank.documents[0]).toMatchObject({ decision: 'QUARANTINED', reason: expect.stringMatching(/^Not read: /) });
    }, 180000);
});

describe('two OCR readings that disagree: the arithmetic may choose, but only one consistent choice', () => {
    async function ledgerTable() {
        const { readTable } = await import('../../lib/interpretation/evidence');
        const read = await extractDocument(LEDGER_PDF, file(DIR, LEDGER_PDF).bytes, 'x') as { bytes: Uint8Array };
        return readTable(read.bytes)!;
    }
    const lineOf = (t: { rows: string[][] }, id: string) => t.rows.findIndex(r => r[1] === id);
    it('a misread figure whose other reading satisfies every check is resolved, and the choice is disclosed', async () => {
        const { verifyWithDisputes } = await import('../../lib/interpretation/gates');
        const t = await ledgerTable(), line = lineOf(t, 'GL-DEMO-0003');
        t.rows[line][6] = '7785.7'; // what the first pass read; the second read 778.57
        const v = verifyWithDisputes(t, wire(CORRECT[LEDGER_PDF]), [{ line, column: 6, readings: ['778.57'] }, { line: line + 1, column: 3, readings: ['Packaging purchose'] }], { extracted: 'OCR' });
        expect(v.decision).toBe('AUTO_ACCEPTED');
        expect(v.checks.find(c => c.id === 'ocr-readings')!.detail).toBe(`line ${line + 1}: "778.57" not "7785.7"`);
    });
    it('when no other reading satisfies the checks, the document stays quarantined', async () => {
        const { verifyWithDisputes } = await import('../../lib/interpretation/gates');
        const t = await ledgerTable(), line = lineOf(t, 'GL-DEMO-0003');
        t.rows[line][6] = '7785.7';
        const v = verifyWithDisputes(t, wire(CORRECT[LEDGER_PDF]), [{ line, column: 6, readings: ['7785.70'] }], { extracted: 'OCR' });
        expect(v.decision).toBe('QUARANTINED');
        expect(v.disclosures.at(-1)).toMatch(/no alternative reading satisfies the checks/);
    });
    it('an OCR currency code with one letter in the wrong case is read as its ISO code, disclosed; only for OCR', async () => {
        const { verifyProposal } = await import('../../lib/interpretation/gates');
        const scope = { months: 'MANY' as const, currencies: 'ANY' as const };
        const proposal = (literal: string) => { const p = structuredClone(CORRECT[LEDGER_PDF]); p.scope.currency = { line: 5, literal }; return wire(p); };
        const withLine = async (text: string) => { const t = await ledgerTable(); t.rows[5] = ['Currency', text]; return t; };
        const ocr = verifyProposal(await withLine('UsD'), proposal('USD'), { extracted: 'OCR', scope });
        expect(ocr.decision).toBe('AUTO_ACCEPTED');
        expect(ocr.summary).toContain('· USD,');
        expect(ocr.disclosures).toContain('Currency "UsD" on line 6 was read by OCR with a letter in the wrong case; taken as USD.');
        expect(verifyProposal(await withLine('UsD'), proposal('UsD'), { extracted: 'OCR', scope }).decision).toBe('AUTO_ACCEPTED');
        // A text layer is never case-corrected; two wrong-case letters, a non-ISO code or a code absent from the cited line stay quarantined.
        expect(verifyProposal(await withLine('UsD'), proposal('USD'), { extracted: 'PDF_TEXT', scope }).decision).toBe('QUARANTINED');
        expect(verifyProposal(await withLine('Usd'), proposal('USD'), { extracted: 'OCR', scope }).decision).toBe('QUARANTINED');
        expect(verifyProposal(await withLine('XqZ'), proposal('XQZ'), { extracted: 'OCR', scope }).decision).toBe('QUARANTINED');
        expect(verifyProposal(await withLine('UsD'), proposal('SGD'), { extracted: 'OCR', scope }).decision).toBe('QUARANTINED');
        // Tokens come from the whole cited line, not the model's literal: no standalone code, or two codes, stays quarantined.
        expect(verifyProposal(await withLine('UsDT'), proposal('USD'), { extracted: 'OCR', scope }).decision).toBe('QUARANTINED');
        expect(verifyProposal(await withLine('UsD / SgD'), proposal('USD'), { extracted: 'OCR', scope }).decision).toBe('QUARANTINED');
        expect(verifyProposal(await withLine('UsD'), proposal('Currency UsD'), { extracted: 'OCR', scope }).decision).toBe('AUTO_ACCEPTED');
    });
    it('two different corrections that both pass every check are ambiguous: none is taken', async () => {
        const { verifyWithDisputes } = await import('../../lib/interpretation/gates');
        const { parseAmount } = await import('../../lib/interpretation/formats');
        const t = await ledgerTable(), header = CORRECT[LEDGER_PDF].headerLine;
        const debits = t.rows.map((r, line) => ({ r, line })).filter(({ r, line }) => line > header && r.length === t.rows[header].length && typeof parseAmount(r[5] ?? '', 'COMMA_THOUSANDS_DOT_DECIMAL') === 'bigint' && parseAmount(r[5], 'COMMA_THOUSANDS_DOT_DECIMAL')! > 10000n).slice(0, 3);
        const fmt = (v: bigint) => `${(v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(v % 100n).toString().padStart(2, '0')}`;
        const value = (i: number) => parseAmount(debits[i].r[5], 'COMMA_THOUSANDS_DOT_DECIMAL') as bigint;
        const original = debits[0].r[5];
        // The first debit was read MYR 90 short. Restoring it, or adding MYR 40 and MYR 50 to two other debits, both match the stated totals.
        const disputes = [{ line: debits[0].line, column: 5, readings: [original] }, { line: debits[1].line, column: 5, readings: [fmt(value(1) + 4000n)] }, { line: debits[2].line, column: 5, readings: [fmt(value(2) + 5000n)] }];
        t.rows[debits[0].line][5] = fmt(value(0) - 9000n);
        const v = verifyWithDisputes(t, wire(CORRECT[LEDGER_PDF]), disputes, { extracted: 'OCR' });
        expect(v.decision).toBe('QUARANTINED');
        expect(v.disclosures.at(-1)).toMatch(/2 different financial readings satisfy the checks, so none is taken/);
    });
    it('a ledger whose debits and credits are swapped is refused by its own labelled totals', async () => {
        const { verifyProposal } = await import('../../lib/interpretation/gates');
        const t = await ledgerTable(), header = CORRECT[LEDGER_PDF].headerLine, width = t.rows[header].length;
        for (const [line, r] of t.rows.entries()) if (line > header && r.length === width && /\d/.test(r[0] ?? '')) [r[5], r[6]] = [r[6], r[5]];
        const v = verifyProposal(t, wire(CORRECT[LEDGER_PDF]), { extracted: 'OCR' });
        expect(v.decision).toBe('QUARANTINED');
        expect(v.checks.find(k => k.id === 'anchor')).toMatchObject({ passed: false, detail: expect.stringMatching(/^stated money in .* contradicts computed/) });
    });
    it('a stated total follows its label, not the column its figure happens to be printed under', async () => {
        const { verifyProposal } = await import('../../lib/interpretation/gates');
        const { readTable } = await import('../../lib/interpretation/evidence');
        const read = await extractDocument(BANK_PDF, file(DIR, BANK_PDF).bytes, 'x') as { bytes: Uint8Array };
        const t = readTable(read.bytes)!, header = CORRECT[BANK_PDF].headerLine, width = t.rows[header].length;
        const { moneyIn, moneyOut } = CORRECT[BANK_PDF].columns;
        // Print each labelled total as a full-width line with its figure under the OTHER side's column (as a printed
        // footer of a credit-first statement does): the label decides, so the totals still confirm the amounts.
        const moved = { ...t, rows: t.rows.map(r => {
            const label = r.join(' ');
            if (!/^Total (withdrawals|deposits)/.test(label)) return [...r];
            const figure = r.find(v => /\d/.test(v))!, row = Array<string>(width).fill('');
            row[0] = r[0]; row[/withdrawals/.test(label) ? moneyIn! : moneyOut!] = figure;
            return row;
        }) };
        const v = verifyProposal(moved, wire(CORRECT[BANK_PDF]), { extracted: 'PDF_TEXT' });
        expect(v.decision).toBe('AUTO_ACCEPTED');
        expect(v.checks.find(k => k.id === 'anchor')!.detail).toMatch(/^stated totals equal money in/);
        // A bare "Total" names no side, so its column still binds it: under the wrong column it contradicts.
        const bare = { ...moved, rows: moved.rows.map(r => /^Total (withdrawals|deposits)/.test(r[0] ?? '') ? ['Total', ...r.slice(1)] : r) };
        expect(verifyProposal(bare, wire(CORRECT[BANK_PDF]), { extracted: 'PDF_TEXT' }).checks.find(k => k.id === 'anchor')).toMatchObject({ passed: false });
    });
    it('without stated totals, the first amount is confirmed only by the stated opening balance', async () => {
        const { verifyProposal } = await import('../../lib/interpretation/gates');
        const { readTable } = await import('../../lib/interpretation/evidence');
        const read = await extractDocument(BANK_PDF, file(DIR, BANK_PDF).bytes, 'x') as { bytes: Uint8Array };
        const base = readTable(read.bytes)!, header = CORRECT[BANK_PDF].headerLine;
        const noTotals = () => ({ ...base, rows: base.rows.map(r => /^Total /.test(r.join(' ')) ? [] : [...r]) });
        const firstLine = header + 1, column = base.rows[firstLine][6] ? 6 : 5;
        expect(verifyProposal(noTotals(), wire(CORRECT[BANK_PDF]), { extracted: 'PDF_TEXT' }).checks.find(k => k.id === 'anchor')!.detail).toBe('running balance agrees with every amount, from the stated opening balance');
        const misread = noTotals(); misread.rows[firstLine][column] = '9,999.99';
        const v = verifyProposal(misread, wire(CORRECT[BANK_PDF]), { extracted: 'PDF_TEXT' });
        expect(v.decision).toBe('QUARANTINED');
        expect(v.checks.find(k => k.id === 'anchor')!.detail).toMatch(/no opening balance or stated totals confirm the first amount/);
        const noOpening = noTotals(); noOpening.rows = noOpening.rows.map(r => /Opening balance/.test(r.join(' ')) ? [] : r);
        expect(verifyProposal(noOpening, wire(CORRECT[BANK_PDF]), { extracted: 'PDF_TEXT' }).decision).toBe('QUARANTINED');
    });
    it('a failure that is not about figures is never retried with other readings', async () => {
        const { verifyWithDisputes } = await import('../../lib/interpretation/gates');
        const t = await ledgerTable();
        const wrongRole = structuredClone(CORRECT[LEDGER_PDF]); wrongRole.scope.currency = { line: 5, literal: 'USD' };
        const v = verifyWithDisputes(t, wire(wrongRole), [{ line: 9, column: 6, readings: ['1.00'] }], { extracted: 'OCR' });
        expect(v.decision).toBe('QUARANTINED');
        expect(v.checks.some(c => c.id === 'ocr-readings')).toBe(false);
    });
    it('a reading both passes agree on is never changed, and a word the engine barely believes may be absent', () => {
        const w = (text: string, x0: number, y: number, extra: Partial<Word> = {}): Word => ({ text, x0, x1: x0 + text.length * 5, y0: y, y1: y + 10, page: 1, ...extra });
        const words = [w('Date', 0, 0), w('Ref', 80, 0), w('Amount', 160, 0), w('01/03/2026', 0, 14), w('A1', 80, 14), w('(1', 150, 14, { confidence: 0, alternatives: [''] }), w('10.00', 162, 14, { alternatives: ['1O.00'] }),
            w('02/03/2026', 0, 28), w('A2', 80, 28), w('5.00', 160, 28)];
        const t = wordsToTable(words);
        expect(new TextDecoder().decode(t.bytes).split('\n')[1]).toBe('01/03/2026,A1,(1 10.00');
        expect(t.disputes).toEqual([{ line: 1, column: 2, readings: ['10.00', '(1 1O.00'] }]);
    });
});
