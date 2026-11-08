import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => { process.env.FINGENCE_M5_LOCAL = '1'; return { m3: vi.fn(), m5: vi.fn() }; });
vi.mock('../../lib/server/financial-m3/runtime', async () => { const { localAccessAllowed } = await import('../../lib/server/ai-ingestion/service');
    return { m3LocalEnabled: () => true, m3RequestAllowed: (r: Request) => localAccessAllowed(r), m3Runtime: mock.m3 }; });
vi.mock('../../lib/server/tenant-admin-m5/flags', async () => { const { localAccessAllowed } = await import('../../lib/server/ai-ingestion/service');
    return { m5LocalEnabled: () => true, m5RequestAllowed: (r: Request) => localAccessAllowed(r) }; });
vi.mock('../../lib/server/tenant-admin-m5/runtime', () => ({ m5Runtime: mock.m5 }));
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { GET as legacyGET, POST as legacyPOST } from '../../app/api/ai-ingestion/m2/consumers/route';
import { GET as adminGET, POST as adminPOST } from '../../app/api/ai-ingestion/m2/admin/route';
import { createM2Identity } from '../../lib/server/ai-ingestion/m2/identity';
import { createM2Pipeline } from '../../lib/server/ai-ingestion/m2/pipeline';
import { createFinancialConsumers } from '../../lib/server/financial-m3/consumers';
import { createManagementService } from '../../lib/server/financial-m3/management';
import { bootstrapOrganization, createTenantAdministration } from '../../lib/server/tenant-admin-m5/service';
import { m5Database, password } from './support';

