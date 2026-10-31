import { describe, expect, it } from 'vitest';
import { answerQuestion, route, suggestions } from '../../lib/poc-finance-qa/answer';
import { readReconciliation } from '../../lib/poc-anomalies/reconciliation';
import { march, year, selection, snapshot, binding } from './support';

describe('rule-based routing', () => {
    it('routes the six required question families and their common wordings', () => {
        expect(['What is the bank-versus-ledger difference?', 'How many transactions were matched?', 'Which transactions require review?', 'How much cash movement was recorded?', 'How many anomalies were identified?', 'What is the next-month statistical cash-movement forecast?', 'How many months of history are observed?', 'How many source records, credits and debits are there?']
            .map(q => route(q))).toEqual(['RECONCILIATION_DIFFERENCE', 'RECONCILIATION_MATCHES', 'REVIEW_ITEMS', 'CASH_MOVEMENT', 'ANOMALY_COUNT', 'CASH_FORECAST', 'MONTHLY_HISTORY', 'SOURCE_TOTALS'].map(intent => ({ kind: 'INTENT', intent })));
    });
    it('refuses metrics, advice, fraud, causes and unknown questions before matching any intent', () => {
        for (const [q, code] of [['What is net profit?', 'UNSUPPORTED_METRIC'], ['What is our revenue this month?', 'UNSUPPORTED_METRIC'], ['What is the current ratio?', 'UNSUPPORTED_METRIC'], ['Total expenses?', 'UNSUPPORTED_METRIC'],
            ['Is the ledger difference fraud?', 'ADVICE_OR_ALLEGATION'], ['Should I invest the net cash?', 'ADVICE_OR_ALLEGATION'], ['Why is there a bank-versus-ledger difference?', 'CAUSE_NOT_ESTABLISHED'], ['Tell me a joke', 'UNSUPPORTED_QUESTION'], ['', 'UNSUPPORTED_QUESTION']])
            expect([q, route(q)]).toEqual([q, { kind: 'REFUSED', code }]);
    });
});

