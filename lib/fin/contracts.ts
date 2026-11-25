/**
 * Fin, FinGence's assistant: the contracts shared by the browser and the gateway.
 *
 * Fin talks; it never states a figure. One strict-schema call per message decides whether the message is about
 * FinGence itself (Fin replies as a guide) or about this business's money (Fin hands a self-contained question to the
 * grounded Q&A, whose plan/answer gates fill every figure from verified records). A reply that contains a figure,
 * an unknown link or anything outside the schema is withheld by `verifyFinReply`, never shown.
 *
 * Fin is the assistant's default name: each person may rename theirs (`cleanAssistantName`), kept per member in the
 * workspace (supabase/sql/workspace-v9-assistant.sql) or, with the workspace off, in this browser.
 */
import { z } from 'zod';
import { MAX_QUESTION } from '../grounded-qa/contracts';
import type { GroundedRun } from '../grounded-qa/client';

export const FIN_VERSION = 'fingence-fin-v2';
/** The assistant's default name, until a person gives theirs another. */
export const FIN_NAME = 'Fin';
export const MAX_NAME = 20;
/** How the assistant writes: concise (the default) leads with the answer; friendly is a little warmer and longer. */
export const TONES = ['concise', 'friendly'] as const;
export type Tone = typeof TONES[number];
export const MAX_MESSAGE = 600;
export const MAX_TURNS = 8;
export const MAX_REPLY = 700;

