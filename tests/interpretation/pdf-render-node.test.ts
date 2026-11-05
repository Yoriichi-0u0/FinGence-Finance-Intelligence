import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { extractDocument } from '../../lib/interpretation/extract';
import { readPdf } from '../../lib/interpretation/pdf';
import { sha256Hex } from '../../lib/document-ingestion/ingest';

// A scanned page that is NOT one stored JPEG (here the scan plus a second image, as a scanner stamp or logo would be):
// in Node (a server processing job) it is rendered on pdf.js's own canvas and read by OCR, as in the browser.
async function twoImageScan() {
    const jpg = readFileSync('public/demo/unfamiliar/general-ledger-cash-march-2026-scan.jpg');
    const pdf = await PDFDocument.create(), scan = await pdf.embedJpg(jpg), stamp = await pdf.embedJpg(jpg);
    const w = scan.width * 0.24, h = scan.height * 0.24, page = pdf.addPage([w, h]);
    page.drawImage(scan, { x: 0, y: 0, width: w, height: h });
    page.drawImage(stamp, { x: w - 12, y: h - 12, width: 8, height: 8 });
    return new Uint8Array(await pdf.save());
}

describe('scanned PDF pages in Node', () => {
    it('renders a page that is not a single stored JPEG', async () => {
        const doc = await readPdf(await twoImageScan());
        try {
            expect(doc.pages[0].scanned).toBe(true);
            expect(await doc.image(1)).toBeNull();
            const png = await doc.render(1, 300 / 72);
            expect(png).toBeInstanceOf(Uint8Array);
            expect([...(png as Uint8Array).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
        } finally { await doc.close(); }
    }, 60_000);

    it('reads it by OCR on the server instead of refusing it', async () => {
        const bytes = await twoImageScan(), read = await extractDocument('ledger-scan-two-images.pdf', bytes, await sha256Hex(bytes));
        expect('error' in read).toBe(false);
        if ('error' in read) return;
        expect(read.source).toEqual(expect.objectContaining({ kind: 'OCR', pages: 1 }));
        expect(read.source.notes[0]).toMatch(/1 of 1 scanned PDF page read by OCR \(.*on the server\)/);
        expect(new TextDecoder().decode(read.bytes)).toMatch(/GL-?DEMO/i);
    }, 180_000);
});
