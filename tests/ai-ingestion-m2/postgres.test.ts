import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { transactionDatabase, type TransactionDatabase, type QueryResult } from '../../lib/server/db/postgres';
import { createM2Identity, provisionM2Account, tokenHash } from '../../lib/server/ai-ingestion/m2/identity';
import { createM2Pipeline, installM2Schema } from '../../lib/server/ai-ingestion/m2/pipeline';
const bin = process.env.FINGENCE_TEST_PG_BIN ?? '/opt/homebrew/opt/postgresql@18/bin';
const executable = (name: string) => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
describe.skipIf(!existsSync(executable('initdb')) || !existsSync(executable('pg_ctl')))('M2 native PostgreSQL ownership and authorization fencing', () => {
    let folder: string, pool: Pool, database: TransactionDatabase, started = false, token: string, user: string, org: string, id: string, port: number;
    const password = 'Synthetic-native-test-password';
    const control = (...args: string[]) => execFileSync(executable('pg_ctl'), ['-D', folder, ...args], { timeout: 30000, stdio: 'ignore' });
    const connect = () => new Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 4, statement_timeout: 5000, connectionTimeoutMillis: 3000 });
    beforeAll(async () => {
        folder = mkdtempSync(join(tmpdir(), 'fingence-m2-native-'));
        execFileSync(executable('initdb'), ['-D', folder, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], { timeout: 30000, stdio: 'ignore' });
        const server = createServer();
        await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
        port = (server.address() as {
            port: number;
        }).port;
        await new Promise<void>(done => server.close(() => done()));
        control('-l', join(folder, 'log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start');
        started = true;
        pool = connect();
        database = transactionDatabase(pool);
        await pool.query('CREATE ROLE anon;CREATE ROLE authenticated;');
        await pool.query(readFileSync('supabase/sql/v2-verified-document-local.sql', 'utf8'));
        await installM2Schema(database);
        const account = await provisionM2Account(database, { email: 'finance@native.invalid', password, organizationName: 'Synthetic native' });
        user = account.userId;
        org = account.organizationId;
        token = (await createM2Identity(database).login('finance@native.invalid', password)).token;
        const service = createM2Pipeline(database);
        id = (await service.reserve(token)).id;
        await service.process(token, id, readFileSync('synthetic/m2/verified-mixed.csv'), 'uploaded.csv');
    }, 60000);
    afterAll(async () => { await pool?.end(); if (started)
        control('-m', 'fast', '-w', 'stop'); if (folder?.startsWith(join(tmpdir(), 'fingence-m2-native-')))
        rmSync(folder, { recursive: true }); }, 30000);
    it('persists native V2 records, ownership, exact calculation and audit', async () => { expect((await createM2Pipeline(database).get(token, id)).report?.groups[0].total).toBe('105.5'); expect((await pool.query('SELECT attempt_id FROM fingence_m2.batch_owners WHERE attempt_id=$1 AND organization_id=$2', [id, org])).rowCount).toBe(1); });
    it.each(['session', 'membership', 'role', 'ownership'] as const)('fences a concurrent %s change until audited read commits, then denies the next read', async (kind) => {
        let signal!: () => void, resume!: () => void, held = false;
        const reached = new Promise<void>(r => signal = r), release = new Promise<void>(r => resume = r);
        const paused: TransactionDatabase = { close: async () => { }, transaction: work => database.transaction(tx => work({ async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>> { const r = await tx.query<Row>(sql, values); if (!held && sql.includes('SELECT batch FROM fingence_v2_local.attempts')) {
                    held = true;
                    signal();
                    await release;
                } return r; } })) };
        const client = await pool.connect();
        let change: Promise<unknown> | undefined;
        const read = createM2Pipeline(paused).get(token, id);
        try {
            await Promise.race([reached, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('native read latch timeout')), 3000))]);
            const pid = (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
            const queries = { session: ['UPDATE fingence_m2.sessions SET revoked=true WHERE token_hash=$1', tokenHash(token)], membership: ['UPDATE fingence_m2.memberships SET active=false WHERE user_id=$1', user], role: ["UPDATE fingence_m2.memberships SET role='Admin' WHERE user_id=$1", user], ownership: ['DELETE FROM fingence_m2.batch_owners WHERE attempt_id=$1', id] };
            change = client.query(queries[kind][0], [queries[kind][1]]);
            let waiting = false;
            const until = Date.now() + 2000;
            while (Date.now() < until) {
                const r = await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
                if (r.rows[0]?.wait_event_type === 'Lock') {
                    waiting = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 15));
            }
            expect(waiting).toBe(true);
            resume();
            expect((await read).report?.groups[0].total).toBe('105.5');
            await change;
            if (kind === 'ownership')
                expect((await createM2Pipeline(database).get(token, id)).report).toBeNull();
            else
                await expect(createM2Pipeline(database).get(token, id)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
        }
        finally {
            resume();
            await Promise.allSettled([read, ...(change ? [change] : [])]);
            client.release();
            await pool.query('UPDATE fingence_m2.sessions SET revoked=false');
            await pool.query("UPDATE fingence_m2.memberships SET active=true,role='Finance'");
            await pool.query('INSERT INTO fingence_m2.batch_owners VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id, org, user]);
        }
    });
    it('rejects a native audit failure without delivering a report', async () => {
        const broken: TransactionDatabase = { close: async () => { }, transaction: work => database.transaction(tx => work({ query: async (sql, values) => { if (sql.includes('INSERT INTO public.security_audit_events'))
                    await tx.query('SELECT 1/0'); return tx.query(sql, values); } })) };
        await expect(createM2Pipeline(broken).get(token, id)).rejects.toThrow();
    });
    it('retains the account, batch and session revocation across crash recovery', async () => {
        await createM2Identity(database).logout(token);
        await pool.end();
        control('-m', 'immediate', '-w', 'stop');
        started = false;
        control('-l', join(folder, 'log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start');
        started = true;
        pool = connect();
        database = transactionDatabase(pool);
        await expect(createM2Pipeline(database).get(token, id)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
        token = (await createM2Identity(database).login('finance@native.invalid', password)).token;
        expect((await createM2Pipeline(database).get(token, id)).report?.groups[0].total).toBe('105.5');
    });
});
