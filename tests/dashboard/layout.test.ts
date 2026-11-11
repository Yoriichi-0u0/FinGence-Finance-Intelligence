import { describe, expect, it } from 'vitest';
import { CARD_IDS, DEFAULT_LAYOUT, isDefault, layoutSchema, move, normalise, offered, setVisible } from '../../lib/dashboard/layout';

/** The Overview layout's one shape and the editor's moves, shared by the browser, the server and (as SQL) the database. */
describe('dashboard layout', () => {
    it('the default is today\'s Overview: the five original cards in order, the optional ones hidden', () => {
        expect(DEFAULT_LAYOUT.cards.filter(c => c.visible).map(c => c.id)).toEqual(['figures', 'cash-chart', 'flagged', 'forecast', 'checks']);
        expect(DEFAULT_LAYOUT.cards.map(c => c.id)).toEqual([...CARD_IDS]);
        expect(layoutSchema.safeParse(DEFAULT_LAYOUT).success).toBe(true);
    });
    it('normalise keeps a saved order, appends a card added since (hidden), and falls back to the default for anything else', () => {
        const saved = { v: 1, cards: [{ id: 'checks', visible: true }, { id: 'figures', visible: false }] };
        const out = normalise(saved);
        expect(out.cards.slice(0, 2)).toEqual(saved.cards);
        expect(out.cards).toHaveLength(CARD_IDS.length);
        expect(out.cards.slice(2).every(c => !c.visible)).toBe(true);
        for (const bad of [null, 'x', { v: 1, cards: [{ id: 'nope', visible: true }] }, { v: 1, cards: [{ id: 'figures', visible: true }], extra: 1 }]) expect(normalise(bad)).toEqual(DEFAULT_LAYOUT);
    });
    it('move swaps with the neighbour, does nothing at either end, and skips a card the person is not offered', () => {
        const down = move(DEFAULT_LAYOUT, 'figures', 1, true);
        expect(down.cards.slice(0, 2).map(c => c.id)).toEqual(['cash-chart', 'figures']);
        expect(move(DEFAULT_LAYOUT, 'figures', -1, true)).toBe(DEFAULT_LAYOUT);
        // last-runs sits between reconciliation-summary and the end: for a Finance user it is skipped, so nothing moves.
        expect(move(DEFAULT_LAYOUT, 'reconciliation-summary', 1, false)).toBe(DEFAULT_LAYOUT);
        const lastFirst = { v: 1 as const, cards: [DEFAULT_LAYOUT.cards[7], ...DEFAULT_LAYOUT.cards.slice(0, 7)] };
        expect(move(lastFirst, 'figures', -1, false)).toBe(lastFirst);
        expect(offered(lastFirst, false).map(c => c.id)).not.toContain('last-runs');
        expect(offered(lastFirst, true)[0].id).toBe('last-runs');
    });
    it('isDefault recognises the default however it was reached', () => {
        expect(isDefault(DEFAULT_LAYOUT)).toBe(true);
        expect(isDefault(setVisible(DEFAULT_LAYOUT, 'checks', false))).toBe(false);
        expect(isDefault(move(move(DEFAULT_LAYOUT, 'flagged', 1, true), 'flagged', -1, true))).toBe(true);
    });
});
