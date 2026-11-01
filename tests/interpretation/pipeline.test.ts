import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput, type ProcessingContext } from '../../lib/demo/pipeline';
import { InterpreterUnavailable, type LayoutInterpreter } from '../../lib/interpretation/contracts';
import { CORRECT } from './proposals';

const doc = (dir: string, name: string): DocumentInput => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))), provenance: 'USER_SUPPLIED' });
const sample = (name: string) => doc('public/demo', name), unfamiliar = (name: string) => doc('public/demo/unfamiliar', name);
const BANK = 'demo-bank-statement-2026-03.csv', LEDGER = 'demo-general-ledger-2026-03.csv', HISTORY = 'demo-bank-history-2025-04-to-2026-03.csv';
const receipt = { provider: 'GROQ' as const, model: 'recorded-test', requestId: null, latencyMs: 0, inputTokens: null, outputTokens: null, estimatedUsd: null, mode: 'LIVE' as const };
/** Recorded test double: returns the hand-written correct proposal for the evidence's file. */
const recorded: LayoutInterpreter = { async propose(evidence) { return { proposal: CORRECT[evidence.fileName] ?? { role: 'UNSUPPORTED' }, receipt }; } };
const figures = (c: ProcessingContext) => ({
    status: c.status, scope: c.scope, counts: c.outputs.reconciliation?.counts, cash: c.outputs.reconciliation?.cashMovement, totals: c.outputs.totals,
    anomalies: c.outputs.anomalies.map(a => [a.row.date, a.row.amount, a.severity]), forecast: c.outputs.forecast?.forecast,
});

describe('AI-interpreted unfamiliar layouts reproduce the Phase 1 results', () => {
    it.each([
        ['bank export + ledger export', 'bank-statement-march-2026-export.csv', 'general-ledger-cash-march-2026.csv'],
        ['Malay statement + signed ledger', 'penyata-bank-mac-2026.csv', 'ledger-signed-march-2026.csv'],
    ])('%s', async (_, bankName, ledgerName) => {
        const baseline = await processDocuments([sample(BANK), sample(LEDGER), sample(HISTORY)]);
        const c = await processDocuments([unfamiliar(bankName), unfamiliar(ledgerName), sample(HISTORY)], undefined, undefined, { interpreter: recorded });
        expect(c.stages.map(s => `${s.id}:${s.decision}`)).toEqual(baseline.stages.map(s => `${s.id}:${s.decision}`));
        expect(figures(c)).toEqual(figures(baseline));
        expect(c.outputs.reconciliation!.cashMovement.signedDifference).toBe('-2692.92');
        expect(c.outputs.forecast!.forecast).toMatchObject({ period: '2026-04', net: '35446.45' });
        expect(c.documents.slice(0, 2).every(d => d.interpretation?.decision === 'AUTO_ACCEPTED' && d.interpretation.mappingHash)).toBe(true);
        expect(c.processingId).not.toBe(baseline.processingId);
        expect(c.stages.find(s => s.id === 'VERIFY')!.checks.filter(k => k.id.endsWith('roundtrip')).map(k => k.passed)).toEqual([true, true]);
        expect(c.outputs.report!.limitations.join(' ')).toMatch(/proposed by a language model \(recorded-test on Groq\)/);
    });
    it('is deterministic for the same documents and accepted mapping', async () => {
        const inputs = [unfamiliar('bank-statement-march-2026-export.csv'), unfamiliar('general-ledger-cash-march-2026.csv')];
        const a = await processDocuments(inputs, undefined, undefined, { interpreter: recorded }), b = await processDocuments([...inputs].reverse(), undefined, undefined, { interpreter: recorded });
        expect(b.processingId).toBe(a.processingId);
    });
});

describe('without a usable interpreter the Phase 1 behaviour is unchanged', () => {
    it('quarantines unfamiliar layouts when no interpreter is configured', async () => {
        const c = await processDocuments([unfamiliar('bank-statement-march-2026-export.csv'), sample(LEDGER)]);
        expect(c.status).toBe('QUARANTINED');
        expect(c.documents[0]).toMatchObject({ role: null, interpretation: null });
    });
    it('reports an unavailable interpreter instead of guessing', async () => {
        const down: LayoutInterpreter = { async propose() { throw new InterpreterUnavailable('RATE_LIMITED'); } };
        const c = await processDocuments([unfamiliar('bank-statement-march-2026-export.csv'), sample(LEDGER)], undefined, undefined, { interpreter: down });
        expect(c.status).toBe('QUARANTINED');
        expect(c.documents[0].reason).toMatch(/AI interpretation unavailable \(RATE_LIMITED\)/);
    });
    it('never sends canonical or evaluator documents to the interpreter', async () => {
        const seen: string[] = [];
        const spy: LayoutInterpreter = { async propose(e) { seen.push(e.fileName); return recorded.propose(e); } };
        const c = await processDocuments([sample(BANK), sample(LEDGER), unfamiliar('general-ledger-cash-march-2026.csv')], undefined, undefined, { interpreter: spy });
        expect(seen).toEqual(['general-ledger-cash-march-2026.csv']);
        expect(c.status).toBe('QUARANTINED'); // two ledgers: ambiguous, as in Phase 1
    });
    it('a wrong model proposal quarantines the run with the failed gate visible', async () => {
        const wrong: LayoutInterpreter = { async propose(e) { const p = structuredClone(CORRECT[e.fileName]); if (p.columns.moneyIn !== null) { p.columns.moneyIn = 5; p.columns.moneyOut = 6; } return { proposal: p, receipt }; } };
        const c = await processDocuments([unfamiliar('bank-statement-march-2026-export.csv'), sample(LEDGER)], undefined, undefined, { interpreter: wrong });
        expect(c.status).toBe('QUARANTINED');
        expect(c.outputs.reconciliation).toBeNull();
        expect(c.documents[0].interpretation!.checks.find(k => !k.passed)!.id).toBe('balance');
    });
});
