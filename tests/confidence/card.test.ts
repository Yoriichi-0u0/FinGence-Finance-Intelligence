import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';

vi.mock('next/navigation', () => ({ usePathname: () => '/data' }));
const { ConfidenceCard, CONFIDENCE_DEFINITION } = await import('../../components/demo/confidence');
const doc = (p: string): DocumentInput => ({ name: p.split('/').at(-1)!, bytes: new Uint8Array(readFileSync(join('public/demo', p))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');

describe('the confidence card a Finance user sees', () => {
    it('shows one percentage and its band in plain words, with the way it is measured one click away', async () => {
        const c = await processDocuments(['quarter/demo-bank-statement-2026-q1-sgd.csv', 'quarter/demo-general-ledger-2026-q1-sgd.csv'].map(doc));
        const page = text(renderToStaticMarkup(createElement(ConfidenceCard, { context: c })));
        expect(page).toContain('Processing confidence 99% High confidence');
        expect(page).toContain('How is this measured?');
        // Closed until asked for; it never shows a model, tokens or a fingerprint.
        expect(page).not.toContain(CONFIDENCE_DEFINITION);
        expect(page).not.toMatch(/token|SHA-256|gpt-oss/i);
    });
    it('shows "Incomplete" with the reason when a stage behind the figures did not pass', async () => {
        const c = structuredClone(await processDocuments(['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv'].map(doc)));
        c.stages.find(s => s.id === 'VERIFY')!.decision = 'QUARANTINED';
        const page = text(renderToStaticMarkup(createElement(ConfidenceCard, { context: c })));
        expect(page).toContain('Incomplete');
        expect(page).toContain('Independent verification');
        expect(page).not.toMatch(/\d+%/);
    });
});