describe('answers quote only the computed facts', () => {
    it('labels every answer as deterministic, never as a live model, and is reproducible', () => {
        const a = answerQuestion(march, '  How much   cash movement was recorded? ');
        expect(a).toMatchObject({ version: 'poc-finance-answer-v1', answerOrigin: 'DETERMINISTIC_VERIFIED_SOURCE', liveModel: false, status: 'ANSWERED', intent: 'CASH_MOVEMENT', question: 'How much cash movement was recorded?', selection });
        expect(a.headline).toBe('Net signed bank cash movement for BUS-T · 2026-03 is MYR 380.00.');
        expect(a.interpretation).toContain('not revenue, profit or a statutory cash flow statement');
        expect(a.evidence[0].href).toBe(`/transactions?source=${selection.sourceId}&business=BUS-T&period=2026-03&currency=MYR`);
        expect(answerQuestion(march, 'How much cash movement was recorded?')).toEqual(a);
    });
    it('reports totals, anomaly candidates with denominator and rule categories, and monthly history', () => {
        expect(answerQuestion(march, 'How many source records, credits and debits are there?').facts.map(f => [f.id, f.value])).toEqual([['rows', '4'], ['creditRows', '1'], ['debitRows', '3'], ['credits', '500.00'], ['debits', '-120.00']]);
        const anomalies = answerQuestion(march, 'How many anomalies were identified?');
        expect(anomalies.headline).toBe('2 of 4 source records for BUS-T · 2026-03 are anomaly review candidates (1 high, 1 medium severity).');
        expect(anomalies.facts.filter(f => f.id.startsWith('rule.')).map(f => [f.label, f.value])).toEqual([['Duplicate reference', '1'], ['Amount outlier', '2']]);
        expect(anomalies.records).toEqual([{ label: 'Open anomaly review candidates', detail: expect.any(String), recordIds: ['B3'] }]);
        expect(answerQuestion(march, 'Show the monthly trend').headline).toBe('1 observed month for BUS-T (MYR): 2026-03.');
        const history = answerQuestion(year, 'How many months of history are observed?');
        expect(history.headline).toBe('12 consecutive observed months for BUS-T (MYR), 2025-09 to 2026-08.');
        expect(history.interpretation).toContain('from MYR 600.00 in 2025-09 to MYR 1,700.00 in 2026-08');
    });
    it('quotes the reconciliation difference, matches and review records only for the bound snapshot', () => {
        const diff = answerQuestion(march, 'What is the bank-versus-ledger difference?');
        expect(diff.headline).toBe('Bank minus ledger for BUS-T · 2026-03 is MYR 10.00 (bank MYR 380.00, ledger MYR 370.00).');
        expect(diff.interpretation).toContain('the cause of the difference is not inferred');
        expect(answerQuestion(march, 'How many transactions were matched?').headline).toBe('2 of 4 bank records matched a ledger entry: 1 exact and 1 date shift.');
        const review = answerQuestion(march, 'Which transactions require review?');
        expect(review.headline).toBe('3 reconciliation outcomes and 1 open anomaly review candidate need review for BUS-T · 2026-03.');
        expect(review.records.map(g => [g.label, g.recordIds])).toEqual([['Reconciliation: bank only', ['B3']], ['Reconciliation: ledger only', ['L9']], ['Reconciliation: amount review', ['B4', 'L4']], ['Open anomaly review candidates', ['B3']]]);
        for (const facts of [year, { ...march, reconciliation: readReconciliation(snapshot(), { ...binding, bankSha256: 'c'.repeat(64) }) }, { ...march, reconciliation: readReconciliation(snapshot('381.00'), binding) }]) {
            const r = answerQuestion(facts, 'What is the bank-versus-ledger difference?');
            expect(r).toMatchObject({ status: 'UNAVAILABLE', code: 'RECONCILIATION_UNAVAILABLE', facts: [] });
            expect(JSON.stringify(r)).not.toContain('10.00');
        }
        expect(answerQuestion(year, 'Which transactions require review?')).toMatchObject({ status: 'ANSWERED', headline: '1 open anomaly review candidate for BUS-T · 2026-03; no reconciliation is available for this source.' });
    });
    it('forecasts only with sufficient history and always carries the backtest caveat', () => {
        const none = answerQuestion(march, 'What is the next-month cash-movement forecast?');
        expect(none).toMatchObject({ status: 'UNAVAILABLE', code: 'FORECAST_UNAVAILABLE', facts: [] });
        expect(none.headline).toContain('1 consecutive month found');
        expect(answerQuestion(march, 'Forecast for April 2026?').status).toBe('UNAVAILABLE');
        const f = answerQuestion(year, 'What is the next-month cash-movement forecast?');
        expect(f.headline).toBe('Six-month baseline for BUS-T in 2026-09: receipts MYR 1,850.00, payments MYR 400.00, derived net MYR 1,450.00.');
        expect(f.interpretation).toMatch(/not AI\. In 6 rolling-origin backtest months its WAPE was .* net is experimental and low confidence\./);
        expect(answerQuestion(year, 'What is the September 2026 forecast?').status).toBe('ANSWERED');
        expect(answerQuestion(year, 'What is the October 2026 forecast?')).toMatchObject({ status: 'REFUSED', code: 'SELECTION_MISMATCH' });
    });
    it('never lets the question change the selected business, month or currency', () => {
        expect(answerQuestion(march, 'Cash movement for BUS-U?')).toMatchObject({ status: 'REFUSED', code: 'SELECTION_MISMATCH', facts: [] });
        expect(answerQuestion(march, 'Cash movement in USD?')).toMatchObject({ status: 'REFUSED', code: 'SELECTION_MISMATCH' });
        expect(answerQuestion(march, 'Cash movement in RM for BUS-T in March 2026?').status).toBe('ANSWERED');
        expect(answerQuestion(march, 'Cash movement in June 2026?')).toMatchObject({ status: 'UNAVAILABLE', code: 'ABSENT_PERIOD', facts: [] });
        expect(answerQuestion({ ...year, selection: { ...selection, period: '2026-08' } }, 'Cash movement in 2026-03?')).toMatchObject({ status: 'REFUSED', code: 'SELECTION_MISMATCH' });
        expect(answerQuestion(march, 'May I see the cash movement?').status).toBe('ANSWERED');
    });
    it('refusals carry no figures and suggestions differ between one-month and full-year sources', () => {
        for (const q of ['What is net profit?', 'Is this fraud?', 'Why is cash lower?', 'Weather?']) expect(answerQuestion(march, q)).toMatchObject({ status: 'REFUSED', facts: [], records: [], evidence: [] });
        expect(suggestions(march)).toContain('How many transactions were matched?');
        expect(suggestions(year)[0]).toBe('How many months of history are observed?');
        for (const q of [...suggestions(march), ...suggestions(year)]) expect(route(q).kind === 'INTENT' || q === 'What is net profit?').toBe(true);
    });
});