/** Every page Fin may link to, with what it is for. The guide and the link enum are built from this one list. */
export const FIN_PAGES = {
    '/': { label: 'Overview', about: 'what needs attention first, the processing confidence and a card for every page' },
    '/data': { label: 'Data', about: 'choose a sample or your own documents, process them, and see what FinGence read beside each document' },
    '/history': { label: 'History', about: 'every run you processed, saved with its documents, to reopen exactly as it was' },
    '/transactions': { label: 'Transactions', about: 'every bank and ledger record FinGence read and checked' },
    '/reconciliation': { label: 'Reconciliation', about: 'bank against books: what matched, what was resolved by a stated rule, and what is still unexplained' },
    '/analytics': { label: 'Analytics', about: 'what drove your cash: a cash flow statement and the biggest changes, sorted by the categories your own books use, with counterparties and months' },
    '/forecasting': { label: 'Forecasting', about: 'your cash for the coming months, planned category by category from your verified history, with the range past forecasts actually missed by' },
    '/anomalies': { label: 'Anomalies', about: 'unusual bank records, each checked against your books; a candidate is a reason to review, never a fraud finding' },
    '/reports': { label: 'Reports', about: 'a management summary of the same figures, to print or save as PDF' },
    '/ai-report': { label: 'AI report', about: 'a report laid out like a Bursa-listed company\'s quarterly or annual report: statements and notes computed by FinGence, commentary written by AI, every figure checked' },
    '/chatbot': { label: 'Assistant', about: 'a full-page conversation with your assistant' },
    '/uat': { label: 'Testing checklist', about: 'the acceptance-testing tasks, where you record how each one went and submit your results' },
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

/** What the browser sends: the assistant's name, the conversation's words, the page, and the run's scope. Never amounts or records. */
export const finRequestSchema = z.strictObject({
    version: z.literal(FIN_VERSION),
    name: z.string().max(MAX_NAME * 2).refine(n => cleanAssistantName(n) === n, 'Not a valid assistant name.'),
    tone: z.enum(TONES).default('concise'),
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
 * Figures belong to the grounded answer only. Fin's own words may not contain a digit, a currency sign or code,
 * a percentage, or a number written as a word ("twelve", "forty thousand", "a dozen", "half"), so a remembered or
 * invented amount or count can never reach the screen. "One" and "once" are allowed: they are ordinary words
 * ("one place", "at once") far more often than counts.
 */
const FIGURE = /\d|[$€£¥%]|\b(?:MYR|SGD|USD|EUR|GBP|RM)\b/i;
const NUMBER_WORD = /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?|half|halves|twice|percent|per cent|quarter of)\b/i;
export function verifyFinReply(content: unknown, req: Pick<FinRequest, 'run'>): FinVerdict {
    const parsed = finReplySchema.safeParse(content);
    if (!parsed.success) return { decision: 'WITHHELD', reason: 'SCHEMA' };
    const reply = parsed.data;
    if (FIGURE.test(reply.reply) || NUMBER_WORD.test(reply.reply)) return { decision: 'WITHHELD', reason: 'FIGURE_IN_REPLY' };
    if (reply.kind === 'FINANCE') {
        if (!reply.financeQuestion?.trim()) return { decision: 'WITHHELD', reason: 'MISSING_QUESTION' };
        if (!req.run) return { decision: 'WITHHELD', reason: 'NO_RUN' };
    }
    // Links outside Fin's page list are dropped, not followed; at most three are shown.
    const links = [...new Set(reply.links.map(finPage).filter((l): l is FinPage => l !== null))].slice(0, 3);
    return { decision: 'SHOWN', reply: { ...reply, links } };
}

/**
 * A name a person gives their assistant: letters (any script), single spaces, hyphens and apostrophes, at most twenty
 * characters, and never a figure, a currency code or a number word, so the name can never carry a figure into a reply.
 * Returns the cleaned name, or null when it cannot be used. The database checks the same length and refuses digits and
 * symbols (fingence_workspace.valid_assistant).
 */
const NAME_SHAPE = /^\p{L}[\p{L}\p{M}'’ -]*$/u;
export function cleanAssistantName(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!name || [...name].length > MAX_NAME || !NAME_SHAPE.test(name) || FIGURE.test(name) || NUMBER_WORD.test(name)) return null;
    return name;
}
const nameField = z.string().max(MAX_NAME * 2).refine(n => cleanAssistantName(n) === n, 'Not a valid assistant name.');
/**
 * What is kept for each member (workspace v9 and v10). Version 1 holds only the name; version 2 adds the controls:
 * tone, quiet (no badge, status line or announcements), character (the mascot, or a plain icon) and motion (follow the
 * device, or off). New saves are version 2; a version 1 row still reads.
 */
export const assistantSettingsSchema = z.union([
    z.strictObject({ v: z.literal(1), name: nameField }),
    z.strictObject({ v: z.literal(2), name: nameField, tone: z.enum(TONES), quiet: z.boolean(), character: z.boolean(), motion: z.enum(['device', 'off']) }),
]);
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
export type AssistantPrefs = Omit<Extract<AssistantSettings, { v: 2 }>, 'v'>;
export const DEFAULT_PREFS: AssistantPrefs = { name: FIN_NAME, tone: 'concise', quiet: false, character: true, motion: 'device' };
/** A stored row made whole: anything unreadable gives the defaults. */
export function prefsOf(stored: unknown): AssistantPrefs {
    const parsed = assistantSettingsSchema.safeParse(stored);
    if (!parsed.success) return DEFAULT_PREFS;
    const d = parsed.data;
    return d.v === 1 ? { ...DEFAULT_PREFS, name: d.name } : { name: d.name, tone: d.tone, quiet: d.quiet, character: d.character, motion: d.motion };
}
/** What to store for these choices: nothing when every one is the default. */
export function storedPrefs(p: AssistantPrefs): AssistantSettings | null {
    const same = (Object.keys(DEFAULT_PREFS) as (keyof AssistantPrefs)[]).every(k => p[k] === DEFAULT_PREFS[k]);
    return same ? null : { v: 2, ...p };
}

/** How the assistant introduces itself: by its name, and plainly as an AI. */
export const finGreeting = (name: string) => `Hi, I'm ${name}, your FinGence AI assistant. I can show you around FinGence and answer questions about the figures in your latest run. What would you like to know?`;

/** The words the assistant says when it cannot use the model, so the panel always answers something honest. */
export const FIN_FALLBACK = {
    greeting: finGreeting(FIN_NAME),
    unavailable: 'I can\'t reach my AI right now, so I\'ll answer with FinGence\'s fixed rules instead. Questions about your figures still work.',
    withheld: 'I started to answer, but my reply didn\'t pass FinGence\'s checks, so I\'ve held it back. Could you ask that another way?',
    noRun: 'I can answer that once there are figures to read. Process a sample or your own documents on Data, then ask me again.',
} as const;

/**
 * What Fin remembers of a verified answer for follow-ups ("how much did we pay them in February?"): its words and the
 * names it filled in, with every figure (amount, count, date, period) replaced by [figure]. Figures never travel back.
 */
export const VERIFIED_PREFIX = 'Verified answer (figures withheld):';
export function verifiedContext(run: GroundedRun | 'PENDING' | undefined): string | null {
    if (!run || run === 'PENDING' || run.status !== 'ANSWERED' || !run.verdict?.sentences) return null;
    const words = run.verdict.sentences.map(sentence => sentence.map(seg => 'text' in seg ? seg.text
        : FIGURE.test(seg.value) || NUMBER_WORD.test(seg.value) ? '[figure]' : seg.value).join('')).join(' ').replace(/\s+/g, ' ').trim();
    return words ? `${VERIFIED_PREFIX} ${words}`.slice(0, 400) : null;
}
