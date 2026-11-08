import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { PersistenceError } from '../../lib/server/persistence/contracts';
import { createM2Pipeline, installM2Schema, registeredM2Source } from '../../lib/server/ai-ingestion/m2/pipeline';
import { createM2Identity, provisionM2Account, tokenHash } from '../../lib/server/ai-ingestion/m2/identity';
import { offlineSemanticAdapter, groqReadyBoundary } from '../../lib/server/ai-ingestion/m2/interpreter';
import { extractTrustedEvidence } from '../../lib/server/ai-ingestion/v2-i1/persistence';
let db: PGlite, database: TransactionDatabase, identity: ReturnType<typeof createM2Identity>, pipeline: ReturnType<typeof createM2Pipeline>;
let token: string, otherToken: string, org: string, user: string;
const password = 'Synthetic-test-only-password';
const mixed = () => readFileSync('synthetic/m2/verified-mixed.csv');
beforeAll(async () => {
    const start=performance.now();
    db = await PGlite.create();
    console.info('M2 fixture PGlite ready ms='+Math.round(performance.now()-start));
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;');
    await db.exec(readFileSync('supabase/sql/v2-verified-document-local.sql', 'utf8'));
    database = { close: async () => { }, transaction: work => db.transaction(tx => work({ query: async (sql, values) => { const r = await tx.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as never; } })) };
    await installM2Schema(database);
    console.info('M2 fixture schema ready ms='+Math.round(performance.now()-start));
    identity = createM2Identity(database);
    pipeline = createM2Pipeline(database);
    const a = await provisionM2Account(database, { email: 'a@synthetic.invalid', password, organizationName: 'Synthetic A' });
    org = a.organizationId;
    user = a.userId;
    await provisionM2Account(database, { email: 'b@synthetic.invalid', password, organizationName: 'Synthetic B' });
    token = (await identity.login('a@synthetic.invalid', password)).token;
    otherToken = (await identity.login('b@synthetic.invalid', password)).token;
    console.info('M2 fixture sessions ready ms='+Math.round(performance.now()-start));
}, 60000);
afterAll(async () => { await db?.close(); });
async function run(bytes = mixed(), name = 'source.csv', service = pipeline) { const { id } = await service.reserve(token); await service.process(token, id, bytes, name); return { id, ...await pipeline.get(token, id) }; }
describe('V2 M2 actual extraction → verification → tenant persistence → exact report', () => {
    it('persists accepted, rejected and warnings without C1 conversion; calculations cite the stored rows', async () => {
        const r = await run();
        expect(r.batch?.publicationEligible).toBe(false);
        expect(r.batch?.verification?.coverage).toMatchObject({ sourceRows: 4, rowCountEstablished: true });
        expect(r.batch?.verification?.accepted).toHaveLength(3);
        expect(r.batch?.verification?.rejected).toHaveLength(1);
        expect(r.report?.groups).toMatchObject([{ currency: 'MYR', monetaryBasis: 'source_signed_amount', total: '105.5', status: 'AVAILABLE' }]);
        expect(r.report?.excludedWarnings).toBe(1);
        expect(r.report?.groups[0].sources).toHaveLength(2);
        expect(r.batch?.receipt).toMatchObject({ mode: 'RECORDED_TEST', model: 'SIMULATED_OFFLINE_SEMANTIC_ADAPTER_V1', retries: 0 });
        expect(r.batch?.verification?.accepted.every(row => row.evidenceIds.every(id => r.batch?.evidence?.items.some(i => i.id === id)))).toBe(true);
        expect(r.batch?.evidence?.items.some(i => i.address !== null)).toBe(true);
        const included = await pipeline.get(token, r.id, 'include');
        expect(included.report?.groups[0].total).toBe('85.5');
        expect((await db.query('SELECT attempt_id FROM fingence_m2.batch_owners WHERE attempt_id=$1 AND organization_id=$2', [r.id, org])).rows).toHaveLength(1);
        await expect(pipeline.process(token, r.id, mixed(), 'source.csv')).rejects.toThrow('ATTEMPT_ALREADY_CLAIMED');
        expect((await db.query('SELECT id FROM fingence_v2_local.attempts WHERE id=$1', [r.id])).rows).toHaveLength(1);
    });
    it('quarantines unknown fields without summing unresolved records or inflating source coverage', async () => {
        const r = await run(readFileSync('synthetic/m2/quarantine.csv'));
        expect(r.batch?.verification?.accepted).toHaveLength(0);
        expect(r.batch?.verification?.unresolved).toHaveLength(1);
        expect(r.report?.groups).toEqual([]);
    });
    it('rejects unregistered uploaded content and never accepts browser verification claims', async () => {
        expect(await registeredM2Source(Buffer.from('real financial data'))).toBe(false);
        const { id } = await pipeline.reserve(token);
        await expect(pipeline.process(token, id, Buffer.from('{}'), 'verified.json')).rejects.toThrow('REGISTERED_SYNTHETIC_REQUIRED');
        expect((await pipeline.get(token, id)).job.state).toBe('RESERVED');
        await pipeline.cancel(token, id);
        await expect(pipeline.process(token, id, mixed(), 'source.csv')).rejects.toThrow('ATTEMPT_ALREADY_CLAIMED');
    });
    it('unsupported conventions and fabricated header references fail the unchanged verifier', async () => {
        for (const mutate of [(p: Record<string, unknown>) => { p.conventions = null; }, (p: Record<string, unknown>) => { p.fields = [{ headerId: 'fabricated', ruleId: 'amount', reason: 'invented' }]; }]) {
            const service = createM2Pipeline(database, { mode: 'SIMULATED', async propose(e) { const r = await offlineSemanticAdapter.propose(e); mutate(r.plan as Record<string, unknown>); return r; } });
            const r = await run(mixed(), 'source.csv', service);
            expect(r.batch?.verification?.accepted).toHaveLength(0);
            expect(r.batch?.verification?.unresolved.length).toBeGreaterThan(0);
            expect(r.report?.groups).toEqual([]);
        }
    });
    it('denies cross-organization enumeration and direct Data API roles', async () => {
        const r = await run();
        await expect(pipeline.get(otherToken, r.id)).rejects.toThrow('ACCESS_DENIED');
        await expect(pipeline.investigate(otherToken, r.id)).rejects.toThrow('ACCESS_DENIED');
        expect((await pipeline.list(otherToken)).some((j) => j.id === r.id)).toBe(false);
        for (const role of ['anon', 'authenticated']) {
            await db.exec('SET ROLE ' + role);
            try {
                await expect(db.query('SELECT * FROM fingence_m2.users')).rejects.toThrow();
                await expect(db.query('SELECT * FROM fingence_v2_local.attempts')).rejects.toThrow();
            }
            finally {
                await db.exec('RESET ROLE');
            }
        }
    });
    it('requires current unexpired sessions and active version-bound Finance membership', async () => {
        const r = await run();
        await expect(pipeline.get('invalid', r.id)).rejects.toThrow('ACCESS_DENIED');
        const fresh = async () => (await identity.login('a@synthetic.invalid', password)).token;
        const expired = await fresh();
        await db.query("UPDATE fingence_m2.sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [tokenHash(expired)]);
        await expect(pipeline.get(expired, r.id)).rejects.toThrow('ACCESS_DENIED');
        const revoked = await fresh();
        await identity.logout(revoked);
        await expect(pipeline.get(revoked, r.id)).rejects.toThrow('ACCESS_DENIED');
        await db.query('UPDATE fingence_m2.memberships SET active=false WHERE user_id=$1', [user]);
        await expect(pipeline.get(token, r.id)).rejects.toThrow('ACCESS_DENIED');
        await db.query('UPDATE fingence_m2.memberships SET active=true,version=version+1 WHERE user_id=$1', [user]);
        await expect(pipeline.get(token, r.id)).rejects.toThrow('ACCESS_DENIED');
        token = await fresh();
        for (const role of ['Technical (Management)', 'Admin']) {
            await db.query('UPDATE fingence_m2.memberships SET role=$2 WHERE user_id=$1', [user, role]);
            await expect(pipeline.get(token, r.id)).rejects.toThrow('ACCESS_DENIED');
        }
        await db.query("UPDATE fingence_m2.memberships SET role='Finance' WHERE user_id=$1", [user]);
        await expect(identity.login('a@synthetic.invalid', 'wrong-password')).rejects.toThrow('ACCESS_DENIED');
    });
    it('blocks result delivery when durable read auditing fails', async () => {
        const r = await run();
        const failing: TransactionDatabase = { close: async () => { }, transaction: work => database.transaction(tx => work({ query: (sql, values) => sql.includes('INSERT INTO public.security_audit_events') ? Promise.reject(new Error('synthetic audit failure')) : tx.query(sql, values) })) };
        await expect(createM2Pipeline(failing).get(token, r.id)).rejects.toThrow();
    });
    it('atomically rolls back batch, ownership and success audit on a persistence failure', async () => {
        let failed = false;
        const failing: TransactionDatabase = { close: async () => { }, transaction: work => database.transaction(tx => work({ query: (sql, values) => { if (sql.startsWith('INSERT INTO fingence_m2.batch_owners')) {
                    failed = true;
                    return Promise.reject(new PersistenceError('PERSISTENCE_FAILED'));
                } return tx.query(sql, values); } })) };
        const service = createM2Pipeline(failing);
        const { id } = await service.reserve(token);
        await expect(service.process(token, id, mixed(), 'source.csv')).rejects.toThrow('OPERATION_NOT_CONFIRMED');
        expect(failed).toBe(true);
        expect((await pipeline.get(token, id))).toMatchObject({ job: { state: 'FAILED' }, batch: null, report: null });
        expect((await db.query('SELECT * FROM fingence_v2_local.attempts WHERE id=$1', [id])).rows).toHaveLength(0);
    });
    it('recovers a committed operation after acknowledgement loss without dispatching or persisting twice', async () => {
        let persistCommits = 0;
        const uncertain: TransactionDatabase = { close: async () => { }, async transaction(work) { let persisted = false; const value = await database.transaction(tx => work({ query: (sql, values) => { if (sql.startsWith('INSERT INTO fingence_m2.batch_owners'))
                    persisted = true; return tx.query(sql, values); } })); if (persisted) {
                persistCommits++;
                throw new PersistenceError('COMMIT_OUTCOME_UNKNOWN');
            } return value; } };
        const service = createM2Pipeline(uncertain);
        const { id } = await service.reserve(token);
        await expect(service.process(token, id, mixed(), 'source.csv')).rejects.toThrow('OPERATION_NOT_CONFIRMED');
        const recovered = await createM2Pipeline(database).get(token, id);
        expect(recovered.job.state).toBe('COMPLETED');
        expect(recovered.report?.groups[0].total).toBe('105.5');
        expect(persistCommits).toBe(1);
        expect(await pipeline.investigate(token, id)).toEqual({ outcome: 'CONFIRMED_COMMITTED' });
        await expect(service.process(token, id, mixed(), 'source.csv')).rejects.toThrow('ATTEMPT_ALREADY_CLAIMED');
        expect(persistCommits).toBe(1);
    });
    it('requires separate authorization before any provider invocation', async () => {
        const provider = { propose: vi.fn() };
        const boundary = groqReadyBoundary(provider, () => false);
        await expect(boundary.propose(await extractTrustedEvidence(mixed(), 'source.csv'))).rejects.toThrow('LIVE_DISPATCH_NOT_AUTHORIZED');
        expect(provider.propose).not.toHaveBeenCalled();
    });
});
describe('multi-format extraction and independent outcomes', () => {
    const cases = ['i01.csv', 'i02.xlsx', 'i03.pdf', 'i04.pdf', 'i05.png', 'i06.jpg'];
    const ocrAvailable=existsSync(process.env.FINGENCE_AI_PYTHON??'.venv-ai/bin/python');
    for(const name of cases) it.skipIf(!name.endsWith('.csv')&&!name.endsWith('.xlsx')&&!ocrAvailable)(`extracts, verifies and atomically persists ${name} with actual provenance`, async () => {
        const bytes = readFileSync('synthetic/ai-ingestion-i2/' + name), r = await run(bytes, 'uploaded' + name.slice(name.lastIndexOf('.')));
        expect(r.job.state).toBe('COMPLETED');
        expect(r.batch?.evidence?.items.length).toBeGreaterThan(0);
        expect(r.batch?.source.format).toBe(name.endsWith('csv') ? 'CSV' : name.endsWith('xlsx') ? 'XLSX' : name.endsWith('pdf') ? 'PDF' : 'IMAGE');
        const v = r.batch!.verification!;
        expect(v.accepted.length + v.rejected.length + v.unresolved.length).toBe(v.coverage.sourceRows);
        expect(v.coverage.rowCountEstablished || r.batch?.documentQuarantine !== null).toBe(true);
        for (const g of r.report!.groups)
            for (const source of g.sources)
                expect(v.accepted.some(row => row.id === source.recordId && JSON.stringify(row.evidenceIds) === JSON.stringify(source.evidenceIds))).toBe(true);
        if (!name.endsWith('csv') && !name.endsWith('xlsx'))
            expect(r.batch?.evidence?.items.some(i => i.page !== null)).toBe(true);
    }, 90000);
});

it('cannot mislabel an offline adapter receipt as genuine inference',async()=>{
 const service=createM2Pipeline(database,{mode:'SIMULATED',async propose(e){const r=await offlineSemanticAdapter.propose(e);return {...r,receipt:{...r.receipt,mode:'LIVE_GROQ'}};}});
 const {id}=await service.reserve(token);await expect(service.process(token,id,mixed(),'source.csv')).rejects.toThrow('OPERATION_NOT_CONFIRMED');
 expect(await pipeline.get(token,id)).toMatchObject({job:{state:'FAILED'},batch:null,report:null});
});

it('stores extraction failure as document quarantine without inventing source rows',async()=>{
 const original=process.env.FINGENCE_AI_PYTHON;vi.stubEnv('FINGENCE_AI_PYTHON','/nonexistent/synthetic-test-python');
 try{
  const r=await run(readFileSync('synthetic/ai-ingestion-i2/i03.pdf'),'source.pdf');
  expect(r.batch?.documentFailure).toEqual({code:'EXTRACTION_FAILED',rowCountEstablished:false});
  expect(r.batch?.verification).toBeNull();expect(r.report?.groups).toEqual([]);
  const saved=await db.query<{outcome_count:number;document_quarantine:{kind:string}}>('SELECT outcome_count,document_quarantine FROM fingence_v2_local.attempts WHERE id=$1',[r.id]);
  expect(saved.rows[0]).toMatchObject({outcome_count:0,document_quarantine:{kind:'DOCUMENT_QUARANTINE'}});
 }finally{if(original===undefined)delete process.env.FINGENCE_AI_PYTHON;else process.env.FINGENCE_AI_PYTHON=original;}
});

it('classifies a retained reference only for its creating principal without enumerating another tenant',async()=>{
 const {id}=await pipeline.reserve(token);
 expect(await pipeline.reference(token,id)).toEqual({owned:true,ownerUserId:user});
 expect(await pipeline.reference(otherToken,id)).toEqual({owned:false,ownerUserId:null});
 expect(await pipeline.reference(otherToken,'77777777-7777-4777-8777-777777777777')).toEqual({owned:false,ownerUserId:null});
});
