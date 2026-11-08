import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';

vi.mock('next/navigation', () => ({ usePathname: () => '/data' }));
const { DemoProcessingProvider } = await import('../../components/demo/context');
const { DemoBanner } = await import('../../components/demo/banner');
const { default: DemoDataWorkspace } = await import('../../components/demo/data-workspace');
const { usesOwnDocuments } = await import('../../components/demo/shared');

const BANK = 'demo-bank-statement-2026-03.csv', LEDGER = 'demo-general-ledger-2026-03.csv';
const doc = (name: string, provenance: DocumentInput['provenance']): DocumentInput => ({ name, bytes: new Uint8Array(readFileSync(join('public/demo', name))), provenance });
// children are passed positionally, as the app does with JSX.
const Provider = DemoProcessingProvider as (props: { enabled: boolean; children?: ReactNode }) => ReactNode;
const page = (child: ReactNode) => renderToStaticMarkup(createElement(Provider, { enabled: true }, child)).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('public demo notices', () => {
    it('warns against confidential documents and explains local processing and sessionStorage on Data', () => {
        const text = page(createElement(DemoDataWorkspace));
        expect(text).toContain('Public prototype: do not submit confidential or real financial documents.');
        expect(text).toContain('The built-in sample documents are fictional.');
        expect(text).toContain('processed locally in this browser and are not uploaded to a server');
        expect(text).toContain("kept temporarily in this tab's sessionStorage");
        expect(text).toContain('This is not live AI inference.');
        expect(text).not.toMatch(/fictional data(?! only)/i);
    });
    it('keeps the banner rule-based and never calls every document fictional', () => {
        const text = page(createElement(DemoBanner));
        expect(text).toContain('rule-based processing in your browser, not live AI');
        expect(text).toContain('do not use confidential or real financial documents');
        expect(text).not.toMatch(/fictional data/i);
    });
    it('distinguishes the built-in samples from the visitor’s own files without changing the processing', async () => {
        const sample = await processDocuments([doc(BANK, 'PUBLIC_SYNTHETIC_SAMPLE'), doc(LEDGER, 'PUBLIC_SYNTHETIC_SAMPLE')]);
        const own = await processDocuments([doc(BANK, 'USER_SUPPLIED'), doc(LEDGER, 'PUBLIC_SYNTHETIC_SAMPLE')]);
        expect(usesOwnDocuments(sample)).toBe(false);
        expect(usesOwnDocuments(own)).toBe(true);
        expect(own.processingId).toBe(sample.processingId);
        expect(own.outputs.reconciliation!.cashMovement.signedDifference).toBe('-2692.92');
        const limitations = sample.outputs.report!.limitations.join(' ');
        expect(limitations).toContain('sessionStorage');
        expect(limitations).not.toMatch(/persisted/);
    });
});
