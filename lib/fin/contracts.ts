/**
 * Fin, FinGence's assistant: the contracts shared by the browser and the gateway.
 *
 * Fin talks; it never states a figure. One strict-schema call per message decides whether the message is about
 * FinGence itself (Fin replies as a guide) or about this business's money (Fin hands a self-contained question to the
 * grounded Q&A, whose plan/answer gates fill every figure from verified records). A reply that contains a figure,
 * an unknown link or anything outside the schema is withheld by `verifyFinReply`, never shown.
 */
import { z } from 'zod';
import { MAX_QUESTION } from '../grounded-qa/contracts';

export const FIN_VERSION = 'fingence-fin-v1';
export const FIN_NAME = 'Fin';
export const MAX_MESSAGE = 600;
export const MAX_TURNS = 8;
export const MAX_REPLY = 700;

/** Every page Fin may link to, with what it is for. The guide and the link enum are built from this one list. */
export const FIN_PAGES = {
    '/': { label: 'Overview', about: 'what needs attention first, the processing confidence and a card for every page' },
    '/data': { label: 'Data', about: 'choose a sample or your own documents, process them, and see what FinGence read beside each document' },
    '/history': { label: 'History', about: 'every run you processed, saved with its documents, to reopen exactly as it was' },
    '/transactions': { label: 'Transactions', about: 'every bank and ledger record FinGence verified' },
    '/reconciliation': { label: 'Reconciliation', about: 'bank against books: what matched, what was resolved by a stated rule, and what is still unexplained' },
    '/analytics': { label: 'Analytics', about: 'money in and out by counterparty and by month' },
    '/forecasting': { label: 'Forecasting', about: 'a next-month cash baseline (an average of recent months, not a prediction), with an experimental challenger where enabled' },
    '/anomalies': { label: 'Anomalies', about: 'payments worth a second look; a candidate is a reason to review, never a finding' },
    '/reports': { label: 'Reports', about: 'the management report, ready to print or save as PDF' },
    '/chatbot': { label: 'Fin', about: 'a full-page conversation with Fin' },
    '/account': { label: 'Your account', about: 'who you are signed in as, and changing your own password' },
} as const;
export type FinPage = keyof typeof FIN_PAGES;
export const FIN_LINKS = Object.keys(FIN_PAGES) as [FinPage, ...FinPage[]];
export const finPage = (path: string): FinPage | null => {
    const bare = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/', clean = bare === '/overview' || bare === '/home' ? '/' : bare;
    return (FIN_LINKS as string[]).includes(clean) ? clean as FinPage : null;
};

const turn = z.strictObject({ role: z.enum(['user', 'fin']), text: z.string().min(1).max(MAX_MESSAGE) });
export type FinTurn = z.infer<typeof turn>;

/** What the browser sends: the conversation's words, the page, and the run's scope. Never amounts or records. */
export const finRequestSchema = z.strictObject({
    version: z.literal(FIN_VERSION),
    page: z.enum(FIN_LINKS).nullable(),
    turns: z.array(turn).min(1).max(MAX_TURNS).refine(t => t.at(-1)?.role === 'user', 'The last turn must be the user\'s.'),
    run: z.strictObject({ businessName: z.string().max(120), period: z.string().max(17), currency: z.string().regex(/^[A-Z]{3}$/) }).nullable(),
});
export type FinRequest = z.infer<typeof finRequestSchema>;

/** What the model must return (strict JSON schema). */
export const finReplySchema = z.strictObject({
    kind: z.enum(['GUIDE', 'FINANCE', 'DECLINE']),
    reply: z.string().min(1).max(MAX_REPLY),
    links: z.array(z.string().max(60)).max(6),
    financeQuestion: z.string().max(MAX_QUESTION).nullable(),
});
export type FinReply = Omit<z.infer<typeof finReplySchema>, 'links'> & { links: FinPage[] };

export type FinVerdict =
    | { decision: 'SHOWN'; reply: FinReply }
    | { decision: 'WITHHELD'; reason: 'SCHEMA' | 'FIGURE_IN_REPLY' | 'MISSING_QUESTION' | 'NO_RUN' };

/**
 * Figures belong to the grounded answer only. Fin's own words may not contain a digit, a currency sign or code
 * next to a number word, or a percentage, so a remembered or invented amount can never reach the screen.
 */
const FIGURE = /\d|[$€£¥%]|\b(?:MYR|SGD|USD|EUR|GBP|RM)\b/i;
export function verifyFinReply(content: unknown, req: Pick<FinRequest, 'run'>): FinVerdict {
    const parsed = finReplySchema.safeParse(content);
    if (!parsed.success) return { decision: 'WITHHELD', reason: 'SCHEMA' };
    const reply = parsed.data;
    if (FIGURE.test(reply.reply)) return { decision: 'WITHHELD', reason: 'FIGURE_IN_REPLY' };
    if (reply.kind === 'FINANCE') {
        if (!reply.financeQuestion?.trim()) return { decision: 'WITHHELD', reason: 'MISSING_QUESTION' };
        if (!req.run) return { decision: 'WITHHELD', reason: 'NO_RUN' };
    }
    // Links outside Fin's page list are dropped, not followed; at most three are shown.
    const links = [...new Set(reply.links.map(finPage).filter((l): l is FinPage => l !== null))].slice(0, 3);
    return { decision: 'SHOWN', reply: { ...reply, links } };
}

/** The words Fin says when it cannot use the model, so the panel always answers something honest. */
export const FIN_FALLBACK = {
    greeting: `Hi, I'm ${FIN_NAME}. I can show you around FinGence and answer questions about the figures in your latest run. What would you like to know?`,
    unavailable: 'I can\'t reach my AI right now, so I\'ll answer with FinGence\'s fixed rules instead. Questions about your figures still work.',
    withheld: 'I started to answer, but my reply didn\'t pass FinGence\'s checks, so I\'ve held it back. Could you ask that another way?',
    noRun: 'I can answer that once there are figures to read. Process a sample or your own documents on Data, then ask me again.',
} as const;
