import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { transactionDatabase, type TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity, provisionM2Account } from '../../lib/server/ai-ingestion/m2/identity';
import { installM2Schema } from '../../lib/server/ai-ingestion/m2/pipeline';
import { installM3Schema } from '../../lib/server/financial-m3/management';
import { createM4Pipeline, installM4Schema, recordedControl } from '../../lib/server/ai-ingestion/m4/adapter';
const bin = process.env.FINGENCE_TEST_PG_BIN ?? '/opt/homebrew/opt/postgresql@18/bin';
describe.skipIf(!existsSync(join(bin, 'initdb')))('M4 native provider-boundary isolation (transport doubles only)', () => {
    let folder: string, pool: Pool, db: TransactionDatabase, started = false, user: string, org: string;
    const password = 'Synthetic-native-M4-password', bytes = readFileSync('synthetic/m2/verified-mixed.csv');
    const control = (...args: string[]) => execFileSync(join(bin, 'pg_ctl'), ['-D', folder, ...args], { timeout: 30000, stdio: 'ignore' });
    beforeAll(async () => { folder = mkdtempSync(join(tmpdir(), 'fingence-m4-native-')); execFileSync(join(bin, 'initdb'), ['-D', folder, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' }); const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const port = (server.address() as {
        port: number;
    }).port; await new Promise<void>(r => server.close(() => r())); control('-l', join(folder, 'log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'); started = true; pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 1, statement_timeout: 5000 }); db = transactionDatabase(pool); await pool.query('CREATE ROLE anon;CREATE ROLE authenticated'); await pool.query(readFileSync('supabase/sql/v2-verified-document-local.sql', 'utf8')); await installM2Schema(db); const a = await provisionM2Account(db, { email: 'native@m4.invalid', password, organizationName: 'Native M4' }); user = a.userId; org = a.organizationId; await installM3Schema(db); await installM4Schema(db); await installM4Schema(db); }, 60000);
    afterAll(async () => { await pool?.end(); if (started)
        control('-m', 'fast', '-w', 'stop'); if (folder?.startsWith(join(tmpdir(), 'fingence-m4-native-')))
        rmSync(folder, { recursive: true }); });
    it.each(['session', 'membership', 'role', 'organization'] as const)('prevents persistence after concurrent %s revocation while provider is pending', async (kind) => { let hit!: () => void, resume!: () => void; const reached = new Promise<void>(r => hit = r), release = new Promise<void>(r => resume = r); const identity = createM2Identity(db), token = (await identity.login('native@m4.invalid', password)).token; const p = createM4Pipeline(db, { origin: 'RECORDED_TEST', control: e => ({ async propose(request) { hit(); await release; return recordedControl(e).propose(request); } }) }), id = (await p.reserve(token)).id, run = p.process(token, id, bytes, 'source.csv'); try {
        await reached;
        if (kind === 'session')
            await identity.logout(token);
        else if(kind==='organization')await pool.query('UPDATE fingence_m3.organization_states SET active=false WHERE organization_id=$1',[org]);else
            await pool.query(kind === 'role' ? "UPDATE fingence_m2.memberships SET role='Admin',version=version+1 WHERE user_id=$1" : "UPDATE fingence_m2.memberships SET active=false,version=version+1 WHERE user_id=$1", [user]);
        resume();
        await expect(run).rejects.toThrow();
        expect((await pool.query('SELECT count(*)::int n FROM fingence_v2_local.attempts WHERE id=$1', [id])).rows[0].n).toBe(0);
        expect((await pool.query('SELECT state FROM fingence_m4.inferences WHERE operation_id=$1', [id])).rows[0].state).toBe('COMPLETED');
        await expect(p.get(token, id)).rejects.toThrow();
    }
    finally {
        resume();
        await run.catch(() => { });
        await pool.query("UPDATE fingence_m2.memberships SET active=true,role='Finance' WHERE user_id=$1", [user]);await pool.query('UPDATE fingence_m3.organization_states SET active=true WHERE organization_id=$1',[org]);
    } });
    it('retains completed inference receipt but atomically rolls back financial ownership when audit fails', async () => { const token = (await createM2Identity(db).login('native@m4.invalid', password)).token; const broken: TransactionDatabase = { close: async () => { }, transaction: work => db.transaction(tx => work({ query: async (sql, v) => { if (sql.includes('INSERT INTO public.security_audit_events') && v?.includes('ingestion.persisted'))
                throw Error('TEST_AUDIT_UNAVAILABLE'); return tx.query(sql, v); } })) }; const p = createM4Pipeline(broken), id = (await p.reserve(token)).id; await expect(p.process(token, id, bytes, 'source.csv')).rejects.toThrow(); expect((await pool.query('SELECT count(*)::int n FROM fingence_m2.batch_owners WHERE attempt_id=$1', [id])).rows[0].n).toBe(0); expect((await pool.query('SELECT state FROM fingence_m4.inferences WHERE operation_id=$1', [id])).rows[0].state).toBe('COMPLETED'); });
    it('denies direct anon/authenticated inference access including raw proposals', async () => { for (const role of ['anon', 'authenticated']) {
        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE ' + role);
            await expect(c.query('SELECT * FROM fingence_m4.inferences WHERE organization_id=$1', [org])).rejects.toMatchObject({ code: '42501' });
            await c.query('ROLLBACK');
        }
        finally {
            c.release();
        }
    } });
});
