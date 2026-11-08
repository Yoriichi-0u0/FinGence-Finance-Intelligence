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
import { createPocAnomalies } from '../../lib/server/poc-anomalies/service';
import { installPocAnomalySchema } from '../../lib/server/poc-anomalies/schema';
import { failingAudit, m5Database, password } from '../tenant-admin-m5/support';
import { bank, ledger, csv } from '../poc-reconciliation/fixtures';
import { pdfText } from './support';

let pg: PGlite, db: TransactionDatabase, finance: string, other: string, technical: string;
const bankBytes = csv([bank]), ledgerBytes = csv([ledger]);
const sha = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const hashes = { bank: sha(bankBytes), ledger: sha(ledgerBytes) };
const must = <T extends { status: string }>(r: T) => { expect(r.status).not.toBe('REFUSED'); if (!('sourceId' in r)) throw Error('missing upload'); return r.sourceId as string; };
const service = () => createPocAnomalies(db, { reconciliation: readScopedReconciliation });
let sourceId: string;
beforeAll(async () => {
    ({ pg, db } = await m5Database());
    await installReconciliationSchema(db); await installPocAnomalySchema(db);
    for (const [name, role] of [['finance', 'Finance'], ['other', 'Finance'], ['technical', 'Technical (Management)']] as const)
        await provisionM3Account(db, { email: `${name}@combined.invalid`, password, organizationName: name, role });
    const login = async (name: string) => (await createM2Identity(db).login(`${name}@combined.invalid`, password)).token;
    finance = await login('finance'); other = await login('other'); technical = await login('technical');
    sourceId = must(await service().upload(finance, 'bank.csv', bankBytes));
}, 60000);
afterAll(async () => { await pg?.close(); });

