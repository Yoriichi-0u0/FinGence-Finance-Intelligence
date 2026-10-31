import { describe, expect, it } from 'vitest';
import { answerQuestion, suggestions } from '../../lib/poc-finance-qa/answer';
import { acceptNarration, narrationRequest, templateNarrator } from '../../lib/poc-finance-qa/narration';
import { march, year } from './support';

describe('future narration contract (no model is called)', () => {
    it('accepts the deterministic template for every answered suggestion, citing only existing facts', async () => {
        let answered = 0;
        for (const facts of [march, year]) for (const q of [...suggestions(facts), 'How many months of history are observed?', 'How many transactions were matched?', 'Which transactions require review?']) {
            const answer = answerQuestion(facts, q), request = narrationRequest(answer);
            if (answer.status !== 'ANSWERED') { expect(request).toBeNull(); continue; }
            answered++;
            const proposal = await templateNarrator.narrate(request!);
            expect([q, acceptNarration(answer, proposal, templateNarrator.origin)]).toEqual([q, { accepted: true, text: `${answer.headline} ${answer.interpretation}`, origin: 'DETERMINISTIC_TEMPLATE' }]);
        }
        expect(answered).toBeGreaterThanOrEqual(10);
    });
    it('rejects invented figures, uncited or unknown claims and narration of refusals', () => {
        const a = answerQuestion(march, 'How much cash movement was recorded?'), ids = a.facts.map(f => f.id);
        expect(acceptNarration(a, { text: 'Net movement was MYR 380.00 from 4 rows.', claimIds: ['net', 'rows'] }, 'LANGUAGE_MODEL')).toMatchObject({ accepted: true, origin: 'LANGUAGE_MODEL' });
        for (const [text, claimIds, reason] of [['Net movement was MYR 381.00.', ids, 'UNCITED_FIGURE'], ['Net movement was MYR 380.00, up 12% on February.', ids, 'UNCITED_FIGURE'], ['There were 44 rows.', ids, 'UNCITED_FIGURE'],
            ['Net movement was MYR 380.00.', ['rows'], 'UNCITED_FIGURE'], ['Net movement was MYR 380.00.', [], 'NO_CITATION'], ['Net movement was MYR 380.00.', ['net', 'profit'], 'UNKNOWN_CLAIM'], ['x'.repeat(1201), ids, 'TOO_LONG']] as const)
            expect(acceptNarration(a, { text, claimIds: [...claimIds] }, 'LANGUAGE_MODEL')).toEqual({ accepted: false, reason });
        const refused = answerQuestion(march, 'What is net profit?');
        expect(narrationRequest(refused)).toBeNull();
        expect(acceptNarration(refused, { text: 'Profit is unknown.', claimIds: ['net'] }, 'LANGUAGE_MODEL')).toEqual({ accepted: false, reason: 'NOT_ANSWERED' });
    });
});
