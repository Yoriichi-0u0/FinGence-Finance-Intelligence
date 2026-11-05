import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';
import { toCents } from '../../lib/poc-anomalies/source';
import { groundingIndex, runQueries } from '../../lib/grounded-qa/tools';
import { qaFacts } from '../../lib/demo/questions';
import { answerQuestion } from '../../lib/poc-finance-qa/answer';

// The public quarter sample (scripts/generate-quarter-documents.mjs): three months, SGD, a second fictional business.
const text = (name: string) => readFileSync(join('public/demo/quarter', name), 'utf8');
const doc = (name: string, body = text(name)): DocumentInput => ({ name, bytes: new TextEncoder().encode(body), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const BANK = 'demo-bank-statement-2026-q1-sgd.csv', LEDGER = 'demo-general-ledger-2026-q1-sgd.csv', HISTORY = 'demo-bank-history-2025-04-to-2026-03-sgd.csv';
const sample = () => [doc(BANK), doc(LEDGER), doc(HISTORY)];
const without = (body: string, month: string) => body.split('\n').filter((l, i) => i === 0 || !l.includes(`,${month}-`)).join('\n');

describe('several months and another currency, end to end', () => {
    it('reconciles every month, clears timing differences across months and keeps one currency', async () => {
        const c = await processDocuments(sample());
        expect(c.stages.map(s => `${s.id}:${s.decision}`)).toEqual(['IDENTIFY:AUTO_ACCEPTED', 'EXTRACT:AUTO_ACCEPTED', 'INTERPRET:AUTO_ACCEPTED', 'VERIFY:AUTO_ACCEPTED', 'RECONCILE:AUTO_ACCEPTED', 'ANALYZE:AUTO_ACCEPTED', 'FORECAST:AUTO_ACCEPTED', 'REPORT:AUTO_ACCEPTED']);
        expect(c.stages.flatMap(s => s.checks).every(k => k.passed)).toBe(true);
        expect(c.scope).toEqual({ organizationId: 'synthetic-demo', businessId: 'DEMO-002', businessName: 'Straits Demo Bakery (Synthetic)', period: '2026-01/2026-03', months: ['2026-01', '2026-02', '2026-03'], currency: 'SGD' });
        expect(c.outputs.periods.map(p => p.period)).toEqual(['2026-01', '2026-02', '2026-03']);
        expect(c.outputs.notReconciled).toEqual([]);
        expect(c.outputs.statement).toBeNull();
        // The whole-run snapshot is exactly the months combined, and passes the reconciliation contract.
        const r = c.outputs.reconciliation!, sum = (k: 'bank' | 'ledger' | 'signedDifference') => c.outputs.periods.reduce((n, p) => n + toCents(p.snapshot.cashMovement[k]), 0n);
        expect(c.outputs.reconciliationView.status).toBe('AVAILABLE');
        expect(r.scope.period).toBe('2026-01/2026-03');
        expect(r.results).toHaveLength(c.outputs.periods.reduce((n, p) => n + p.snapshot.results.length, 0));
        expect([toCents(r.cashMovement.bank), toCents(r.cashMovement.ledger), toCents(r.cashMovement.signedDifference)]).toEqual([sum('bank'), sum('ledger'), sum('signedDifference')]);
        expect(r.cashMovement.bank).toBe(c.outputs.totals!.net);
        // January's deposit clears in February, February's cheque and late booking clear in March, one deposit is still in transit.
        expect(c.outputs.resolution!.totals.resolutions).toEqual({ MATCHED_LATE: 2, MATCHED_BY_AMOUNT: 0, TIMING_CLEARED: 6, TIMING_OPEN: 1, ENTRY_PREPARED: 4, UNEXPLAINED: 0 });
        expect(c.outputs.resolution!.summary).toBe('January 2026 to March 2026: 104 transactions matched, 4 timing differences identified (1 expected on the next statement), 4 correcting entries prepared for your books. With these entries your books agree with the bank. Nothing needs your attention.');
        expect(c.outputs.resolution!.entries.every(e => e.debit.amount === e.credit.amount)).toBe(true);
        // Amounts stay in SGD; nothing is converted.
        expect(c.outputs.bankRows.every(x => x.currency === 'SGD')).toBe(true);
        expect(c.conventions).toContain('Currency SGD, as the documents state it; one currency per processing and no foreign-exchange conversion.');
        expect(c.outputs.forecast!.forecast).toMatchObject({ status: 'AVAILABLE', period: '2026-04' });
    });
    it('confirms unusual records against the books and flags only the one they do not show', async () => {
        const c = await processDocuments(sample()), a = c.outputs.anomalyResolution!;
        expect(a).toMatchObject({ corroborated: 8, flagged: 1 });
        const flagged = a.items.filter(i => i.resolution === 'FLAGGED');
        expect(flagged.map(i => i.row.rowId)).toEqual(['BANK-Q1-0101']);
        expect(flagged[0].summary).toBe('Payment of SGD 1,299.00 to Lucky Star Trading on 19 March 2026 looked unusual (unverified counterparty, amount outlier) and your books do not record it. Flagged for your technical team.');
        // A record cleared across months is still confirmed by the books (the February deposit booked in January).
        expect(a.items.find(i => i.row.rowId === 'BANK-Q1-0038')).toMatchObject({ resolution: 'CORROBORATED_BY_BOOKS', booked: { how: 'TIMING_CLEARED' } });
        expect(c.quarantine.map(q => [q.kind, q.reference])).toEqual([['ANOMALY_CANDIDATE', 'BANK-Q1-0101']]);
        expect(c.status).toBe('COMPLETED_WITH_EXCEPTIONS');
        expect(c.outputs.report).toMatchObject({ anomalyCandidates: 9, anomaliesFlagged: 1 });
    });
    it('reports a month only the bank covers instead of reconciling it against nothing', async () => {
        const c = await processDocuments([doc(BANK), doc(LEDGER, without(text(LEDGER), '2026-03')), doc(HISTORY)]);
        expect(c.stages.every(s => s.decision !== 'QUARANTINED')).toBe(true);
        expect(c.outputs.periods.map(p => p.period)).toEqual(['2026-01', '2026-02']);
        expect(c.outputs.notReconciled).toEqual([expect.objectContaining({ side: 'BANK', period: '2026-03' })]);
        expect(c.stages.find(s => s.id === 'RECONCILE')!.summary).toMatch(/Not reconciled, one side only: 2026-03 \(bank only, \d+ records\)\.$/);
        // Analytics still covers every verified bank record; the check explains the part without a ledger.
        expect(c.stages.find(s => s.id === 'ANALYZE')!.checks.find(k => k.id === 'consistency')).toMatchObject({ passed: true, detail: expect.stringMatching(/in months without a ledger/) });
        // March anomalies cannot be confirmed: no ledger covers that month.
        const march = c.outputs.anomalyResolution!.items.filter(i => i.row.period === '2026-03');
        expect(march.length).toBeGreaterThan(0);
        expect(march.every(i => i.resolution === 'FLAGGED' && /no ledger covers that month/.test(i.summary))).toBe(true);
        // Q&A never presents the partial reconciliation as the whole statement period's.
        const [rec] = runQueries(groundingIndex(c)!, [{ tool: 'reconciliation', status: 'ALL_EXCEPTIONS' }]);
        expect(rec.label).toBe('Reconciliation of 2026-01 to 2026-02 (bank minus ledger); 1 month not reconciled');
        expect(rec.fields.bankMovement).toMatchObject({ kind: 'MONEY', cents: toCents(c.outputs.reconciliation!.cashMovement.bank).toString() });
        expect(c.outputs.reconciliation!.cashMovement.bank).not.toBe(c.outputs.totals!.net);
        expect(rec.fields.notReconciled).toMatchObject({ kind: 'TEXT', text: 'Not in these figures, because only one document covers it: bank statement only 2026-03' });
        // Label and fields stay within the gateway's limits even for a long statement against one ledger month.
        const long = await processDocuments([doc(BANK), doc(LEDGER, text(LEDGER).split('\n').filter((l, i) => i === 0 || l.includes(',2026-01-')).join('\n'))]);
        const [one] = runQueries(groundingIndex(long)!, [{ tool: 'reconciliation', status: 'ALL_EXCEPTIONS' }]);
        expect(one.label.length).toBeLessThanOrEqual(160);
        expect(Object.values(one.fields).every(v => v.kind !== 'TEXT' || v.text.length <= 400)).toBe(true);
        // The rule-based answerer refuses to quote a reconciliation whose bank movement is not the statement's.
        expect(answerQuestion(qaFacts(c)!, 'What is the bank-versus-ledger difference?')).toMatchObject({ status: 'UNAVAILABLE' });
    });
    it('confirms a bank record that clears a booked item in a month the books do not cover', async () => {
        // Only January's ledger: the February bank credit BANK-Q1-0038 clears January's deposit GL-Q1-0036 in transit.
        const january = text(LEDGER).split('\n').filter((l, i) => i === 0 || l.includes(',2026-01-')).join('\n');
        const c = await processDocuments([doc(BANK), doc(LEDGER, january), doc(HISTORY)]);
        expect(c.outputs.anomalyResolution!.items.find(i => i.row.rowId === 'BANK-Q1-0038')).toMatchObject({ resolution: 'CORROBORATED_BY_BOOKS', booked: { ledgerRecordIds: ['GL-Q1-0036'], how: 'TIMING_CLEARED' } });
    });
    it('quarantines a history whose month disagrees with the statement, and a pair that shares no month', async () => {
        const lines = text(HISTORY).split('\n'), header = lines[0].split(','), row = lines.findIndex(l => l.includes(',2026-02,'));
        const cells = lines[row].split(','); cells[header.indexOf('AmountMYR')] = '1.00'; cells[header.indexOf('SignedCashMovementMYR')] = cells[header.indexOf('SignedCashMovementMYR')].startsWith('-') ? '-1.00' : '1.00'; lines[row] = cells.join(',');
        const c = await processDocuments([doc(BANK), doc(LEDGER), doc(HISTORY, lines.join('\n'))]);
        expect(c.outputs.history.accepted).toBe(false);
        expect(c.stages.find(s => s.id === 'VERIFY')!.checks.find(k => k.id === 'history-period')).toMatchObject({ passed: false, detail: expect.stringContaining('2026-02: history') });
        const ledgerJanuary = text(LEDGER).split('\n').filter((l, i) => i === 0 || l.includes(',2026-01-')).join('\n');
        const bankMarch = text(BANK).split('\n').filter((l, i) => i === 0 || l.includes(',2026-03-')).join('\n');
        const apart = await processDocuments([doc(BANK, bankMarch), doc(LEDGER, ledgerJanuary)]);
        expect(apart.status).toBe('QUARANTINED');
        expect(apart.stages.at(-1)).toMatchObject({ id: 'INTERPRET', decision: 'QUARANTINED' });
    });
    it('is deterministic and order independent', async () => {
        const a = await processDocuments(sample()), b = await processDocuments(sample().reverse());
        expect(b.processingId).toBe(a.processingId);
        expect(JSON.stringify(b.outputs.resolution)).toBe(JSON.stringify(a.outputs.resolution));
        expect(JSON.stringify(b.outputs.anomalyResolution)).toBe(JSON.stringify(a.outputs.anomalyResolution));
    });
});
