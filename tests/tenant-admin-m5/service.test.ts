import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity, tokenHash } from '../../lib/server/ai-ingestion/m2/identity';
import { createM2Pipeline } from '../../lib/server/ai-ingestion/m2/pipeline';
import { createFinancialConsumers } from '../../lib/server/financial-m3/consumers';
import { createManagementService } from '../../lib/server/financial-m3/management';
import { SECURITY_AUDIT_ACTIONS, LOCAL_ADMINISTRATION_AUDIT_ACTIONS } from '../../lib/server/security/audit';
import { installM5Schema } from '../../lib/server/tenant-admin-m5/schema';
import { bootstrapOrganization, createTenantAdministration, issueRecoveryAdmin, setOrganizationActive } from '../../lib/server/tenant-admin-m5/service';
import { failingAudit, m5Database, password } from './support';

let pg: PGlite, db: TransactionDatabase;
const identity = () => createM2Identity(db), admin = () => createTenantAdministration(db);
const audits = async (action: string, organizationId?: string) => (await pg.query<{ actor_id: string | null; outcome: string; target_id: string | null }>(
    'SELECT actor_id,outcome,target_id FROM public.security_audit_events WHERE action=$1' + (organizationId ? ' AND organization_id=$2' : '') + ' ORDER BY id', organizationId ? [action, organizationId] : [action])).rows;
const membership = async (userId: string) => (await pg.query<{ role: string; active: boolean; version: number }>('SELECT role,active,version FROM fingence_m2.memberships WHERE user_id=$1', [userId])).rows[0];
async function enrolled(adminToken: string, email: string, role: 'Finance' | 'Technical (Management)' | 'Admin') {
    const invite = await admin().invite(adminToken, { email, role });
    if (invite.status !== 'INVITED') throw new Error(invite.code);
    const result = await admin().enroll({ code: invite.code, email, password });
    if (result.status !== 'ENROLLED') throw new Error(result.code);
    const userId = (await pg.query<{ id: string }>('SELECT id::text FROM fingence_m2.users WHERE email=$1', [email])).rows[0].id;
    return { userId, active: result.membershipActive };
}
async function activate(adminToken: string, userId: string, role: 'Finance' | 'Technical (Management)' | 'Admin' = 'Finance') {
    const current = await membership(userId);
    const result = await admin().changeMembership(adminToken, { userId, role, active: true, expectedVersion: current.version });
    if (result.status !== 'UPDATED') throw new Error(result.code);
    return (await identity().login((await pg.query<{ email: string }>('SELECT email FROM fingence_m2.users WHERE id=$1', [userId])).rows[0].email, password)).token;
}

let orgA: string, orgB: string, adminA: string, adminAUser: string, adminB: string, finance: { userId: string }, financeToken: string, tech: { userId: string }, techToken: string, batch: string;
beforeAll(async () => {
    ({ pg, db } = await m5Database());
    const a = await bootstrapOrganization(db, { name: 'M5 synthetic A', adminEmail: 'admin@a.m5.invalid' });
    orgA = a.organizationId;
    expect(await admin().enroll({ code: a.code, email: 'admin@a.m5.invalid', password })).toEqual({ status: 'ENROLLED', membershipActive: true });
    const login = await identity().login('admin@a.m5.invalid', password);
    adminA = login.token; adminAUser = login.principal.user_id;
    const b = await bootstrapOrganization(db, { name: 'M5 synthetic B', adminEmail: 'admin@b.m5.invalid' });
    orgB = b.organizationId;
    await admin().enroll({ code: b.code, email: 'admin@b.m5.invalid', password });
    adminB = (await identity().login('admin@b.m5.invalid', password)).token;
    finance = await enrolled(adminA, 'finance@a.m5.invalid', 'Finance');
    financeToken = await activate(adminA, finance.userId);
    tech = await enrolled(adminA, 'tech@a.m5.invalid', 'Technical (Management)');
    techToken = await activate(adminA, tech.userId, 'Technical (Management)');
    const pipeline = createM2Pipeline(db);
    batch = (await pipeline.reserve(financeToken)).id;
    await pipeline.process(financeToken, batch, readFileSync('synthetic/m2/verified-mixed.csv'), 'synthetic.csv');
}, 60000);
afterAll(async () => { await pg?.close(); });

