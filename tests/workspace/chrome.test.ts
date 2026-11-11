import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments, type DocumentInput, type ProcessingContext } from '../../lib/demo/pipeline';

vi.mock('next/navigation', () => ({ usePathname: () => '/data', useRouter: () => ({ push: () => undefined }) }));
const { WorkspaceContext } = await import('../../components/workspace/context');
const { SourceStrip } = await import('../../components/demo/shared');
const { DemoProcessingProvider } = await import('../../components/demo/context');
const { DemoBanner } = await import('../../components/demo/banner');
const { default: DemoDataWorkspace } = await import('../../components/demo/data-workspace');
const { AccountMenu } = await import('../../components/workspace/account-menu');
const { AuthLayout, SignIn } = await import('../../components/workspace/access');
type Role = 'FINANCE' | 'ADMIN' | 'SUPERADMIN';

const doc = (name: string): DocumentInput => ({ name, bytes: new Uint8Array(readFileSync(join('public/demo', name))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const session = (role: Role) => ({ email: 'pat.lee@saic-test.invalid', role, organization: { name: 'SAIC' }, processing: { paused: false, reason: null, since: null }, ai: { enabled: true } });
/** Renders as a signed-in person, optionally viewing as a lower role. */
function as(role: Role | null, child: ReactNode, viewRole: Role | null = role) {
    const value = { enabled: role !== null, loading: false, session: role ? session(role) : null, viewRole, setViewAs: () => undefined, ended: false, refresh: async () => null, signOut: async () => undefined };
    const Provider = DemoProcessingProvider as (props: { enabled: boolean; children?: ReactNode }) => ReactNode;
    return renderToStaticMarkup(createElement(WorkspaceContext.Provider, { value }, createElement(Provider, { enabled: true }, child))).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
}

describe('page chrome by role', async () => {
    const context: ProcessingContext = await processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv')]);
    const fingerprint = context.documents[0].sha256.slice(0, 12);

    it('a Finance user sees the business and period, not the processing ID or fingerprints', () => {
        const text = as('FINANCE', createElement(SourceStrip, { context }));
        expect(text).toContain(`${context.scope!.businessName} (${context.scope!.businessId})`);
        expect(text).not.toContain(context.processingId);
        expect(text).not.toContain(fingerprint);
    });
    it('Admins, Superadmins and deployments without sign-in see them', () => {
        for (const role of ['ADMIN', 'SUPERADMIN', null] as const) {
            const text = as(role, createElement(SourceStrip, { context }));
            expect(text).toContain(context.processingId);
            expect(text).toContain(fingerprint);
        }
    });
    it('an Admin viewing as a Finance user sees what a Finance user sees', () => {
        expect(as('ADMIN', createElement(SourceStrip, { context }), 'FINANCE')).not.toContain(context.processingId);
    });
    it('signed in, the banner is status chips without the public-demo warning, and Data names the test version', () => {
        const banner = as('FINANCE', createElement(DemoBanner));
        expect(banner).toContain('SAIC');
        expect(banner).not.toMatch(/public demo|no sign-in/i);
        const data = as('FINANCE', createElement(DemoDataWorkspace));
        expect(data).toContain('Test version for SAIC: use the sample documents or test files, not confidential records.');
        expect(data).not.toMatch(/Public prototype|Synthetic sample/);
    });
    it('the account menu shows who is signed in and opens on demand', () => {
        const menu = as('ADMIN', createElement(AccountMenu));
        expect(menu).toContain('pat.lee@saic-test.invalid');
        expect(menu).toContain('Admin · SAIC');
        expect(menu).not.toContain('Sign out');
        expect(as('ADMIN', createElement(AccountMenu), 'FINANCE')).toContain('Viewing as Finance user');
        expect(as(null, createElement(AccountMenu))).toBe('');
    });
    it('the sign-in page is branded and makes no claim the system cannot keep', () => {
        const page = as(null, createElement(AuthLayout, null, createElement(SignIn)));
        expect(page).toContain('FinGence');
        expect(page).toContain('For SAIC users · by invitation only');
        expect(page).toContain('It never supplies an amount.');
        expect(page).toContain('I have a code');
    });
});
