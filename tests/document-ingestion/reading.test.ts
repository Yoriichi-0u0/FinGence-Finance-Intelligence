import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';
import type { LayoutInterpreter } from '../../lib/interpretation/contracts';
import { imageSize } from '../../lib/interpretation/extract';
import { stopOcr } from '../../lib/interpretation/ocr';
import { CORRECT, wire } from '../interpretation/proposals';

// What the side-by-side document view shows: each verified record points to the line it was read from.
const file = (dir: string, name: string): DocumentInput => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const receipt = { provider: 'GROQ' as const, model: 'recorded-test', requestId: null, latencyMs: 0, inputTokens: null, outputTokens: null, estimatedUsd: null, mode: 'LIVE' as const };
const recorded: LayoutInterpreter = { async propose(e) { const p = CORRECT[e.fileName]; return { proposal: p ? wire(p) : { layout: { role: 'UNSUPPORTED' }, rationale: '', unresolved: [] }, receipt }; } };
afterAll(() => stopOcr());

describe('the reading behind the side-by-side document view', () => {
    it('maps every record of a supported-schema CSV to its own line, with no AI lines', async () => {
        const c = await processDocuments(['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv'].map(n => file('public/demo', n)));
        const [bank, ledger] = c.documents;
        expect(bank.reading!.records).toHaveLength(c.outputs.bankRows.length);
        expect(ledger.reading!.records).toHaveLength(c.outputs.ledger!.rows.length);
        for (const d of [bank, ledger]) for (const r of d.reading!.records) expect(d.reading!.rows[r.line]).toContain(r.id);
        expect(bank.reading!.aiLines).toEqual([]);
        expect(bank.reading!.columns.map(x => x.field)).toEqual(expect.arrayContaining(['recordId', 'date', 'description', 'reference', 'amount']));
    });

    it('maps each record of an AI-read CSV to its source line, and lists the lines the model was shown', async () => {
        const c = await processDocuments([file('public/demo/unfamiliar', 'bank-statement-march-2026-export.csv'), file('public/demo/unfamiliar', 'general-ledger-cash-march-2026.csv')], undefined, undefined, { interpreter: recorded });
        const bank = c.documents[0], r = bank.reading!;
        expect(bank.decision).toBe('AUTO_ACCEPTED');
        expect(r.records).toHaveLength(c.outputs.bankRows.length);
        // Each record's line holds that record's amount, as the document prints it.
        const byId = new Map(c.outputs.bankRows.map(x => [x.rowId, x]));
        for (const rec of r.records) expect(r.rows[rec.line].join(' ').replace(/,/g, '')).toContain(byId.get(rec.id)!.amount.replace(/\.00$/, ''));
        expect(r.aiLines.length).toBeGreaterThan(0);
        expect(r.aiLines.length).toBeLessThan(r.rows.length);
        expect(r.columns.map(x => x.field)).toEqual(expect.arrayContaining(['date', 'description']));
    });

    it('keeps where every cell of a PDF sits on its page', async () => {
        const c = await processDocuments([file('public/demo/unfamiliar', 'bank-statement-march-2026.pdf'), file('public/demo/unfamiliar', 'general-ledger-cash-march-2026.pdf')], undefined, undefined, { interpreter: recorded });
        const bank = c.documents[0], src = bank.source!;
        expect(src.kind).toBe('PDF_TEXT');
        if (src.kind === 'WORKSHEET') return;
        expect(src.geometry!.length).toBe(bank.reading!.rows.length);
        expect(src.coords).toEqual(expect.arrayContaining([{ number: 1, coords: 'POINTS', scale: 1 }]));
        for (const rec of bank.reading!.records) {
            const g = src.geometry![rec.line]!;
            expect(g.page).toBeGreaterThanOrEqual(1);
            expect(g.cells.filter(Boolean).length).toBeGreaterThanOrEqual(3);
            for (const b of g.cells) if (b) expect(b[2]).toBeGreaterThan(b[0]);
        }
    }, 60_000);

    it('reads the pixel size of a scan from its header', () => {
        const jpg = new Uint8Array(readFileSync('public/demo/unfamiliar/general-ledger-cash-march-2026-scan.jpg'));
        const size = imageSize(jpg)!;
        expect(size.width).toBeGreaterThan(1000);
        expect(size.height).toBeGreaterThan(size.width);
        expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
    });
});