let pg: PGlite, db: TransactionDatabase, admin: string, adminId: string, tech: string, financeId: string;
const origin = 'http://127.0.0.1:3185';
const call = (handler: (r: Request) => Promise<Response>, path: string, token: string, body?: unknown) => handler(new Request(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:3185', origin, cookie: 'fingence_m5_session=' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }));
const legacy = '/api/ai-ingestion/m2/consumers', modern = '/api/ai-ingestion/m2/admin';
const audit = async (action: string, actor: string, target: string) => (await pg.query('SELECT outcome FROM public.security_audit_events WHERE action=$1 AND actor_id=$2 AND target_id=$3', [action, actor, target])).rows;
const membership = async (userId: string) => (await pg.query('SELECT role,active,version FROM fingence_m2.memberships WHERE user_id=$1', [userId])).rows[0] as { role: string; active: boolean; version: number };
const userId = async (email: string) => (await pg.query<{ id: string }>('SELECT id::text FROM fingence_m2.users WHERE email=$1', [email])).rows[0].id;
async function enroll(email: string, role: string) {
    const invited = await (await call(adminPOST, modern + '?action=invite', admin, { email, role })).json();
    await new Promise(r => setTimeout(r, 1050));
    expect(await (await call(adminPOST, modern + '?action=enroll', '', { code: invited.code, email, password })).json()).toEqual({ status: 'ENROLLED', membershipActive: false });
    return userId(email);
}
const local = () => { vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_LOCAL', '1'); };
beforeAll(async () => {
    local();
    ({ pg, db } = await m5Database());
    const org = await bootstrapOrganization(db, { name: 'Legacy route', adminEmail: 'admin@legacy.m5.invalid' });
    await createTenantAdministration(db).enroll({ code: org.code, email: 'admin@legacy.m5.invalid', password });
    const signedIn = await createM2Identity(db).login('admin@legacy.m5.invalid', password);
    admin = signedIn.token; adminId = signedIn.principal.user_id;
    mock.m3.mockResolvedValue({ consumers: createFinancialConsumers(db), management: createManagementService(db) });
    mock.m5.mockResolvedValue({ administration: createTenantAdministration(db) });
    const techId = await enroll('tech@legacy.m5.invalid', 'Technical (Management)');
    expect((await call(adminPOST, modern + '?action=membership', admin, { userId: techId, role: 'Technical (Management)', active: true, expectedVersion: 1 })).status).toBe(200);
    tech = (await createM2Identity(db).login('tech@legacy.m5.invalid', password)).token;
    financeId = await enroll('finance@legacy.m5.invalid', 'Finance');
}, 60000);
beforeEach(local);
afterAll(async () => { await pg?.close(); });

describe('legacy M3 management endpoints delegate to M5 enforcement', () => {
    it('refuses a non-Admin through the legacy endpoint with a durable denial, exactly as the new endpoint does', async () => {
        expect((await call(legacyPOST, legacy + '?action=membership', tech, { userId: financeId, role: 'Finance', active: true, expectedVersion: 1 })).status).toBe(404);
        expect((await call(adminPOST, modern + '?action=membership', tech, { userId: financeId, role: 'Finance', active: true, expectedVersion: 1 })).status).toBe(404);
        expect(await audit('authorization.denied', (await createM2Identity(db).session(tech)).userId, financeId)).toEqual([{ outcome: 'denied' }, { outcome: 'denied' }]);
        expect((await membership(financeId)).active).toBe(false);
        const views = await Promise.all([call(legacyGET, legacy + '?action=management', tech), call(adminGET, modern + '?action=overview', tech)].map(async r => (await r).json()));
        expect(views.map(v => [v.view, v.members, v.invitations])).toEqual([['OPERATIONAL', null, null], ['OPERATIONAL', null, null]]);
    });
    it('records typed M5 audits when an Admin activates, revokes and reads through the legacy endpoint', async () => {
        expect(await (await call(legacyPOST, legacy + '?action=membership', admin, { userId: financeId, role: 'Finance', active: true, expectedVersion: 1 })).json()).toEqual({ status: 'UPDATED', sessionsRevoked: true });
        expect(await audit('membership.activated', adminId, financeId)).toEqual([{ outcome: 'success' }]);
        expect(await (await call(legacyPOST, legacy + '?action=revoke', admin, { userId: financeId })).json()).toEqual({ status: 'UPDATED', sessionsRevoked: true });
        expect(await audit('session.revoked', adminId, financeId)).toEqual([{ outcome: 'success' }]);
        const overview = await (await call(legacyGET, legacy + '?action=management', admin)).json();
        expect(overview.members.find((m: { userId: string }) => m.userId === financeId)).toMatchObject({ role: 'Finance', active: true, accountActive: true });
    });
    it('keeps the legacy generic failure contract while the new endpoint reports the protected refusal', async () => {
        const before = await membership(adminId);
        expect((await call(legacyPOST, legacy + '?action=membership', admin, { userId: adminId, role: 'Finance', active: true, expectedVersion: before.version })).status).toBe(404);
        const response = await call(adminPOST, modern + '?action=membership', admin, { userId: adminId, role: 'Finance', active: true, expectedVersion: before.version });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ refused: 'LAST_ADMIN_PROTECTED' });
        expect(await membership(adminId)).toEqual(before);
    });
    it('an account suspended through the new endpoint loses legacy financial access immediately', async () => {
        const finance = (await createM2Identity(db).login('finance@legacy.m5.invalid', password)).token;
        const pipeline = createM2Pipeline(db), batch = (await pipeline.reserve(finance)).id;
        await pipeline.process(finance, batch, readFileSync('synthetic/m2/verified-mixed.csv'), 'synthetic.csv');
        expect((await call(legacyGET, legacy + '?batch=' + batch, finance)).status).toBe(200);
        expect(await (await call(adminPOST, modern + '?action=account', admin, { userId: financeId, active: false })).json()).toEqual({ status: 'UPDATED', sessionsRevoked: true });
        for (const path of [legacy, legacy + '?batch=' + batch, legacy + '?batch=' + batch + '&action=export'])
            expect((await call(legacyGET, path, finance)).status).toBe(404);
        expect((await call(legacyPOST, legacy + '?action=question&batch=' + batch, finance, { question: 'What is the source-signed total?' })).status).toBe(404);
        await expect(createM2Identity(db).login('finance@legacy.m5.invalid', password)).rejects.toThrow();
    });
});
