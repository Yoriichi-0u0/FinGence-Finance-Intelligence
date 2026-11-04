/**
 * Reads a PDF's text layer into positioned words (pdf.js, in the browser or in Node). Pages with no text
 * layer are scans: they are rendered and read by OCR where a canvas exists (the browser), and otherwise
 * reported, never guessed.
 */
import type { Word } from './positioned';

export const MAX_PDF_PAGES = 20;
export const isPdf = (bytes: Uint8Array) => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
export type PdfPage = { number: number; width: number; height: number; words: Word[]; scanned: boolean };

async function pdfjs() {
    // The legacy build carries the polyfills that older browsers (and Node) need; the modern build assumes very new APIs.
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (typeof window !== 'undefined' && !lib.GlobalWorkerOptions.workerSrc)
        lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
    return lib;
}

/** Text-layer words of every page (top-left origin, PDF points). A page without text is marked `scanned`. */
export async function readPdf(bytes: Uint8Array): Promise<{ pages: PdfPage[]; render: (page: number, scale: number) => Promise<HTMLCanvasElement | null>; close: () => Promise<void> }> {
    const lib = await pdfjs();
    const task = lib.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }), doc = await task.promise;
    if (doc.numPages > MAX_PDF_PAGES) { await task.destroy(); throw Error(`More than ${MAX_PDF_PAGES} pages.`); }
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n), view = page.getViewport({ scale: 1 }), content = await page.getTextContent();
        const words: Word[] = [];
        for (const item of content.items) {
            if (!('str' in item) || !item.str.trim()) continue;
            const [, , , d, e, f] = item.transform as number[], height = Math.abs(item.height || d) || 1;
            // PDF space is bottom-left; positioned words are top-left.
            words.push({ text: item.str, x0: e, x1: e + item.width, y0: view.height - f - height, y1: view.height - f, page: n });
        }
        pages.push({ number: n, width: view.width, height: view.height, words, scanned: words.length === 0 });
    }
    const render = async (n: number, scale: number) => {
        if (typeof document === 'undefined') return null;
        const page = await doc.getPage(n), view = page.getViewport({ scale }), canvas = document.createElement('canvas');
        canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
        // The print intent renders without requestAnimationFrame, which browsers pause in a background tab.
        await page.render({ canvas, viewport: view, intent: 'print' }).promise;
        return canvas;
    };
    return { pages, render, close: () => task.destroy() };
}
