import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';
import { qaFacts } from '../../lib/demo/questions';
import { answerQuestion } from '../../lib/poc-finance-qa/answer';

const text = (name: string) => readFileSync(join('public/demo', name), 'utf8');
const doc = (name: string, body = text(name)): DocumentInput => ({ name, bytes: new TextEncoder().encode(body), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const BANK = 'demo-bank-statement-2026-03.csv', LEDGER = 'demo-general-ledger-2026-03.csv', HISTORY = 'demo-bank-history-2025-04-to-2026-03.csv';
const sample = () => [doc(BANK), doc(LEDGER), doc(HISTORY)];
const replaceCell = (body: string, row: number, column: string, value: string) => {
    const lines = body.split('\n'), header = lines[0].split(','), cells = lines[row].split(',');
    cells[header.indexOf(column)] = value; lines[row] = cells.join(','); return lines.join('\n');
};

describe('one-action processing of the public synthetic documents', () => {
    it('identifies roles, verifies independently and produces one consistent context', async () => {
        const c = await processDocuments(sample());
        expect(c.status).toBe('COMPLETED_WITH_EXCEPTIONS');
        expect(c.documents.map(d => [d.role, d.decision])).toEqual([['BANK_STATEMENT', 'AUTO_ACCEPTED'], ['GENERAL_LEDGER', 'AUTO_ACCEPTED'], ['BANK_HISTORY', 'AUTO_ACCEPTED']]);
        expect(c.stages.map(s => `${s.id}:${s.decision}`)).toEqual(['IDENTIFY:AUTO_ACCEPTED', 'EXTRACT:AUTO_ACCEPTED', 'INTERPRET:AUTO_ACCEPTED', 'VERIFY:AUTO_ACCEPTED', 'RECONCILE:AUTO_ACCEPTED', 'ANALYZE:AUTO_ACCEPTED', 'FORECAST:AUTO_ACCEPTED', 'REPORT:AUTO_ACCEPTED']);
        expect(c.stages.flatMap(s => s.checks).every(k => k.passed)).toBe(true);
        expect(c.scope).toEqual({ organizationId: 'synthetic-demo', businessId: 'DEMO-001', businessName: 'Rimba Demo Kitchen (Synthetic)', period: '2026-03', currency: 'MYR' });
        expect(c.outputs.reconciliation!.counts).toEqual({ MATCH_EXACT: 46, MATCH_DATE_SHIFT: 4, BANK_ONLY: 3, LEDGER_ONLY: 2, AMOUNT_MISMATCH_REVIEW: 2, AMBIGUOUS_DUPLICATE_LEDGER: 1, REFERENCE_MISMATCH_REVIEW: 1 });
        expect(c.outputs.reconciliation!.cashMovement).toEqual({ bank: '28232.01', ledger: '30924.93', signedDifference: '-2692.92' });
        expect(c.outputs.totals).toMatchObject({ rows: 57, net: '28232.01' });
        expect(c.outputs.anomalies).toHaveLength(6);
        expect(c.outputs.history.months).toHaveLength(12);
        expect(c.outputs.forecast!.forecast).toMatchObject({ status: 'AVAILABLE', period: '2026-04', credits: '67274.28', debits: '31827.83', net: '35446.45', tests: 6 });
        expect(c.outputs.report).toMatchObject({ processingId: c.processingId, anomalyCandidates: 6, forecast: { status: 'AVAILABLE', period: '2026-04' } });
        expect(c.outputs.report!.sources.map(s => s.sha256)).toEqual(c.documents.map(d => d.sha256));
    });
    it('is deterministic and order independent; a different document set is a different processing', async () => {
        const a = await processDocuments(sample()), b = await processDocuments(sample().reverse());
        expect(b.processingId).toBe(a.processingId);
        expect(JSON.stringify(b.outputs.reconciliation)).toBe(JSON.stringify(a.outputs.reconciliation));
        const pair = await processDocuments([doc(BANK), doc(LEDGER)]);
        expect(pair.processingId).not.toBe(a.processingId);
        // Without history only one month is observed: the forecast engine's own refusal is reported, not a figure.
        expect(pair.outputs.forecast!.forecast).toMatchObject({ status: 'UNAVAILABLE', code: 'INSUFFICIENT_HISTORY' });
        expect(pair.stages.find(s => s.id === 'FORECAST')!.decision).toBe('UNAVAILABLE');
        expect(pair.outputs.report!.forecast.status).toBe('UNAVAILABLE');
    });
    it('quarantines every unmatched and ambiguous outcome and never presents it as matched', async () => {
        const c = await processDocuments(sample()), snapshot = c.outputs.reconciliation!;
        const exceptions = c.quarantine.filter(q => q.kind === 'RECONCILIATION_EXCEPTION');
        expect(exceptions).toHaveLength(9);
        expect(exceptions.map(e => e.status).sort()).toEqual(['AMBIGUOUS_DUPLICATE_LEDGER', 'AMOUNT_MISMATCH_REVIEW', 'AMOUNT_MISMATCH_REVIEW', 'BANK_ONLY', 'BANK_ONLY', 'BANK_ONLY', 'LEDGER_ONLY', 'LEDGER_ONLY', 'REFERENCE_MISMATCH_REVIEW']);
        const ambiguous = snapshot.results.find(r => r.status === 'AMBIGUOUS_DUPLICATE_LEDGER')!;
        expect(ambiguous.ledgerRecordIds).toHaveLength(2);
        expect(c.quarantine.filter(q => q.kind === 'ANOMALY_CANDIDATE')).toHaveLength(6);
    });
    it('quarantines missing, duplicated, evaluation-only and inconsistent documents instead of guessing', async () => {
        const missing = await processDocuments([doc(BANK)]);
        expect(missing.status).toBe('QUARANTINED');
        expect(missing.stages.map(s => s.id)).toEqual(['IDENTIFY']);
        expect(missing.outputs.reconciliation).toBeNull(); expect(missing.outputs.totals).toBeNull();
        const twoBanks = await processDocuments([doc(BANK), doc('copy.csv', text(BANK) + '\n'), doc(LEDGER)]);
        expect(twoBanks.status).toBe('QUARANTINED');
        expect(twoBanks.documents.filter(d => d.role === 'BANK_STATEMENT').every(d => d.decision === 'QUARANTINED')).toBe(true);
        const evaluator = await processDocuments([doc(BANK), doc(LEDGER), doc('labels.csv', 'TransactionID,IsAnomaly\nX,1\n')]);
        expect(evaluator.documents[2]).toMatchObject({ role: null, decision: 'QUARANTINED' });
        expect(evaluator.outputs.reconciliation).not.toBeNull();
        const otherBusiness = await processDocuments([doc(BANK), doc(LEDGER, text(LEDGER).replaceAll(',DEMO-001,', ',DEMO-002,'))]);
        expect(otherBusiness.status).toBe('QUARANTINED');
        expect(otherBusiness.stages.at(-1)).toMatchObject({ id: 'INTERPRET', decision: 'QUARANTINED' });
        const broken = await processDocuments([doc(BANK), doc(LEDGER, replaceCell(text(LEDGER), 3, 'SignedCashMovementMYR', '1.00'))]);
        expect(broken.stages.at(-1)).toMatchObject({ id: 'EXTRACT', decision: 'QUARANTINED' });
        expect(broken.outputs.reconciliation).toBeNull();
    });
    it('quarantines a history that disagrees with the verified statement, without blocking reconciliation', async () => {
        const body = text(HISTORY), lines = body.split('\n'), header = lines[0].split(',');
        const row = lines.findIndex(l => l.includes(',2026-03,'));
        const cells = lines[row].split(','), amount = header.indexOf('AmountMYR'), signed = header.indexOf('SignedCashMovementMYR');
        cells[amount] = '1.00'; cells[signed] = cells[signed].startsWith('-') ? '-1.00' : '1.00'; lines[row] = cells.join(',');
        const c = await processDocuments([doc(BANK), doc(LEDGER), doc(HISTORY, lines.join('\n'))]);
        expect(c.documents[2]).toMatchObject({ role: 'BANK_HISTORY', decision: 'QUARANTINED' });
        expect(c.outputs.history.accepted).toBe(false);
        expect(c.outputs.forecast!.forecast.status).toBe('UNAVAILABLE');
        expect(c.outputs.reconciliation!.cashMovement.signedDifference).toBe('-2692.92');
        expect(c.quarantine.some(q => q.kind === 'HISTORY')).toBe(true);
    });
    it('answers rule-based questions only from the processing context', async () => {
        const c = await processDocuments(sample()), facts = qaFacts(c)!;
        expect(answerQuestion(facts, 'What is the bank-versus-ledger difference?').headline).toContain('MYR -2,692.92');
        expect(answerQuestion(facts, 'How many anomalies were identified?').headline).toMatch(/^6 of 57 source records/);
        expect(answerQuestion(facts, 'What is the next-month cash-movement forecast?').status).toBe('ANSWERED');
        expect(answerQuestion(facts, 'What is net profit?').status).toBe('REFUSED');
        const quarantined = await processDocuments([doc(BANK)]);
        expect(qaFacts(quarantined)).toBeNull();
    });
});

const dataset = process.env.FINGENCE_POC_DATASET_DIR;
describe.skipIf(!dataset || !existsSync(join(dataset, 'demo_bank_statement_mar2026.csv')))('private March pack processed by the same pipeline (local only)', () => {
    it('matches the authenticated local PoC figures and accepts the consistent 6,000-row history', async () => {
        const file = (name: string): DocumentInput => ({ name, bytes: new Uint8Array(readFileSync(join(dataset!, name))), provenance: 'USER_SUPPLIED' });
        const c = await processDocuments([file('demo_bank_statement_mar2026.csv'), file('demo_general_ledger_mar2026.csv'), file('source_transactions_6000.csv')]);
        expect(c.outputs.reconciliation!.counts).toEqual({ MATCH_EXACT: 151, MATCH_DATE_SHIFT: 6, BANK_ONLY: 7, LEDGER_ONLY: 6, AMOUNT_MISMATCH_REVIEW: 4, AMBIGUOUS_DUPLICATE_LEDGER: 3, REFERENCE_MISMATCH_REVIEW: 4 });
        expect(c.outputs.reconciliation!.cashMovement).toEqual({ bank: '102950.56', ledger: '100434.50', signedDifference: '2516.06' });
        expect(c.outputs.anomalies).toHaveLength(14);
        expect(c.outputs.history.accepted).toBe(true);
        expect(c.outputs.forecast!.forecast).toMatchObject({ status: 'AVAILABLE', period: '2026-09', credits: '205774.83', debits: '129113.73', net: '76661.10' });
    }, 60000);
});
