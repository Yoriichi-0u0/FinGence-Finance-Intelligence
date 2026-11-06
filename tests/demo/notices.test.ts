import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';

vi.mock('next/navigation', () => ({ usePathname: () => '/data' }));
const { DemoProcessingProvider } = await import('../../components/demo/context');
const { DemoBanner, CompactDemoNotice } = await import('../../components/demo/banner');
const { default: DemoDataWorkspace } = await import('../../components/demo/data-workspace');
const { usesOwnDocuments } = await import('../../components/demo/shared');
const { AppShell } = await import('../../components/app-shell');
const Shell = AppShell as (props: { syntheticDemo: boolean; children?: ReactNode }) => ReactNode;

const BANK = 'demo-bank-statement-2026-03.csv', LEDGER = 'demo-general-ledger-2026-03.csv';
const doc = (name: string, provenance: DocumentInput['provenance']): DocumentInput => ({ name, bytes: new Uint8Array(readFileSync(join('public/demo', name))), provenance });
// children are passed positionally, as the app does with JSX.
const Provider = DemoProcessingProvider as (props: { enabled: boolean; children?: ReactNode }) => ReactNode;
const page = (child: ReactNode) => renderToStaticMarkup(createElement(Provider, { enabled: true }, child)).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('public demo notices', () => {
    it('keeps the shell free of obsolete prototype notices and automatic dialogs', () => {
        const html = renderToStaticMarkup(createElement(Shell, { syntheticDemo: true }, createElement('p', null, 'Current page')));
        expect(html).not.toContain('Illustrative prototype page');
        expect(html).not.toContain('Hosted persistence, authentication and reconciliation are pending');
        expect(html).not.toContain('Illustrative page notice');
        expect(html).not.toContain('<dialog');
        expect(html).toContain('Current page');
    });
    it('keeps local processing and sessionStorage disclosures without the removed header notice', () => {
        const text = page(createElement(DemoDataWorkspace));
        expect(text).not.toContain('Public Demo');
        expect(text).toContain('Built-in samples are fictional.');
        expect(text).toContain('processed locally in this browser and are not uploaded to a server');
        expect(text).toContain("Temporary document contents in this tab's sessionStorage");
        expect(text).toContain('deterministic rules, not live AI');
        expect(text).not.toMatch(/fictional data(?! only)/i);
    });
    it('keeps both retired shared notices absent', () => {
        expect(page(createElement(DemoBanner))).toBe('');
        const text = page(createElement(CompactDemoNotice, { context: null }));
        expect(text).toBe('');
        expect(text).not.toContain('Public Demo');
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
