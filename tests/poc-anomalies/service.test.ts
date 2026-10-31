import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity } from '../../lib/server/ai-ingestion/m2/identity';
import { bootstrapOrganization, createTenantAdministration } from '../../lib/server/tenant-admin-m5/service';
import { installPocAnomalySchema } from '../../lib/server/poc-anomalies/schema';
import { createPocAnomalies, type PocAnalysis, type PocRefused, type ReconciliationReader } from '../../lib/server/poc-anomalies/service';
import { failingAudit, m5Database, password } from '../tenant-admin-m5/support';
import { csv, ordinary, pdfText } from './support';

let pg: PGlite, db: TransactionDatabase;
const admin = () => createTenantAdministration(db), service = (reader?: ReconciliationReader) => createPocAnomalies(db, { reconciliation: reader });
const audits = async (action: string) => (await pg.query<{ actor_id: string; organization_id: string; outcome: string; target_id: string }>('SELECT actor_id,organization_id,outcome,target_id FROM public.security_audit_events WHERE action=$1 ORDER BY id', [action])).rows;
async function member(adminToken: string, email: string, role: 'Finance' | 'Technical (Management)') {
    const invite = await admin().invite(adminToken, { email, role });
    if (invite.status !== 'INVITED') throw new Error(invite.code);
    await admin().enroll({ code: invite.code, email, password });
    const userId = (await pg.query<{ id: string }>('SELECT id::text FROM fingence_m2.users WHERE email=$1', [email])).rows[0].id;
    const changed = await admin().changeMembership(adminToken, { userId, role, active: true, expectedVersion: 1 });
    if (changed.status !== 'UPDATED') throw new Error(changed.code);
    return (await createM2Identity(db).login(email, password)).token;
}
async function organization(name: string) {
    const org = await bootstrapOrganization(db, { name, adminEmail: `admin@${name}.poc.invalid` });
    await admin().enroll({ code: org.code, email: `admin@${name}.poc.invalid`, password });
    const adminToken = (await createM2Identity(db).login(`admin@${name}.poc.invalid`, password)).token;
    return { id: org.organizationId, adminToken, finance: await member(adminToken, `finance@${name}.poc.invalid`, 'Finance') };
}
const ok = <T extends { status: string }>(value: T | PocRefused) => { if (value.status === 'REFUSED') throw new Error((value as PocRefused).code); return value as T; };
const source = csv([
    ...ordinary('A'), { id: 'O1', amount: '5000.00', date: '2026-03-21' }, { id: 'C1', description: '[debit] Staff Health Centre', date: '2026-03-22' },
    { id: 'P1', amount: '102.00', date: '2026-02-10' }, { id: 'S1', direction: 'Credit', amount: '900.00', counterparty: 'POS Sales Settlement', description: '[credit] Pos Sales Settlement', date: '2026-03-23' },
]);
let a: Awaited<ReturnType<typeof organization>>, b: Awaited<ReturnType<typeof organization>>, techA: string, sourceId: string;

beforeAll(async () => {
    ({ pg, db } = await m5Database());
    await installPocAnomalySchema(db);
    await installPocAnomalySchema(db);
    a = await organization('org-a');
    b = await organization('org-b');
    techA = await member(a.adminToken, 'tech@org-a.poc.invalid', 'Technical (Management)');
    sourceId = ok(await service().upload(a.finance, 'synthetic.csv', source)).sourceId;
}, 60000);
afterAll(async () => { await pg?.close(); });

describe('PoC anomaly source storage', () => {
    it('stores a Finance upload once per organization and audits it', async () => {
        const again = ok(await service().upload(a.finance, 'renamed.csv', source));
        expect(again).toMatchObject({ sourceId, duplicate: true, rowCount: 24, layout: 'NORMALIZED_TRANSACTIONS' });
        const list = ok(await service().sources(a.finance));
        expect(list.sources.map(s => [s.id, s.fileName, s.rowCount])).toEqual([[sourceId, 'synthetic.csv', 24]]);
        expect((await audits('ingestion.persisted')).filter(r => r.target_id === sourceId)).toHaveLength(2);
        expect((await pg.query('SELECT 1 FROM fingence_poc.anomaly_sources')).rows).toHaveLength(1);
    });
    it('refuses invalid and evaluator files with an audited rejection and stores nothing', async () => {
        expect(await service().upload(a.finance, 'labels.csv', new TextEncoder().encode('SourceTransactionID,BusinessID,IsAnomaly\nX,B,No'))).toEqual({ status: 'REFUSED', code: 'EVALUATOR_FILE' });
        expect(await service().upload(a.finance, 'bad.csv', csv([{ id: 'X', amount: '1.5' }]))).toMatchObject({ status: 'REFUSED', code: 'INVALID_ROWS', details: ['Line 2: invalid amount.'] });
        expect((await audits('ingestion.rejected')).length).toBeGreaterThanOrEqual(2);
        expect((await pg.query('SELECT 1 FROM fingence_poc.anomaly_sources')).rows).toHaveLength(1);
    });
    it('rolls back an upload whose audit cannot be written', async () => {
        await expect(createPocAnomalies(failingAudit(db)).upload(a.finance, 'other.csv', csv(ordinary('Z')))).rejects.toThrow();
        expect((await pg.query('SELECT 1 FROM fingence_poc.anomaly_sources')).rows).toHaveLength(1);
    });
});

