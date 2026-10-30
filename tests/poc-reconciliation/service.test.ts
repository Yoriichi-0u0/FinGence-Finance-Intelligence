import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { installM2Schema } from '../../lib/server/ai-ingestion/m2/pipeline';
import { provisionM2Account, createM2Identity } from '../../lib/server/ai-ingestion/m2/identity';
import { installM3Schema } from '../../lib/server/financial-m3/management';
import { createReconciliationService, installReconciliationSchema } from '../../lib/server/poc-reconciliation/service';
import { bank, ledger, csv } from './fixtures';
let pg: PGlite, db: TransactionDatabase, finance: string, other: string, tech: string, revoked: string;
const b = csv([bank]), l = csv([ledger]), hashes = { bank: createHash('sha256').update(b).digest('hex'), ledger: createHash('sha256').update(l).digest('hex') };
beforeAll(async () => {
    pg = await PGlite.create(); await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    await pg.exec(readFileSync('supabase/sql/v2-verified-document-local.sql', 'utf8'));
    db = { close: async () => {}, transaction: work => pg.transaction(tx => work({ query: async (sql, values) => { const r = await tx.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as never; } })) };
    await installM2Schema(db);
    for (const [email, role] of [['finance', 'Finance'], ['other', 'Finance'], ['tech', 'Technical (Management)']] as const)
        await provisionM2Account(db, { email: email + '@poc.invalid', password: 'Public-synthetic-test-password', organizationName: email, role });
    await installM3Schema(db); await installReconciliationSchema(db);
    const auth = createM2Identity(db), login = async (name: string) => (await auth.login(name + '@poc.invalid', 'Public-synthetic-test-password')).token;
    finance = await login('finance'); other = await login('other'); tech = await login('tech'); revoked = await login('finance'); await auth.logout(revoked);
}, 60000);
afterAll(async () => { await pg?.close(); });
describe('Finance-owned persistent source pairs', () => {
    it('commits both sources, derived snapshot and durable audit; identical pair cannot duplicate', async () => {
        const service = createReconciliationService(db, hashes);
        const first = await service.ingest(finance, b, l, 'bank.csv', 'ledger.csv');
        const second = await service.ingest(finance, b, l, 'renamed.csv', 'ledger.csv');
        expect(first.id).toBe(second.id); expect((await service.list(finance))).toHaveLength(1);
        const snapshot = await service.get(finance, first.id);
        expect(snapshot.cashMovement.bank).toBe('6380.53');
        expect(snapshot.evidence[snapshot.results[0].bankEvidenceIds[0]].row).toBe(2);
        expect((await pg.query("SELECT count(*)::int AS n FROM security_audit_events WHERE action='ingestion.persisted'")).rows[0]).toEqual({ n: 1 });
    });
    it('denies other tenants, technical roles, missing/expired/revoked sessions without revealing existence', async () => {
        const service = createReconciliationService(db, hashes), item = (await service.list(finance))[0];
        expect(await service.list(other)).toEqual([]);
        for (const token of [other, tech, revoked, 'invalid']) await expect(service.get(token, item.id)).rejects.toThrow('ACCESS_DENIED');
        await pg.query("UPDATE fingence_m2.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [(await import('../../lib/server/ai-ingestion/m2/identity')).tokenHash(other)]);
        await expect(service.list(other)).rejects.toThrow('ACCESS_DENIED');
    });
    it('requires registered synthetic source bytes and fails atomically when audit fails', async () => {
        await expect(createReconciliationService(db).ingest(finance, b, l, 'bank.csv', 'ledger.csv')).rejects.toThrow('REGISTERED_POC_SOURCES_REQUIRED');
        const changed = csv([{ ...bank, BankDescription: 'Changed synthetic test input' }]);
        const broken: TransactionDatabase = { close: async () => {}, transaction: work => db.transaction(tx => work({ query: (sql, args) => { if (/INSERT INTO.*security_audit_events/i.test(sql)) throw Error('TEST_AUDIT_FAILURE'); return tx.query(sql, args); } })) };
        await expect(createReconciliationService(broken, { ...hashes, bank: createHash('sha256').update(changed).digest('hex') }).ingest(finance, changed, l, 'bank.csv', 'ledger.csv')).rejects.toThrow('TEST_AUDIT_FAILURE');
        expect(await createReconciliationService(db, hashes).list(finance)).toHaveLength(1);
    });
});
