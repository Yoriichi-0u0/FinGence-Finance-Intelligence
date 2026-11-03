import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { processDocuments, type DocumentInput, type ProcessingContext } from '../../lib/demo/pipeline';
import type { LayoutInterpreter } from '../../lib/interpretation/contracts';
import { excelNumber, expandWorkbook } from '../../lib/interpretation/workbook';
import { CORRECT, wire } from './proposals';

const WORKBOOK = 'rimba-demo-kitchen-march-2026.xlsx';
const BANK = 'demo-bank-statement-2026-03.csv', LEDGER = 'demo-general-ledger-2026-03.csv', HISTORY = 'demo-bank-history-2025-04-to-2026-03.csv';
const file = (dir: string, name: string) => new Uint8Array(readFileSync(join(dir, name)));
const input = (name: string, bytes: Uint8Array): DocumentInput => ({ name, bytes, provenance: 'USER_SUPPLIED' });
const sample = (name: string) => input(name, file('public/demo', name));
const workbook = () => input(WORKBOOK, file('public/demo/unfamiliar', WORKBOOK));
const receipt = { provider: 'GROQ' as const, model: 'recorded-test', requestId: null, latencyMs: 0, inputTokens: null, outputTokens: null, estimatedUsd: null, mode: 'LIVE' as const };
const recorded: LayoutInterpreter = { async propose(e) { const p = CORRECT[e.fileName]; return { proposal: p ? wire(p) : { layout: { role: 'UNSUPPORTED' }, rationale: '', unresolved: [] }, receipt }; } };
const figures = (c: ProcessingContext) => ({
    status: c.status, scope: c.scope, counts: c.outputs.reconciliation?.counts, cash: c.outputs.reconciliation?.cashMovement, totals: c.outputs.totals,
    anomalies: c.outputs.anomalies.map(a => [a.row.date, a.row.amount, a.severity]), forecast: c.outputs.forecast?.forecast,
});
/** Rewrites parts of an XLSX archive (a different save of the "same" workbook, or a tampered one). */
function repack(bytes: Uint8Array, edit: (parts: Record<string, string>) => void, mtime = new Date('2026-04-01T00:00:00')) {
    const parts = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([n, b]) => [n, strFromU8(b)]));
    edit(parts);
    return zipSync(Object.fromEntries(Object.entries(parts).map(([n, t]) => [n, [strToU8(t), { mtime }]])));
}
/** A workbook whose worksheets hold the given CSV documents as text cells. */
function textWorkbook(sheets: [string, string][]) {
    const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const col = (i: number) => String.fromCharCode(65 + i);
    const sheetXml = (csv: string) => `<worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${Papa.parse<string[]>(csv.trim()).data.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => v ? `<c r="${col(x)}${y + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>` : '').join('')}</row>`).join('')}</sheetData></worksheet>`;
    return zipSync({
        '[Content_Types].xml': strToU8(`<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
        '_rels/.rels': strToU8(`<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
        'xl/workbook.xml': strToU8(`<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>${sheets.map(([n], i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
        'xl/_rels/workbook.xml.rels': strToU8(`<Relationships xmlns="${ns}/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
        ...Object.fromEntries(sheets.map(([, csv], i) => [`xl/worksheets/sheet${i + 1}.xml`, strToU8(sheetXml(csv))])),
    });
}

describe('stored Excel numbers are read at Excel precision, never re-valued', () => {
    it.each([
        ['2615.15', '2615.15', false], ['1250', '1250', false], ['18.5', '18.5', false], ['-778.57', '-778.57', false],
        ['47615.149999999994', '47615.15', true], ['0.30000000000000004', '0.3', true], ['-1234.5599999999999', '-1234.56', true],
        ['1E-3', '0.001', true], ['1.5E+3', '1500', true],
        ['9007199254740993.1', '9007199254740990', true], // beyond what an Excel cell can hold; never a valid amount anyway
    ])('%s → %s', (literal, text, rounded) => expect(excelNumber(literal)).toEqual({ text, rounded }));
});

describe('a workbook becomes one document per worksheet that holds a table', () => {
    it('converts the public sample deterministically and lists the worksheet it did not read', async () => {
        const r = await expandWorkbook(WORKBOOK, workbook().bytes, 'f'.repeat(64));
        if ('error' in r) throw Error(r.error);
        expect(r.skipped).toEqual(['Cover']);
        expect(r.worksheets.map(w => [w.name, w.source.sheetNumber])).toEqual([[`${WORKBOOK} › Bank statement`, 2], [`${WORKBOOK} › Cash ledger`, 3]]);
        const [bank, ledger] = r.worksheets.map(w => new TextDecoder().decode(w.bytes).split('\n'));
        expect(bank[8]).toBe('Date,Txn ID,Ref No,Particulars,Payee / Payer,Withdrawal (RM),Deposit (RM),Balance (RM)');
        expect(bank[9]).toBe('2026-03-01,BANK-DEMO-0001,29TPR9UKHD7J,[credit] POS SALES SETTLEMENT DAILY POS SETTLEMENT,POS Sales Settlement,,2615.15,47615.15');
        expect(bank.slice(-4, -1)).toEqual(['Total withdrawals,40401.31', 'Total deposits,68633.32', 'Closing balance,73232.01']); // footers stay narrow
        expect(ledger[7]).toMatch(/^2026-03-02,GL-DEMO-0001,.*,1567\.26,$/); // a table row keeps its empty trailing cell
        expect(r.worksheets[0].source.notes).toEqual([
            `Worksheet 2 "Bank statement" of ${WORKBOOK}: 70 rows × 8 columns read as text.`, '57 date cells written as ISO dates (YYYY-MM-DD).',
            "51 stored numbers read at Excel's 15-significant-digit precision.", 'Worksheet without a table not read: "Cover".',
        ]);
    });
    it('refuses what is not a readable workbook', async () => {
        expect(await expandWorkbook('a.xlsx', file('public/demo', BANK), 'x')).toMatchObject({ error: expect.stringMatching(/ZIP workbook/) });
        expect(await expandWorkbook('a.xlsx', textWorkbook([['Notes', 'Just a note']]), 'x')).toEqual({ error: 'No worksheet holds a table ("Notes").' });
    });
});

describe('an Excel workbook gives exactly the Phase 1 results', () => {
    it('both worksheets are interpreted, verified and reconciled to the cent', async () => {
        const baseline = await processDocuments([sample(BANK), sample(LEDGER), sample(HISTORY)]);
        const c = await processDocuments([workbook(), sample(HISTORY)], undefined, undefined, { interpreter: recorded });
        expect(c.stages.map(s => `${s.id}:${s.decision}`)).toEqual(baseline.stages.map(s => `${s.id}:${s.decision}`));
        expect(figures(c)).toEqual(figures(baseline));
        expect(c.outputs.reconciliation!.cashMovement.signedDifference).toBe('-2692.92');
        expect(c.documents.map(d => [d.role, d.decision, d.source?.sheet ?? null])).toEqual([
            ['BANK_STATEMENT', 'AUTO_ACCEPTED', 'Bank statement'], ['GENERAL_LEDGER', 'AUTO_ACCEPTED', 'Cash ledger'], ['BANK_HISTORY', 'AUTO_ACCEPTED', null],
        ]);
        expect(c.documents[0].source!.workbookSha256).toBe('1c85a1295c8d3e5b763010600db3b46b72b172fef69cf698b97f4916ebae41cb');
        expect(c.stages.find(s => s.id === 'VERIFY')!.checks.filter(k => k.id.endsWith('roundtrip')).map(k => k.passed)).toEqual([true, true]);
    });
    it('identity follows the worksheet content: another save of the same workbook gives the same processing ID', async () => {
        const a = await processDocuments([workbook()], undefined, undefined, { interpreter: recorded });
        const resaved = repack(workbook().bytes, () => {}, new Date('2026-05-09T13:45:00'));
        const b = await processDocuments([input('copy.xlsx', resaved)], undefined, undefined, { interpreter: { async propose(e) { return recorded.propose({ ...e, fileName: e.fileName.replace('copy.xlsx', WORKBOOK) }); } } });
        expect(a.status).not.toBe('QUARANTINED');
        expect(b.documents[0].source!.workbookSha256).not.toBe(a.documents[0].source!.workbookSha256);
        expect(b.processingId).toBe(a.processingId);
    });
    it('without an interpreter the worksheets are quarantined as unfamiliar, exactly like CSVs', async () => {
        const c = await processDocuments([workbook()]);
        expect(c.status).toBe('QUARANTINED');
        expect(c.documents.map(d => [d.role, d.decision])).toEqual([[null, 'QUARANTINED'], [null, 'QUARANTINED']]);
    });
    it('a workbook holding the supported schemas as text is recognised by the exact signatures, no model needed', async () => {
        const text = (name: string) => readFileSync(join('public/demo', name), 'utf8');
        const baseline = await processDocuments([sample(BANK), sample(LEDGER)]);
        const c = await processDocuments([input('books.xlsx', textWorkbook([['Bank', text(BANK)], ['Ledger', text(LEDGER)]]))]);
        expect(figures(c)).toEqual(figures(baseline));
        expect(c.documents.every(d => d.interpretation === null)).toBe(true);
    });
    it('two bank statements in one workbook are ambiguous, as two files would be', async () => {
        const text = readFileSync(join('public/demo', BANK), 'utf8');
        const c = await processDocuments([input('two.xlsx', textWorkbook([['March', text], ['March copy', text]])), sample(LEDGER)]);
        expect(c.status).toBe('QUARANTINED');
        expect(c.documents.slice(0, 2).map(d => d.reason)).toEqual([expect.stringMatching(/More than one bank statement/), expect.stringMatching(/More than one bank statement/)]);
    });
    it('an unreadable workbook is quarantined with its reason, and the other documents keep their positions', async () => {
        const c = await processDocuments([input('broken.xlsx', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), sample(BANK), sample(LEDGER)]);
        expect(c.documents[0]).toMatchObject({ name: 'broken.xlsx', decision: 'QUARANTINED', reason: expect.stringMatching(/^Workbook not read: /) });
        expect(c.outputs.reconciliation?.cashMovement.signedDifference).toBe('-2692.92');
    });
});

describe('tampered workbooks are refused by the same gates', () => {
    const sheet = 'xl/worksheets/sheet2.xml';
    it.each([
        ['one sen added to a withdrawal', (x: string) => x.replace('<v>778.57</v>', '<v>778.58</v>'), 'balance'],
        ['withdrawal and deposit headings swapped', (x: string) => x.replace('Withdrawal (RM)', 'TMP').replace('Deposit (RM)', 'Withdrawal (RM)').replace('TMP', 'Deposit (RM)'), 'direction'],
    ])('%s', async (_, edit, gate) => {
        const tampered = repack(workbook().bytes, parts => { parts[sheet] = edit(parts[sheet]); });
        const c = await processDocuments([input(WORKBOOK, tampered), sample(LEDGER)], undefined, undefined, { interpreter: recorded });
        expect(c.status).toBe('QUARANTINED');
        expect(c.outputs.reconciliation).toBeNull();
        expect(c.documents[0].interpretation!.checks.filter(k => !k.passed).map(k => k.id)).toContain(gate);
    });
});