describe('M5 local schema and audit contract', () => {
    it('installs idempotently, denies Data API roles and accepts exactly the TypeScript audit allowlist', async () => {
        await installM5Schema(db);
        await installM5Schema(db);
        const definition = (await pg.query<{ definition: string }>("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='security_audit_events_action_check'")).rows[0].definition;
        for (const action of SECURITY_AUDIT_ACTIONS)
            expect(definition).toContain(`'${action}'`);
        await expect(pg.query("INSERT INTO public.security_audit_events(occurred_at,action,outcome) VALUES (now(),'membership.raw_sql','success')")).rejects.toThrow();
        for (const role of ['anon', 'authenticated']) {
            await pg.exec(`SET ROLE ${role}`);
            for (const table of ['fingence_m5.invitations', 'fingence_m5.account_suspensions'])
                await expect(pg.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({ code: '42501' });
            await pg.exec('RESET ROLE');
        }
    });
    it('keeps the hosted Phase 3 action list unchanged and adds only local administration actions', () => {
        const hosted = [...readFileSync('supabase/sql/phase3-security-audit-api-events.sql', 'utf8').split('security_audit_events_target_type_check')[0].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]);
        expect([...SECURITY_AUDIT_ACTIONS].sort()).toEqual([...hosted, ...LOCAL_ADMINISTRATION_AUDIT_ACTIONS].sort());
    });
});

