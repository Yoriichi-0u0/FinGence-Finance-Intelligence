import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity } from '../../lib/server/ai-ingestion/m2/identity';
import { provisionM3Account, resolveM3Principal } from '../../lib/server/financial-m3/management';
import { createReconciliationService, installReconciliationSchema, readScopedReconciliation } from '../../lib/server/poc-reconciliation/service';
import { createReconciliationReviews } from '../../lib/server/poc-reconciliation/reviews';
import { createPocAnomalies, type PocReport } from '../../lib/server/poc-anomalies/service';
import { installPocAnomalySchema } from '../../lib/server/poc-anomalies/schema';
import { readReportReviewAggregate } from '../../lib/server/poc-anomalies/human-review';
import { readHumanReview, readReconciliation, type ReconciliationView } from '../../lib/poc-anomalies/reconciliation';
import { failingAudit, m5Database, password } from '../tenant-admin-m5/support';
import { bank, ledger, csv } from '../poc-reconciliation/fixtures';
import type { ReconciliationReviewAggregateV1 } from '../../lib/poc-reconciliation/reviews';
import { pdfText } from './support';

let pg: PGlite, db: TransactionDatabase, finance: string, other: string, technical: string, reconciliationId: string, sourceId: string;
// Two review-eligible outcomes: one amount mismatch and one ambiguous duplicate ledger pair.
const b = csv([bank, { ...bank, BankTransactionID: 'BANK-DUP', BankReference: 'DUP-REF', BankAmountMYR: '50.00', SignedCashMovementMYR: '50.00' }, { ...bank, BankTransactionID: 'BANK-EXACT', BankReference: 'EXACT-REF' }]);
const l = csv([{ ...ledger, CashAccountDebitMYR: '6380.52', SignedCashMovementMYR: '6380.52' }, ...['GL-DUP-A', 'GL-DUP-B'].map(LedgerEntryID => ({ ...ledger, LedgerEntryID, LedgerReference: 'DUP-REF', CashAccountDebitMYR: '50.00', SignedCashMovementMYR: '50.00' })), { ...ledger, LedgerEntryID: 'GL-EXACT', LedgerReference: 'EXACT-REF' }]);
const sha = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const service = (database = db) => createPocAnomalies(database, { reconciliation: readScopedReconciliation, humanReview: readReportReviewAggregate });
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, canonical(v)])) : value;
async function both(token: string, input: { sourceId: string; businessId?: string; period?: string; currency?: string } = { sourceId }) {
    const json = await service().report(token, input, 'json'), pdf = await service().report(token, input, 'pdf');
    if (json.status !== 'OK' || pdf.status !== 'OK') throw Error('report refused');
    return { json: json.report, file: JSON.parse(new TextDecoder().decode(json.bytes)) as PocReport, pdf: pdfText(pdf.bytes), pdfReport: pdf.report };
}
const decide = async (state: 'EXPLAINED' | 'ESCALATED', status: string) => {
    const reviews = createReconciliationReviews(db), view = await reviews.get(finance, reconciliationId);
    if (view.status !== 'OK') throw Error('review unavailable');
    const outcome = view.outcomes.find(o => o.status === status)!;
    expect((await reviews.review(finance, { reconciliationId, outcomeKey: outcome.key, state, rationale: 'Synthetic evidence annotated; original discrepancy remains uncleared.', expectedVersion: outcome.review.version })).status).toBe('REVIEWED');
};

beforeAll(async () => {
    ({ pg, db } = await m5Database());
    await installReconciliationSchema(db); await installPocAnomalySchema(db);
    for (const [name, role] of [['finance', 'Finance'], ['other', 'Finance'], ['technical', 'Technical (Management)']] as const)
        await provisionM3Account(db, { email: `${name}@human-review.invalid`, password, organizationName: name, role });
    const login = async (name: string) => (await createM2Identity(db).login(`${name}@human-review.invalid`, password)).token;
    finance = await login('finance'); other = await login('other'); technical = await login('technical');
    reconciliationId = (await createReconciliationService(db, { bank: sha(b), ledger: sha(l) }).ingest(finance, b, l, 'bank.csv', 'ledger.csv')).id;
    const upload = await service().upload(finance, 'bank.csv', b);
    if (upload.status !== 'STORED') throw Error('upload refused');
    sourceId = upload.sourceId;
}, 60000);
afterAll(async () => { await pg?.close(); });

