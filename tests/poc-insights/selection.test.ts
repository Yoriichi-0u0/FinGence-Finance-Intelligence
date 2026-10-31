import { describe, expect, it } from 'vitest';
import { readSelection, rememberSelection, forgetSelection } from '../../lib/poc-insights/selection';
import type { M2ClientPrincipal } from '../../lib/ai-ingestion/m2-client-state';
const p: M2ClientPrincipal = { userId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', role: 'Finance', membershipVersion: 1 };
const selected = { source: '33333333-3333-4333-8333-333333333333', business: 'BUS-001', period: '2026-03', currency: 'MYR' };
const store = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } }; };
describe('non-authoritative cross-page source selection', () => {
    it('preserves the selected source/business/period/currency through sidebar navigation', () => {
        const s = store(); rememberSelection(s, p, selected); expect(readSelection(s, p, '')).toEqual(selected);
        expect(readSelection(s, p, '?' + new URLSearchParams({ ...selected, period: '2026-02' }))).toEqual({ ...selected, period: '2026-02' });
    });
    it('separates principals, organizations, roles and membership versions and clears on invalidation', () => {
        const s = store(); rememberSelection(s, p, selected);
        for (const change of [{ userId: 'another' }, { organizationId: 'another' }, { membershipVersion: 2 }, { role: 'Admin' as const }]) expect(readSelection(s, { ...p, ...change }, '')).toBeNull();
        forgetSelection(s, p); expect(readSelection(s, p, '')).toBeNull();
    });
    it('rejects invalid explicit URL selections rather than silently selecting another dataset', () => {
        expect(() => readSelection(store(), p, '?source=invalid')).toThrow('INVALID_SELECTION');
        const broken = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); }, removeItem: () => { throw Error('blocked'); } };
        expect(readSelection(broken, p, '')).toBeNull(); expect(rememberSelection(broken, p, selected)).toBe(false); expect(() => forgetSelection(broken, p)).not.toThrow();
    });
});