describe('combined persisted reconciliation / anomaly report', () => {
    it('is unavailable before the source pair exists; then quotes the persisted snapshot without a nested transaction', async () => {
        const empty = await service().report(finance, { sourceId }, 'json');
        expect(empty.status === 'OK' && empty.report.reconciliation.status).toBe('UNAVAILABLE');
        const saved = await createReconciliationService(db, hashes).ingest(finance, bankBytes, ledgerBytes, 'bank.csv', 'ledger.csv');
        let transactions = 0;
        const counted: TransactionDatabase = { close: async () => {}, transaction: work => { transactions++; return db.transaction(work); } };
        const r = await createPocAnomalies(counted, { reconciliation: readScopedReconciliation }).report(finance, { sourceId }, 'pdf');
        expect(transactions).toBe(1);
        if (r.status !== 'OK' || r.report.reconciliation.status !== 'AVAILABLE') throw Error('missing combined report');
        expect(r.report.reconciliation.snapshot.cashMovement).toEqual(saved.snapshot.cashMovement);
        expect(r.report.cashMovement.net).toBe(saved.snapshot.cashMovement.bank);
        expect(r.report.source.sha256).toBe(saved.snapshot.sources.bank.sha256);
        expect(pdfText(r.bytes)).toContain('Reconciliation bank movement equals the anomaly source net movement.');
    });
    it('binds the exact source SHA, organization, business, period and currency; refuses ambiguous ledger pairs', async () => {
        await db.transaction(async tx => {
            const p = await resolveM3Principal(tx, finance);
            const scope = { organizationId: p.organization_id, businessId: bank.BusinessID, period: '2026-03', currency: 'MYR', bankSha256: hashes.bank };
            expect(await readScopedReconciliation(tx, p, scope)).not.toBeNull();
            for (const change of [{ bankSha256: 'a'.repeat(64) }, { organizationId: randomUUID() }, { businessId: 'OTHER' }, { period: '2026-04' }, { currency: 'USD' }])
                expect(await readScopedReconciliation(tx, p, { ...scope, ...change })).toBeNull();
            const secondLedger = csv([{ ...ledger, LedgerEntryID: 'ANOTHER-LEDGER-ID' }]);
            const secondHash = sha(secondLedger);
            const existing = (await tx.query<{ snapshot: Record<string, unknown> }>('SELECT snapshot FROM fingence_poc.reconciliations WHERE organization_id=$1', [p.organization_id])).rows[0].snapshot;
            const copy = structuredClone(existing) as unknown as { sources: { ledger: { sha256: string; sourceId: string } } };
            copy.sources.ledger = { sha256: secondHash, sourceId: secondHash };
            await tx.query('INSERT INTO fingence_poc.reconciliations(id,organization_id,created_by,bank_sha256,ledger_sha256,snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [randomUUID(), p.organization_id, p.user_id, hashes.bank, secondHash, JSON.stringify(copy)]);
            expect(await readScopedReconciliation(tx, p, scope)).toBeNull();
            await tx.query('DELETE FROM fingence_poc.reconciliations WHERE ledger_sha256=$1', [secondHash]);
        });
    });
    it('denies other tenants, technical users and revoked sessions, without masking reader or audit failures', async () => {
        for (const token of [other, technical]) expect(await service().report(token, { sourceId }, 'pdf')).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const revoked = (await createM2Identity(db).login('finance@combined.invalid', password)).token;
        await createM2Identity(db).logout(revoked);
        await expect(service().report(revoked, { sourceId }, 'pdf')).rejects.toThrow('ACCESS_DENIED');
        await expect(createPocAnomalies(db, { reconciliation: async () => { throw Error('TEST_READER_FAILURE'); } }).report(finance, { sourceId }, 'pdf')).rejects.toThrow('TEST_READER_FAILURE');
        await expect(createPocAnomalies(failingAudit(db), { reconciliation: readScopedReconciliation }).report(finance, { sourceId }, 'pdf')).rejects.toThrow('audit failure');
    });
});

const dataset = process.env.FINGENCE_POC_DATASET_DIR;
describe.skipIf(!dataset || !existsSync(join(dataset, 'demo_bank_statement_mar2026.csv')))('actual supplied March pack / combined pipeline', () => {
    it('persists 175 bank + 177 ledger rows; reconciles seven categories and source-linked anomalies in JSON/PDF', async () => {
        const bank = readFileSync(join(dataset!, 'demo_bank_statement_mar2026.csv')), ledger = readFileSync(join(dataset!, 'demo_general_ledger_mar2026.csv'));
        const saved = await createReconciliationService(db).ingest(finance, bank, ledger, 'march-bank.csv', 'march-ledger.csv');
        const sourceId = must(await service().upload(finance, 'march-bank.csv', bank));
        const json = await service().report(finance, { sourceId }, 'json'), pdf = await service().report(finance, { sourceId }, 'pdf');
        if (json.status !== 'OK' || pdf.status !== 'OK' || json.report.reconciliation.status !== 'AVAILABLE') throw Error('missing combined report');
        expect(saved.snapshot.rows.bank).toHaveLength(175); expect(saved.snapshot.rows.ledger).toHaveLength(177);
        expect(json.report.reconciliation.snapshot.counts).toEqual({ MATCH_EXACT: 151, MATCH_DATE_SHIFT: 6, BANK_ONLY: 7, LEDGER_ONLY: 6, AMOUNT_MISMATCH_REVIEW: 4, AMBIGUOUS_DUPLICATE_LEDGER: 3, REFERENCE_MISMATCH_REVIEW: 4 });
        expect(json.report.reconciliation.snapshot.cashMovement).toEqual({ bank: '102950.56', ledger: '100434.50', signedDifference: '2516.06' });
        expect(json.report.cashMovement.rows).toBe(175); expect(json.report.cashMovement.net).toBe('102950.56'); expect(json.report.counts.candidates).toBe(14);
        expect(JSON.parse(new TextDecoder().decode(json.bytes)).reconciliation.snapshot).toEqual(json.report.reconciliation.snapshot);
        for (const value of ['MYR 102,950.56', 'MYR 100,434.50', 'MYR 2,516.06', '14 (', saved.snapshot.sources.bank.sha256]) expect(pdfText(pdf.bytes)).toContain(value);
        expect(pdf.report.cashMovement).toEqual(json.report.cashMovement); expect(pdf.report.candidates).toEqual(json.report.candidates);
        // Same business/month, different uploaded source bytes: the 6,000-row file must not inherit March reconciliation.
        const fullId = must(await service().upload(finance, 'source_transactions_6000.csv', readFileSync(join(dataset!, 'source_transactions_6000.csv'))));
        const full = await service().report(finance, { sourceId: fullId, businessId: 'BUS-001', period: '2026-03', currency: 'MYR' }, 'json');
        expect(full.status === 'OK' && full.report.reconciliation.status).toBe('UNAVAILABLE');
        expect(full.status === 'OK' && full.report.counts.candidates).toBe(9);
    });
});
