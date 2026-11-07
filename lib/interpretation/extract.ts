/**
 * PDFs and images → one CSV-shaped document each. A PDF's text layer is read directly; scanned pages (no text
 * layer) and images are read by OCR (in the browser, or on the server in a processing job). Either way the words are placed into a table by geometry
 * alone (`positioned.ts`), and the document is then identified, interpreted and gated like a CSV, with an
 * additional arithmetic anchor (`verifyProposal` with `extracted`).
 */
import { isImage, OCR_ENGINE, ocrWords } from './ocr';
import { isPdf, readPdf } from './pdf';
import { wordsToTable, type Dispute, type RowGeometry, type Word } from './positioned';

/**
 * How a page's word coordinates map to what a viewer draws: PDF points times `scale` (a text layer, or a scanned page
 * rendered at `scale`), or the pixels of the stored scan image (`width` × `height`).
 */
export type PageCoords = { number: number; coords: 'POINTS'; scale: number } | { number: number; coords: 'PIXELS'; width: number; height: number };
/** Pixel size of a PNG or JPEG from its header, or null. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
    if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) return { width: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, height: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1], length = b[i + 2] << 8 | b[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b[i + 5] << 8 | b[i + 6], width: b[i + 7] << 8 | b[i + 8] };
        i += 2 + length;
    }
    return null;
}

export const MAX_EXTRACT_BYTES = 10_000_000;
export type ExtractedSource = {
    kind: 'PDF_TEXT' | 'OCR'; file: string; fileSha256: string; pages: number; confidence: number | null; notes: string[]; disputes: Dispute[];
    /** Where each table line's cells sit on its page, and each page's coordinates: what the document view highlights. */
    geometry?: RowGeometry[]; coords?: PageCoords[];
};
export const isExtractable = (bytes: Uint8Array) => isPdf(bytes) || isImage(bytes);
/** Rendering scale for scanned PDF pages: about 300 dpi, enough for statement-size print. */
const SCAN_SCALE = 300 / 72;

export type Extraction = { bytes: Uint8Array; source: ExtractedSource } | { error: string };
export type Extractor = (name: string, bytes: Uint8Array, sha256: string) => Promise<Extraction>;
export async function extractDocument(name: string, bytes: Uint8Array, sha256: string): Promise<Extraction> {
    if (bytes.byteLength > MAX_EXTRACT_BYTES) return { error: `Larger than ${MAX_EXTRACT_BYTES / 1_000_000} MB.` };
    const words: Word[] = [], notes: string[] = [], confidences: number[] = [], coords: PageCoords[] = [];
    let disputed = 0;
    let pages = 1, ocrPages = 0;
    try {
        if (isPdf(bytes)) {
            const pdf = await readPdf(bytes);
            pages = pdf.pages.length;
            const rotated = pdf.pages.reduce((n, p) => n + p.rotated, 0);
            if (rotated) notes.push(`${rotated} rotated text run${rotated === 1 ? '' : 's'} (watermarks or margin notes) not read.`);
            try {
                for (const page of pdf.pages) {
                    if (!page.scanned) { words.push(...page.words); coords.push({ number: page.number, coords: 'POINTS', scale: 1 }); continue; }
                    // The scan as stored when the page is one JPEG; otherwise the page rendered at about 300 dpi (browser or Node canvas).
                    const stored = await pdf.image(page.number), size = stored && imageSize(stored);
                    const scan = stored ?? await pdf.render(page.number, SCAN_SCALE);
                    coords.push(stored && size ? { number: page.number, coords: 'PIXELS', ...size } : { number: page.number, coords: 'POINTS', scale: SCAN_SCALE });
                    if (!scan) return { error: `Page ${page.number} is a scan without a text layer that could not be rendered for OCR.` };
                    const read = await ocrWords(scan, page.number);
                    words.push(...read.words); confidences.push(read.confidence); disputed += read.disputed; ocrPages++;
                }
            } finally { await pdf.close(); }
        } else {
            const read = await ocrWords(bytes, 1), size = imageSize(bytes);
            if (size) coords.push({ number: 1, coords: 'PIXELS', ...size });
            words.push(...read.words); confidences.push(read.confidence); disputed += read.disputed; ocrPages = 1;
        }
    } catch (error) {
        return { error: `${isPdf(bytes) ? 'PDF' : 'Image'} could not be read (${error instanceof Error ? error.message.slice(0, 120) : 'unreadable'}).` };
    }
    if (!words.length) return { error: 'No readable text was found.' };
    const table = wordsToTable(words);
    const kind = ocrPages ? 'OCR' : 'PDF_TEXT', confidence = confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null;
    notes.push(kind === 'OCR'
        ? `${isPdf(bytes) ? `${ocrPages} of ${pages} scanned PDF page${pages === 1 ? '' : 's'}` : 'Image'} read by OCR (${OCR_ENGINE}${typeof window === 'undefined' ? ', on the server' : ', in this browser'}); mean word confidence ${confidence}%.`
        : `Text layer of ${pages} PDF page${pages === 1 ? '' : 's'} read directly (no OCR).`);
    if (disputed) notes.push(`Each page was read twice; ${disputed} word${disputed === 1 ? '' : 's'} read differently by the two passes took the more confident reading.`);
    notes.push(`${words.length} words placed into ${table.rows} lines by position; cell values are kept as read.`, ...table.notes);
    return { bytes: table.bytes, source: { kind, file: name, fileSha256: sha256, pages, confidence, notes, disputes: table.disputes, geometry: table.geometry, coords } };
}