describe('source-bound human reconciliation review summary in the management report', () => {
    it('reports every eligible outcome as Open before any decision, never "no exceptions"', async () => {
        const { json, file, pdf } = await both(finance);
        expect(json.reconciliation.status).toBe('AVAILABLE');
        expect(json.reconciliationHumanReview).toMatchObject({ status: 'AVAILABLE', reconciliationId, originalEligible: 2, eligibleByStatus: { AMOUNT_MISMATCH_REVIEW: 1, AMBIGUOUS_DUPLICATE_LEDGER: 1, BANK_ONLY: 0, LEDGER_ONLY: 0, REFERENCE_MISMATCH_REVIEW: 0 }, states: { OPEN: 2, INVESTIGATING: 0, EXPLAINED: 0, ESCALATED: 0 } });
        expect(file.reconciliationHumanReview).toEqual(json.reconciliationHumanReview);
        expect(pdf).toContain('Human reconciliation review (annotations, not cleared transactions)');
        expect(pdf).toContain('Reviewer: Open\n2');
    });
    it('quotes decisions without changing the original snapshot, cash movement, anomaly counts or report hash binding', async () => {
        const before = await both(finance);
        await decide('EXPLAINED', 'AMOUNT_MISMATCH_REVIEW'); await decide('ESCALATED', 'AMBIGUOUS_DUPLICATE_LEDGER');
        const after = await both(finance);
        expect(after.json.reconciliationHumanReview).toMatchObject({ status: 'AVAILABLE', originalEligible: 2, states: { OPEN: 0, INVESTIGATING: 0, EXPLAINED: 1, ESCALATED: 1 } });
        expect(after.json.reconciliation).toEqual(before.json.reconciliation);
        for (const k of ['cashMovement', 'counts', 'candidates', 'source', 'selection'] as const) expect(after.json[k]).toEqual(before.json[k]);
        // PDF and JSON come from one model: same figures, and the hash still covers the new field.
        expect(after.file.reconciliationHumanReview).toEqual(after.json.reconciliationHumanReview);
        expect(after.pdfReport.reconciliationHumanReview).toEqual(after.json.reconciliationHumanReview);
        const { reportHash, ...unsigned } = after.file;
        expect(createHash('sha256').update(JSON.stringify(canonical(unsigned))).digest('hex')).toBe(reportHash);
        for (const value of ['Reviewer: Explained\n1', 'Reviewer: Escalated\n1', 'Reviewer: Investigating\n0', 'Explained does not mean matched, reconciled, cleared or settled.', 'Anomaly review summary'])
            expect(after.pdf).toContain(value);
        expect(after.pdf).not.toMatch(/Explained\s*(=|means)\s*matched/i);
        // A new session sees the same persisted decisions.
        const again = await both((await createM2Identity(db).login('finance@human-review.invalid', password)).token);
        expect(again.json.reconciliationHumanReview).toEqual(after.json.reconciliationHumanReview);
    });
    it('is unavailable for a different bank source and does not clear the original decisions', async () => {
        const changed = await service().upload(finance, 'changed.csv', csv([{ ...bank, BankTransactionID: 'BANK-OTHER' }]));
        if (changed.status !== 'STORED') throw Error('upload refused');
        const other = await both(finance, { sourceId: changed.sourceId });
        expect(other.json.reconciliation.status).toBe('UNAVAILABLE');
        expect(other.json.reconciliationHumanReview.status).toBe('UNAVAILABLE');
        expect(other.pdf).toContain('Human review summary unavailable.');
        expect(other.pdf).not.toContain('Reviewer: Open');
        expect((await both(finance)).json.reconciliationHumanReview).toMatchObject({ status: 'AVAILABLE', states: { EXPLAINED: 1, ESCALATED: 1 } });
    });
    it('omits the summary for ambiguous or inconsistent annotations while keeping the original reconciliation', async () => {
        const [{ organization_id }] = (await pg.query<{ organization_id: string }>('SELECT organization_id::text FROM fingence_poc.reconciliations WHERE id=$1', [reconciliationId])).rows;
        const stray = 'f'.repeat(64);
        await pg.query("INSERT INTO fingence_poc.reconciliation_reviews(organization_id,reconciliation_id,outcome_key,version,state,rationale,decided_by) SELECT organization_id,id,$2,1,'EXPLAINED','Stray annotation',created_by FROM fingence_poc.reconciliations WHERE id=$1", [reconciliationId, stray]);
        const inconsistent = await both(finance);
        expect(inconsistent.json.reconciliation.status).toBe('AVAILABLE');
        expect(inconsistent.json.reconciliationHumanReview.status).toBe('UNAVAILABLE');
        expect(inconsistent.pdf).toContain('Signed difference');
        expect(inconsistent.pdf).not.toContain('Reviewer: Explained');
        await pg.query('DELETE FROM fingence_poc.reconciliation_reviews WHERE outcome_key=$1', [stray]);
        // A second ledger pair for the same bank source is ambiguous: no reconciliation and no annotation summary.
        const duplicate = randomUUID(), otherLedger = 'e'.repeat(64);
        await pg.query(`INSERT INTO fingence_poc.reconciliations(id,organization_id,created_by,bank_sha256,ledger_sha256,snapshot)
            SELECT $2,organization_id,created_by,bank_sha256,$3,jsonb_set(snapshot,'{sources,ledger,sha256}',to_jsonb($3::text)) FROM fingence_poc.reconciliations WHERE id=$1`, [reconciliationId, duplicate, otherLedger]);
        const ambiguous = await both(finance);
        expect(ambiguous.json.reconciliation.status).toBe('UNAVAILABLE');
        expect(ambiguous.json.reconciliationHumanReview.status).toBe('UNAVAILABLE');
        expect(ambiguous.pdf).not.toContain('Reviewer: Open');
        await db.transaction(async tx => {
            const p = await resolveM3Principal(tx, finance), view = readReconciliation((await tx.query<{ snapshot: unknown }>('SELECT snapshot FROM fingence_poc.reconciliations WHERE id=$1', [reconciliationId])).rows[0].snapshot, { organizationId: organization_id, businessId: 'BUS-001', period: '2026-03', currency: 'MYR', bankSha256: sha(b) });
            if (view.status !== 'AVAILABLE') throw Error('snapshot unavailable');
            expect(await readReportReviewAggregate(tx, p, view.snapshot)).not.toBeNull();
            expect(await readReportReviewAggregate(tx, { ...p, role: 'Technical (Management)' }, view.snapshot)).toBeNull();
            expect(await readReportReviewAggregate(tx, p, { ...view.snapshot, scope: { ...view.snapshot.scope, organizationId: randomUUID() } })).toBeNull();
            expect(await readReportReviewAggregate(tx, p, { ...view.snapshot, scope: { ...view.snapshot.scope, period: '2026-04' } })).toBeNull();
        });
        await pg.query('DELETE FROM fingence_poc.reconciliations WHERE id=$1', [duplicate]);
        expect((await both(finance)).json.reconciliationHumanReview.status).toBe('AVAILABLE');
    });
    it('rejects aggregates that are not bound to this exact snapshot or do not account for every eligible outcome', async () => {
        const view = (await both(finance)).json.reconciliation as Extract<ReconciliationView, { status: 'AVAILABLE' }>;
        const good = await db.transaction(async tx => readReportReviewAggregate(tx, await resolveM3Principal(tx, finance), view.snapshot)) as ReconciliationReviewAggregateV1;
        expect(readHumanReview(good, view).status).toBe('AVAILABLE');
        const states = good.states, sources = good.sources;
        for (const bad of [
            null, { ...good, version: 'other' }, { ...good, scope: { ...good.scope, period: '2026-04' } }, { ...good, scope: { ...good.scope, organizationId: randomUUID() } },
            { ...good, sources: { ...sources, ledger: { ...sources.ledger, sha256: '0'.repeat(64) } } }, { ...good, sources: { ...sources, bank: { ...sources.bank, sourceId: 'other' } } },
            { ...good, eligible: 3 }, { ...good, states: { ...states, OPEN: states.OPEN + 1 } }, { ...good, states: { ...states, OPEN: -1, EXPLAINED: states.EXPLAINED + 1 } },
            { ...good, states: { ...states, MATCHED: 0 } }, { ...good, states: { ...states, OPEN: 0.5 } },
        ]) expect(readHumanReview(bad, view).status).toBe('UNAVAILABLE');
        expect(readHumanReview(good, { status: 'UNAVAILABLE', reason: 'none' }).status).toBe('UNAVAILABLE');
    });
    it('denies other tenants, technical users and revoked sessions; never masks database or audit failures', async () => {
        for (const token of [other, technical]) expect(await service().report(token, { sourceId }, 'json')).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const revoked = (await createM2Identity(db).login('finance@human-review.invalid', password)).token;
        await createM2Identity(db).logout(revoked);
        await expect(service().report(revoked, { sourceId }, 'json')).rejects.toThrow('ACCESS_DENIED');
        await expect(createPocAnomalies(db, { reconciliation: readScopedReconciliation, humanReview: async () => { throw Error('TEST_REVIEW_FAILURE'); } }).report(finance, { sourceId }, 'pdf')).rejects.toThrow('TEST_REVIEW_FAILURE');
        await expect(service(failingAudit(db)).report(finance, { sourceId }, 'pdf')).rejects.toThrow('audit failure');
    });
});

