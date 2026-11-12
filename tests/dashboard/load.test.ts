import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => undefined }) }));
const { cachedLayout, loadLayout } = await import('../../components/demo/dashboard');
const { DEFAULT_LAYOUT, setVisible } = await import('../../lib/dashboard/layout');

/**
 * Loading a signed-in person's saved layout: a failed request is never taken for their choice (it is not kept for the tab,
 * so the next visit tries again and a Done cannot save the fallback over the real layout).
 */
const answer = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
const saved = setVisible(DEFAULT_LAYOUT, 'counterparties', true);

describe('loading the saved layout', () => {
    it('a database outage, a network error or a malformed answer is a failed load, and nothing is kept', async () => {
        expect(await loadLayout('a@example.invalid', answer(503, { code: 'WORKSPACE_UNAVAILABLE' }))).toEqual({ failed: true });
        expect(await loadLayout('a@example.invalid', (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toEqual({ failed: true });
        expect(await loadLayout('a@example.invalid', answer(200, { something: 'else' }))).toEqual({ failed: true });
        expect(cachedLayout('a@example.invalid')).toBeNull();
    });
    it('once the store answers, the saved layout is used and kept for this tab', async () => {
        expect(await loadLayout('a@example.invalid', answer(200, { dashboard: saved, updatedAt: '2026-11-12T00:00:00Z' }))).toEqual({ layout: saved });
        expect(cachedLayout('a@example.invalid')).toEqual(saved);
        // Kept for that person only.
        expect(cachedLayout('b@example.invalid')).toBeNull();
    });
    it('a member who never saved one gets the default, which is an answer and not a failure', async () => {
        expect(await loadLayout('c@example.invalid', answer(200, { dashboard: null, updatedAt: null }))).toEqual({ layout: DEFAULT_LAYOUT });
        expect(cachedLayout('c@example.invalid')).toEqual(DEFAULT_LAYOUT);
    });
});
