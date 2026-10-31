import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Pipeline, installM2Schema } from '../../lib/server/ai-ingestion/m2/pipeline';
import { createM2Identity, provisionM2Account, tokenHash } from '../../lib/server/ai-ingestion/m2/identity';
import { createFinancialConsumers, prepareGroundedRequest, validateGroundedClaims } from '../../lib/server/financial-m3/consumers';
import { installM3Schema, createManagementService } from '../../lib/server/financial-m3/management';
let pg: PGlite, db: TransactionDatabase, token: string, other: string, admin: string, tech: string, id: string, quarantine: string, org: string, user: string;
beforeAll(async () => {
    pg = await PGlite.create();
    await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;');
    await pg.exec(readFileSync('supabase/sql/v2-verified-document-local.sql', 'utf8'));
    db = { close: async () => { }, transaction: work => pg.transaction(tx => work({ query: async (sql, values) => { const r = await tx.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as never; } })) };
    await installM2Schema(db);
    const identity = createM2Identity(db), password = 'Public-synthetic-test-password';
    const a = await provisionM2Account(db, { email: 'a@m3.invalid', password, organizationName: 'Synthetic A' });
    org = a.organizationId;
    user = a.userId;
    await provisionM2Account(db, { email: 'b@m3.invalid', password, organizationName: 'Synthetic B' });
    const ad = await provisionM2Account(db, { email: 'admin@m3.invalid', password, organizationName: 'Admin original', role: 'Admin' });
    const te = await provisionM2Account(db, { email: 'tech@m3.invalid', password, organizationName: 'Tech original', role: 'Technical (Management)' });
    await pg.query('UPDATE fingence_m2.memberships SET organization_id=$2 WHERE user_id IN ($1,$3)', [ad.userId, org, te.userId]);
    await installM3Schema(db);
    token = (await identity.login('a@m3.invalid', password)).token;
    other = (await identity.login('b@m3.invalid', password)).token;
    admin = (await identity.login('admin@m3.invalid', password)).token;
    tech = (await identity.login('tech@m3.invalid', password)).token;
    const pipeline = createM2Pipeline(db);
    id = (await pipeline.reserve(token)).id;
    await pipeline.process(token, id, readFileSync('synthetic/m2/verified-mixed.csv'), 'synthetic.csv');
    quarantine = (await pipeline.reserve(token)).id;
    await pipeline.process(token, quarantine, readFileSync('synthetic/m2/quarantine.csv'), 'unsupported.csv');
}, 60000);
afterAll(async () => { await pg?.close(); });
describe('one independently verified V2 selection across all consumers', () => {
    it('uses identical persisted rows, exact sums, dates and references in transactions, plots, exports and answers', async () => {
        const service = createFinancialConsumers(db), s = await service.snapshot(token, id, 'exclude');
        expect(s.version).toBe('v2-financial-consumers-v1');
        expect(s.records).toHaveLength(2);
        expect(s.analytics[0].sourceSignedTotal).toBe('105.5');
        expect(s.analytics[0].days.map(p => p.total)).toEqual(['125.5', '-20']);
        expect(s.analytics[0].months[0]).toMatchObject({ period: '2026-10', total: '105.5', recordCount: 2 });
        const report = await service.export(token, id, 'exclude');
        expect(report.selection).toEqual(s.selection);
        expect(report.records).toEqual(s.records);
        expect(report.analytics).toEqual(s.analytics);
        expect(report.publicationEligible).toBe(false);
        const answer = await service.answer(token, id, 'exclude', 'What is the source-signed total?');
        expect(answer.selectionHash).toBe(s.selection.hash);
        expect(answer.claims[0]).toMatchObject({ value: '105.5', currency: 'MYR', recordIds: s.records.map(r => r.id) });
        expect(s.records.every(r => r.evidence.every(e => e !== null && typeof e.id === 'string'))).toBe(true);
    });
    it('warning policy changes the selection consistently, without including rejected or unresolved rows', async () => {
        const s = await createFinancialConsumers(db).snapshot(token, id, 'include');
        expect(s.records).toHaveLength(3);
        expect(s.analytics[0].sourceSignedTotal).toBe('85.5');
        expect(s.counts).toMatchObject({ accepted: 3, rejected: 1, unresolved: 0, selected: 3, excludedWarnings: 0 });
        const excluded = await createFinancialConsumers(db).snapshot(token, id, 'exclude');
        expect(excluded.selection.hash).not.toBe(s.selection.hash);
        expect(excluded.counts.excludedWarnings).toBe(1);
    });
    it('does not fabricate totals, reconciliation, forecasts or answers for unsupported evidence', async () => {
        const service = createFinancialConsumers(db), s = await service.snapshot(token, quarantine, 'exclude');
        expect(s.records).toEqual([]);
        expect(s.analytics).toEqual([]);
        expect(s.counts.unresolved).toBe(1);
        expect(s.capabilities.forecasting.status).toBe('UNAVAILABLE');
        expect(s.capabilities.reconciliation.status).toBe('UNAVAILABLE');
        expect((await service.answer(token, id, 'exclude', 'Predict my revenue')).status).toBe('UNSUPPORTED');
    });
    it('denies other tenants, forged/expired/revoked identity and nonfinancial roles', async () => {
        const s = createFinancialConsumers(db);
        for (const t of [other, 'forged', admin, tech])
            await expect(s.snapshot(t, id, 'exclude')).rejects.toThrow();
        const short = (await createM2Identity(db).login('a@m3.invalid', 'Public-synthetic-test-password')).token;
        await pg.query("UPDATE fingence_m2.sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [tokenHash(short)]);
        await expect(s.snapshot(short, id, 'exclude')).rejects.toThrow();
    });
    it('blocks missing/uncertain jobs and failed durable audits instead of returning zero-valued dashboards', async () => {
        const pending = (await createM2Pipeline(db).reserve(token)).id;
        await pg.query("UPDATE fingence_m2.jobs SET state='UNCERTAIN' WHERE id=$1", [pending]);
        await expect(createFinancialConsumers(db).snapshot(token, pending, 'exclude')).rejects.toThrow('BATCH_UNAVAILABLE');
        const broken: TransactionDatabase = { close: async () => { }, transaction: work => db.transaction(tx => work({ query: (sql, v) => sql.includes('INSERT INTO public.security_audit_events') ? Promise.reject(new Error('audit failure')) : tx.query(sql, v) })) };
        await expect(createFinancialConsumers(broken).snapshot(token, id, 'exclude')).rejects.toThrow();
    });
    it('binds model-ready numeric claims to the selected source facts; never dispatches', async () => {
        const s = await createFinancialConsumers(db).snapshot(token, id, 'exclude'), request = prepareGroundedRequest(s, 'What is the source-signed total?');
        expect(request.mode).toBe('MODEL_NOT_CONFIGURED');
        expect(validateGroundedClaims(s, request.allowedClaims)).toBe(true);
        expect(validateGroundedClaims(s, [{ ...request.allowedClaims[0], value: '9999' }])).toBe(false);
        expect(validateGroundedClaims(s, [{ ...request.allowedClaims[0], recordIds: ['invented'] }])).toBe(false);
    });
    it('Technical receives operational metadata only; Admin manages only its own organization', async () => {
        const m = createManagementService(db), overview = await m.overview(tech);
        expect(overview.members).toBeNull();
        expect(JSON.stringify(overview)).not.toContain('125.5');
        expect(overview.jobs.some(j => j.state === 'COMPLETED')).toBe(true);
        await expect(m.membership(tech, { userId: user, role: 'Admin', active: true, expectedVersion: 1 })).rejects.toThrow();
        await expect(m.membership(admin, { userId: '77777777-7777-4777-8777-777777777777', role: 'Finance', active: true, expectedVersion: 1 })).rejects.toThrow();
    });
});
it('groups currencies separately with exact large amounts and supported calendar dates', async () => {
    const pipeline = createM2Pipeline(db), batch = (await pipeline.reserve(token)).id;
    await pipeline.process(token, batch, readFileSync('synthetic/m3/currency-months.csv'), 'currencies.csv');
    const s = await createFinancialConsumers(db).snapshot(token, batch, 'include');
    expect(s.records).toHaveLength(5);
    expect(s.analytics.map(g => [g.currency, g.sourceSignedTotal])).toEqual([['MYR', '0.25'], ['USD', '0.01']]);
    expect(s.analytics[1].months.map(m => m.total)).toEqual(['9007199254740993.01', '-9007199254740993']);
    expect(s.analytics[0].months.map(m => m.total)).toEqual(['0.3', '-0.05']);
    expect((await createFinancialConsumers(db).answer(token, batch, 'include', 'What is the source-signed total?')).claims).toHaveLength(2);
});
it('does not invent a signed source amount for a general ledger workbook', async () => {
    const pipeline = createM2Pipeline(db), batch = (await pipeline.reserve(token)).id;
    await pipeline.process(token, batch, readFileSync('synthetic/ai-ingestion-i2/i02.xlsx'), 'ledger.xlsx');
    const s = await createFinancialConsumers(db).snapshot(token, batch, 'include');
    expect(s.records.length).toBeGreaterThan(0);
    expect(s.analytics.every(g => g.status === 'UNAVAILABLE' && g.sourceSignedTotal === null)).toBe(true);
    expect((await createFinancialConsumers(db).answer(token, batch, 'include', 'What is the source-signed total?')).status).toBe('UNAVAILABLE');
});
it('enrolls inactive members, permits scoped Admin activation, revokes old sessions on role change and protects last Admin', async () => {
    const { provisionM3Account } = await import('../../lib/server/financial-m3/management');
    const account = await provisionM3Account(db, { email: 'new@m3.invalid', password: 'Public-synthetic-test-password', organizationId: org, role: 'Finance' }), identity = createM2Identity(db), m = createManagementService(db);
    expect(account.active).toBe(false);
    await expect(identity.login('new@m3.invalid', 'Public-synthetic-test-password')).rejects.toThrow();
    await m.membership(admin, { userId: account.userId, role: 'Finance', active: true, expectedVersion: 1 });
    const t = (await identity.login('new@m3.invalid', 'Public-synthetic-test-password')).token;
    expect((await createFinancialConsumers(db).list(t)).length).toBeGreaterThan(0);
    await m.membership(admin, { userId: account.userId, role: 'Technical (Management)', active: true, expectedVersion: 2 });
    await expect(createFinancialConsumers(db).list(t)).rejects.toThrow();
    await expect(m.membership(admin, { userId: account.userId, role: 'Finance', active: true, expectedVersion: 2 })).rejects.toThrow('STALE_MEMBERSHIP');
    const ad = (await pg.query<{
        user_id: string;
    }>("SELECT user_id FROM fingence_m2.memberships WHERE organization_id=$1 AND role='Admin'", [org])).rows[0].user_id;
    await expect(m.membership(admin, { userId: ad, role: 'Finance', active: true, expectedVersion: 1 })).rejects.toThrow('LAST_ADMIN_PROTECTED');
    await m.revoke(admin, user);
    await expect(createFinancialConsumers(db).snapshot(token, id, 'exclude')).rejects.toThrow();
    token = (await identity.login('a@m3.invalid', 'Public-synthetic-test-password')).token;
    const audit = (await pg.query<{
        target_type: string;
    }>("SELECT target_type FROM security_audit_events WHERE action='authorization.role_changed' ORDER BY occurred_at DESC LIMIT 1")).rows[0];
    expect(audit.target_type).toBe('organization_user');
});
it('rolls back membership changes if audit acknowledgement fails', async () => {
    const broken: TransactionDatabase = { close: async () => { }, transaction: work => db.transaction(tx => work({ query: (sql, v) => sql.includes('INSERT INTO public.security_audit_events') ? Promise.reject(new Error('audit failure')) : tx.query(sql, v) })) };
    await expect(createManagementService(broken).membership(admin, { userId: user, role: 'Admin', active: false, expectedVersion: 1 })).rejects.toThrow();
    expect((await pg.query('SELECT active,role,version FROM fingence_m2.memberships WHERE user_id=$1', [user])).rows[0]).toMatchObject({ active: true, role: 'Finance', version: 1 });
    expect((await createFinancialConsumers(db).snapshot(token, id, 'exclude')).analytics[0].sourceSignedTotal).toBe('105.5');
});
it('deactivated organization sessions cannot retrieve data or be silently reinstated', async () => {
    const { setLocalOrganizationActive } = await import('../../lib/server/financial-m3/management');
    await setLocalOrganizationActive(db, org, false);
    await expect(createFinancialConsumers(db).snapshot(token, id, 'exclude')).rejects.toThrow();
    await setLocalOrganizationActive(db, org, true);
    await expect(createM2Identity(db).login('a@m3.invalid', 'Public-synthetic-test-password')).rejects.toThrow();
});
