import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { askGrounded, type QaModel } from '../../lib/grounded-qa/client';
import { groundingIndex } from '../../lib/grounded-qa/tools';
import type { AskRequest } from '../../lib/grounded-qa/contracts';
import { InterpreterUnavailable } from '../../lib/interpretation/contracts';
import { GroundedAnswer } from '../../components/demo/grounded-answer';
import { phase1 } from './fixtures';

const receipt = { provider: 'GROQ' as const, model: 'openai/gpt-oss-120b', requestId: null, latencyMs: 900, inputTokens: 1800, outputTokens: 250, estimatedUsd: 0.0004, mode: 'LIVE' as const };
/** Recorded model double: answers each stage with the given content and records what it was sent. */
function recorded(plan: unknown, answer?: unknown): QaModel & { sent: AskRequest[] } {
    const sent: AskRequest[] = [];
    return { sent, async call(req) { sent.push(req); return { content: req.stage === 'plan' ? plan : answer, receipt }; } };
}
const PLAN = { plan: { kind: 'QUERY', queries: [{ tool: 'counterparties', direction: 'OUT', limit: 3 }] }, rationale: 'Rank payees by money paid.' };
const GOOD = { answer: { kind: 'ANSWERED', sentences: [{ text: '{F1.name} was paid the most, {F1.total} across {F1.transactions} payments.', cites: ['F1'] }], derived: [] } };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('grounded question orchestration', () => {
    it('plans, runs the verified queries, answers and renders only gate-approved values', async () => {
        const index = groundingIndex(await phase1())!, model = recorded(PLAN, GOOD);
        const run = await askGrounded(index, 'Who did we pay the most this month?', model);
        expect(run.status).toBe('ANSWERED');
        expect(model.sent.map(s => s.stage)).toEqual(['plan', 'answer']);
        expect(JSON.stringify(model.sent[0])).not.toMatch(/\d+\.\d{2}|BANK-DEMO/); // plan stage saw no amounts or records
        expect(run.receipts).toHaveLength(2);
        const html = text(renderToStaticMarkup(createElement(GroundedAnswer, { run })));
        expect(html).toMatch(/AI answer · verified/);
        expect(html).toMatch(/Staff Payroll was paid the most, MYR [\d,]+\.\d{2} across 2 payments\./);
        expect(html).toContain('Every highlighted figure was filled in by FinGence');
        expect(html).toContain('The model asked for: Top 3 counterparties by money out.');
        expect(html).toContain('2 calls to openai/gpt-oss-120b on Groq');
    });
    it('refuses advice and allegations before any model call', async () => {
        const model = recorded(PLAN, GOOD), run = await askGrounded(groundingIndex(await phase1())!, 'Is Borneo Fresh Supplies committing fraud?', model);
        expect(run).toMatchObject({ status: 'REFUSED', refusal: { reason: 'ALLEGATION', by: 'PRE_CHECK' } });
        expect(model.sent).toEqual([]);
    });
    it('passes a model refusal through without an answer call', async () => {
        const model = recorded({ plan: { kind: 'REFUSE', reason: 'CAUSE_NOT_RECORDED' }, rationale: 'The records do not say why.' });
        const run = await askGrounded(groundingIndex(await phase1())!, 'Why did our cash position change so much?', model);
        expect(run).toMatchObject({ status: 'REFUSED', refusal: { reason: 'CAUSE_NOT_RECORDED', by: 'MODEL' } });
        expect(model.sent).toHaveLength(1);
        expect(text(renderToStaticMarkup(createElement(GroundedAnswer, { run })))).toContain('The records do not state why this happened. The model declined to plan an answer.');
    });
    it('explains the supplier limitation instead of naming the largest payee, before any model call', async () => {
        const model = recorded(PLAN, GOOD), run = await askGrounded(groundingIndex(await phase1())!, 'Which supplier did we pay the most?', model);
        expect(run).toMatchObject({ status: 'REFUSED', refusal: { reason: 'CLASSIFICATION_NOT_RECORDED', by: 'PRE_CHECK' } });
        expect(model.sent).toEqual([]);
        const html = text(renderToStaticMarkup(createElement(GroundedAnswer, { run })));
        expect(html).toContain('do not classify them (for example as suppliers, customers or employees)');
        expect(html).not.toContain('Staff Payroll');
    });
    it('withholds an invalid plan and never calls the answer stage', async () => {
        const model = recorded({ plan: { kind: 'QUERY', queries: [{ tool: 'transactions', direction: 'OUT', counterparty: 'Acme Holdings', sort: 'LARGEST', limit: 3 }] }, rationale: '' });
        const run = await askGrounded(groundingIndex(await phase1())!, 'How much did we pay Acme Holdings?', model);
        expect(run.status).toBe('WITHHELD');
        expect(model.sent).toHaveLength(1);
    });
    it('withholds a fabricated answer and shows none of its text', async () => {
        const lie = { answer: { kind: 'ANSWERED', sentences: [{ text: '{F1.name} was paid RM 99,999.99 last week.', cites: ['F1'] }], derived: [] } };
        const run = await askGrounded(groundingIndex(await phase1())!, 'Who did we pay the most?', recorded(PLAN, lie));
        expect(run.status).toBe('WITHHELD');
        const html = renderToStaticMarkup(createElement(GroundedAnswer, { run }));
        expect(html).not.toContain('99,999.99');
        expect(text(html)).toContain('did not pass the checks below, so it is not shown');
        expect(text(html)).toContain('No amount, count, date, percentage or identifier typed by the model');
    });
    it('reports an unavailable model instead of guessing', async () => {
        const down: QaModel = { async call() { throw new InterpreterUnavailable('RATE_LIMITED', 600); } };
        const run = await askGrounded(groundingIndex(await phase1())!, 'Who did we pay the most?', down);
        expect(run).toMatchObject({ status: 'UNAVAILABLE', error: 'RATE_LIMITED' });
    });
});
