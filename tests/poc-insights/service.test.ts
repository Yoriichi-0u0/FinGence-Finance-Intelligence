import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity, tokenHash } from '../../lib/server/ai-ingestion/m2/identity';
import { provisionM3Account } from '../../lib/server/financial-m3/management';
import { installReconciliationSchema, createReconciliationService } from '../../lib/server/poc-reconciliation/service';
import { installPocAnomalySchema } from '../../lib/server/poc-anomalies/schema';
import { createPocAnomalies } from '../../lib/server/poc-anomalies/service';
import { createPocInsights } from '../../lib/server/poc-insights/service';
import { createPocForecast } from '../../lib/server/poc-forecast/service';
import { toCents, fromCents } from '../../lib/poc-anomalies/source';
import { insightsQuery } from '../../lib/poc-insights/model';
import { m5Database, failingAudit, password } from '../tenant-admin-m5/support';
import { csv } from '../poc-anomalies/support';
let pg: PGlite, db: TransactionDatabase, finance: string, other: string, technical: string, admin: string, source: string;
const content = csv([{ id: 'A', direction: 'Credit', amount: '123.45' }, { id: 'B', amount: '20.10' }]);
beforeAll(async () => {
    ({ pg, db } = await m5Database()); await installReconciliationSchema(db); await installPocAnomalySchema(db);
    for (const [name, role] of [['finance', 'Finance'], ['other', 'Finance'], ['technical', 'Technical (Management)'], ['admin', 'Admin']] as const)
        await provisionM3Account(db, { email: `${name}@insights.invalid`, password, role, organizationName: name });
    const login = async (n: string) => (await createM2Identity(db).login(`${n}@insights.invalid`, password)).token;
    [finance, other, technical, admin] = await Promise.all(['finance', 'other', 'technical', 'admin'].map(login));
    const r = await createPocAnomalies(db).upload(finance, 'source.csv', content); if (r.status !== 'STORED') throw Error('upload failed'); source = r.sourceId;
}, 60000);
afterAll(async () => { await pg?.close(); });
describe('read-only Finance PoC insights', () => {
    it('reads the already-uploaded source with real ownership, exact figures, provenance and a committed audit', async () => {
        const r = await createPocInsights(db).read(finance, insightsQuery.parse({ source }));
        if (r.status !== 'OK') throw Error('unavailable');
        expect(r.version).toBe('poc-financial-insights-v1'); expect(r.publicationEligible).toBe(false);
        expect(r.totals.net).toBe('103.35'); expect(r.transactions.map(r => [r.rowId, r.csvRecord])).toEqual([['A', 2], ['B', 3]]);
        expect(r.reconciliation.status).toBe('UNAVAILABLE'); expect(r.source.rowCount).toBe(2);
        expect((await pg.query("SELECT 1 FROM security_audit_events WHERE action='financial_record.read' AND target_id=$1", [source])).rows).toHaveLength(1);
        expect((await createPocInsights(db).sources(finance)).status).toBe('OK');
    });
    it('denies other tenants and roles and refuses unknown sources and selected business', async () => {
        const service = createPocInsights(db), q = insightsQuery.parse({ source });
        for (const token of [other, technical, admin]) expect(await service.read(token, q)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await service.read(finance, insightsQuery.parse({ source: '11111111-1111-4111-8111-111111111111' }))).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await service.read(finance, insightsQuery.parse({ source, business: 'NO-ACCESS' }))).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect((await pg.query("SELECT 1 FROM security_audit_events WHERE action='authorization.denied'")).rows).toHaveLength(2);
    });
    it('fails closed on revoked, expired or invalid sessions and membership removal', async () => {
        const auth = createM2Identity(db), q = insightsQuery.parse({ source });
        const revoked = (await auth.login('finance@insights.invalid', password)).token; await auth.logout(revoked);
        const expired = (await auth.login('finance@insights.invalid', password)).token;
        await pg.query("UPDATE fingence_m2.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [tokenHash(expired)]);
        for (const token of [revoked, expired, 'invalid']) await expect(createPocInsights(db).read(token, q)).rejects.toThrow('ACCESS_DENIED');
        await pg.query("UPDATE fingence_m2.memberships SET active=false WHERE user_id=(SELECT id FROM fingence_m2.users WHERE email='other@insights.invalid')");
        await expect(createPocInsights(db).sources(other)).rejects.toThrow('ACCESS_DENIED');
    });
    it('blocks result delivery on audit failure and never hides source corruption as a valid empty dashboard', async () => {
        await expect(createPocInsights(failingAudit(db)).read(finance, insightsQuery.parse({ source }))).rejects.toThrow('audit failure');
        await pg.query('UPDATE fingence_poc.anomaly_sources SET content=$1 WHERE id=$2', [new Uint8Array([1, 2]), source]);
        await expect(createPocInsights(db).read(finance, insightsQuery.parse({ source }))).rejects.toThrow('SOURCE_INTEGRITY');
        await pg.query('UPDATE fingence_poc.anomaly_sources SET content=$1 WHERE id=$2', [content, source]);
    });
});
const dataset = process.env.FINGENCE_POC_DATASET_DIR;
describe.skipIf(!dataset || !existsSync(join(dataset, 'source_transactions_6000.csv')))('supplied March and full-year cross-module consistency', () => {
    it('uses the exact same rows and calculations as anomalies/report and attaches only the matching reconciliation', async () => {
        const bank = readFileSync(join(dataset!, 'demo_bank_statement_mar2026.csv')), ledger = readFileSync(join(dataset!, 'demo_general_ledger_mar2026.csv'));
        await createReconciliationService(db).ingest(finance, bank, ledger, 'bank.csv', 'ledger.csv');
        const anomalies = createPocAnomalies(db), upload = await anomalies.upload(finance, 'bank.csv', bank);
        if (upload.status !== 'STORED') throw Error('upload failed');
        const r = await createPocInsights(db).read(finance, insightsQuery.parse({ source: upload.sourceId }));
        const a = await anomalies.analysis(finance, { sourceId: upload.sourceId });
        if (r.status !== 'OK' || a.status !== 'OK' || r.reconciliation.status !== 'AVAILABLE') throw Error('unavailable');
        expect(r.totals).toEqual({ rows: 175, creditRows: 60, debitRows: 115, credits: '230966.35', debits: '-128015.79', net: '102950.56' });
        expect(a.cashMovement).toMatchObject(r.totals); expect(r.anomalies.candidates).toBe(14);
        expect(r.series).toHaveLength(1); expect(r.reconciliation.snapshot.cashMovement.signedDifference).toBe('2516.06');
        const marchForecast = await createPocForecast(db).forecast(finance, { sourceId: upload.sourceId, businessId: 'BUS-001' });
        if (marchForecast.status !== 'OK') throw Error('forecast refused');
        expect(marchForecast.source.sha256).toBe(r.source.sha256);
        expect(marchForecast.business.forecast).toMatchObject({ status: 'UNAVAILABLE', code: 'INSUFFICIENT_HISTORY' });
        const fullUpload = await anomalies.upload(finance, 'full.csv', readFileSync(join(dataset!, 'source_transactions_6000.csv')));
        if (fullUpload.status !== 'STORED') throw Error('upload failed');
        const full = await createPocInsights(db).read(finance, insightsQuery.parse({ source: fullUpload.sourceId, business: 'BUS-001', period: '2026-03' }));
        if (full.status !== 'OK') throw Error('unavailable');
        expect(full.series).toHaveLength(12); expect(full.totals.net).toBe(r.totals.net); expect(full.anomalies.candidates).toBe(9);
        expect(full.reconciliation.status).toBe('UNAVAILABLE'); expect(full.source.sha256).not.toBe(r.source.sha256);
        const forecast = await createPocForecast(db).forecast(finance, { sourceId: fullUpload.sourceId, businessId: 'BUS-001' });
        if (forecast.status !== 'OK') throw Error('forecast refused');
        expect(forecast.source.sha256).toBe(full.source.sha256);
        expect(forecast.business.history).toEqual(full.series.map(m => ({ ...m, debits: fromCents(-toCents(m.debits)) })));
        expect(forecast.business.forecast).toMatchObject({ status: 'AVAILABLE', period: '2026-09', credits: '205774.83', debits: '129113.73', net: '76661.10' });
    });
});
