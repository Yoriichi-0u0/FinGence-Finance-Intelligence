import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { transactionDatabase, type TransactionDatabase, type QueryResult } from '../../lib/server/db/postgres';
import { createM2Identity, tokenHash } from '../../lib/server/ai-ingestion/m2/identity';
import { createM2Pipeline, installM2Schema } from '../../lib/server/ai-ingestion/m2/pipeline';
import { createFinancialConsumers } from '../../lib/server/financial-m3/consumers';
import { installM3Schema, provisionM3Account, createManagementService, setLocalOrganizationActive } from '../../lib/server/financial-m3/management';
const bin = process.env.FINGENCE_TEST_PG_BIN ?? '/opt/homebrew/opt/postgresql@18/bin', exe = (name: string) => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
describe.skipIf(!existsSync(exe('initdb')) || !existsSync(exe('pg_ctl')))('M3 native selected-data and membership fencing', () => {
    let folder: string, pool: Pool, db: TransactionDatabase, started = false, port: number, token: string, admin: string, user: string, org: string, id: string;
    const password = 'Synthetic-native-M3-password', control = (...args: string[]) => execFileSync(exe('pg_ctl'), ['-D', folder, ...args], { timeout: 30000, stdio: 'ignore' });
    beforeAll(async () => {
        folder = mkdtempSync(join(tmpdir(), 'fingence-m3-native-'));
        execFileSync(exe('initdb'), ['-D', folder, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], { timeout: 30000, stdio: 'ignore' });
        const listener = createServer();
        await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
        port = (listener.address() as {
            port: number;
        }).port;
        await new Promise<void>(r => listener.close(() => r()));
        control('-l', join(folder, 'log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start');
        started = true;
        pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 6, statement_timeout: 8000, connectionTimeoutMillis: 3000 });
        db = transactionDatabase(pool);
        await pool.query('CREATE ROLE anon;CREATE ROLE authenticated;');
        await pool.query(readFileSync('supabase/sql/v2-verified-document-local.sql', 'utf8'));
        await installM2Schema(db);
        await installM3Schema(db);
        const owner = await provisionM3Account(db, { email: 'admin@native-m3.invalid', password, organizationName: 'M3 native', role: 'Admin' });
        org = owner.organizationId;
        const finance = await provisionM3Account(db, { email: 'finance@native-m3.invalid', password, organizationId: org, role: 'Finance' });
        user = finance.userId;
        admin = (await createM2Identity(db).login('admin@native-m3.invalid', password)).token;
        await createManagementService(db).membership(admin, { userId: user, role: 'Finance', active: true, expectedVersion: 1 });
        token = (await createM2Identity(db).login('finance@native-m3.invalid', password)).token;
        id = (await createM2Pipeline(db).reserve(token)).id;
        await createM2Pipeline(db).process(token, id, readFileSync('synthetic/m2/verified-mixed.csv'), 'synthetic.csv');
    }, 60000);
    afterAll(async () => { await pool?.end(); if (started)
        control('-m', 'fast', '-w', 'stop'); if (folder?.startsWith(join(tmpdir(), 'fingence-m3-native-')))
        rmSync(folder, { recursive: true }); }, 30000);
    it.each(['session', 'membership', 'ownership', 'organization'] as const)('holds a transaction-consistent source snapshot against concurrent %s revocation', async (kind) => {
        let hit!: () => void, resume!: () => void, held = false;
        const reached = new Promise<void>(r => hit = r), release = new Promise<void>(r => resume = r);
        const paused: TransactionDatabase = { close: async () => { }, transaction: work => db.transaction(tx => work({ async query<Row extends Record<string, unknown>>(sql: string, v?: unknown[]): Promise<QueryResult<Row>> { const result = await tx.query<Row>(sql, v); if (!held && sql.includes('SELECT batch FROM fingence_v2_local.attempts')) {
                    held = true;
                    hit();
                    await release;
                } return result; } })) };
        const read = createFinancialConsumers(paused).snapshot(token, id, 'exclude');
        let change: Promise<unknown> | undefined;
        const client = await pool.connect();
        try {
            await Promise.race([reached, new Promise<never>((_, reject) => setTimeout(() => reject(Error('native read latch timeout')), 4000))]);
            const pid = (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
            if (kind === 'organization')
                change = setLocalOrganizationActive(db, org, false);
            else {
                const sql = { session: 'UPDATE fingence_m2.sessions SET revoked=true WHERE token_hash=$1', membership: 'UPDATE fingence_m2.memberships SET active=false,version=version+1 WHERE user_id=$1', ownership: 'DELETE FROM fingence_m2.batch_owners WHERE attempt_id=$1' };
                change = client.query(sql[kind], [kind === 'session' ? tokenHash(token) : kind === 'membership' ? user : id]);
            }
            // Observe actual server lock waiting, rather than assuming concurrency from timer ordering.
            let waiting = false;
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
                const locks = await pool.query("SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND datname=current_database()");
                if (locks.rows.some(r => kind === 'organization' || r.pid === pid)) {
                    waiting = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 15));
            }
            expect(waiting).toBe(true);
            resume();
            expect((await read).analytics[0].sourceSignedTotal).toBe('105.5');
            await change;
            await expect(createFinancialConsumers(db).snapshot(token, id, 'exclude')).rejects.toThrow();
        }
        finally {
            resume();
            await Promise.allSettled([read, ...(change ? [change] : [])]);
            client.release();
            await pool.query('UPDATE fingence_m3.organization_states SET active=true');
            await pool.query('UPDATE fingence_m2.memberships SET active=true');
            await pool.query('INSERT INTO fingence_m2.batch_owners VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id, org, user]);
            token = (await createM2Identity(db).login('finance@native-m3.invalid', password)).token;
            admin = (await createM2Identity(db).login('admin@native-m3.invalid', password)).token;
        }
    });
    it('serializes concurrent Admin edits without duplicate version updates or deadlock', async () => {
        const version = (await pool.query('SELECT version FROM fingence_m2.memberships WHERE user_id=$1', [user])).rows[0].version;
        const result = await Promise.allSettled([1, 2].map(() => createManagementService(db).membership(admin, { userId: user, role: 'Finance', active: true, expectedVersion: version })));
        expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
        expect((await pool.query('SELECT version FROM fingence_m2.memberships WHERE user_id=$1', [user])).rows[0].version).toBe(version + 1);
        token = (await createM2Identity(db).login('finance@native-m3.invalid', password)).token;
    });
    it('does not deliver financial data after native audit failure and needs only one pool connection', async () => {
        const single = new Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 1, statement_timeout: 5000, connectionTimeoutMillis: 2000 });
        try {
            expect((await createFinancialConsumers(transactionDatabase(single)).snapshot(token, id, 'exclude')).records).toHaveLength(2);
        }
        finally {
            await single.end();
        }
        const broken: TransactionDatabase = { close: async () => { }, transaction: work => db.transaction(tx => work({ query: async (sql, v) => { if (sql.includes('INSERT INTO public.security_audit_events'))
                    await tx.query('SELECT 1/0'); return tx.query(sql, v); } })) };
        await expect(createFinancialConsumers(broken).export(token, id, 'exclude')).rejects.toThrow();
    });
    it('denies direct anon/authenticated schema access', async () => { const client = await pool.connect(); try {
        for (const role of ['anon', 'authenticated']) {
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE ' + role);
            await expect(client.query('SELECT * FROM fingence_m3.organization_states')).rejects.toMatchObject({ code: '42501' });
            await client.query('ROLLBACK');
        }
    }
    finally {
        client.release();
    } });
});
