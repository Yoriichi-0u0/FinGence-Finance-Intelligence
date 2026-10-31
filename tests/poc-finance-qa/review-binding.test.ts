import { describe, expect, it } from 'vitest';
import { answerQuestion, type QaFacts } from '../../lib/poc-finance-qa/answer';
import { march } from './support';

const snap = march.reconciliation.status === 'AVAILABLE' ? march.reconciliation.snapshot : (() => { throw Error(); })();
const aggregate = { version: 'poc-reconciliation-review-aggregate-v1', reconciliationId: '11111111-1111-4111-8111-111111111111', scope: snap.scope, sources: snap.sources, eligible: 3, states: { OPEN: 1, INVESTIGATING: 0, EXPLAINED: 1, ESCALATED: 1 } };
const ask = (review: unknown) => answerQuestion({ ...march, reconciliationReviews: review } as QaFacts, 'Which transactions require review?');

describe('human review states stay separate from original reconciliation outcomes', () => {
    it('quotes separate human states without reducing original exceptions or clearing Explained outcomes', () => {
        const a = ask(aggregate);
        expect(a.facts.find(f => f.id === 'exceptions')?.value).toBe('3');
        expect(a.facts.find(f => f.id === 'review.EXPLAINED')?.value).toBe('1');
        expect(a.facts.find(f => f.id === 'review.OPEN')?.value).toBe('1');
        expect(a.interpretation).toContain('Explained never means matched or cleared');
        expect(a.records.flatMap(r => r.recordIds)).toContain('B4');
    });
    it('does not quote annotations from another bank, ledger, organization, business, period or currency', () => {
        for (const change of [
            { sources: { ...aggregate.sources, bank: { ...aggregate.sources.bank, sha256: 'f'.repeat(64) } } },
            { sources: { ...aggregate.sources, ledger: { ...aggregate.sources.ledger, sha256: 'e'.repeat(64) } } },
            ...['organizationId', 'businessId', 'period', 'currency'].map(k => ({ scope: { ...aggregate.scope, [k]: 'OTHER' } })),
            { eligible: 2 }, { states: { ...aggregate.states, OPEN: 2 } },
        ]) {
            const a = ask({ ...aggregate, ...change });
            expect(a.facts.some(f => f.id.startsWith('review.'))).toBe(false);
            expect(a.interpretation).toContain('Human review decisions are unavailable');
            expect(a.facts.find(f => f.id === 'exceptions')?.value).toBe('3');
        }
    });
    it('does not manufacture review state when metadata is absent', () => {
        expect(ask(null).interpretation).toContain('Human review decisions are unavailable');
        expect(ask(null).facts.some(f => f.id.startsWith('review.'))).toBe(false);
    });
});
