import { beforeAll, describe, expect, it } from 'vitest';
import type { QaModel } from '../../lib/grounded-qa/client';
import { COMMENTARY_QUESTION, commentaryQueries, renderedText, writeCommentary } from '../../lib/grounded-qa/commentary';
import type { AskRequest } from '../../lib/grounded-qa/contracts';
import { preCheck } from '../../lib/grounded-qa/gates';
import { groundingIndex, runQueries, type GroundingIndex } from '../../lib/grounded-qa/tools';
import { InterpreterUnavailable } from '../../lib/interpretation/contracts';
import { phase1 } from './fixtures';

const receipt = { provider: 'GROQ' as const, model: 'recorded-test', requestId: null, latencyMs: 0, inputTokens: null, outputTokens: null, estimatedUsd: null, mode: 'LIVE' as const };
type Sentence = { text: string; cites: string[] };
let index: GroundingIndex, id: (label: RegExp) => string;
beforeAll(async () => {
    index = groundingIndex(await phase1())!;
    const facts = runQueries(index, commentaryQueries(index));
    id = label => facts.find(f => label.test(f.label))!.id;
});
/** A recorded model that writes the given sentences (built once the fact IDs are known). */
const writes = (sentences: () => Sentence[], seen: AskRequest[] = []): QaModel => ({ async call(req) { seen.push(req); return { content: { answer: { kind: 'ANSWERED', sentences: sentences(), derived: [] } }, receipt }; } });
const ideal = (): Sentence[] => {
    const cash = id(/^Cash summary/), rec = id(/^Reconciliation of/), anomalies = id(/^Anomaly review candidates/), forecast = id(/^Next-month cash baseline/);
    return [
        { text: `In {${cash}.period}, money in was {${cash}.moneyIn} and money out was {${cash}.moneyOut}, a net cash movement of {${cash}.net}.`, cites: [cash] },
        { text: `The bank-versus-ledger difference is {${rec}.difference}, with {${rec}.matched} items matched and {${rec}.exceptions} exceptions still open for review.`, cites: [rec] },
        { text: `There are {${anomalies}.candidates} anomaly review candidates, each a reason to review rather than a finding.`, cites: [anomalies] },
        { text: `The next-month cash baseline for {${forecast}.period} is a net {${forecast}.net}, the average of the last {${forecast}.basisMonths} months.`, cites: [forecast] },
    ];
};

describe('AI management commentary over verified facts', () => {
    it('FinGence chooses the queries; the question itself is never refused', () => {
        expect(commentaryQueries(index).map(q => q.tool)).toEqual(['cash_summary', 'reconciliation', 'anomalies', 'forecast']);
        expect(preCheck(COMMENTARY_QUESTION, [])).toBeNull();
    });
    it('a faithful commentary is accepted and every figure is rendered by FinGence from the records', async () => {
        const seen: AskRequest[] = [];
        const run = await writeCommentary(index, writes(ideal, seen));
        expect(run.status).toBe('ANSWERED');
        expect(seen.map(r => r.stage)).toEqual(['answer']); // one call, no model-chosen plan
        expect(renderedText(run.verdict!.sentences!)).toEqual([
            'In March 2026, money in was MYR 68,633.32 and money out was MYR 40,401.31, a net cash movement of MYR 28,232.01.',
            expect.stringMatching(/^The bank-versus-ledger difference is −MYR 2,692\.92, with 50 items matched and 9 exceptions still open for review\.$/),
            expect.stringMatching(/^There are \d+ anomaly review candidates/),
            'The next-month cash baseline for April 2026 is a net MYR 35,446.45, the average of the last 6 months.',
        ]);
    });
    it.each([
        ['a figure typed by the model', (s: Sentence[]) => { s[0].text = 'Money in was MYR 68,633.32.'; }, 'no-free-figures'],
        ['an accounting conclusion', (s: Sentence[]) => { s[0].text = s[0].text.replace('a net cash movement', 'a profit'); }, 'conclusions'],
        ['advice', (s: Sentence[]) => { s[1].text += ' The owner should chase the open items.'; }, 'conclusions'],
        ['a fact it does not cite', (s: Sentence[]) => { s[2].cites = [s[0].cites[0]]; }, 'placeholders'],
    ])('%s is withheld', async (_, edit, gate) => {
        const run = await writeCommentary(index, writes(() => { const s = ideal(); edit(s); return s; }));
        expect(run.status).toBe('WITHHELD');
        expect(run.verdict!.checks.find(c => !c.passed)?.id).toBe(gate);
    });
    it('an unavailable model leaves only the deterministic summary', async () => {
        const run = await writeCommentary(index, { async call() { throw new InterpreterUnavailable('RATE_LIMITED'); } });
        expect([run.status, run.error, run.verdict]).toEqual(['UNAVAILABLE', 'RATE_LIMITED', null]);
    });
});
