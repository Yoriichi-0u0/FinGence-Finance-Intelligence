import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { THEME_STORAGE_KEY, themeInitialization } from '../components/overview/theme-preference';
import { visibleNavigation, searchNavigation, moveNavigationIndex } from '../components/navigation/routes';
const local = { localFinancialConsumers: true, localReconciliation: true, localAdministration: true };
const paths = (mode: Parameters<typeof visibleNavigation>[0]) => visibleNavigation(mode).map(item => item.href);
describe('shared sidebar and navigation search catalogue', () => {
    it.each([['upload', '/data'], ['transactions', '/transactions'], ['matching', '/reconciliation'], ['reconcile', '/reconciliation'], ['forecast', '/forecasting'], ['report', '/reports'], ['question', '/ask']])('routes %s to an existing demo module', (query, href) => {
        expect(searchNavigation(visibleNavigation({ syntheticDemo: true }), query).map(item => item.href)).toContain(href);
    });
    it('uses names and descriptions, supports multiple terms and has an empty result state', () => {
        const items = visibleNavigation({ syntheticDemo: true });
        expect(searchNavigation(items, '  UPLOAD financial  ').map(item => item.href)).toEqual(['/data']);
        expect(searchNavigation(items, 'not-a-module')).toEqual([]);
        expect(searchNavigation(items, '  ')).toEqual(items);
    });
    it('hides all protected local finance and administration links before session confirmation', () => {
        expect(paths(local)).toEqual(['/', '/data']);
        for (const query of ['question', 'admin', 'transactions', 'matching']) expect(searchNavigation(visibleNavigation(local), query)).toEqual([]);
    });
    it('uses the PoC finance route only for Finance; runtime flags cannot be granted by a role', () => {
        const items = visibleNavigation({ ...local, role: 'Finance' });
        expect(searchNavigation(items, 'question').map(item => item.href)).toEqual(['/finance-questions']);
        expect(items.some(item => item.href === '/admin' || item.href === '/ask')).toBe(false);
        expect(paths({ role: 'Finance' })).not.toContain('/finance-questions');
        expect(paths({ role: 'Admin' })).not.toContain('/admin');
    });
    it.each(['Admin', 'Technical (Management)'] as const)('preserves the existing %s administration view without Finance links', role => {
        expect(paths({ ...local, role })).toEqual(['/', '/data', '/admin']);
        expect(searchNavigation(visibleNavigation({ ...local, role }), 'question')).toEqual([]);
    });
    it('keeps local routes absent in hosted/browser demo mode', () => {
        expect(paths({ syntheticDemo: true, role: 'Admin' })).not.toContain('/admin');
        expect(paths({ syntheticDemo: true, role: 'Finance' })).not.toContain('/finance-questions');
        expect(paths({ syntheticDemo: true })).toContain('/ask');
    });
    it('wraps keyboard selection in both directions and handles zero results', () => {
        expect(moveNavigationIndex(-1, 'ArrowDown', 3)).toBe(0);
        expect(moveNavigationIndex(-1, 'ArrowUp', 3)).toBe(2);
        expect(moveNavigationIndex(2, 'ArrowDown', 3)).toBe(0);
        expect(moveNavigationIndex(0, 'ArrowUp', 3)).toBe(2);
        expect(moveNavigationIndex(0, 'ArrowDown', 0)).toBe(-1);
    });
});

describe('initial theme preference', () => {
    function initial(saved: string | null, systemDark: boolean, blocked = false) {
        const element = { dataset: {} as Record<string, string> };
        runInNewContext(themeInitialization, {
            document: { documentElement: element },
            matchMedia: () => ({ matches: systemDark }),
            localStorage: { getItem: (key: string) => { expect(key).toBe(THEME_STORAGE_KEY); if (blocked) throw Error('Storage blocked'); return saved; } },
        });
        return element.dataset.fingenceTheme;
    }
    it('honors a saved preference even when it differs from the system theme', () => {
        expect(initial('light', true)).toBe('light'); expect(initial('dark', false)).toBe('dark');
    });
    it('defaults to the system for absent or invalid stored preferences', () => {
        expect(initial(null, true)).toBe('dark'); expect(initial('invalid', false)).toBe('light');
    });
    it('keeps the system default when preference storage is blocked', () => {
        expect(initial(null, true, true)).toBe('dark');
    });
});