const dataset = process.env.FINGENCE_POC_DATASET_DIR;
describe.skipIf(!dataset || !existsSync(join(dataset, 'demo_bank_statement_mar2026.csv')))('actual March pack / human review summary', () => {
    it('reports 24 original review-eligible outcomes as 22 Open, 0 Investigating, 1 Explained, 1 Escalated; the 6,000-row file stays unavailable', async () => {
        const march = readFileSync(join(dataset!, 'demo_bank_statement_mar2026.csv'));
        reconciliationId = (await createReconciliationService(db).ingest(finance, march, readFileSync(join(dataset!, 'demo_general_ledger_mar2026.csv')), 'march-bank.csv', 'march-ledger.csv')).id;
        const upload = await service().upload(finance, 'march-bank.csv', march);
        if (upload.status !== 'STORED') throw Error('upload refused');
        const input = { sourceId: upload.sourceId, businessId: 'BUS-001', period: '2026-03', currency: 'MYR' };
        const before = await both(finance, input);
        expect(before.json.reconciliationHumanReview).toMatchObject({ status: 'AVAILABLE', originalEligible: 24, states: { OPEN: 24, INVESTIGATING: 0, EXPLAINED: 0, ESCALATED: 0 } });
        await decide('EXPLAINED', 'AMOUNT_MISMATCH_REVIEW'); await decide('ESCALATED', 'AMBIGUOUS_DUPLICATE_LEDGER');
        const after = await both(finance, input);
        expect(after.json.reconciliationHumanReview).toMatchObject({ status: 'AVAILABLE', originalEligible: 24, eligibleByStatus: { BANK_ONLY: 7, LEDGER_ONLY: 6, AMOUNT_MISMATCH_REVIEW: 4, AMBIGUOUS_DUPLICATE_LEDGER: 3, REFERENCE_MISMATCH_REVIEW: 4 }, states: { OPEN: 22, INVESTIGATING: 0, EXPLAINED: 1, ESCALATED: 1 } });
        expect(after.file.reconciliationHumanReview).toEqual(after.json.reconciliationHumanReview);
        if (after.json.reconciliation.status !== 'AVAILABLE') throw Error('reconciliation unavailable');
        expect(after.json.reconciliation).toEqual(before.json.reconciliation);
        expect(after.json.reconciliation.snapshot.counts).toEqual({ MATCH_EXACT: 151, MATCH_DATE_SHIFT: 6, BANK_ONLY: 7, LEDGER_ONLY: 6, AMOUNT_MISMATCH_REVIEW: 4, AMBIGUOUS_DUPLICATE_LEDGER: 3, REFERENCE_MISMATCH_REVIEW: 4 });
        expect(after.json.reconciliation.snapshot.cashMovement).toEqual({ bank: '102950.56', ledger: '100434.50', signedDifference: '2516.06' });
        expect(after.json.counts).toEqual(before.json.counts); expect(after.json.counts.candidates).toBe(14);
        for (const value of ['MYR 2,516.06', '24 outcomes', 'Reviewer: Open\n22', 'Reviewer: Investigating\n0', 'Reviewer: Explained\n1', 'Reviewer: Escalated\n1']) expect(after.pdf).toContain(value);
        const full = await service().upload(finance, 'source_transactions_6000.csv', readFileSync(join(dataset!, 'source_transactions_6000.csv')));
        if (full.status !== 'STORED') throw Error('upload refused');
        const other = await both(finance, { ...input, sourceId: full.sourceId });
        expect(other.json.reconciliation.status).toBe('UNAVAILABLE');
        expect(other.json.reconciliationHumanReview.status).toBe('UNAVAILABLE');
        expect(other.pdf).not.toContain('Reviewer: Open');
    }, 60000);
});
