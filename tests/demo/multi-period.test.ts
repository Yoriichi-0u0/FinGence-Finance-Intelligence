import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';
import { toCents } from '../../lib/poc-anomalies/source';
import { catalogue, groundingIndex, runQueries } from '../../lib/grounded-qa/tools';
import { verifyAnswer } from '../../lib/grounded-qa/gates';
import { catalogueSchema } from '../../lib/grounded-qa/contracts';
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
    it('a month named in an AI answer must be the month of a fact cited in that sentence', async () => {
        const c = await processDocuments(sample()), index = groundingIndex(c)!, cat = catalogue(index), ctx = { question: 'What was the net cash movement?', catalogue: cat };
        const answer = (text: string, cites: string[]) => ({ answer: { kind: 'ANSWERED', sentences: [{ text, cites }], derived: [] } });
        const failed = (v: { checks: { id: string; passed: boolean }[] }) => v.checks.filter(k => !k.passed).map(k => k.id);
        // The whole-range summary never vouches for one month inside it.
        const whole = runQueries(index, [{ tool: 'cash_summary', period: '2026-01/2026-03' }]);
        expect(failed(verifyAnswer(answer('February net cash movement was {F1.net}.', ['F1']), whole, ctx))).toEqual(['no-free-figures']);
        expect(failed(verifyAnswer(answer('Net cash movement over {F1.period} was {F1.net}.', ['F1']), whole, ctx))).toEqual([]);
        // A February fact cited in the same sentence does.
        const february = runQueries(index, [{ tool: 'cash_summary', period: '2026-02' }]);
        expect(failed(verifyAnswer(answer('February net cash movement was {F1.net}.', ['F1']), february, ctx))).toEqual([]);
    });
    it('keeps the AI Q&A catalogue within its bound for a long multi-month processing', async () => {
        // 30 months, two bank records and their ledger entries per month.
        const months = Array.from({ length: 30 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);
        const bankHead = 'BankTransactionID,BusinessID,BusinessName,AccountNumber,Currency,ValueDate,StatementMonth,BankReference,BankDescription,BankDirection,BankAmountMYR,SignedCashMovementMYR,Counterparty,SourceTransactionID';
        const ledgerHead = 'LedgerEntryID,BusinessID,PostingDate,CashAccount,Currency,LedgerReference,LedgerMemo,Counterparty,CashAccountDebitMYR,CashAccountCreditMYR,SignedCashMovementMYR,CategoryLabel';
        const rows = months.flatMap((m, i) => [[`B${i}A`, `${m}-05`, `REFA${String(i).padStart(4, '0')}`, 'Credit', '100.00', '100.00', 'Card Sales'], [`B${i}B`, `${m}-20`, `REFB${String(i).padStart(4, '0')}`, 'Debit', '40.00', '-40.00', 'Flour Mill']]);
        const bank = [bankHead, ...rows.map(([id, d, ref, dir, amt, sgn, cp]) => `${id},DEMO-009,Long Demo (Synthetic),****0009,SGD,${d},${d.slice(0, 7)},${ref},[${dir.toLowerCase()}] ${cp.toUpperCase()},${dir},${amt},${sgn},${cp},`)].join('\n');
        const ledger = [ledgerHead, ...rows.map(([id, d, ref, , amt, sgn, cp]) => `L${id},DEMO-009,${d},1000-BANK,SGD,${ref},Entry,${cp},${sgn.startsWith('-') ? '0.00' : amt},${sgn.startsWith('-') ? amt : '0.00'},${sgn},Other`)].join('\n');
        const c = await processDocuments([doc('long-bank.csv', bank + '\n'), doc('long-ledger.csv', ledger + '\n')]);
        expect(c.scope?.months).toHaveLength(30);
        const index = groundingIndex(c)!, cat = catalogue(index);
        expect(catalogueSchema.safeParse(cat).success).toBe(true);
        expect(cat.months).toHaveLength(25);
        expect(cat.months.at(-1)).toBe('2024-01/2026-06');
        // The whole range is still answered from every statement record.
        const [whole] = runQueries(index, [{ tool: 'cash_summary', period: '2024-01/2026-06' }]);
        expect(whole.fields.transactions).toMatchObject({ kind: 'COUNT', n: 60 });
    });
    it('is deterministic and order independent', async () => {
        const a = await processDocuments(sample()), b = await processDocuments(sample().reverse());
        expect(b.processingId).toBe(a.processingId);
        expect(JSON.stringify(b.outputs.resolution)).toBe(JSON.stringify(a.outputs.resolution));
        expect(JSON.stringify(b.outputs.anomalyResolution)).toBe(JSON.stringify(a.outputs.anomalyResolution));
    });

    it('answers which payment was flagged from the flagged record, and withholds a confirmed one called flagged', async () => {
        const c = await processDocuments(sample()), index = groundingIndex(c)!, cat = catalogue(index), ctx = { question: 'Which payment was flagged and how much was it?', catalogue: cat };
        const facts = runQueries(index, [{ tool: 'anomalies', severity: 'ANY' }]);
        // The one flagged candidate is listed first and named by its outcome, even with more than eight candidates.
        expect(facts[0].fields).toEqual(expect.objectContaining({ candidates: { kind: 'COUNT', n: 9 }, flagged: { kind: 'COUNT', n: 1 }, confirmedByBooks: { kind: 'COUNT', n: 8 } }));
        expect(facts[1]).toEqual(expect.objectContaining({ label: 'Flagged anomaly #1', fields: expect.objectContaining({ id: { kind: 'TEXT', text: 'BANK-Q1-0101' } }) }));
        expect(facts.slice(2).every(f => f.label.startsWith('Anomaly confirmed by the books #'))).toBe(true);
        const ans = (t: string, cites: string[]) => ({ answer: { kind: 'ANSWERED', sentences: [{ text: t, cites }], derived: [] } });
        const failed = (v: ReturnType<typeof verifyAnswer>) => v.checks.filter(k => !k.passed).map(k => k.id);
        expect(failed(verifyAnswer(ans('The payment flagged was {F2.amount} to {F2.counterparty} on {F2.date}.', ['F2']), facts, ctx))).toEqual([]);
        // The production answer of 6 Nov 2026: a confirmed record presented as flagged is withheld.
        expect(failed(verifyAnswer(ans('The payment flagged was {F3.amount} to {F3.counterparty} on {F3.date}.', ['F3']), facts, ctx))).toEqual(['outcomes']);
        expect(failed(verifyAnswer(ans('The payment of {F2.amount} was confirmed by the books.', ['F2']), facts, ctx))).toEqual(['outcomes']);
        expect(failed(verifyAnswer(ans('The payment of {F3.amount} on {F3.date} was confirmed by the books.', ['F3']), facts, ctx))).toEqual([]);
    });

});
