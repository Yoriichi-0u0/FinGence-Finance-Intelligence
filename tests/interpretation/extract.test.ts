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