describe('OS-owner organization onboarding and enrollment', () => {
    it('creates no account or membership until the one-time Admin code is redeemed, and stores only its hash', async () => {
        const c = await bootstrapOrganization(db, { name: 'M5 synthetic C', adminEmail: 'admin@c.m5.invalid' });
        expect(c.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect((await pg.query('SELECT 1 FROM fingence_m2.memberships WHERE organization_id=$1', [c.organizationId])).rows).toHaveLength(0);
        const stored = (await pg.query<Record<string, unknown>>('SELECT * FROM fingence_m5.invitations WHERE id=$1', [c.invitationId])).rows[0];
        expect(stored).toMatchObject({ token_hash: tokenHash(c.code), issuer: 'OS_BOOTSTRAP', role: 'Admin', state: 'PENDING', created_by: null });
        expect(JSON.stringify(stored)).not.toContain(c.code);
        await expect(identity().login('admin@c.m5.invalid', password)).rejects.toThrow();
        expect(await admin().enroll({ code: c.code, email: 'someone-else@c.m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        expect((await audits('authorization.denied', c.organizationId)).length).toBe(1);
        expect(await admin().enroll({ code: c.code, email: 'ADMIN@c.m5.invalid ', password })).toEqual({ status: 'ENROLLED', membershipActive: true });
        expect(await admin().enroll({ code: c.code, email: 'admin@c.m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        expect((await identity().login('admin@c.m5.invalid', password)).principal.role).toBe('Admin');
        expect((await audits('membership.enrolled', c.organizationId)).length).toBe(1);
    });
    it('rejects invalid credentials and records the failed sign-in', async () => {
        const before = (await audits('auth.sign_in_failed')).length;
        await expect(identity().login('admin@a.m5.invalid', 'Wrong-synthetic-password')).rejects.toThrow('ACCESS_DENIED');
        await expect(identity().login('unknown@a.m5.invalid', password)).rejects.toThrow('ACCESS_DENIED');
        expect((await audits('auth.sign_in_failed')).length).toBe(before + 2);
    });
    it('enrolls Admin-invited members inactive; only an Admin activation permits sign-in', async () => {
        const pending = await enrolled(adminA, 'pending@a.m5.invalid', 'Admin');
        expect(pending.active).toBe(false);
        expect(await membership(pending.userId)).toMatchObject({ role: 'Admin', active: false, version: 1 });
        await expect(identity().login('pending@a.m5.invalid', password)).rejects.toThrow('ACCESS_DENIED');
        expect(await admin().changeMembership(financeToken, { userId: pending.userId, role: 'Admin', active: true, expectedVersion: 1 })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await admin().changeMembership(techToken, { userId: pending.userId, role: 'Admin', active: true, expectedVersion: 1 })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect((await membership(pending.userId)).active).toBe(false);
        const token = await activate(adminA, pending.userId, 'Admin');
        expect((await identity().session(token)).role).toBe('Admin');
        expect((await audits('membership.activated', orgA)).some(row => row.target_id === pending.userId && row.actor_id === adminAUser)).toBe(true);
    });
    it('refuses expired, revoked, malformed, weak-password, existing-account and inactive-organization enrollments', async () => {
        const expired = await admin().invite(adminA, { email: 'expired@a.m5.invalid', role: 'Finance' });
        if (expired.status !== 'INVITED') throw new Error();
        await pg.query("UPDATE fingence_m5.invitations SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1", [expired.invitation.id]);
        expect(await admin().enroll({ code: expired.code, email: 'expired@a.m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        const revoked = await admin().invite(adminA, { email: 'revoked@a.m5.invalid', role: 'Finance' });
        if (revoked.status !== 'INVITED') throw new Error();
        expect(await admin().revokeInvitation(adminA, revoked.invitation.id)).toEqual({ status: 'REVOKED' });
        expect(await admin().enroll({ code: revoked.code, email: 'revoked@a.m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        const weak = await admin().invite(adminA, { email: 'weak@a.m5.invalid', role: 'Finance' });
        if (weak.status !== 'INVITED') throw new Error();
        expect(await admin().enroll({ code: weak.code, email: 'weak@a.m5.invalid', password: 'short' })).toEqual({ status: 'REFUSED', code: 'PASSWORD_POLICY' });
        expect((await pg.query("SELECT state FROM fingence_m5.invitations WHERE id=$1", [weak.invitation.id])).rows[0]).toEqual({ state: 'PENDING' });
        expect(await admin().enroll({ code: 'not a code', email: 'weak@a.m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        // Organization B may invite an address already registered elsewhere without learning that it exists.
        const elsewhere = await admin().invite(adminB, { email: 'finance@a.m5.invalid', role: 'Finance' });
        expect(elsewhere.status).toBe('INVITED');
        if (elsewhere.status !== 'INVITED') throw new Error();
        expect(await admin().enroll({ code: elsewhere.code, email: 'finance@a.m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        expect(await admin().invite(adminA, { email: 'finance@a.m5.invalid', role: 'Admin' })).toEqual({ status: 'REFUSED', code: 'ALREADY_MEMBER' });
        expect((await pg.query('SELECT count(*)::int AS n FROM fingence_m2.users WHERE email IN ($1,$2,$3)', ['expired@a.m5.invalid', 'revoked@a.m5.invalid', 'weak@a.m5.invalid'])).rows[0]).toEqual({ n: 0 });
    });
    it('a newer invitation supersedes the earlier pending code for the same address', async () => {
        const first = await admin().invite(adminA, { email: 'twice@a.m5.invalid', role: 'Finance' }), second = await admin().invite(adminA, { email: 'twice@a.m5.invalid', role: 'Technical (Management)' });
        if (first.status !== 'INVITED' || second.status !== 'INVITED') throw new Error();
        expect(await admin().enroll({ code: first.code, email: 'twice@a.m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        expect(await admin().enroll({ code: second.code, email: 'twice@a.m5.invalid', password })).toEqual({ status: 'ENROLLED', membershipActive: false });
    });
});

describe('role-scoped administration', () => {
    it('denies Finance and records the durable denial without exposing members', async () => {
        const before = (await audits('authorization.denied', orgA)).length;
        expect(await admin().overview(financeToken)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await admin().auditLog(financeToken)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await admin().invite(financeToken, { email: 'escalate@a.m5.invalid', role: 'Admin' })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await admin().changeMembership(financeToken, { userId: finance.userId, role: 'Admin', active: true, expectedVersion: (await membership(finance.userId)).version })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await admin().setAccountActive(financeToken, { userId: adminAUser, active: false })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const denied = await audits('authorization.denied', orgA);
        expect(denied.length).toBe(before + 5);
        expect(denied.slice(-5).every(row => row.actor_id === finance.userId && row.outcome === 'denied')).toBe(true);
        expect((await membership(finance.userId)).role).toBe('Finance');
        expect((await pg.query("SELECT 1 FROM fingence_m5.invitations WHERE email='escalate@a.m5.invalid'")).rows).toHaveLength(0);
    });
    it('gives Technical (Management) processing counts only', async () => {
        const view = await admin().overview(techToken);
        expect(view).toMatchObject({ status: 'OK', view: 'OPERATIONAL', members: null, invitations: null, financialAccess: false });
        if (view.status !== 'OK') throw new Error();
        expect(view.jobs.some(job => job.state === 'COMPLETED' && job.count >= 1)).toBe(true);
        expect(JSON.stringify(view)).not.toContain('@');
        expect(await admin().auditLog(techToken)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await admin().revokeSessions(techToken, finance.userId)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
    });
    it('lists only its own organization for Admin, without tokens, hashes or codes', async () => {
        const view = await admin().overview(adminA);
        if (view.status !== 'OK' || !view.members || !view.invitations) throw new Error();
        expect(view.view).toBe('ADMIN');
        expect(view.members.map(m => m.email)).toContain('finance@a.m5.invalid');
        expect(view.members.map(m => m.email)).not.toContain('admin@b.m5.invalid');
        expect(view.members.find(m => m.email === 'finance@a.m5.invalid')).toMatchObject({ role: 'Finance', active: true, accountActive: true, activeSessions: 1 });
        expect(JSON.stringify(view)).not.toMatch(/token|hash|code/i);
        expect(view.invitations.every(i => !('token_hash' in i))).toBe(true);
    });
    it('isolates tenants: another Admin cannot learn of, change, revoke or suspend users and invitations', async () => {
        const invitation = await admin().invite(adminA, { email: 'confidential@a.m5.invalid', role: 'Finance' });
        if (invitation.status !== 'INVITED') throw new Error();
        const before = await membership(finance.userId), unknown = '00000000-0000-4000-8000-000000000000';
        for (const target of [finance.userId, unknown]) {
            expect(await admin().changeMembership(adminB, { userId: target, role: 'Admin', active: true, expectedVersion: before.version })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
            expect(await admin().revokeSessions(adminB, target)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
            expect(await admin().setAccountActive(adminB, { userId: target, active: false })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        }
        expect(await admin().revokeInvitation(adminB, invitation.invitation.id)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await admin().revokeInvitation(adminB, '00000000-0000-4000-8000-000000000001')).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await membership(finance.userId)).toEqual(before);
        expect((await identity().session(financeToken)).role).toBe('Finance');
        const log = await admin().auditLog(adminB);
        if (log.status !== 'OK') throw new Error();
        // Only addresses B itself typed may appear; A's members never resolve in B's log.
        for (const address of ['admin@a.m5.invalid', 'tech@a.m5.invalid', 'confidential@a.m5.invalid'])
            expect(JSON.stringify(log)).not.toContain(address);
        expect(log.events.filter(e => e.targetId === finance.userId).every(e => e.targetEmail === null)).toBe(true);
        // B's own denial records echo only identifiers B supplied; a real and a nonexistent target look identical.
        const shape = (id: string) => log.events.filter(e => e.targetId === id).map(({ action, outcome, targetEmail }) => ({ action, outcome, targetEmail }));
        expect(shape(finance.userId)).toEqual(shape(unknown));
        expect((await audits('authorization.denied', orgB)).length).toBeGreaterThanOrEqual(8);
    });
});

describe('membership, session and account lifecycle', () => {
    it('a role change bumps the version, revokes sessions and removes financial access immediately', async () => {
        expect((await createFinancialConsumers(db).snapshot(financeToken, batch, 'exclude')).analytics[0].sourceSignedTotal).toBe('105.5');
        const { version } = await membership(finance.userId);
        expect(await admin().changeMembership(adminA, { userId: finance.userId, role: 'Technical (Management)', active: true, expectedVersion: version })).toEqual({ status: 'UPDATED', sessionsRevoked: true });
        expect(await membership(finance.userId)).toEqual({ role: 'Technical (Management)', active: true, version: version + 1 });
        await expect(createFinancialConsumers(db).snapshot(financeToken, batch, 'exclude')).rejects.toThrow();
        expect(await admin().changeMembership(adminA, { userId: finance.userId, role: 'Finance', active: true, expectedVersion: version })).toEqual({ status: 'REFUSED', code: 'STALE_MEMBERSHIP' });
        expect((await audits('authorization.role_changed', orgA)).at(-1)).toMatchObject({ outcome: 'failure', target_id: finance.userId });
        await admin().changeMembership(adminA, { userId: finance.userId, role: 'Finance', active: true, expectedVersion: version + 1 });
        financeToken = (await identity().login('finance@a.m5.invalid', password)).token;
        expect((await createFinancialConsumers(db).snapshot(financeToken, batch, 'exclude')).analytics[0].sourceSignedTotal).toBe('105.5');
    });
    it('revokes sessions without changing the membership', async () => {
        const before = await membership(tech.userId);
        expect(await admin().revokeSessions(adminA, tech.userId)).toEqual({ status: 'UPDATED', sessionsRevoked: true });
        await expect(identity().session(techToken)).rejects.toThrow();
        expect(await membership(tech.userId)).toEqual(before);
        expect((await audits('session.revoked', orgA)).at(-1)).toMatchObject({ actor_id: adminAUser, target_id: tech.userId, outcome: 'success' });
        techToken = (await identity().login('tech@a.m5.invalid', password)).token;
    });
    it('account suspension invalidates sessions on every existing route and blocks new sign-in, separately from membership', async () => {
        const consumers = createFinancialConsumers(db);
        expect(await admin().setAccountActive(adminA, { userId: finance.userId, active: false })).toEqual({ status: 'UPDATED', sessionsRevoked: true });
        await expect(consumers.list(financeToken)).rejects.toThrow();
        await expect(consumers.snapshot(financeToken, batch, 'exclude')).rejects.toThrow();
        await expect(createM2Pipeline(db).list(financeToken)).rejects.toThrow();
        await expect(identity().session(financeToken)).rejects.toThrow();
        await expect(createManagementService(db).overview(techToken)).resolves.toMatchObject({ financialAccess: false });
        const failed = (await audits('auth.sign_in_failed', orgA)).length;
        await expect(identity().login('finance@a.m5.invalid', password)).rejects.toThrow('ACCESS_DENIED');
        expect((await audits('auth.sign_in_failed', orgA)).length).toBe(failed + 1);
        expect(await membership(finance.userId)).toMatchObject({ role: 'Finance', active: true });
        const view = await admin().overview(adminA);
        if (view.status !== 'OK' || !view.members) throw new Error();
        expect(view.members.find(m => m.userId === finance.userId)).toMatchObject({ active: true, accountActive: false, activeSessions: 0 });
        expect(await admin().setAccountActive(adminA, { userId: finance.userId, active: false })).toEqual({ status: 'REFUSED', code: 'STALE_ACCOUNT' });
        expect(await admin().setAccountActive(adminA, { userId: finance.userId, active: true })).toEqual({ status: 'UPDATED', sessionsRevoked: false });
        await expect(consumers.list(financeToken)).rejects.toThrow();
        financeToken = (await identity().login('finance@a.m5.invalid', password)).token;
        expect((await consumers.list(financeToken)).length).toBeGreaterThan(0);
        expect((await audits('account.deactivated', orgA)).map(row => row.outcome)).toEqual(['success', 'failure']);
        expect((await audits('account.reactivated', orgA)).map(row => row.outcome)).toEqual(['success']);
    });
    it('protects the last Admin who can still sign in across demotion, deactivation and suspension', async () => {
        const fresh = await m5Database(), local = createTenantAdministration(fresh.db), id = createM2Identity(fresh.db);
        const org = await bootstrapOrganization(fresh.db, { name: 'Last Admin', adminEmail: 'one@last.m5.invalid' });
        await local.enroll({ code: org.code, email: 'one@last.m5.invalid', password });
        const one = await id.login('one@last.m5.invalid', password), oneId = one.principal.user_id;
        expect(await local.changeMembership(one.token, { userId: oneId, role: 'Finance', active: true, expectedVersion: 1 })).toEqual({ status: 'REFUSED', code: 'LAST_ADMIN_PROTECTED' });
        expect(await local.changeMembership(one.token, { userId: oneId, role: 'Admin', active: false, expectedVersion: 1 })).toEqual({ status: 'REFUSED', code: 'LAST_ADMIN_PROTECTED' });
        expect(await local.setAccountActive(one.token, { userId: oneId, active: false })).toEqual({ status: 'REFUSED', code: 'LAST_ADMIN_PROTECTED' });
        const second = await local.invite(one.token, { email: 'two@last.m5.invalid', role: 'Admin' });
        if (second.status !== 'INVITED') throw new Error();
        await local.enroll({ code: second.code, email: 'two@last.m5.invalid', password });
        const twoId = (await fresh.pg.query<{ id: string }>("SELECT id::text FROM fingence_m2.users WHERE email='two@last.m5.invalid'")).rows[0].id;
        await local.changeMembership(one.token, { userId: twoId, role: 'Admin', active: true, expectedVersion: 1 });
        // A suspended Admin cannot sign in, so it does not count toward the protected minimum.
        expect(await local.setAccountActive(one.token, { userId: twoId, active: false })).toEqual({ status: 'UPDATED', sessionsRevoked: true });
        expect(await local.changeMembership(one.token, { userId: oneId, role: 'Finance', active: true, expectedVersion: 1 })).toEqual({ status: 'REFUSED', code: 'LAST_ADMIN_PROTECTED' });
        await expect(createManagementService(fresh.db).membership(one.token, { userId: oneId, role: 'Finance', active: true, expectedVersion: 1 })).rejects.toThrow('LAST_ADMIN_PROTECTED');
        await local.setAccountActive(one.token, { userId: twoId, active: true });
        expect(await local.changeMembership(one.token, { userId: oneId, role: 'Finance', active: true, expectedVersion: 1 })).toEqual({ status: 'UPDATED', sessionsRevoked: true });
        await expect(id.session(one.token)).rejects.toThrow();
        await fresh.pg.close();
    });
    it('treats accounts with memberships elsewhere as unavailable rather than revealing them', async () => {
        const shared = await enrolled(adminA, 'shared@a.m5.invalid', 'Finance');
        await pg.query("INSERT INTO fingence_m2.memberships(user_id,organization_id,role,active) VALUES ($1,$2,'Finance',false)", [shared.userId, orgB]);
        expect(await admin().setAccountActive(adminA, { userId: shared.userId, active: false })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect((await pg.query('SELECT 1 FROM fingence_m5.account_suspensions WHERE user_id=$1', [shared.userId])).rows).toHaveLength(0);
    });
    it('commits no mutation when its durable audit fails, and never reports a denial whose audit failed', async () => {
        const broken = createTenantAdministration(failingAudit(db)), before = await membership(tech.userId);
        await expect(broken.invite(adminA, { email: 'audit@a.m5.invalid', role: 'Finance' })).rejects.toThrow();
        expect((await pg.query("SELECT 1 FROM fingence_m5.invitations WHERE email='audit@a.m5.invalid'")).rows).toHaveLength(0);
        await expect(broken.changeMembership(adminA, { userId: tech.userId, role: 'Admin', active: true, expectedVersion: before.version })).rejects.toThrow();
        await expect(broken.revokeSessions(adminA, tech.userId)).rejects.toThrow();
        await expect(broken.setAccountActive(adminA, { userId: tech.userId, active: false })).rejects.toThrow();
        expect(await membership(tech.userId)).toEqual(before);
        expect((await identity().session(techToken)).role).toBe('Technical (Management)');
        expect((await pg.query('SELECT 1 FROM fingence_m5.account_suspensions WHERE user_id=$1', [tech.userId])).rows).toHaveLength(0);
        const pending = await admin().invite(adminA, { email: 'audit@a.m5.invalid', role: 'Finance' });
        if (pending.status !== 'INVITED') throw new Error();
        await expect(broken.revokeInvitation(adminA, pending.invitation.id)).rejects.toThrow();
        await expect(broken.enroll({ code: pending.code, email: 'audit@a.m5.invalid', password })).rejects.toThrow();
        expect((await pg.query('SELECT state FROM fingence_m5.invitations WHERE id=$1', [pending.invitation.id])).rows[0]).toEqual({ state: 'PENDING' });
        expect((await pg.query("SELECT 1 FROM fingence_m2.users WHERE email='audit@a.m5.invalid'")).rows).toHaveLength(0);
        await expect(broken.overview(financeToken)).rejects.toThrow();
        await expect(createM2Identity(failingAudit(db)).login('finance@a.m5.invalid', password)).rejects.toThrow();
    });
    it('shows the Admin its organization audit trail with typed actions', async () => {
        const log = await admin().auditLog(adminA);
        if (log.status !== 'OK') throw new Error();
        const actions = new Set(log.events.map(e => e.action));
        for (const action of ['membership.invited', 'membership.enrolled', 'membership.activated', 'authorization.role_changed', 'session.revoked', 'account.deactivated', 'account.reactivated', 'authorization.denied'])
            expect(actions).toContain(action);
        expect(log.events.find(e => e.action === 'membership.activated' && e.targetId === finance.userId)).toMatchObject({ actorEmail: 'admin@a.m5.invalid', targetEmail: 'finance@a.m5.invalid', outcome: 'success' });
        expect(log.events.length).toBeLessThanOrEqual(100);
        expect((await audits('security_logs.read', orgA)).length).toBeGreaterThan(0);
    });
});

describe('OS-owner organization lifecycle and recovery', () => {
    it('deactivation revokes sessions and pending codes; reactivation restores nothing; recovery needs explicit confirmation and no remaining Admin', async () => {
        const fresh = await m5Database(), local = createTenantAdministration(fresh.db), id = createM2Identity(fresh.db);
        const org = await bootstrapOrganization(fresh.db, { name: 'Lifecycle', adminEmail: 'owner@life.m5.invalid' });
        await local.enroll({ code: org.code, email: 'owner@life.m5.invalid', password });
        const owner = await id.login('owner@life.m5.invalid', password);
        const pending = await local.invite(owner.token, { email: 'later@life.m5.invalid', role: 'Finance' });
        if (pending.status !== 'INVITED') throw new Error();
        await expect(issueRecoveryAdmin(fresh.db, { organizationId: org.organizationId, adminEmail: 'spare@life.m5.invalid', confirmation: org.organizationId })).rejects.toThrow('ACTIVE_ADMIN_PRESENT');
        await setOrganizationActive(fresh.db, org.organizationId, false);
        await expect(id.session(owner.token)).rejects.toThrow();
        await setOrganizationActive(fresh.db, org.organizationId, true);
        expect(await local.enroll({ code: pending.code, email: 'later@life.m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        await expect(id.login('owner@life.m5.invalid', password)).rejects.toThrow();
        await expect(issueRecoveryAdmin(fresh.db, { organizationId: org.organizationId, adminEmail: 'spare@life.m5.invalid', confirmation: 'yes' })).rejects.toThrow('RECOVERY_CONFIRMATION_REQUIRED');
        const recovery = await issueRecoveryAdmin(fresh.db, { organizationId: org.organizationId, adminEmail: 'spare@life.m5.invalid', confirmation: org.organizationId });
        expect(await local.enroll({ code: recovery.code, email: 'spare@life.m5.invalid', password })).toEqual({ status: 'ENROLLED', membershipActive: true });
        const spare = await id.login('spare@life.m5.invalid', password);
        expect(spare.principal.role).toBe('Admin');
        expect((await fresh.pg.query("SELECT issuer FROM fingence_m5.invitations WHERE id=$1", [recovery.invitationId])).rows[0]).toEqual({ issuer: 'OS_RECOVERY' });
        await fresh.pg.close();
    });
});
