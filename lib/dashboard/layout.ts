import { z } from 'zod';

/**
 * The Overview layout a person chooses with "Customise dashboard": which cards are shown, and in what order.
 * The same strict shape is checked in the browser, the server and the database (supabase/sql/workspace-v4-preferences.sql,
 * fingence_workspace.valid_dashboard). A new card needs a migration that adds its ID there too.
 */
export const CARD_IDS = ['figures', 'cash-chart', 'flagged', 'forecast', 'checks', 'counterparties', 'reconciliation-summary', 'last-runs'] as const;
export type CardId = typeof CARD_IDS[number];

export const CARDS: Record<CardId, { label: string; detail: string; adminOnly?: true }> = {
    figures: { label: 'Key figures', detail: 'Cash in, cash out, net movement and the reconciliation rate' },
    'cash-chart': { label: 'Cash chart', detail: 'Cash position by day, or cash in and out by month' },
    flagged: { label: 'Flagged by FinGence', detail: 'What to know about, with a link to each' },
    forecast: { label: "Next month's expected net", detail: 'From the verified bank history' },
    checks: { label: 'How FinGence checked these figures', detail: 'The automated checks behind every figure' },
    counterparties: { label: 'Largest counterparties', detail: 'Who paid you and whom you paid the most' },
    'reconciliation-summary': { label: 'Reconciliation summary', detail: 'How every record was matched or resolved' },
    'last-runs': { label: 'Last processing runs', detail: 'The latest runs from the Technical log, for Admins', adminOnly: true },
};

export type Layout = { v: 1; cards: { id: CardId; visible: boolean }[] };

export const layoutSchema = z.object({
    v: z.literal(1),
    cards: z.array(z.object({ id: z.enum(CARD_IDS), visible: z.boolean() }).strict()).min(1).max(CARD_IDS.length)
        .refine(cards => new Set(cards.map(c => c.id)).size === cards.length, 'each card at most once'),
}).strict();

/** Today's Overview: the five original cards in their original order; the optional cards start hidden. */
const DEFAULT_VISIBLE: readonly CardId[] = ['figures', 'cash-chart', 'flagged', 'forecast', 'checks'];
export const DEFAULT_LAYOUT: Layout = { v: 1, cards: CARD_IDS.map(id => ({ id, visible: DEFAULT_VISIBLE.includes(id) })) };

/** A stored layout made whole: anything outside the shape gives the default; a card added since it was saved is appended, hidden. */
export function normalise(value: unknown): Layout {
    const parsed = layoutSchema.safeParse(value);
    if (!parsed.success) return DEFAULT_LAYOUT;
    const cards = parsed.data.cards.slice();
    for (const id of CARD_IDS) if (!cards.some(c => c.id === id)) cards.push({ id, visible: false });
    return { v: 1, cards };
}

export const isDefault = (layout: Layout) => JSON.stringify(normalise(layout)) === JSON.stringify(DEFAULT_LAYOUT);

/** The cards this person is offered: an Admin-only card is left out for a Finance user (and for the workspace-off demo). */
export const offered = (layout: Layout, admin: boolean) => layout.cards.filter(c => admin || !CARDS[c.id].adminOnly);

/** Move a card one place up (-1) or down (+1) among the cards this person is offered; at either end nothing changes. */
export function move(layout: Layout, id: CardId, delta: -1 | 1, admin: boolean): Layout {
    const cards = layout.cards.slice(), from = cards.findIndex(c => c.id === id);
    if (from < 0) return layout;
    let to = from + delta;
    while (to >= 0 && to < cards.length && !admin && CARDS[cards[to].id].adminOnly) to += delta;
    if (to < 0 || to >= cards.length) return layout;
    [cards[from], cards[to]] = [cards[to], cards[from]];
    return { v: 1, cards };
}

export const setVisible = (layout: Layout, id: CardId, visible: boolean): Layout => ({ v: 1, cards: layout.cards.map(c => c.id === id ? { id, visible } : c) });