describe('PoC anomaly analysis', () => {
    it('returns source-derived candidates and exact cash movement for one business and period', async () => {
        const result = ok(await service().analysis(a.finance, { sourceId })) as PocAnalysis;
        expect(result.selection).toEqual({ businessId: 'BUS-T01', businessName: 'Synthetic Test Cafe', period: '2026-03', currency: 'MYR' });
        expect(result.options).toEqual([{ businessId: 'BUS-T01', businessName: 'Synthetic Test Cafe', periods: ['2026-02', '2026-03'], currencies: ['MYR'] }]);
        // 20 ordinary debits (2,040.00) + 5,000.00 + 100.00 out; 900.00 in. The February row is out of scope.
        expect(result.cashMovement).toMatchObject({ rows: 23, creditRows: 1, debitRows: 22, credits: '900.00', debits: '-7140.00', net: '-6240.00' });
        expect(result.candidates.map(c => [c.rowId, c.severity, c.findings.map(f => f.ruleId)])).toEqual([['O1', 'HIGH', ['AMOUNT_OUTLIER']], ['C1', 'MEDIUM', ['DESCRIPTION_COUNTERPARTY_MISMATCH']]]);
        expect(result.candidates[0]).toMatchObject({ amount: '5000.00', signedAmount: '-5000.00', currency: 'MYR', review: { state: 'OPEN', version: 0 } });
        expect(result.counts).toMatchObject({ candidates: 2, high: 1, medium: 1, byReview: { OPEN: 2, EXPLAINED: 0, ESCALATED: 0 } });
        expect(result.evaluation).toBeNull();
        expect(result.scope.organizationId).toBe(a.id);
        const february = ok(await service().analysis(a.finance, { sourceId, period: '2026-02' })) as PocAnalysis;
        expect([february.cashMovement.net, february.candidates.length]).toEqual(['-102.00', 0]);
    });
    it('denies Technical users with a durable audit and hides other tenants and unknown scopes generically', async () => {
        expect(await service().analysis(techA, { sourceId })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect((await audits('authorization.denied')).some(r => r.target_id === 'poc-anomaly-analysis')).toBe(true);
        expect(await service().analysis(b.finance, { sourceId })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await service().analysis(b.finance, { sourceId: '00000000-0000-4000-8000-000000000000' })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(ok(await service().sources(b.finance)).sources).toEqual([]);
        for (const scope of [{ businessId: 'BUS-OTHER' }, { period: '2025-01' }, { currency: 'USD' }])
            expect(await service().analysis(a.finance, { sourceId, ...scope })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        await expect(service().analysis('not-a-session', { sourceId })).rejects.toThrow();
    });
    it('records explicit review decisions with version checks and never clears them automatically', async () => {
        expect(ok(await service().review(a.finance, { sourceId, rowId: 'O1', state: 'EXPLAINED', expectedVersion: 0 }))).toEqual({ status: 'REVIEWED', rowId: 'O1', state: 'EXPLAINED', version: 1 });
        expect(await service().review(a.finance, { sourceId, rowId: 'O1', state: 'ESCALATED', expectedVersion: 0 })).toEqual({ status: 'REFUSED', code: 'STALE_REVIEW' });
        expect(await service().review(a.finance, { sourceId, rowId: 'A-1', state: 'EXPLAINED', expectedVersion: 0 })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await service().review(b.finance, { sourceId, rowId: 'C1', state: 'EXPLAINED', expectedVersion: 0 })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await service().review(techA, { sourceId, rowId: 'C1', state: 'EXPLAINED', expectedVersion: 0 })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        await expect(createPocAnomalies(failingAudit(db)).review(a.finance, { sourceId, rowId: 'C1', state: 'ESCALATED', expectedVersion: 0 })).rejects.toThrow();
        const result = ok(await service().analysis(a.finance, { sourceId })) as PocAnalysis;
        expect(result.candidates.map(c => [c.rowId, c.review.state, c.review.version])).toEqual([['O1', 'EXPLAINED', 1], ['C1', 'OPEN', 0]]);
        expect((await audits('anomaly.reviewed')).filter(r => r.outcome === 'success').map(r => r.target_id)).toEqual([`${sourceId}:O1`]);
    });
});

describe('PoC management report', () => {
    it('renders a PDF whose figures equal the analysis and reports reconciliation as unavailable without a snapshot', async () => {
        const result = ok(await service().report(a.finance, { sourceId }, 'pdf'));
        expect(Buffer.from(result.bytes.subarray(0, 5)).toString()).toBe('%PDF-');
        expect((await PDFDocument.load(result.bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
        const text = pdfText(result.bytes);
        for (const expected of ['FinGence management report', 'SYNTHETIC PoC DATA', 'Synthetic Test Cafe (BUS-T01)', 'MYR 900.00 (1 row)', 'MYR -7,140.00 (22 rows)', 'MYR -6,240.00', 'Reconciliation unavailable.', 'O1', 'C1', '1 open, 1 explained, 0 escalated', result.report.reportHash, result.report.source.sha256])
            expect(text).toContain(expected);
        expect(result.report.reconciliation.status).toBe('UNAVAILABLE');
        const json = ok(await service().report(a.finance, { sourceId }, 'json'));
        const parsed = JSON.parse(new TextDecoder().decode(json.bytes));
        expect(parsed).toMatchObject({ reportVersion: 'poc-management-report-v1', publicationEligible: false, cashMovement: result.report.cashMovement, counts: result.report.counts });
        expect((await audits('report.downloaded')).filter(r => r.target_id === sourceId && r.outcome === 'success')).toHaveLength(2);
    });
    it('quotes an in-scope FinancePoCReconciliationV1 snapshot read-only and refuses one from another tenant', async () => {
        const snapshot = (organizationId: string) => ({ version: 'finance-poc-reconciliation-v1', origin: 'DETERMINISTIC_RULES', scope: { organizationId, businessId: 'BUS-T01', period: '2026-03', currency: 'MYR' },
            sources: { bank: { sourceId: 'bank-src', sha256: createHash('sha256').update(source).digest('hex') }, ledger: { sourceId: 'gl-src', sha256: 'b'.repeat(64) } }, cashMovement: { bank: '-6240.00', ledger: '-6200.00', signedDifference: '-40.00' },
            counts: { MATCH_EXACT: 1, AMOUNT_MISMATCH_REVIEW: 1 }, results: [{ status: 'MATCH_EXACT', bankRecordId: 'A-1', ledgerRecordIds: ['GL-1'], reason: 'r', bankEvidenceIds: [], ledgerEvidenceIds: [] }, { status: 'AMOUNT_MISMATCH_REVIEW', bankRecordId: 'O1', ledgerRecordIds: ['GL-2'], reason: 'r', bankEvidenceIds: [], ledgerEvidenceIds: [] }], limitations: ['Synthetic constructed case.'] });
        const seen: string[] = [];
        const available = ok(await service(async (_tx, p, scope) => { seen.push(scope.organizationId); return snapshot(p.organization_id); }).report(a.finance, { sourceId }, 'pdf'));
        expect(seen).toEqual([a.id]);
        expect(available.report.reconciliation.status).toBe('AVAILABLE');
        const text = pdfText(available.bytes);
        for (const expected of ['MYR -6,200.00', 'MYR -40.00', 'Reconciliation bank movement equals the anomaly source net movement.', 'Amount mismatch review', 'Synthetic constructed case.']) expect(text).toContain(expected);
        const foreign = ok(await service(async () => snapshot(b.id)).report(a.finance, { sourceId }, 'pdf'));
        expect(foreign.report.reconciliation).toMatchObject({ status: 'UNAVAILABLE', reason: expect.stringContaining('different organization') });
    });
    it('denies other roles and tenants and rolls back when the download audit fails', async () => {
        expect(await service().report(techA, { sourceId }, 'pdf')).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await service().report(b.finance, { sourceId }, 'pdf')).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const before = (await audits('report.downloaded')).length;
        await expect(createPocAnomalies(failingAudit(db)).report(a.finance, { sourceId }, 'pdf')).rejects.toThrow();
        expect((await audits('report.downloaded')).length).toBe(before);
    });
});
