/**
 * Deterministic XLSX → table conversion for the processing pipeline. Each worksheet that holds a table
 * becomes its own document, written in the shape of a CSV export (blank rows separate blocks; each block is
 * padded to its widest row), so identification, AI layout interpretation and every gate run unchanged on it. No value is
 * guessed: text is kept verbatim, numbers keep their stored digits and dates are written as ISO dates.
 */
import type { RawCell } from '../ingestion/models';

export const MAX_WORKBOOK_BYTES = 4_000_000;
/** Excel itself holds 15 significant digits; longer stored literals are binary floating-point artefacts. */
const EXCEL_DIGITS = 15;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export type WorksheetSource = { kind: 'WORKSHEET'; workbook: string; workbookSha256: string; sheet: string; sheetNumber: number; notes: string[] };
export type Worksheet = { name: string; sheet: string; bytes: Uint8Array; source: WorksheetSource };
export type ExpandedWorkbook = { worksheets: Worksheet[]; skipped: string[] } | { error: string };

export const isWorkbook = (name: string, bytes: Uint8Array) => /\.xlsx$/i.test(name) || ZIP_MAGIC.every((b, i) => bytes[i] === b);

/** A stored number literal at Excel's own precision, without exponent notation. */
export function excelNumber(literal: string): { text: string; rounded: boolean } {
    const digits = literal.replace(/^-/, '').replace(/e.*$/i, '').replace('.', '').replace(/^0+/, '');
    if (!/e/i.test(literal) && digits.length <= EXCEL_DIGITS) return { text: literal, rounded: false };
    const value = Number(literal);
    if (!Number.isFinite(value)) return { text: literal, rounded: false };
    const [mantissa, exponent] = value.toPrecision(EXCEL_DIGITS).split('e');
    let [whole, fraction = ''] = mantissa.replace('-', '').split('.');
    const shift = Number(exponent ?? 0);
    if (shift > 0) { fraction = fraction.padEnd(shift, '0'); whole += fraction.slice(0, shift); fraction = fraction.slice(shift); }
    else if (shift < 0) { fraction = '0'.repeat(-shift - 1) + whole + fraction; whole = '0'; }
    fraction = fraction.replace(/0+$/, ''); whole = whole.replace(/^0+(?=\d)/, '');
    const text = `${value < 0 ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
    return { text, rounded: text !== literal };
}

function cellText(cell: RawCell, counts: { rounded: number; dates: number; timed: number }): string {
    if (cell === null) return '';
    if (typeof cell === 'string') return cell;
    if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
    if (cell.kind === 'excel_date') {
        const [date, time] = cell.value.split('T');
        counts.dates++;
        if (/^00:00:00(\.000)?Z?$/.test(time ?? '')) return date;
        counts.timed++;
        return `${date} ${(time ?? '').slice(0, 8)}`;
    }
    const number = excelNumber(cell.value);
    if (number.rounded) counts.rounded++;
    return number.text;
}
const csvCell = (v: string) => /[",\n\r]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/**
 * Splits a workbook into one CSV-shaped document per worksheet that holds a table (at least two rows with two or
 * more filled cells). Other worksheets are listed as skipped, never silently dropped.
 */
export async function expandWorkbook(name: string, bytes: Uint8Array, sha256: string): Promise<ExpandedWorkbook> {
    if (bytes.byteLength > MAX_WORKBOOK_BYTES) return { error: `Workbook is larger than ${MAX_WORKBOOK_BYTES / 1_000_000} MB.` };
    const { inspectFile } = await import('../ingestion/readers');
    let file;
    try { file = await inspectFile(bytes, { name: /\.xlsx$/i.test(name) ? name : `${name}.xlsx` }); }
    catch (error) { return { error: error instanceof Error ? error.message : 'Unable to read this workbook.' }; }
    if (file.type !== 'XLSX') return { error: 'Not an XLSX workbook.' };
    const worksheets: Worksheet[] = [], skipped: string[] = [];
    for (const sheet of file.sheets) {
        const label = sheet.name ?? `Sheet ${sheet.index + 1}`;
        const counts = { rounded: 0, dates: 0, timed: 0 };
        const lines: string[][] = [];
        for (const row of sheet.rows) lines[row.rowNumber - 1] = row.cells.map(c => cellText(c, counts));
        for (let i = 0; i < lines.length; i++) lines[i] ??= [];
        const used = (r: string[]) => { let n = r.length; while (n && !r[n - 1].trim()) n--; return n; };
        while (lines.length && !used(lines.at(-1)!)) lines.pop();
        if (lines.filter(r => r.filter(c => c.trim()).length >= 2).length < 2) { skipped.push(label); continue; }
        // Each block of consecutive non-blank rows is padded to its widest row, as a CSV export of that block would be:
        // a table keeps its empty trailing cells while a title, note or footer line above or below it stays narrow.
        const widths = lines.map(used);
        for (let start = 0; start < lines.length;) {
            if (!widths[start]) { start++; continue; }
            let end = start; while (end + 1 < lines.length && widths[end + 1]) end++;
            const block = Math.max(...widths.slice(start, end + 1));
            for (let i = start; i <= end; i++) widths[i] = block;
            start = end + 1;
        }
        const text = lines.map((r, line) => Array.from({ length: widths[line] }, (_, i) => csvCell(r[i] ?? '')).join(',')).join('\n') + '\n';
        const notes = [`Worksheet ${sheet.index + 1} "${label}" of ${file.name}: ${lines.length} rows × ${Math.max(...widths)} columns read as text.`];
        if (counts.dates) notes.push(`${counts.dates} date cell${counts.dates === 1 ? '' : 's'} written as ISO dates (YYYY-MM-DD)${counts.timed ? `; ${counts.timed} carry a time of day` : ''}.`);
        if (counts.rounded) notes.push(`${counts.rounded} stored number${counts.rounded === 1 ? '' : 's'} read at Excel's 15-significant-digit precision.`);
        worksheets.push({ name: `${file.name} › ${label}`.slice(0, 120), sheet: label, bytes: new TextEncoder().encode(text), source: { kind: 'WORKSHEET', workbook: file.name, workbookSha256: sha256, sheet: label, sheetNumber: sheet.index + 1, notes } });
    }
    if (skipped.length) for (const w of worksheets) w.source.notes.push(`Worksheet${skipped.length === 1 ? '' : 's'} without a table not read: ${skipped.map(s => `"${s}"`).join(', ')}.`);
    return worksheets.length ? { worksheets, skipped } : { error: `No worksheet holds a table${skipped.length ? ` (${skipped.map(s => `"${s}"`).join(', ')})` : ''}.` };
}
