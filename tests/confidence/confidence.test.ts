import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput, type ProcessingContext } from '../../lib/demo/pipeline';
import { bandOf, processingConfidence, readingConcern } from '../../lib/confidence';

const doc = (p: string): DocumentInput => ({ name: p.split('/').at(-1)!, bytes: new Uint8Array(readFileSync(join('public/demo', p))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const march = () => processDocuments(['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv'].map(doc));
const quarter = () => processDocuments(['quarter/demo-bank-statement-2026-q1-sgd.csv', 'quarter/demo-general-ledger-2026-q1-sgd.csv'].map(doc));
const copy = (c: ProcessingContext) => structuredClone(c);

/** Confidence = the share of bank movement, by value, read reliably, checked and explained. Not a probability. */
describe('processing confidence', () => {
    it('a fully read, checked and explained month is 100%, High', async () => {
        const c = processingConfidence(await march());
        expect(c).toMatchObject({ status: 'MEASURED', percent: 100, band: 'HIGH', currency: 'MYR', records: 57, counted: 57 });
    });
    it('a forecast that cannot be made (no history) is not a doubt about the figures', async () => {
        const m = await march();
        expect(m.stages.find(s => s.id === 'FORECAST')?.decision).not.toBe('AUTO_ACCEPTED');
        expect(processingConfidence(m).status).toBe('MEASURED');
    });
    it('an unusual record the books could not settle lowers it by its value, and says so', async () => {
        const c = processingConfidence(await quarter());
        if (c.status !== 'MEASURED') throw Error(c.reason);
        expect(c.percent).toBe(99);
        expect(c.band).toBe('HIGH');
        expect(c.explained).toEqual({ cents: '129900', records: 1, reasons: ['1 unusual record (SGD 1,299.00) the books could not settle'] });
        expect(c.read.records).toBe(0);
    });
    it('a statement read by OCR below 90% confidence is not read reliably: none of its money counts', async () => {
        const m = copy(await march()), statement = m.documents.find(d => d.role === 'BANK_STATEMENT')!;
        statement.source = { kind: 'OCR', file: 'scan.jpg', fileSha256: 'a'.repeat(64), pages: 1, confidence: 85, notes: [], disputes: [] };
        expect(readingConcern(statement)).toBe(`${statement.name} was read by OCR at 85% confidence (below 90%)`);
        const c = processingConfidence(m);
        expect(c).toMatchObject({ status: 'MEASURED', percent: 0, band: 'LOW', read: { records: 57 } });
    });
    it('OCR at 90% or more counts only when its amounts were confirmed by the arithmetic anchor', async () => {
        const m = copy(await march()), statement = m.documents.find(d => d.role === 'BANK_STATEMENT')!;
        statement.source = { kind: 'OCR', file: 'scan.jpg', fileSha256: 'a'.repeat(64), pages: 1, confidence: 93, notes: [], disputes: [] };
        statement.interpretation = { method: 'AI_LAYOUT_PROPOSAL', receipt: null, proposal: null, error: null, decision: 'AUTO_ACCEPTED', summary: '', checks: [{ id: 'anchor', label: 'Anchor', passed: true, detail: '' }],
            mapping: [], disclosures: [], canonicalSha256: null, canonicalNet: null, mappingHash: null };
        expect(processingConfidence(m)).toMatchObject({ percent: 100 });
        statement.interpretation.checks[0].passed = false;
        expect(readingConcern(statement)).toMatch(/could not be confirmed by its own arithmetic/);
    });
    it('a ledger that was not read reliably means nothing counts as explained', async () => {
        const m = copy(await march()), ledger = m.documents.find(d => d.role === 'GENERAL_LEDGER')!;
        ledger.source = { kind: 'OCR', file: 'ledger.jpg', fileSha256: 'b'.repeat(64), pages: 1, confidence: 70, notes: [], disputes: [] };
        const c = processingConfidence(m);
        expect(c).toMatchObject({ percent: 0, band: 'LOW' });
        if (c.status === 'MEASURED') expect(c.explained.reasons.at(-1)).toMatch(/^the ledger is not reliable/);
    });
    it('a stage behind the figures that did not pass gives no percentage at all', async () => {
        const m = copy(await march());
        m.stages.find(s => s.id === 'RECONCILE')!.decision = 'QUARANTINED';
        expect(processingConfidence(m)).toMatchObject({ status: 'INCOMPLETE', reason: expect.stringContaining('Deterministic reconciliation') });
    });
    it('bands: 98% and above High, 90% to 98% Check advised, below Low; never rounded up to 100%', () => {
        expect([bandOf(100), bandOf(98), bandOf(97.9), bandOf(90), bandOf(89.9)]).toEqual(['HIGH', 'HIGH', 'CHECK', 'CHECK', 'LOW']);
    });
});
