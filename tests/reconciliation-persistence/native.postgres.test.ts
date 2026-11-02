import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { transactionDatabase, type TransactionDatabase } from '../../lib/server/db/postgres';
import { createFinancialProcessingService } from '../../lib/server/reconciliation/service';
import { tokenHash } from '../../lib/server/ai-ingestion/m2/identity';
import { bank, ledger, csv } from '../poc-reconciliation/fixtures';
import { digest, RESEARCH_TWO_DAY_POLICY } from '../../lib/server/reconciliation/processing';
const bin = process.env.FINGENCE_TEST_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\18\\bin';
const executable = (name: string) => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const available = existsSync(executable('initdb')) && existsSync(executable('pg_ctl'));
const org = '00000000-0000-4000-8000-000000000001', otherOrg = '00000000-0000-4000-8000-000000000002';
const user = '00000000-0000-4000-8000-000000000003', otherUser = '00000000-0000-4000-8000-000000000004';
const token = 'A'.repeat(43), otherToken = 'B'.repeat(43), techToken = 'C'.repeat(43);
// Exact-byte synthetic documents, based on the already supplied PoC test row; no labels.
const b = { bytes: readFileSync(new URL('./fixtures/bank.csv', import.meta.url)), filename: 'bank.csv' };
const l = { bytes: readFileSync(new URL('./fixtures/ledger.csv', import.meta.url)), filename: 'ledger.csv' };
const registered = { bank: digest(b.bytes), ledger: digest(l.bytes) };
const s = 'fingence_reconciliation';
(available ? describe : describe.skip)('DB04/AI06 native disposable PostgreSQL with restricted runtime', () => {
    let directory: string, port: number, owner: Pool, runtime: Pool, db: TransactionDatabase, started = false;
    function runtimeDatabase() {
        runtime = new Pool({ host: '127.0.0.1', port, database: 'postgres', user: 'db04_test', max: 4, connectionTimeoutMillis: 5000 });
        runtime.on('error', () => { });
        db = transactionDatabase(runtime);
        return db;
    }
    const service = () => createFinancialProcessingService(db, registered);
    beforeAll(async () => {
        directory = mkdtempSync(join(tmpdir(), 'fingence-db04-pg-'));
        execFileSync(executable('initdb'), ['-D', directory, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], { windowsHide: true, timeout: 30000, stdio: 'pipe' });
        const reservation = createServer();
        await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
        port = (reservation.address() as {
            port: number;
        }).port;
        await new Promise<void>(done => reservation.close(() => done()));
        started = true;
        execFileSync(executable('pg_ctl'), ['-D', directory, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], { windowsHide: true, timeout: 35000, stdio: 'ignore' });
        owner = new Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
        owner.on('error', () => { });
        await owner.query('CREATE ROLE anon;CREATE ROLE authenticated;');
        for (const file of ['phase1-clean-setup.sql', 'c3b1-grouped-persistence-upgrade.sql', 'db02-001-warning-mutation-fence.sql', 'v2-verified-document-local.sql', 'v2-m2-local.sql', 'v2-m3-local.sql', 'db04-001-reconciliation.sql', 'db04-002-reconciliation-security.sql'])
            await owner.query(readFileSync(join('supabase/sql', file), 'utf8'));
        await owner.query('CREATE ROLE db04_test LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE fingence_reconciliation_runtime;');
        await owner.query('INSERT INTO fingence_m2.organizations VALUES($1,\'synthetic\'),($2,\'other\')', [org, otherOrg]);
        await owner.query('INSERT INTO fingence_m2.users VALUES($1,\'one@synthetic.invalid\',\'unused\'),($2,\'two@synthetic.invalid\',\'unused\')', [user, otherUser]);
        await owner.query("INSERT INTO fingence_m2.memberships(user_id,organization_id,role) VALUES($1,$2,'Finance'),($3,$4,'Finance'),($1,$4,'Technical (Management)'),($3,$2,'Finance')", [user, org, otherUser, otherOrg]);
        await owner.query('INSERT INTO fingence_m3.organization_states(organization_id) VALUES($1),($2)', [org, otherOrg]);
        for (const [t, u, o] of [[token, user, org], [otherToken, otherUser, otherOrg], [techToken, user, otherOrg]])
            await owner.query("INSERT INTO fingence_m2.sessions VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',false,1)", [tokenHash(t), u, o]);
        runtimeDatabase();
    }, 60000);
    beforeEach(async () => {
        await owner.query(`TRUNCATE ${s}.audit,${s}.reviews,${s}.cases,${s}.decisions,${s}.proposals,${s}.transactions,${s}.job_sources,${s}.jobs,${s}.documents`);
    });
    afterAll(async () => {
        await runtime?.end();
        await owner?.end();
        if (started && existsSync(join(directory, 'postmaster.pid')))
            execFileSync(executable('pg_ctl'), ['-D', directory, '-m', 'fast', '-w', 'stop'], { windowsHide: true, timeout: 25000, stdio: 'ignore' });
        if (directory) {
            const child = relative(resolve(tmpdir()), resolve(directory));
            if (child.startsWith('fingence-db04-pg-') && !child.includes('..') && !child.includes('\\') && !child.includes('/'))
                rmSync(directory, { recursive: true });
        }
    }, 30000);
    const counts = async () => (await owner.query(`SELECT (SELECT count(*)::int FROM ${s}.jobs) jobs,(SELECT count(*)::int FROM ${s}.transactions) records,(SELECT count(*)::int FROM ${s}.documents) documents`)).rows[0];
    async function scoped(t: string, sql: string, args: unknown[] = []) {
        const c = await runtime.connect();
        try {
            await c.query('BEGIN');
            await c.query("SELECT set_config('fingence.reconciliation_token_hash',$1,true)", [tokenHash(t)]);
            const r = await c.query(sql, args);
            await c.query('COMMIT');
            return r;
        }
        catch (e) {
            await c.query('ROLLBACK');
            throw e;
        }
        finally {
            c.release();
        }
    }
    it('applies additive migrations and exercises a nonowner, nonbypass login', async () => {
        expect((await runtime.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
        expect((await owner.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname=$1", [s])).rows[0].n).toBe(9);
        expect((await owner.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity", [s])).rows[0].n).toBe(9);
    });
    it('persists and reads exact financial rows, source fingerprints and independent evidence', async () => {
        const first = await service().persist(token, b, l), read = await service().get(token, first.processingId);
        expect(first.reused).toBe(false);
        expect(read.job.processing_id).toBe(first.processingId);
        expect(read.sources.map(r => r.sha256)).toEqual([registered.bank, registered.ledger]);
        expect(read.transactions).toHaveLength(2);
        expect(read.transactions[0]).toMatchObject({ signed_amount: '6380.53', original_amount: '06380.53', canonical_date: '2026-03-01', date_basis: 'TRANSACTION_DATE', sha256: registered.bank });
        expect(read.transactions[1]).toMatchObject({ date_basis: 'POSTING_DATE', transaction_date: null });
        expect(read.proposals[0]).toMatchObject({ decision: 'VERIFIED_SUGGESTION', algorithm_version: 'cash-rules-v1', policy_version: 'synthetic-cash-same-day/1' });
    });
    it('recreates the connection pool/service and retains the same records', async () => {
        const first = await service().persist(token, b, l), before = await service().get(token, first.processingId);
        await db.close();
        runtimeDatabase();
        const after = await service().get(token, first.processingId);
        expect(after.transactions).toEqual(before.transactions);
        expect(after.sources).toEqual(before.sources);
    });
    it('round-trips exact amounts above the JavaScript safe integer boundary', async () => {
        const amount = '9007199254740991.99';
        const largeBank = { bytes: csv([{ ...bank, BankAmountMYR: amount, SignedCashMovementMYR: amount }]), filename: 'bank.csv' };
        const largeLedger = { bytes: csv([{ ...ledger, CashAccountDebitMYR: amount, SignedCashMovementMYR: amount }]), filename: 'ledger.csv' };
        const client = createFinancialProcessingService(db, { bank: digest(largeBank.bytes), ledger: digest(largeLedger.bytes) });
        const first = await client.persist(token, largeBank, largeLedger), read = await client.get(token, first.processingId);
        expect(read.transactions.map(r => r.signed_amount)).toEqual([amount, amount]);
        expect(read.proposals[0].decision).toBe('VERIFIED_SUGGESTION');
    });
    it('serializes concurrent repeated requests and writes exactly one complete result', async () => {
        const results = await Promise.all(Array.from({ length: 4 }, () => service().persist(token, b, l)));
        expect(new Set(results.map(r => r.processingId)).size).toBe(1);
        expect(results.filter(r => !r.reused)).toHaveLength(1);
        expect(await counts()).toEqual({ jobs: 1, records: 2, documents: 2 });
    });
    it('reuses fingerprints and records while a new versioned policy creates a separate processing context', async () => {
        const first = await service().persist(token, b, l);
        expect((await service().persist(token, b, l)).reused).toBe(true);
        const second = await createFinancialProcessingService(db, registered, RESEARCH_TWO_DAY_POLICY).persist(token, b, l);
        expect(second.processingId).not.toBe(first.processingId);
        expect(await counts()).toEqual({ jobs: 2, records: 4, documents: 2 });
    });
    it('rolls back all accepted results when the final atomic audit INSERT fails', async () => {
        await owner.query(`CREATE FUNCTION public.db04_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE='23514'; END $$;CREATE TRIGGER db04_fail BEFORE INSERT ON ${s}.audit FOR EACH ROW EXECUTE FUNCTION public.db04_fail()`);
        try {
            await expect(service().persist(token, b, l)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
            expect(await counts()).toEqual({ jobs: 0, records: 0, documents: 0 });
        }
        finally {
            await owner.query(`DROP TRIGGER db04_fail ON ${s}.audit;DROP FUNCTION public.db04_fail()`);
        }
    });
    it('rejects invalid records before any accepted writes and preserves NULL as invalid', async () => {
        const bad = { bytes: csv([{ ...bank, BankAmountMYR: '', SignedCashMovementMYR: '' }]), filename: 'bank.csv' };
        await expect(createFinancialProcessingService(db, { ...registered, bank: digest(bad.bytes) }).persist(token, bad, l)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
        expect(await counts()).toEqual({ jobs: 0, records: 0, documents: 0 });
    });
    it('denies cross-organization service reads and independently enforces RLS', async () => {
        const first = await service().persist(token, b, l);
        await expect(service().get(otherToken, first.processingId)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
        expect((await scoped(otherToken, `SELECT * FROM ${s}.transactions`)).rows).toEqual([]);
        expect((await runtime.query(`SELECT * FROM ${s}.jobs`)).rows).toEqual([]);
        await db.transaction(async (tx) => {
            await tx.query("SELECT set_config('fingence.reconciliation_token_hash',$1,true),set_config('fingence.organization_id',$2,true)", [tokenHash(otherToken), org]);
            expect((await tx.query(`SELECT * FROM ${s}.jobs`)).rows).toEqual([]);
        });
        await expect(scoped(otherToken, `INSERT INTO ${s}.jobs(organization_id,processing_id,created_by,pipeline_version,policy,status) VALUES($1,$2,$3,'test','{}','COMPLETED')`, [org, 'f'.repeat(64), otherUser])).rejects.toMatchObject({ code: '42501' });
    });
    it('does not leak a pooled session claim outside its transaction', async () => {
        await service().persist(token, b, l);
        expect((await runtime.query(`SELECT * FROM ${s}.transactions`)).rows).toEqual([]);
    });
    it('binds audit actors to the authenticated session even within the same organization', async () => {
        const first = await service().persist(token, b, l);
        await expect(scoped(token, `INSERT INTO ${s}.audit(organization_id,processing_id,actor_id,action) VALUES($1,$2,$3,'READ')`, [org, first.processingId, otherUser])).rejects.toMatchObject({ code: '42501' });
    });
    it('denies technical, revoked, expired, inactive and version-stale sessions', async () => {
        for (const t of [techToken, 'invalid'])
            await expect(service().persist(t, b, l)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
        for (const change of ["revoked=true", "expires_at=clock_timestamp()-interval '1 second'", "membership_version=2"]) {
            await owner.query(`UPDATE fingence_m2.sessions SET ${change} WHERE token_hash=$1`, [tokenHash(token)]);
            await expect(service().persist(token, b, l)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
            await owner.query("UPDATE fingence_m2.sessions SET revoked=false,expires_at=clock_timestamp()+interval '1 hour',membership_version=1 WHERE token_hash=$1", [tokenHash(token)]);
        }
        await owner.query('UPDATE fingence_m2.memberships SET active=false WHERE user_id=$1 AND organization_id=$2', [user, org]);
        try {
            await expect(service().persist(token, b, l)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
        }
        finally {
            await owner.query('UPDATE fingence_m2.memberships SET active=true WHERE user_id=$1', [user]);
        }
    });
    it('enforces M5 suspension when the optional local lifecycle table exists', async () => {
        await owner.query('CREATE SCHEMA fingence_m5;CREATE TABLE fingence_m5.account_suspensions(user_id uuid PRIMARY KEY)');
        await owner.query('INSERT INTO fingence_m5.account_suspensions VALUES($1)', [user]);
        try {
            await expect(service().persist(token, b, l)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
        }
        finally {
            await owner.query('DROP SCHEMA fingence_m5 CASCADE');
        }
    });
    it('fences immutable evidence and denies unneeded table/DDL privileges', async () => {
        await service().persist(token, b, l);
        await expect(scoped(token, `UPDATE ${s}.transactions SET reference='changed'`)).rejects.toMatchObject({ code: '42501' });
        await expect(scoped(token, `DELETE FROM ${s}.jobs`)).rejects.toMatchObject({ code: '42501' });
        await expect(runtime.query(`TRUNCATE ${s}.audit`)).rejects.toMatchObject({ code: '42501' });
        await expect(runtime.query('SELECT * FROM fingence_m2.sessions')).rejects.toMatchObject({ code: '42501' });
        await expect(owner.query(`UPDATE ${s}.transactions SET reference='changed'`)).rejects.toMatchObject({ code: '23514' });
    });
    it('enforces unique records, typed source linkage, exact amounts and transaction FKs', async () => {
        const first = await service().persist(token, b, l), args = [org, first.processingId];
        await expect(owner.query(`INSERT INTO ${s}.transactions SELECT * FROM ${s}.transactions WHERE organization_id=$1 AND processing_id=$2 LIMIT 1`, args)).rejects.toMatchObject({ code: '23505' });
        await expect(owner.query(`INSERT INTO ${s}.job_sources VALUES($1,$2,$3,'LEDGER')`, [org, '0'.repeat(64), registered.bank])).rejects.toMatchObject({ code: '23503' });
        await expect(owner.query(`INSERT INTO ${s}.proposals(organization_id,processing_id,ordinal,bank_record_id,ledger_record_id,algorithm_version,proposal_type) VALUES($1,$2,20,'missing','missing','cash-rules-v1','ONE_TO_ONE')`, args)).rejects.toMatchObject({ code: '23503' });
        await expect(owner.query(`INSERT INTO ${s}.transactions SELECT organization_id,processing_id,sha256,kind,'new',10,'REJECTED',canonical_date,transaction_date,posting_date,date_basis,currency,signed_amount,original_amount,reference,evidence FROM ${s}.transactions LIMIT 1`)).rejects.toMatchObject({ code: '23514' });
        await expect(owner.query(`INSERT INTO ${s}.transactions SELECT organization_id,processing_id,repeat('0',64),kind,'wrong-source',10,status,canonical_date,transaction_date,posting_date,date_basis,currency,signed_amount,original_amount,reference,evidence FROM ${s}.transactions LIMIT 1`)).rejects.toMatchObject({ code: '23503' });
        await expect(owner.query(`INSERT INTO ${s}.transactions SELECT organization_id,processing_id,sha256,kind,'wrong-decimal',10,status,canonical_date,transaction_date,posting_date,date_basis,currency,1,original_amount,reference,evidence FROM ${s}.transactions LIMIT 1`)).rejects.toMatchObject({ code: '23514' });
        await expect(owner.query(`INSERT INTO ${s}.transactions SELECT organization_id,processing_id,sha256,kind,'null-amount',10,status,canonical_date,transaction_date,posting_date,date_basis,currency,NULL,original_amount,reference,evidence FROM ${s}.transactions LIMIT 1`)).rejects.toMatchObject({ code: '23502' });
    });
    it('refuses a verified decision with missing financial checks', async () => {
        await service().persist(token, b, l);
        await expect(owner.query(`INSERT INTO ${s}.decisions SELECT organization_id,processing_id,99,policy_version,'VERIFIED_SUGGESTION','{}'::jsonb FROM ${s}.decisions LIMIT 1`)).rejects.toMatchObject({ code: '23514' });
    });
    it('persists unresolved evidence and append-only human annotations without clearing suggestions', async () => {
        const changed = { bytes: csv([{ ...ledger, Counterparty: 'Conflicting party' }]), filename: 'ledger.csv' }, reg = { ...registered, ledger: digest(changed.bytes) };
        const client = createFinancialProcessingService(db, reg), first = await client.persist(token, b, changed);
        expect((await client.get(token, first.processingId)).proposals[0].decision).toBe('UNRESOLVED');
        expect(await client.review(token, first.processingId, 0, 0, 'INVESTIGATING', 'Synthetic case review')).toEqual({ version: 1 });
        await expect(client.review(token, first.processingId, 0, 0, 'EXPLAINED', 'stale')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        await client.review(token, first.processingId, 0, 1, 'EXPLAINED', 'Explanation is not financial clearance');
        const read = await client.get(token, first.processingId);
        expect(read.reviews).toHaveLength(2);
        expect(read.proposals[0].decision).toBe('UNRESOLVED');
    });
    it('retains unknown commit outcomes without automatic retry', async () => {
        let commits = 0;
        const uncertain = transactionDatabase({ end: async () => { }, async connect() { const c = await runtime.connect(); return { release: (destroy?: boolean) => c.release(destroy), async query(sql: string, args?: unknown[]) { const r = await c.query(sql, args); if (sql === 'COMMIT') {
                    commits++;
                    throw Error('synthetic lost acknowledgement');
                } return r; } }; } });
        await expect(createFinancialProcessingService(uncertain, registered).persist(token, b, l)).rejects.toMatchObject({ code: 'COMMIT_OUTCOME_UNKNOWN' });
        expect(commits).toBe(1);
        expect(await counts()).toEqual({ jobs: 1, records: 2, documents: 2 });
        // Explicit investigation via a healthy read; no retry of an uncertain write.
        const id = (await owner.query(`SELECT processing_id FROM ${s}.jobs`)).rows[0].processing_id;
        expect((await service().get(token, id)).transactions).toHaveLength(2);
    });
});
