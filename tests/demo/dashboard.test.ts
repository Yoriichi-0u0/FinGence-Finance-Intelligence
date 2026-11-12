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
const { WorkspaceContext } = await import('../../components/workspace/context');
const { DEFAULT_LAYOUT, move, setVisible } = await import('../../lib/dashboard/layout');
const { DashboardEditor } = await import('../../components/demo/dashboard');

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

describe('Overview with a saved layout (Customise dashboard)', () => {
    // The chart hidden, "Flagged by FinGence" first, the two optional cards shown, and the Admin-only card switched on.
    const saved = move(move(setVisible(setVisible(setVisible(setVisible(DEFAULT_LAYOUT, 'cash-chart', false), 'counterparties', true), 'reconciliation-summary', true), 'last-runs', true), 'flagged', -1, true), 'flagged', -1, true);
    const asRole = (role: 'FINANCE' | 'ADMIN', child: ReactNode) => createElement(WorkspaceContext.Provider, { value: { enabled: true, loading: false, session: { email: 'x@example.invalid', role, organization: { name: 'SAIC' }, processing: { paused: false, reason: null, since: null }, ai: { enabled: true } }, viewRole: role, setViewAs: () => undefined, ended: false, refresh: async () => null, signOut: async () => undefined } }, child);
    it('draws the cards in the saved order, leaves hidden ones out, and adds the optional cards', async () => {
        const c = await processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv')]);
        if (!isReady(c)) throw Error('sample did not process');
        const page = text(asRole('FINANCE', createElement(DemoModule, { view: 'overview', context: c, layout: saved })));
        const flagged = c.outputs.resolution!.attention.length + c.outputs.anomalyResolution!.flagged ? 'Flagged by FinGence' : 'Nothing flagged';
        const at = (s: string) => { const i = page.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
        expect(at(flagged)).toBeLessThan(at('Cash in '));
        expect(at('Cash in ')).toBeLessThan(at('How FinGence checked these figures'));
        expect(at('How FinGence checked these figures')).toBeLessThan(at('Largest counterparties'));
        expect(at('Largest counterparties')).toBeLessThan(at('Reconciliation summary'));
        expect(page).not.toContain('Cash position through');
        expect(page).toContain('Customise dashboard');
        // The largest payer in, from the verified rows, with its total.
        const top = new Map<string, number>(); for (const r of c.outputs.bankRows) if (r.direction === 'Credit') top.set(r.counterparty, (top.get(r.counterparty) ?? 0) + Number(r.amount));
        const [name] = [...top.entries()].sort((a, b) => b[1] - a[1])[0];
        expect(page).toContain(name);
        expect(page).toContain(`Matched exactly ${c.outputs.reconciliation!.counts.MATCH_EXACT}`);
        // A Finance user (or an Admin viewing as one) never gets the Admin-only card, whatever the layout says.
        expect(page).not.toContain('Last processing runs');
        expect(text(asRole('ADMIN', createElement(DemoModule, { view: 'overview', context: c, layout: saved })))).toContain('Last processing runs');
    });
    it('with every card hidden, it says how to bring them back', async () => {
        const c = await processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv')]);
        if (!isReady(c)) throw Error('sample did not process');
        const none = { v: 1 as const, cards: DEFAULT_LAYOUT.cards.map(x => ({ ...x, visible: false })) };
        expect(text(createElement(DemoModule, { view: 'overview', context: c, layout: none }))).toContain('Every card is hidden. Use Customise dashboard to show them again.');
    });
});

describe('Customise dashboard editor', () => {
    const editor = (saving: boolean) => renderToStaticMarkup(createElement(DashboardEditor, { draft: setVisible(DEFAULT_LAYOUT, 'checks', false), admin: true, where: 'workspace', saving, error: null, onChange: () => undefined, onDone: () => undefined, onCancel: () => undefined }));
    const off = (button: string) => /\sdisabled=""/.test(button);
    const switches = (html: string) => [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map(m => m[0]);
    const moves = (html: string) => [...html.matchAll(/<button[^>]*aria-label="Move [^"]*"[^>]*>/g)].map(m => m[0]);
    const reset = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Reset to default/)![0];
    it('while a save is pending, no control can change the layout (an edit then would be lost when the save finishes)', () => {
        const busy = editor(true), idle = editor(false);
        expect(switches(busy)).toHaveLength(8);
        expect(moves(busy)).toHaveLength(16);
        expect([...switches(busy), ...moves(busy)].every(off)).toBe(true);
        expect(off(reset(busy))).toBe(true);
        expect(busy).toContain('aria-busy="true"');
        // When idle the switches and Reset work, and only the first Up and the last Down are disabled.
        expect(switches(idle).some(off)).toBe(false);
        expect(moves(idle).filter(off)).toHaveLength(2);
        expect(off(reset(idle))).toBe(false);
    });
});

describe('results pages share one pattern', () => {
    it('every page names the period and currency above a short title, and uses the Overview figure names', async () => {
        const c = await processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv'), doc('demo-bank-history-2025-04-to-2026-03.csv')]);
        if (!isReady(c)) throw Error('sample did not process');
        for (const view of ['transactions', 'reconciliation', 'analytics', 'anomalies', 'forecasting', 'reports', 'ask'] as const) {
            const page = text(createElement(DemoModule, { view, context: c }));
            expect(page, view).toMatch(/^ ?March 2026 · MYR /);
            expect(page, view).not.toMatch(/Results · /);
        }
        for (const view of ['transactions', 'analytics'] as const) {
            const page = text(createElement(DemoModule, { view, context: c }));
            expect(page).toContain('Cash in');
            expect(page).not.toMatch(/Bank cash in \(credits\)|Net signed movement/);
        }
        expect(text(createElement(DemoModule, { view: 'forecasting', context: c }))).toContain('Expected net');
    });
    it('amount columns line up: right-aligned figures of equal width', async () => {
        const c = await processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv')]);
        if (!isReady(c)) throw Error('sample did not process');
        const html = renderToStaticMarkup(createElement(Provider, { enabled: true }, createElement(DemoModule, { view: 'transactions', context: c })));
        expect(html).toMatch(/<th scope="col" class="px-4 py-2.5 font-semibold text-right tabular-nums whitespace-nowrap">Signed amount<\/th>/);
    });
    it('an empty result says what is missing and offers the one thing to do', async () => {
        const c = await processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv')]);
        if (!isReady(c)) throw Error('sample did not process');
        const page = text(createElement(DemoModule, { view: 'analytics', context: c }));
        expect(page).toContain('No monthly trend yet');
        expect(page).toContain('Open Data');
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
