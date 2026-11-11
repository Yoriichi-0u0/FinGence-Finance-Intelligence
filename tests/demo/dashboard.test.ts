import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => undefined }) }));
const { DemoProcessingProvider } = await import('../../components/demo/context');
const { DemoModule, isReady } = await import('../../components/demo/modules');
const { default: DemoDataWorkspace } = await import('../../components/demo/data-workspace');
const { money, outflow } = await import('../../components/demo/shared');

const doc = (path: string): DocumentInput => ({ name: path.split('/').at(-1)!, bytes: new Uint8Array(readFileSync(join('public/demo', path))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const Provider = DemoProcessingProvider as (props: { enabled: boolean; children?: ReactNode }) => ReactNode;
const text = (child: ReactNode) => renderToStaticMarkup(createElement(Provider, { enabled: true }, child)).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('Overview dashboard', () => {
    it('leads with cash in, cash out, net and the reconciliation rate, then what FinGence flagged', async () => {
        const c = await processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv')]);
        if (!isReady(c)) throw Error('sample did not process');
        const page = text(createElement(DemoModule, { view: 'overview', context: c }));
        expect(page).toContain(`Cash in ${money(c.scope.currency, c.outputs.totals.credits)}`);
        expect(page).toContain(`Cash out ${outflow(c.scope.currency, c.outputs.totals.debits)}`);
        expect(page).toContain(`Net movement ${money(c.scope.currency, c.outputs.totals.net)}`);
        expect(page).toContain('Reconciled automatically');
        expect(page).toContain('Cash position through March 2026');
        const unexplained = c.outputs.resolution!.attention.length, flagged = c.outputs.anomalyResolution!.flagged;
        expect(page).toContain(unexplained + flagged ? 'Flagged by FinGence' : 'Nothing flagged');
        if (flagged) expect(page).toContain(`${flagged} unusual bank record`);
        expect(page).not.toMatch(/payments? the books do not show/);
        // The checks are one line, with the stage list behind it.
        const checks = c.stages.flatMap(s => s.checks);
        expect(page).toContain(`How FinGence checked these figures ${checks.filter(k => k.passed).length} of ${checks.length} checks passed`);
    });
    it('shows months side by side for a multi-month processing', async () => {
        const c = await processDocuments(['demo-bank-statement-2026-q1-sgd.csv', 'demo-general-ledger-2026-q1-sgd.csv'].map(n => doc(`quarter/${n}`)));
        if (!isReady(c)) throw Error('quarter sample did not process');
        expect(c.scope.months.length).toBe(3);
        expect(text(createElement(DemoModule, { view: 'overview', context: c }))).toContain('Cash in and out by month');
    });
});

describe('Data as three steps', () => {
    it('starts on Choose, keeps the safety line visible and the handling detail one click away', () => {
        const page = text(createElement(DemoDataWorkspace));
        expect(page).toContain('1 Choose (current) 2 Process 3 See results');
        expect(page).toContain('How your documents are handled');
        expect(page).toContain('Step 1 Choose documents');
        expect(page).toContain('Step 2 · in this browser Process and check');
        expect(page).toContain('Not started');
        expect(page).not.toContain('Identify documents and roles');
    });
});
