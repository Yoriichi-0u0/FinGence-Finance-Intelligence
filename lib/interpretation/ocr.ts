/**
 * OCR of scanned pages and images into positioned words (tesseract.js, English model). In the browser the image
 * never leaves the page: the engine and its language data are downloaded, the recognition runs locally.
 */
import type { Word } from './positioned';

export const isImage = (bytes: Uint8Array) =>
    (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff); // PNG | JPEG
export const OCR_ENGINE = 'tesseract.js 7 (eng)';
export type OcrImage = Uint8Array | HTMLCanvasElement;
type Encoded = Uint8Array | Blob;
import type { Worker } from 'tesseract.js';

let worker: Promise<Worker> | null = null;
async function engine() {
    worker ??= (async () => {
        const { createWorker } = await import('tesseract.js');
        // Statement text is mostly codes and figures: the word dictionaries would pull "29TPR9…" towards letters.
        const config = { load_system_dawg: '0', load_freq_dawg: '0' };
        if (typeof window !== 'undefined') return createWorker('eng', 1, {}, config);
        // Node (tests): the language model comes from the installed @tesseract.js-data/eng package, not the network.
        const { dirname, join } = await import('node:path'), { createRequire } = await import('node:module');
        const langPath = join(dirname(createRequire(import.meta.url).resolve('@tesseract.js-data/eng/package.json')), '4.0.0');
        return createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' }, config);
    })();
    return worker;
}

const overlap = (a: Word, b: Word) => {
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)), i = ix * iy;
    return i / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i || 1);
};
async function pass(image: Encoded, page: number, mode: '3' | '6'): Promise<Word[]> {
    const ocr = await engine();
    await ocr.setParameters({ tessedit_pageseg_mode: mode as never });
    const { data } = await ocr.recognize(image instanceof Uint8Array ? (typeof Buffer !== 'undefined' ? Buffer.from(image) : new Blob([image.slice()])) : image, {}, { blocks: true });
    return (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)))
        .filter(w => w.text.trim()).map(w => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, page, confidence: w.confidence }));
}

/**
 * Words with their boxes on `page`. The page is read twice, as one uniform block of text (mode 6, the layout) and
 * with automatic layout analysis (mode 3); where the two readings of the same word differ, the reading the engine
 * is more confident of is used and the other is kept as an alternative. Only if the table then fails its arithmetic
 * may the gates try those alternatives (`verifyWithDisputes`), and only a single consistent choice is accepted.
 */
export async function ocrWords(input: OcrImage, page: number): Promise<{ words: Word[]; confidence: number; disputed: number }> {
    // A canvas is encoded once: handing the same canvas to the engine twice stalls the second read in the browser.
    const image = input instanceof Uint8Array ? input : await new Promise<Blob>((resolve, reject) => input.toBlob(b => b ? resolve(b) : reject(Error('canvas could not be encoded')), 'image/png'));
    const block = await pass(image, page, '6'), auto = await pass(image, page, '3');
    let disputed = 0;
    const words = block.map(w => {
        const other = auto.find(x => overlap(w, x) > 0.5);
        // A word the engine itself barely believes (under 30%) may be a smudge read as text: its alternative is "absent".
        if (!other || other.text === w.text) return (w.confidence ?? 100) < 30 ? { ...w, alternatives: [''] } : w;
        disputed++;
        // The more confident reading is used; the other is kept as an alternative for the arithmetic gates.
        return (other.confidence ?? 0) > (w.confidence ?? 0) ? { ...w, text: other.text, confidence: other.confidence, alternatives: [w.text] } : { ...w, alternatives: [other.text] };
    });
    return { words, disputed, confidence: words.length ? Math.round(words.reduce((n, w) => n + (w.confidence ?? 0), 0) / words.length) : 0 };
}
export async function stopOcr() { const w = await worker; worker = null; await w?.terminate(); }
