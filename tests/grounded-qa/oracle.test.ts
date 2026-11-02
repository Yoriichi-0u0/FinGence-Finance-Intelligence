import { describe, expect, it } from 'vitest';
import { askGrounded, type QaModel } from '../../lib/grounded-qa/client';
import { groundingIndex } from '../../lib/grounded-qa/tools';
import { phase1 } from './fixtures';
import { QUESTIONS, score } from './eval-set';

const receipt = { provider: 'GROQ' as const, model: 'oracle', requestId: null, latencyMs: 0, inputTokens: null, outputTokens: null, estimatedUsd: null, mode: 'LIVE' as const };

describe('evaluation set, scored with hand-written ideal plans and answers (not model output)', () => {
    it.each(QUESTIONS.map(q => [q.id, q] as const))('%s meets its expectation and is never withheld when ideal', async (_, q) => {
        const index = groundingIndex(await phase1())!, o = typeof q.oracle === 'function' ? q.oracle(index) : q.oracle;
        const model: QaModel = { async call(req) { if (!o) throw new Error('no oracle: the model must not be called'); return { content: req.stage === 'plan' ? o.plan : o.answer, receipt }; } };
        const run = await askGrounded(index, q.question, model);
        const s = score(q, index, run);
        if (!o && q.expect !== 'NOT_ANSWERED') return; // live-only questions (no single ideal answer)
        expect({ id: q.id, outcome: s.outcome, missing: s.missing, failed: run.verdict?.checks.filter(c => !c.passed) ?? [] }).toMatchObject({ outcome: q.expect === 'ANSWER' ? 'GROUNDED_CORRECT' : 'REFUSED', missing: [], failed: [] });
        expect(s.meets).toBe(true);
    });
    it('scores fabrication and misgrounding', async () => {
        const index = groundingIndex(await phase1())!, q = QUESTIONS.find(x => x.id === 'S01')!;
        const fake = { status: 'ANSWERED', facts: [], verdict: { derived: [], sentences: [[{ text: 'Paid ' }, { value: 'MYR 1.00' }]] } };
        expect(score(q, index, fake).outcome).toBe('FABRICATED');
        const m08 = QUESTIONS.find(x => x.id === 'M08')!, payroll = { status: 'ANSWERED', facts: [{ fields: { n: { kind: 'TEXT' as const, text: 'Staff Payroll' } } }], verdict: { derived: [], sentences: [[{ text: 'The outside company paid the most is ' }, { value: 'Staff Payroll' }]] } };
        expect(score(m08, index, payroll)).toMatchObject({ outcome: 'FORBIDDEN_CONTENT', meets: false }); // true value, wrong claim
        const wrong = { status: 'ANSWERED', facts: [{ fields: { x: { kind: 'TEXT' as const, text: 'Borneo Fresh Supplies' } } }], verdict: { derived: [], sentences: [[{ value: 'Borneo Fresh Supplies' }, { text: ' was paid the most.' }]] } };
        expect(score(q, index, wrong).outcome).toBe('MISGROUNDED');
    });
});
