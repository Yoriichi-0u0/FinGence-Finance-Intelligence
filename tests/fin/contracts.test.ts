import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { FIN_LINKS, FIN_VERSION, finPage, finRequestSchema, verifyFinReply } from '../../lib/fin/contracts';
import { FIN_CONFIDENCE, FIN_SYSTEM, finUserMessage } from '../../lib/server/ai/fin';
import { CONFIDENCE_DEFINITION } from '../../components/demo/confidence';

const run = { businessName: 'Example Bakery', period: '2026-03', currency: 'MYR' };
const guide = (reply: string, extra: object = {}) => ({ kind: 'GUIDE', reply, links: ['/data'], financeQuestion: null, ...extra });

describe('Fin replies', () => {
    it('shows a friendly guide reply with its links', () => {
        const v = verifyFinReply(guide('Hi! Open Data and process the sample to get started.', { links: ['/data', '/data', '/reports'] }), { run: null });
        expect(v).toEqual({ decision: 'SHOWN', reply: expect.objectContaining({ kind: 'GUIDE', links: ['/data', '/reports'] }) });
    });
    it.each([
        'You paid MYR 250 to Example Supplies.',
        'There were 12 transactions this month.',
        'About 98% of the movement was explained.',
        'You received $40 from them.',
        'Cash in was RM forty thousand.',
    ])('withholds a reply that states a figure: %s', reply => {
        expect(verifyFinReply(guide(reply), { run })).toEqual({ decision: 'WITHHELD', reason: 'FIGURE_IN_REPLY' });
    });
    it('withholds anything outside the strict schema: extra fields, unknown links, unknown kinds', () => {
        for (const bad of [{ ...guide('Hello.'), amount: '1' }, guide('Hello.', { kind: 'ANSWER' }), null, 'Hello'])
            expect(verifyFinReply(bad, { run })).toEqual({ decision: 'WITHHELD', reason: 'SCHEMA' });
    });
    it('drops links to pages outside its list, and shows at most three', () => {
        const v = verifyFinReply(guide('Here you go.', { links: ['/admin', 'https://example.com', '/reports?print=1', '/data', '/history', '/analytics'] }), { run });
        expect(v).toEqual({ decision: 'SHOWN', reply: expect.objectContaining({ links: ['/reports', '/data', '/history'] }) });
    });
    it('a money question needs a self-contained question and a run to read', () => {
        const finance = { kind: 'FINANCE', reply: 'Let me check the verified records.', links: [], financeQuestion: 'Who did we pay the most?' };
        expect(verifyFinReply(finance, { run }).decision).toBe('SHOWN');
        expect(verifyFinReply({ ...finance, financeQuestion: '  ' }, { run })).toEqual({ decision: 'WITHHELD', reason: 'MISSING_QUESTION' });
        expect(verifyFinReply(finance, { run: null })).toEqual({ decision: 'WITHHELD', reason: 'NO_RUN' });
    });
});

describe('Fin requests', () => {
    const req = (turns: { role: 'user' | 'fin'; text: string }[], extra: object = {}) => ({ version: FIN_VERSION, page: '/reconciliation', turns, run, ...extra });
    it('accepts a short conversation ending with the user', () => {
        expect(finRequestSchema.safeParse(req([{ role: 'user', text: 'Hi' }, { role: 'fin', text: 'Hello!' }, { role: 'user', text: 'What is this page?' }])).success).toBe(true);
    });
    it('rejects a conversation ending with Fin, too many turns, unknown pages and unknown fields', () => {
        expect(finRequestSchema.safeParse(req([{ role: 'user', text: 'Hi' }, { role: 'fin', text: 'Hello!' }])).success).toBe(false);
        expect(finRequestSchema.safeParse(req(Array.from({ length: 9 }, () => ({ role: 'user' as const, text: 'Hi' })))).success).toBe(false);
        expect(finRequestSchema.safeParse(req([{ role: 'user', text: 'Hi' }], { page: '/admin' })).success).toBe(false);
        expect(finRequestSchema.safeParse(req([{ role: 'user', text: 'Hi' }], { records: [] })).success).toBe(false);
    });
    it('sends only the words, the page and the run scope', () => {
        const message = JSON.parse(finUserMessage(finRequestSchema.parse(req([{ role: 'user', text: 'Hi' }]))));
        expect(Object.keys(message).sort()).toEqual(['conversation', 'latestRun', 'page']);
    });
    it('maps a path to a known page, ignoring query strings and trailing slashes', () => {
        expect([finPage('/reports?print=1'), finPage('/reconciliation/'), finPage('/'), finPage('/overview'), finPage('/admin')]).toEqual(['/reports', '/reconciliation', '/', '/', null]);
    });
});

describe('Fin knowledge', () => {
    it('uses the confidence definition word for word', () => {
        expect(FIN_CONFIDENCE).toBe(CONFIDENCE_DEFINITION);
        expect(FIN_SYSTEM).toContain(CONFIDENCE_DEFINITION);
    });
    it('links only to pages that exist', () => {
        for (const href of FIN_LINKS) expect(existsSync(`app${href === '/' ? '' : href}/page.tsx`), href).toBe(true);
    });
});
