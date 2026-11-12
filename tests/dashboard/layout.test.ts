import { describe, expect, it } from 'vitest';
import { CARD_IDS, cardSpans, DEFAULT_LAYOUT, isDefault, layoutSchema, move, normalise, offered, setVisible } from '../../lib/dashboard/layout';

/** The Overview layout's one shape and the editor's moves, shared by the browser, the server and (as SQL) the database. */
describe('dashboard layout', () => {
    it('the default (SAIC, 12 Nov): confidence first, the key figures, every page at a glance, then the chart, what was flagged and the forecast', () => {
        expect(DEFAULT_LAYOUT.cards.filter(c => c.visible).map(c => c.id)).toEqual(['confidence', 'figures', 'at-a-glance', 'cash-chart', 'flagged', 'forecast']);
        // Every card appears once; the checks card is covered by the confidence card, so it starts hidden like the optional ones.
        expect(DEFAULT_LAYOUT.cards.map(c => c.id).sort()).toEqual([...CARD_IDS].sort());
        expect(DEFAULT_LAYOUT.cards.find(c => c.id === 'checks')?.visible).toBe(false);
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
        const down = move(DEFAULT_LAYOUT, 'confidence', 1, true);
        expect(down.cards.slice(0, 2).map(c => c.id)).toEqual(['figures', 'confidence']);
        expect(move(DEFAULT_LAYOUT, 'confidence', -1, true)).toBe(DEFAULT_LAYOUT);
        // last-runs sits between reconciliation-summary and the end: for a Finance user it is skipped, so nothing moves.
        expect(move(DEFAULT_LAYOUT, 'reconciliation-summary', 1, false)).toBe(DEFAULT_LAYOUT);
        const runs = DEFAULT_LAYOUT.cards.find(c => c.id === 'last-runs')!;
        const lastFirst = { v: 1 as const, cards: [runs, ...DEFAULT_LAYOUT.cards.filter(c => c !== runs)] };
        expect(move(lastFirst, 'confidence', -1, false)).toBe(lastFirst);
        expect(offered(lastFirst, false).map(c => c.id)).not.toContain('last-runs');
        expect(offered(lastFirst, true)[0].id).toBe('last-runs');
    });
    it('isDefault recognises the default however it was reached', () => {
        expect(isDefault(DEFAULT_LAYOUT)).toBe(true);
        expect(isDefault(setVisible(DEFAULT_LAYOUT, 'figures', false))).toBe(false);
        expect(isDefault(move(move(DEFAULT_LAYOUT, 'flagged', 1, true), 'flagged', -1, true))).toBe(true);
    });
    it('the wide-screen grid keeps the chosen order: no card is pulled above an earlier one', () => {
        // Today's default: the chart spans two rows, with "Flagged" and the forecast stacked beside it.
        expect(cardSpans(['figures', 'cash-chart', 'flagged', 'forecast', 'checks'])).toEqual(['xl:col-span-3', 'xl:col-span-2 xl:row-span-2', 'xl:self-start', 'xl:self-start', 'xl:col-span-3']);
        // The checks moved above the forecast: only "Flagged" sits beside the chart (one row), so the forecast cannot backfill
        // a cell above the checks.
        expect(cardSpans(['figures', 'cash-chart', 'flagged', 'checks', 'forecast'])).toEqual(['xl:col-span-3', 'xl:col-span-2', 'xl:self-start', 'xl:col-span-3', 'xl:self-start']);
        // A two-column card with no narrow card after it takes the full width, leaving no empty cell.
        expect(cardSpans(['cash-chart', 'checks', 'counterparties'])).toEqual(['xl:col-span-3', 'xl:col-span-3', 'xl:col-span-3']);
        expect(cardSpans(['counterparties', 'reconciliation-summary', 'last-runs'])).toEqual(['xl:col-span-2', 'xl:self-start', 'xl:col-span-3']);
    });
});
