import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { transactionDatabase, type QueryResult, type TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity } from '../../lib/server/ai-ingestion/m2/identity';
import { createM2Pipeline, installM2Schema } from '../../lib/server/ai-ingestion/m2/pipeline';
import { createFinancialConsumers } from '../../lib/server/financial-m3/consumers';
import { createManagementService, installM3Schema } from '../../lib/server/financial-m3/management';
import { installM5Schema } from '../../lib/server/tenant-admin-m5/schema';
import { bootstrapOrganization, createTenantAdministration, setOrganizationActive } from '../../lib/server/tenant-admin-m5/service';

const bin = process.env.FINGENCE_TEST_PG_BIN ?? '/opt/homebrew/opt/postgresql@18/bin', exe = (name: string) => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
describe.skipIf(!existsSync(exe('initdb')) || !existsSync(exe('pg_ctl')))('M5 native account administration concurrency', () => {
    let folder: string, pool: Pool, db: TransactionDatabase, started = false;
    let org: string, admin1: string, admin1Id: string, admin2: string, admin2Id: string, finance: string, financeId: string, batch: string, otherAdmin: string;
    const password = 'Synthetic-native-M5-password', control = (...args: string[]) => execFileSync(exe('pg_ctl'), ['-D', folder, ...args], { timeout: 30000, stdio: 'ignore' });
    const service = () => createTenantAdministration(db), identity = () => createM2Identity(db);
    const login = async (email: string) => (await identity().login(email, password)).token;
    const version = async (userId: string) => (await pool.query<{ version: number }>('SELECT version FROM fingence_m2.memberships WHERE user_id=$1', [userId])).rows[0].version;
    const deadlocks = () => readFileSync(join(folder, 'log'), 'utf8').includes('deadlock detected');
    /** Pauses the first transaction statement containing `fragment` after it has acquired its locks. */
    function paused(fragment: string) {
        let hit!: () => void, resume!: () => void, held = false;
        const reached = new Promise<void>(r => hit = r), release = new Promise<void>(r => resume = r);
        const database: TransactionDatabase = { close: async () => { }, transaction: (work, options) => db.transaction(tx => work({ async query<Row extends Record<string, unknown>>(sql: string, v?: unknown[]): Promise<QueryResult<Row>> { const result = await tx.query<Row>(sql, v); if (!held && sql.includes(fragment)) {
                    held = true;
                    hit();
                    await release;
                } return result; } }), options) };
        return { database, resume, reached: Promise.race([reached, new Promise<never>((_, reject) => setTimeout(() => reject(Error('native latch timeout')), 5000))]) };
    }
    /** Observe actual server lock waiting rather than inferring concurrency from timers. */
    async function lockWaiting() {
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
            if ((await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND datname=current_database()")).rows.length)
                return true;
            await new Promise(r => setTimeout(r, 15));
        }
        return false;
    }
    async function enrolledMember(adminToken: string, email: string, role: 'Finance' | 'Admin') {
        const invite = await service().invite(adminToken, { email, role });
        if (invite.status !== 'INVITED') throw new Error(invite.code);
        await service().enroll({ code: invite.code, email, password });
        const userId = (await pool.query<{ id: string }>('SELECT id::text FROM fingence_m2.users WHERE email=$1', [email])).rows[0].id;
        await service().changeMembership(adminToken, { userId, role, active: true, expectedVersion: 1 });
        return userId;
    }
    beforeAll(async () => {
        folder = mkdtempSync(join(tmpdir(), 'fingence-m5-native-'));
        execFileSync(exe('initdb'), ['-D', folder, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], { timeout: 30000, stdio: 'ignore' });
        const listener = createServer();
        await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
        const port = (listener.address() as { port: number }).port;
        await new Promise<void>(r => listener.close(() => r()));
        control('-l', join(folder, 'log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start');
        started = true;
        pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 8, statement_timeout: 8000, connectionTimeoutMillis: 3000 });
        db = transactionDatabase(pool);
        await pool.query('CREATE ROLE anon;CREATE ROLE authenticated;');
        await pool.query(readFileSync('supabase/sql/v2-verified-document-local.sql', 'utf8'));
        await installM2Schema(db);
        await installM3Schema(db);
        await installM5Schema(db);
        const a = await bootstrapOrganization(db, { name: 'M5 native', adminEmail: 'admin1@native-m5.invalid' });
        org = a.organizationId;
        await service().enroll({ code: a.code, email: 'admin1@native-m5.invalid', password });
        admin1 = await login('admin1@native-m5.invalid');
        admin1Id = (await identity().session(admin1)).userId;
        admin2Id = await enrolledMember(admin1, 'admin2@native-m5.invalid', 'Admin');
        admin2 = await login('admin2@native-m5.invalid');
        financeId = await enrolledMember(admin1, 'finance@native-m5.invalid', 'Finance');
        finance = await login('finance@native-m5.invalid');
        batch = (await createM2Pipeline(db).reserve(finance)).id;
        await createM2Pipeline(db).process(finance, batch, readFileSync('synthetic/m2/verified-mixed.csv'), 'synthetic.csv');
        const b = await bootstrapOrganization(db, { name: 'M5 native other', adminEmail: 'admin@other-m5.invalid' });
        await service().enroll({ code: b.code, email: 'admin@other-m5.invalid', password });
        otherAdmin = await login('admin@other-m5.invalid');
    }, 90000);
    afterAll(async () => { await pool?.end(); if (started)
        control('-m', 'fast', '-w', 'stop'); if (folder?.startsWith(join(tmpdir(), 'fingence-m5-native-')))
        rmSync(folder, { recursive: true }); }, 30000);

    it('returns typed refusals on native PostgreSQL instead of masking them as persistence failures', async () => {
        expect(await service().changeMembership(otherAdmin, { userId: financeId, role: 'Admin', active: true, expectedVersion: await version(financeId) })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await service().changeMembership(admin1, { userId: financeId, role: 'Finance', active: true, expectedVersion: 99 })).toEqual({ status: 'REFUSED', code: 'STALE_MEMBERSHIP' });
        expect(await service().overview(finance)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await service().enroll({ code: 'A'.repeat(43), email: 'nobody@native-m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        expect((await pool.query("SELECT count(*)::int AS n FROM public.security_audit_events WHERE action='authorization.denied' AND outcome='denied'")).rows[0].n).toBeGreaterThanOrEqual(2);
    });

    it.each(['M5 administration', 'M3 legacy management'] as const)('%s locks target sessions before membership, so a concurrent financial read waits instead of deadlocking', async (kind) => {
        const latch = paused('FROM fingence_m2.sessions WHERE user_id=$1 AND organization_id=$2 FOR UPDATE');
        const expectedVersion = await version(financeId);
        const change = kind === 'M5 administration'
            ? createTenantAdministration(latch.database).changeMembership(admin1, { userId: financeId, role: 'Finance', active: true, expectedVersion })
            : createManagementService(latch.database).membership(admin1, { userId: financeId, role: 'Finance', active: true, expectedVersion });
        let read: Promise<unknown> | undefined;
        try {
            await latch.reached;
            read = createFinancialConsumers(db).snapshot(finance, batch, 'exclude');
            expect(await lockWaiting()).toBe(true);
            latch.resume();
            expect(await change).toMatchObject({ status: 'UPDATED', sessionsRevoked: true });
            await expect(read).rejects.toThrow();
            expect(deadlocks()).toBe(false);
        }
        finally {
            latch.resume();
            await Promise.allSettled([change, ...(read ? [read] : [])]);
            finance = await login('finance@native-m5.invalid');
        }
        expect((await createFinancialConsumers(db).snapshot(finance, batch, 'exclude')).analytics[0].sourceSignedTotal).toBe('105.5');
    });

    it('account suspension waits for an in-flight audited financial read, then denies the next read and sign-in', async () => {
        const latch = paused('SELECT batch FROM fingence_v2_local.attempts');
        const read = createFinancialConsumers(latch.database).snapshot(finance, batch, 'exclude');
        let suspension: Promise<unknown> | undefined;
        try {
            await latch.reached;
            suspension = service().setAccountActive(admin1, { userId: financeId, active: false });
            expect(await lockWaiting()).toBe(true);
            latch.resume();
            expect((await read).analytics[0].sourceSignedTotal).toBe('105.5');
            expect(await suspension).toEqual({ status: 'UPDATED', sessionsRevoked: true });
            await expect(createFinancialConsumers(db).snapshot(finance, batch, 'exclude')).rejects.toThrow();
            await expect(createM2Pipeline(db).list(finance)).rejects.toThrow();
            await expect(login('finance@native-m5.invalid')).rejects.toThrow();
        }
        finally {
            latch.resume();
            await Promise.allSettled([read, ...(suspension ? [suspension] : [])]);
        }
        expect(await service().setAccountActive(admin1, { userId: financeId, active: true })).toEqual({ status: 'UPDATED', sessionsRevoked: false });
        finance = await login('finance@native-m5.invalid');
    });

    it('a sign-in racing account suspension never leaves a live session', async () => {
        const latch = paused('WHERE user_id=$1 AND active FOR SHARE');
        const signIn = createM2Identity(latch.database).login('finance@native-m5.invalid', password);
        let suspension: Promise<unknown> | undefined;
        try {
            await latch.reached;
            suspension = service().setAccountActive(admin1, { userId: financeId, active: false });
            expect(await lockWaiting()).toBe(true);
            latch.resume();
            const raced = await signIn;
            expect(await suspension).toMatchObject({ status: 'UPDATED' });
            await expect(identity().session(raced.token)).rejects.toThrow();
            expect((await pool.query('SELECT count(*)::int AS n FROM fingence_m2.sessions WHERE user_id=$1 AND NOT revoked AND expires_at>clock_timestamp()', [financeId])).rows[0].n).toBe(0);
            expect(deadlocks()).toBe(false);
        }
        finally {
            latch.resume();
            await Promise.allSettled([signIn, ...(suspension ? [suspension] : [])]);
        }
        await service().setAccountActive(admin1, { userId: financeId, active: true });
        finance = await login('finance@native-m5.invalid');
    });

    it('redeems one enrollment code exactly once under concurrency', async () => {
        const invite = await service().invite(admin1, { email: 'once@native-m5.invalid', role: 'Finance' });
        if (invite.status !== 'INVITED') throw new Error();
        const results = await Promise.all([1, 2, 3, 4].map(() => service().enroll({ code: invite.code, email: 'once@native-m5.invalid', password })));
        expect(results.filter(r => r.status === 'ENROLLED')).toHaveLength(1);
        expect(results.filter(r => r.status === 'REFUSED' && r.code === 'INVITATION_UNAVAILABLE')).toHaveLength(3);
        expect((await pool.query("SELECT count(*)::int AS n FROM fingence_m2.users WHERE email='once@native-m5.invalid'")).rows[0].n).toBe(1);
    });

    it('concurrent Admin suspension and Admin demotion keep exactly one Admin who can sign in', async () => {
        const latch = paused('pg_advisory_xact_lock(hashtextextended($1,0))');
        const suspension = createTenantAdministration(latch.database).setAccountActive(admin1, { userId: admin2Id, active: false });
        let demotion: Promise<unknown> | undefined;
        try {
            await latch.reached;
            demotion = service().changeMembership(admin2, { userId: admin1Id, role: 'Finance', active: true, expectedVersion: await version(admin1Id) });
            expect(await lockWaiting()).toBe(true);
            latch.resume();
            expect(await suspension).toEqual({ status: 'UPDATED', sessionsRevoked: true });
            // The demoting Admin's session was revoked while it waited; it is re-resolved after the lock.
            await expect(demotion).rejects.toThrow();
        }
        finally {
            latch.resume();
            await Promise.allSettled([suspension, ...(demotion ? [demotion] : [])]);
        }
        const signable = (await pool.query("SELECT m.user_id::text FROM fingence_m2.memberships m WHERE m.organization_id=$1 AND m.active AND m.role='Admin' AND NOT EXISTS (SELECT 1 FROM fingence_m5.account_suspensions a WHERE a.user_id=m.user_id)", [org])).rows;
        expect(signable).toEqual([{ user_id: admin1Id }]);
        expect(await service().setAccountActive(admin1, { userId: admin2Id, active: true })).toMatchObject({ status: 'UPDATED' });
        admin2 = await login('admin2@native-m5.invalid');
    });

    it('a self-demotion does not deadlock with the same Admin signing out', async () => {
        const latch = paused('FROM fingence_m2.sessions s JOIN fingence_m2.memberships m');
        const signOut = createM2Identity(latch.database).logout(admin2);
        let demotion: Promise<unknown> | undefined;
        try {
            await latch.reached;
            demotion = service().changeMembership(admin2, { userId: admin2Id, role: 'Finance', active: true, expectedVersion: await version(admin2Id) });
            expect(await lockWaiting()).toBe(true);
            latch.resume();
            await signOut;
            await expect(demotion).rejects.toThrow();
            expect(deadlocks()).toBe(false);
            expect((await pool.query('SELECT role FROM fingence_m2.memberships WHERE user_id=$1', [admin2Id])).rows[0]).toEqual({ role: 'Admin' });
        }
        finally {
            latch.resume();
            await Promise.allSettled([signOut, ...(demotion ? [demotion] : [])]);
        }
        admin2 = await login('admin2@native-m5.invalid');
    });

    it('enrollment racing organization deactivation never leaves a usable membership', async () => {
        const z = await bootstrapOrganization(db, { name: 'M5 native race', adminEmail: 'race@native-m5.invalid' });
        const latch = paused('pg_advisory_xact_lock(hashtextextended($1,0))');
        const enrollment = createTenantAdministration(latch.database).enroll({ code: z.code, email: 'race@native-m5.invalid', password });
        let deactivation: Promise<unknown> | undefined;
        try {
            await latch.reached;
            deactivation = setOrganizationActive(db, z.organizationId, false);
            expect(await lockWaiting()).toBe(true);
            latch.resume();
            expect(await enrollment).toEqual({ status: 'ENROLLED', membershipActive: true });
            await deactivation;
        }
        finally {
            latch.resume();
            await Promise.allSettled([enrollment, ...(deactivation ? [deactivation] : [])]);
        }
        expect((await pool.query('SELECT active FROM fingence_m2.memberships WHERE organization_id=$1', [z.organizationId])).rows).toEqual([{ active: false }]);
        await expect(login('race@native-m5.invalid')).rejects.toThrow();
        const late = await bootstrapOrganization(db, { name: 'M5 native late', adminEmail: 'late@native-m5.invalid' });
        await setOrganizationActive(db, late.organizationId, false);
        expect(await service().enroll({ code: late.code, email: 'late@native-m5.invalid', password })).toEqual({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        expect((await pool.query("SELECT state FROM fingence_m5.invitations WHERE id=$1", [late.invitationId])).rows[0]).toEqual({ state: 'REVOKED' });
    });

    it('commits no Admin mutation when the native audit transaction aborts', async () => {
        const before = (await pool.query('SELECT role,active,version FROM fingence_m2.memberships WHERE user_id=$1', [financeId])).rows[0];
        const broken: TransactionDatabase = { close: async () => { }, transaction: work => db.transaction(tx => work({ query: async (sql, v) => { if (sql.includes('INSERT INTO public.security_audit_events'))
                    await tx.query('SELECT 1/0'); return tx.query(sql, v); } })) };
        await expect(createTenantAdministration(broken).changeMembership(admin1, { userId: financeId, role: 'Admin', active: true, expectedVersion: before.version })).rejects.toThrow();
        await expect(createTenantAdministration(broken).setAccountActive(admin1, { userId: financeId, active: false })).rejects.toThrow();
        expect((await pool.query('SELECT role,active,version FROM fingence_m2.memberships WHERE user_id=$1', [financeId])).rows[0]).toEqual(before);
        expect((await pool.query('SELECT 1 FROM fingence_m5.account_suspensions WHERE user_id=$1', [financeId])).rows).toHaveLength(0);
        expect((await identity().session(finance)).role).toBe('Finance');
    });

    it('denies direct anon/authenticated access to the M5 schema', async () => {
        const client = await pool.connect();
        try {
            for (const role of ['anon', 'authenticated']) {
                await client.query('BEGIN');
                await client.query('SET LOCAL ROLE ' + role);
                await expect(client.query('SELECT * FROM fingence_m5.invitations')).rejects.toMatchObject({ code: '42501' });
                await client.query('ROLLBACK');
            }
        }
        finally {
            client.release();
        }
    });
});
