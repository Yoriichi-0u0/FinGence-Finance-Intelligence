import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => undefined }) }));
const { DemoProcessingProvider } = await import('../../components/demo/context');
const { DemoModule, isReady } = await import('../../components/demo/modules');
const { money } = await import('../../components/demo/shared');

const doc = (path: string): DocumentInput => ({ name: path.split('/').at(-1)!, bytes: new Uint8Array(readFileSync(join('public/demo', path))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const Provider = DemoProcessingProvider as (props: { enabled: boolean; children?: ReactNode }) => ReactNode;
const text = (child: ReactNode) => renderToStaticMarkup(createElement(Provider, { enabled: true }, child)).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('Signal ledger on the results pages', () => {
    it('Anomalies leads with what is flagged and the money at stake; what the books settled steps back', async () => {
        const c = await processDocuments(['demo-bank-statement-2026-q1-sgd.csv', 'demo-general-ledger-2026-q1-sgd.csv'].map(n => doc(`quarter/${n}`)));
        if (!isReady(c)) throw Error('sample did not process');
        const ar = c.outputs.anomalyResolution!, page = text(createElement(DemoModule, { view: 'anomalies', context: c }));
        expect(ar.flagged).toBeGreaterThan(0);
        const flagged = ar.items.filter(x => x.resolution === 'FLAGGED');
        const stake = flagged.reduce((t, x) => t + Math.abs(Math.round(Number(x.row.signedAmount) * 100)), 0);
        expect(page).toContain(`Money at stake ${money(c.scope.currency, (stake / 100).toFixed(2))}`);
        expect(page).toContain(`Needs you · ${ar.flagged} flagged`);
        expect(page.indexOf('Needs you')).toBeLessThan(page.indexOf('confirmed by your books, no action needed'));
        expect(page).toContain(`${ar.corroborated} confirmed by your books, no action needed`);
    });

    it('with nothing flagged, Anomalies has no money at stake and no Needs you', async () => {
        const c = await processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv')]);
        if (!isReady(c)) throw Error('sample did not process');
        const page = text(createElement(DemoModule, { view: 'anomalies', context: c }));
        expect(c.outputs.anomalyResolution!.flagged).toBe(0);
        expect(page).not.toContain('Money at stake');
        expect(page).not.toContain('Needs you');
    });

    it('Reconciliation puts its figures on the headline band and lists a month nobody could reconcile under Needs you', async () => {
        const ledger = readFileSync(join('public/demo/quarter', 'demo-general-ledger-2026-q1-sgd.csv'), 'utf8').split('\n').filter((l, i) => i === 0 || !l.includes(',2026-03-')).join('\n');
        const c = await processDocuments([doc('quarter/demo-bank-statement-2026-q1-sgd.csv'), { name: 'demo-general-ledger-2026-q1-sgd.csv', bytes: new TextEncoder().encode(ledger), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' }]);
        if (!isReady(c)) throw Error('sample did not process');
        const html = renderToStaticMarkup(createElement(Provider, { enabled: true }, createElement(DemoModule, { view: 'reconciliation', context: c })));
        const page = text(createElement(DemoModule, { view: 'reconciliation', context: c }));
        expect(html).toContain('aria-label="Headline figures"');
        expect(page).toContain(`Bank cash movement ${money(c.scope.currency, c.outputs.reconciliation!.cashMovement.bank)}`);
        expect(c.outputs.notReconciled.length).toBeGreaterThan(0);
        expect(page).toContain(`Needs you`);
        expect(page).toMatch(new RegExp(`${c.outputs.notReconciled.length} months? not reconciled`));
        expect(html).toContain('href="#not-reconciled"');
    });
});
