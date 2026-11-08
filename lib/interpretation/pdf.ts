/**
 * Reads a PDF's text layer into positioned words (pdf.js, in the browser or in Node). Pages with no text
 * layer are scans: they are rendered and read by OCR, on a browser canvas or, in Node (server processing jobs),
 * on pdf.js's own Node canvas (@napi-rs/canvas, a pdf.js dependency); a page that cannot be rendered is reported,
 * never guessed.
 */
import type { Word } from './positioned';

export const MAX_PDF_PAGES = 20;
export const isPdf = (bytes: Uint8Array) => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
export type PdfPage = { number: number; width: number; height: number; words: Word[]; scanned: boolean; rotated: number };

async function pdfjs() {
    // The legacy build carries the polyfills that older browsers (and Node) need; the modern build assumes very new APIs.
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (typeof window !== 'undefined' && !lib.GlobalWorkerOptions.workerSrc)
        lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
    return lib;
}

/** Text-layer words of every page (top-left origin, PDF points). A page without text is marked `scanned`. */
/**
 * The page's own scan when the page is exactly one JPEG image (the usual scanner output): read as stored, it is the
 * original pixels, needs no canvas and works in Node too. Null for any other page.
 */
async function pageJpeg(bytes: Uint8Array, page: number): Promise<Uint8Array | null> {
    const { PDFDocument, PDFName, PDFRawStream, PDFDict } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false });
    const xobjects = doc.getPages()[page - 1]?.node.Resources()?.lookup(PDFName.of('XObject'));
    if (!(xobjects instanceof PDFDict)) return null;
    const images = xobjects.keys().map(k => xobjects.lookup(k)).filter(x => x instanceof PDFRawStream && x.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') as unknown as { dict: { get(n: unknown): { toString(): string } | undefined }; contents: Uint8Array }[];
    if (images.length !== 1 || images[0].dict.get(PDFName.of('Filter'))?.toString() !== '/DCTDecode') return null;
    return images[0].contents;
}

export async function readPdf(bytes: Uint8Array): Promise<{ pages: PdfPage[]; image: (page: number) => Promise<Uint8Array | null>; render: (page: number, scale: number) => Promise<HTMLCanvasElement | Uint8Array | null>; close: () => Promise<void> }> {
    const lib = await pdfjs();
    const task = lib.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }), doc = await task.promise;
    if (doc.numPages > MAX_PDF_PAGES) { await task.destroy(); throw Error(`More than ${MAX_PDF_PAGES} pages.`); }
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n), view = page.getViewport({ scale: 1 }), content = await page.getTextContent();
        const words: Word[] = [];
        let rotated = 0;
        for (const item of content.items) {
            if (!('str' in item) || !item.str.trim()) continue;
            const [a, b, c, d, e, f] = item.transform as number[], height = Math.abs(item.height || d) || 1;
            // Rotated text (a diagonal watermark, a vertical margin note) is not part of any table.
            if (Math.abs(b) > Math.abs(a) * 0.02 || Math.abs(c) > Math.abs(d) * 0.02) { rotated++; continue; }
            // PDF space is bottom-left; positioned words are top-left.
            words.push({ text: item.str, x0: e, x1: e + item.width, y0: view.height - f - height, y1: view.height - f, page: n });
        }
        pages.push({ number: n, width: view.width, height: view.height, words, scanned: words.length === 0, rotated });
    }
    const render = async (n: number, scale: number): Promise<HTMLCanvasElement | Uint8Array | null> => {
        if (typeof document === 'undefined') {
            // Node: pdf.js's canvas factory draws on @napi-rs/canvas; the page goes to OCR as a PNG.
            const factory = (doc as unknown as { canvasFactory?: { create(w: number, h: number): { canvas: { toBuffer(type: 'image/png'): Uint8Array }; context: unknown } } }).canvasFactory;
            if (!factory) return null;
            const page = await doc.getPage(n), view = page.getViewport({ scale });
            try {
                const { canvas, context } = factory.create(Math.ceil(view.width), Math.ceil(view.height));
                await page.render({ canvasContext: context as CanvasRenderingContext2D, canvas: canvas as unknown as HTMLCanvasElement, viewport: view, intent: 'print' }).promise;
                return new Uint8Array(canvas.toBuffer('image/png'));
            } catch { return null; }
        }
        const page = await doc.getPage(n), view = page.getViewport({ scale }), canvas = document.createElement('canvas');
        canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
        // The print intent renders without requestAnimationFrame, which browsers pause in a background tab.
        await page.render({ canvas, viewport: view, intent: 'print' }).promise;
        return canvas;
    };
    return { pages, image: n => pageJpeg(bytes, n).catch(() => null), render, close: () => task.destroy() };
}
