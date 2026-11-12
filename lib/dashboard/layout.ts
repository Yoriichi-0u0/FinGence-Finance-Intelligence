import { z } from 'zod';

/**
 * The Overview layout a person chooses with "Customise dashboard": which cards are shown, and in what order.
 * The same strict shape is checked in the browser, the server and the database (supabase/sql/workspace-v4-preferences.sql,
 * fingence_workspace.valid_dashboard; workspace-v5-dashboard-cards.sql added 'confidence' and 'at-a-glance'). A new card needs a
 * migration that adds its ID there too.
 */
export const CARD_IDS = ['figures', 'cash-chart', 'flagged', 'forecast', 'checks', 'counterparties', 'reconciliation-summary', 'last-runs', 'confidence', 'at-a-glance'] as const;
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
    confidence: { label: 'Processing confidence', detail: 'How much of the money FinGence read, checked and explained' },
    'at-a-glance': { label: 'Your results at a glance', detail: 'One line per page, and the report to download' },
};

export type Layout = { v: 1; cards: { id: CardId; visible: boolean }[] };

export const layoutSchema = z.object({
    v: z.literal(1),
    cards: z.array(z.object({ id: z.enum(CARD_IDS), visible: z.boolean() }).strict()).min(1).max(CARD_IDS.length)
        .refine(cards => new Set(cards.map(c => c.id)).size === cards.length, 'each card at most once'),
}).strict();

/**
 * The default Overview (SAIC, 12 Nov): confidence first, the key figures, every page at a glance, then the chart, what was
 * flagged and the forecast. "How FinGence checked" is covered by the confidence card, so it starts hidden like the optional cards.
 */
const DEFAULT_ORDER: readonly CardId[] = ['confidence', 'figures', 'at-a-glance', 'cash-chart', 'flagged', 'forecast', 'checks', 'counterparties', 'reconciliation-summary', 'last-runs'];
const DEFAULT_VISIBLE: readonly CardId[] = ['confidence', 'figures', 'at-a-glance', 'cash-chart', 'flagged', 'forecast'];
export const DEFAULT_LAYOUT: Layout = { v: 1, cards: DEFAULT_ORDER.map(id => ({ id, visible: DEFAULT_VISIBLE.includes(id) })) };

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

/** How wide each card is on a wide screen (three columns); on phones and tablets every card is full width. */
const WIDTH: Record<CardId, 1 | 2 | 3> = { figures: 3, 'cash-chart': 2, flagged: 1, forecast: 1, checks: 3, counterparties: 2, 'reconciliation-summary': 1, 'last-runs': 2, confidence: 3, 'at-a-glance': 3 };

/**
 * The wide-screen grid classes for the shown cards, in order. Cards are placed in the order chosen (no dense packing, so a
 * later card never fills a gap above an earlier one). A two-column card takes the column beside it only for the narrow
 * cards that follow it: two or more stack beside it (it spans two rows), one sits beside it, none and it is full width.
 * Today's default (chart, then "Flagged" and the forecast beside it) comes out as before.
 */
export function cardSpans(ids: readonly CardId[]): string[] {
    return ids.map((id, i) => {
        if (WIDTH[id] === 3) return 'xl:col-span-3';
        if (WIDTH[id] === 1) return 'xl:self-start';
        let narrow = 0;
        while (narrow < 2 && i + 1 + narrow < ids.length && WIDTH[ids[i + 1 + narrow]] === 1) narrow++;
        return narrow === 0 ? 'xl:col-span-3' : narrow === 1 ? 'xl:col-span-2' : 'xl:col-span-2 xl:row-span-2';
    });
}
