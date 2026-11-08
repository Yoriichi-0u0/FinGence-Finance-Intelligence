import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ingestDocuments, interpretationsOf, INGESTION_SCOPE, type DocumentInput } from '../../lib/document-ingestion/ingest';
import { replayInterpreter } from '../../lib/interpretation/client';
import { retryKey, type LayoutEvidence, type LayoutInterpreter } from '../../lib/interpretation/contracts';
import { CORRECT, wire } from '../interpretation/proposals';

const NAME = 'bank-statement-march-2026-export.csv';
const input: DocumentInput = { name: NAME, bytes: new Uint8Array(readFileSync(`public/demo/unfamiliar/${NAME}`)), provenance: 'USER_SUPPLIED' };
const receipt = (n: number) => ({ provider: 'GROQ' as const, model: 'recorded-test', requestId: `call-${n}`, latencyMs: 0, inputTokens: 10, outputTokens: 5, estimatedUsd: 0.001, mode: 'LIVE' as const });
const good = () => wire(CORRECT[NAME]);
/** One column given two meanings: the "mapping" check refuses it, and the model can fix it. */
const twice = () => { const p = structuredClone(CORRECT[NAME]); p.columns.reference = p.columns.description; return wire(p); };
/** Money in and money out swapped: the running balance refuses it, and no other layout makes that document valid. */
const swapped = () => { const p = structuredClone(CORRECT[NAME]); [p.columns.moneyIn, p.columns.moneyOut] = [p.columns.moneyOut, p.columns.moneyIn]; return wire(p); };
function scripted(...answers: (() => unknown)[]) {
    const calls: LayoutEvidence[] = [];
    const interpreter: LayoutInterpreter = { async propose(e) { calls.push(e); const answer = answers[Math.min(calls.length - 1, answers.length - 1)]; return { proposal: answer(), receipt: receipt(calls.length) }; } };
    return { calls, interpreter };
}

describe('one more attempt when the model misread the layout', () => {
    it('asks again once, naming the failed check; the second proposal passes every check and is kept for replay', async () => {
        const { calls, interpreter } = scripted(twice, good);
        const { documents } = await ingestDocuments([input], { interpreter, scope: INGESTION_SCOPE });
        expect(calls).toHaveLength(2);
        expect(calls[0].retry).toBeUndefined();
        expect(calls[1].retry).toEqual({ check: 'mapping', detail: expect.stringMatching(/one column used twice/) });
        const [d] = documents;
        expect(d.decision).toBe('AUTO_ACCEPTED');
        expect(d.interpretation!.firstAttempt).toMatchObject({ check: 'mapping', receipt: { requestId: 'call-1' } });
        expect(d.interpretation!.receipt!.requestId).toBe('call-2');
        expect(d.interpretation!.disclosures[0]).toMatch(/^The first AI proposal failed the "mapping" check/);
        // Replay re-runs the same two steps without calling the model, and reaches the same verified content.
        const saved = interpretationsOf(documents);
        expect(Object.keys(saved)).toEqual([d.sha256, retryKey(d.sha256)]);
        const again = await ingestDocuments([input], { interpreter: replayInterpreter(saved, null), scope: INGESTION_SCOPE });
        expect(again.documents[0]).toMatchObject({ decision: 'AUTO_ACCEPTED', interpretation: { canonicalSha256: d.interpretation!.canonicalSha256, firstAttempt: { check: 'mapping' } } });
    });

    it('asks only once more: a second misreading is quarantined', async () => {
        const { calls, interpreter } = scripted(twice, twice);
        const { documents } = await ingestDocuments([input], { interpreter, scope: INGESTION_SCOPE });
        expect(calls).toHaveLength(2);
        expect(documents[0].decision).toBe('QUARANTINED');
    });

    it('never re-asks when the document itself fails its arithmetic', async () => {
        const { calls, interpreter } = scripted(swapped, good);
        const { documents } = await ingestDocuments([input], { interpreter, scope: INGESTION_SCOPE });
        expect(calls).toHaveLength(1);
        expect(documents[0].decision).toBe('QUARANTINED');
        expect(documents[0].interpretation!.firstAttempt).toBeUndefined();
        expect(documents[0].interpretation!.checks.find(k => !k.passed)!.id).not.toMatch(/^(schema|mapping|header|role-evidence|direction|dates)$/);
    });

    it('keeps the first verdict when the second call is unavailable', async () => {
        let n = 0;
        const interpreter: LayoutInterpreter = { async propose() { if (++n === 2) throw new Error('down'); return { proposal: twice(), receipt: receipt(n) }; } };
        const { documents } = await ingestDocuments([input], { interpreter, scope: INGESTION_SCOPE });
        expect(documents[0]).toMatchObject({ decision: 'QUARANTINED', interpretation: { receipt: { requestId: 'call-1' } } });
        expect(documents[0].interpretation!.firstAttempt).toBeUndefined();
    });
});
