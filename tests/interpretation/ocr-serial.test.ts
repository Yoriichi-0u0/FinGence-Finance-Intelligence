import { describe, expect, it, vi } from 'vitest';

// Two overlapping reads (two server jobs) must not interleave their settings on the shared OCR worker.
const log: string[] = [];
vi.mock('tesseract.js', () => ({
    createWorker: async () => {
        let mode = '';
        return {
            setParameters: async (p: { tessedit_pageseg_mode?: string }) => { if (p.tessedit_pageseg_mode) mode = p.tessedit_pageseg_mode; log.push(`set:${mode}`); await new Promise(r => setTimeout(r, 5)); },
            recognize: async (image: Buffer) => { await new Promise(r => setTimeout(r, 5)); log.push(`read:${image[0]}:${mode}`); return { data: { blocks: [] } }; },
            terminate: async () => undefined,
        };
    },
}));

describe('OCR on the shared worker', () => {
    it('runs one read at a time, so each pass uses its own settings', async () => {
        const { ocrWords } = await import('../../lib/interpretation/ocr');
        await Promise.all([ocrWords(new Uint8Array([1]), 1), ocrWords(new Uint8Array([2]), 1)]);
        const reads = log.filter(l => l.startsWith('read:'));
        // Each image is read in block mode (6) then automatic mode (3), and the first image's reads all come first.
        expect(reads).toEqual(['read:1:6', 'read:1:3', 'read:2:6', 'read:2:3']);
    });
});
