/**
 * PDFs and images → one CSV-shaped document each. A PDF's text layer is read directly; scanned pages (no text
 * layer) and images are read by OCR in this browser. Either way the words are placed into a table by geometry
 * alone (`positioned.ts`), and the document is then identified, interpreted and gated like a CSV, with an
 * additional arithmetic anchor (`verifyProposal` with `extracted`).
 */
import { isImage, OCR_ENGINE, ocrWords } from './ocr';
import { isPdf, readPdf } from './pdf';
import { wordsToTable, type Dispute, type Word } from './positioned';

export const MAX_EXTRACT_BYTES = 10_000_000;
export type ExtractedSource = { kind: 'PDF_TEXT' | 'OCR'; file: string; fileSha256: string; pages: number; confidence: number | null; notes: string[]; disputes: Dispute[] };
export const isExtractable = (bytes: Uint8Array) => isPdf(bytes) || isImage(bytes);
/** Rendering scale for scanned PDF pages: about 300 dpi, enough for statement-size print. */
const SCAN_SCALE = 300 / 72;

export async function extractDocument(name: string, bytes: Uint8Array, sha256: string): Promise<{ bytes: Uint8Array; source: ExtractedSource } | { error: string }> {
    if (bytes.byteLength > MAX_EXTRACT_BYTES) return { error: `Larger than ${MAX_EXTRACT_BYTES / 1_000_000} MB.` };
    const words: Word[] = [], notes: string[] = [], confidences: number[] = [];
    let disputed = 0;
    let pages = 1, ocrPages = 0;
    try {
        if (isPdf(bytes)) {
            const pdf = await readPdf(bytes);
            pages = pdf.pages.length;
            try {
                for (const page of pdf.pages) {
                    if (!page.scanned) { words.push(...page.words); continue; }
                    const canvas = await pdf.render(page.number, SCAN_SCALE);
                    if (!canvas) return { error: `Page ${page.number} is a scan without a text layer; scanned pages are read by OCR in the browser.` };
                    const read = await ocrWords(canvas, page.number);
                    words.push(...read.words); confidences.push(read.confidence); disputed += read.disputed; ocrPages++;
                }
            } finally { await pdf.close(); }
        } else {
            const read = await ocrWords(bytes, 1);
            words.push(...read.words); confidences.push(read.confidence); disputed += read.disputed; ocrPages = 1;
        }
    } catch (error) {
        return { error: `${isPdf(bytes) ? 'PDF' : 'Image'} could not be read (${error instanceof Error ? error.message.slice(0, 120) : 'unreadable'}).` };
    }
    if (!words.length) return { error: 'No readable text was found.' };
    const table = wordsToTable(words);
    const kind = ocrPages ? 'OCR' : 'PDF_TEXT', confidence = confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null;
    notes.push(kind === 'OCR'
        ? `${isPdf(bytes) ? `${ocrPages} of ${pages} scanned PDF page${pages === 1 ? '' : 's'}` : 'Image'} read by OCR in this browser (${OCR_ENGINE}); mean word confidence ${confidence}%.`
        : `Text layer of ${pages} PDF page${pages === 1 ? '' : 's'} read directly (no OCR).`);
    if (disputed) notes.push(`Each page was read twice; ${disputed} word${disputed === 1 ? '' : 's'} read differently by the two passes took the more confident reading.`);
    notes.push(`${words.length} words placed into ${table.rows} lines by position; cell values are kept as read.`, ...table.notes);
    return { bytes: table.bytes, source: { kind, file: name, fileSha256: sha256, pages, confidence, notes, disputes: table.disputes } };
}
