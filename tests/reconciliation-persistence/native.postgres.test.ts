import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync,spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { transactionDatabase, type TransactionDatabase } from '../../lib/server/db/postgres';
import { createFinancialProcessingService } from '../../lib/server/reconciliation/service';
import { createProcessingReadHandler,createProcessingUploadHandler } from '../../lib/server/reconciliation/http';
import {dashboardContext} from '../../lib/reconciliation-dashboard';
import {LocalE5Provider} from '../../lib/server/reconciliation/ai03/model-loader';
import {normalizeCashSource} from '../../lib/server/poc-reconciliation/normalize';
import {createTrustedIngestionService,TRUSTED_INGESTION_VERSION} from '../../lib/server/reconciliation/trusted-ingestion';
import {inspectWithRestrictedIdentity} from '../../lib/server/reconciliation/preflight';
import {assessHostedReadiness} from '../../lib/server/reconciliation/hosted-readiness';
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
    it('diagnoses unsafe PUBLIC ACLs using metadata only in a read-only transaction', async () => {
        await owner.query(`GRANT SELECT (signed_amount) ON ${s}.transactions TO PUBLIC`);
        await owner.query(`CREATE FUNCTION public.db04_diagnostic_definer() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1'`);
        const client = await owner.connect();
        try {
            const results = await client.query(readFileSync(resolve('supabase/sql/db04-inspector-public-diagnostic.sql'),'utf8'));
            const findings = (results as unknown as Array<{command:string;rows:Record<string,unknown>[]}>)
                .find(result => result.command==='SELECT')?.rows;
            expect(findings).toEqual(expect.arrayContaining([
                expect.objectContaining({category:'PUBLIC_COLUMN_PRIVILEGE',schema_name:s,object_name:'transactions',column_name:'signed_amount',privilege_type:'SELECT'}),
                expect.objectContaining({category:'PUBLIC_ELEVATED_FUNCTION',schema_name:'public',object_name:'db04_diagnostic_definer()',privilege_type:'EXECUTE'}),
            ]));
            expect(findings?.every(row => Object.keys(row).sort().join(',')==='category,column_name,object_name,privilege_type,schema_name')).toBe(true);
        } finally {
            await client.query('ROLLBACK'); client.release();
            await owner.query(`REVOKE SELECT (signed_amount) ON ${s}.transactions FROM PUBLIC`);
            await owner.query('DROP FUNCTION public.db04_diagnostic_definer()');
        }
    });
    it('validates the unapproved inspection role template only in disposable PostgreSQL', async () => {
        await owner.query(readFileSync(resolve('supabase/sql/db04-inspection-role-review.sql'), 'utf8'));
        const pool = new Pool({host:'127.0.0.1', port, user:'db04_catalog_inspector', database:'postgres'});
        const inspector = transactionDatabase(pool);
        try {
            expect((await pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only).toBe('on');
            const report = await inspectWithRestrictedIdentity(inspector, {role:'db04_catalog_inspector', database:'postgres'});
            expect(report.permissions.every(p => !p.can_write && !p.can_select)).toBe(true);
            await expect(pool.query(`SELECT * FROM ${s}.transactions`)).rejects.toMatchObject({code:'42501'});
            await expect(pool.query('CREATE TABLE public.inspector_must_not_write (id int)')).rejects.toMatchObject({code:'25006'});
            await owner.query(`GRANT SELECT (signed_amount) ON ${s}.transactions TO db04_catalog_inspector`);
            await expect(inspectWithRestrictedIdentity(inspector, {role:'db04_catalog_inspector', database:'postgres'})).rejects.toThrow('READ_ONLY_INSPECTION_IDENTITY_REQUIRED');
            await owner.query(`REVOKE SELECT (signed_amount) ON ${s}.transactions FROM db04_catalog_inspector`);
        } finally { await inspector.close(); }
    });
    it('rolls back the inspector proposal when PUBLIC can read financial columns', async () => {
        await owner.query(`GRANT SELECT (signed_amount) ON ${s}.transactions TO PUBLIC`);
        const client = await owner.connect();
        try {
            const sql = readFileSync(resolve('supabase/sql/db04-inspection-role-review.sql'), 'utf8').replaceAll('db04_catalog_inspector','db04_unsafe_inspector');
            await expect(client.query(sql)).rejects.toMatchObject({code:'42501',message:'INSPECTION_ROLE_UNSAFE_PUBLIC_PRIVILEGES'});
            await client.query('ROLLBACK');
            expect((await client.query("SELECT 1 FROM pg_roles WHERE rolname='db04_unsafe_inspector'")).rows).toHaveLength(0);
        } finally {
            await client.query('ROLLBACK'); client.release();
            await owner.query(`REVOKE SELECT (signed_amount) ON ${s}.transactions FROM PUBLIC`);
        }
    });
    it('rolls back the inspector proposal when PUBLIC can invoke an elevated data function', async () => {
        await owner.query(`CREATE FUNCTION public.db04_unsafe_reader() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1'`);
        const client = await owner.connect();
        try {
            const sql = readFileSync(resolve('supabase/sql/db04-inspection-role-review.sql'), 'utf8').replaceAll('db04_catalog_inspector','db04_unsafe_function_inspector');
            await expect(client.query(sql)).rejects.toMatchObject({code:'42501',message:'INSPECTION_ROLE_UNSAFE_PUBLIC_PRIVILEGES'});
            await client.query('ROLLBACK');
            expect((await client.query("SELECT 1 FROM pg_roles WHERE rolname='db04_unsafe_function_inspector'")).rows).toHaveLength(0);
        } finally {
            await client.query('ROLLBACK'); client.release();
            await owner.query('DROP FUNCTION public.db04_unsafe_reader()');
        }
    });
    it('performs native read-only metadata inspection without financial SELECT privileges',async()=>{
        await owner.query('CREATE ROLE db04_inspector LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE');
        const inspectorPool=new Pool({host:'127.0.0.1',port,user:'db04_inspector',database:'postgres'}),inspector=transactionDatabase(inspectorPool);
        try {
            const report=await inspectWithRestrictedIdentity(inspector,{role:'db04_inspector',database:'postgres'});
            expect(report.identity.transaction_read_only).toBe('on');expect(report.tables).toHaveLength(11);
            expect(report.columns.some(c=>c.table_name==='transactions'&&c.column_name==='signed_amount'&&c.data_type==='numeric')).toBe(true);
            expect(report.permissions.every(p=>p.can_write===false&&p.can_select===false)).toBe(true);
            expect(report.triggers).toHaveLength(11);expect(report.hostedWritesAuthorized).toBe(false);
            expect(report.foundationCompatibility.missingFoundationTables).toEqual([]);
            expect(report.foundationCompatibility.warningFenceMarkers).toEqual({trigger:true,function:true});
            expect(report.foundationCompatibility.warningFenceEnabled).toBe(true);
            expect(report.foundationCompatibility.exactNumericColumns).toContain('source_amount');
            expect(report.foundationCompatibility.c1ToDb04.supported).toBe(false);
            expect(report.foundationCompatibility.db03Recovery).toContain('NOT_PROVEN_BY_CATALOGS');
            expect(assessHostedReadiness(report).blockers).toEqual(['HOSTED_IDENTITY_CONTRACT_REQUIRED','EXPLICIT_MIGRATION_APPROVAL_REQUIRED','VERIFIED_BACKUP_RESTORE_REQUIRED']);
            const cli=execFileSync(process.execPath,['--conditions=react-server','scripts/db04-readiness.mjs','inspect'],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,DB04_INSPECTION_DATABASE_URL:`postgresql://db04_inspector@127.0.0.1:${port}/postgres?sslmode=disable`,DB04_INSPECTION_ROLE:'db04_inspector',DB04_INSPECTION_DATABASE:'postgres'}});
            const inspected=JSON.parse(cli);expect(inspected.target.environment).toBe('LOCAL');expect(inspected.report.identity.role).toBe('db04_inspector');expect(inspected.readiness.hostedDeploymentAuthorized).toBe(false);
            await expect(inspectorPool.query(`SELECT * FROM ${s}.transactions`)).rejects.toMatchObject({code:'42501'});
            await expect(inspectWithRestrictedIdentity(db,{role:'db04_test',database:'postgres'})).rejects.toThrow('READ_ONLY_INSPECTION_IDENTITY_REQUIRED');
        }finally{await inspector.close();}
    });
    it('connects trusted ingestion outputs through persistence, ranking, independent verification and retrieval',async()=>{
        const input={version:TRUSTED_INGESTION_VERSION,contract:'cash-source-v1' as const,documents:[{document:b,verified:normalizeCashSource(b.bytes,'bank',b.filename)},{document:l,verified:normalizeCashSource(l.bytes,'ledger',l.filename)}]};
        const pipeline=createTrustedIngestionService(db,registered);
        const provider=process.env.DB04_E5_SMOKE==='1'?new LocalE5Provider(resolve('../ai03-runtime'),resolve('../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78')):undefined;
        const first=await pipeline.process(token,input,provider);if(!first.supported)throw Error('Expected supported contract');
        expect(first.context.transactions).toHaveLength(2);expect(first.context.transactions[0]).toMatchObject({record_id:'BANK-BUS-001-V2-00458',original_amount:'06380.53',date_basis:'VALUE_DATE'});
        expect(first.context.proposalVerifications).toHaveLength(1);
        expect((first.context.proposalVerifications[0].evidence as Array<Record<string,unknown>>).every(e=>e.outcome==='UNRESOLVED')).toBe(true);
        const unnecessary={kind:'PRETRAINED_E5' as const,initialize:vi.fn(async()=>{throw Error('Unnecessary inference');}),embed:vi.fn(async()=>{throw Error('Unnecessary inference');}),terminate:vi.fn(),dispose:async()=>{}};
        const second=await pipeline.process(token,input,provider?unnecessary:undefined);if(!second.supported)throw Error();
        expect(unnecessary.initialize).not.toHaveBeenCalled();
        expect(second.processingId).toBe(first.processingId);expect(second.reused).toBe(true);expect(second.context.proposalVerifications).toHaveLength(1);
        await expect(service().get(otherToken,first.processingId)).rejects.toThrow();
        const forged=structuredClone(input);forged.documents[0].verified.rows[0].signedCents='1';
        expect(await pipeline.process(token,forged)).toMatchObject({supported:false});
        expect((await owner.query(`SELECT count(*)::int n FROM ${s}.jobs`)).rows[0].n).toBe(1);
    },120000);
    it('independently verifies persisted candidates concurrently and returns immutable snapshots',async()=>{
        await expect(service().verifyRankings(token,'invalid')).rejects.toMatchObject({code:'INVALID_INPUT'});
        const first=await service().persist(token,b,l);await service().rankFuzzy(token,first.processingId);
        const results=await Promise.all([service().verifyRankings(token,first.processingId),service().verifyRankings(token,first.processingId)]);
        expect(results[0]).toEqual(results[1]);
        const evidence=results[0].evidence as Array<Record<string,unknown>>;
        expect(evidence[0]).toMatchObject({financialEligible:true,outcome:'UNRESOLVED',rankingLineage:true});
        expect(evidence[0].reasons).toContain('ASSIGNMENT_POLICY_NOT_APPROVED');
        expect((await service().get(token,first.processingId)).proposalVerifications).toHaveLength(1);
        expect((await service().get(token,first.processingId)).proposals[0].decision).toBe('VERIFIED_SUGGESTION');
        await expect(service().verifyRankings(otherToken,first.processingId)).rejects.toThrow();
        expect((await scoped(otherToken,`SELECT * FROM ${s}.proposal_verifications`)).rows).toEqual([]);
        await expect(scoped(token,`UPDATE ${s}.proposal_verifications SET outcome='VERIFIED_SUGGESTION'`)).rejects.toMatchObject({code:'42501'});
        await expect(owner.query(`UPDATE ${s}.proposal_verifications SET outcome='UNRESOLVED'`)).rejects.toMatchObject({code:'23514'});
        await expect(owner.query(`INSERT INTO ${s}.proposal_verifications SELECT organization_id,processing_id,repeat('e',64),policy_version,created_by,created_at,'VERIFIED_SUGGESTION',evidence FROM ${s}.proposal_verifications LIMIT 1`)).rejects.toMatchObject({code:'23514'});
        await expect(owner.query(`INSERT INTO ${s}.proposal_verifications SELECT organization_id,processing_id,repeat('e',64),policy_version,created_by,created_at,'UNRESOLVED','[{"outcome":"VERIFIED_SUGGESTION"}]'::jsonb FROM ${s}.proposal_verifications LIMIT 1`)).rejects.toMatchObject({code:'23514'});
    });
    it('rolls back verification evidence when the atomic read audit fails',async()=>{
        const first=await service().persist(token,b,l);await service().rankFuzzy(token,first.processingId);
        await owner.query(`CREATE FUNCTION public.verify_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic verification audit failure' USING ERRCODE='23514'; END $$;CREATE TRIGGER verify_fail BEFORE INSERT ON ${s}.audit FOR EACH ROW EXECUTE FUNCTION public.verify_fail()`);
        try {await expect(service().verifyRankings(token,first.processingId)).rejects.toMatchObject({code:'PERSISTENCE_FAILED'});expect((await owner.query(`SELECT count(*)::int n FROM ${s}.proposal_verifications`)).rows[0].n).toBe(0);}
        finally{await owner.query(`DROP TRIGGER verify_fail ON ${s}.audit;DROP FUNCTION public.verify_fail()`);}
    });
    it.skipIf(process.env.DB04_E5_SMOKE!=='1')('persists actual offline E5 rankings as unresolved evidence',async()=>{
        const first=await service().persist(token,b,l);
        const provider=new LocalE5Provider(resolve('../ai03-runtime'),resolve('../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78'));
        const ranked=await service().rankE5(token,first.processingId,provider);
        const independentlyVerified=await service().verifyRankings(token,first.processingId);
        expect((independentlyVerified.evidence as Array<Record<string,unknown>>)[0]).toMatchObject({algorithm:'db04-e5-proposals/1',financialEligible:true,outcome:'UNRESOLVED'});
        const evidence=ranked?.evidence as Array<Record<string,unknown>>;
        expect(ranked?.version).toBe('db04-e5-proposals/1');expect(evidence).toHaveLength(1);
        expect(evidence[0].decision).toBe('UNRESOLVED');expect(Number.isFinite(evidence[0].score)).toBe(true);
        expect((await service().get(token,first.processingId)).proposals[0].decision).toBe('VERIFIED_SUGGESTION');
    },120000);
    it('persists fuzzy proposal evidence without changing deterministic decisions',async()=>{
        const first=await service().persist(token,b,l);
        const ranked=await service().rankFuzzy(token,first.processingId);
        expect(ranked?.version).toBe('db04-fuzzy-proposals/1');
        const evidence=ranked?.evidence as Array<Record<string,unknown>>;
        expect(evidence).toHaveLength(1);expect(evidence[0].decision).toBe('UNRESOLVED');
        expect(evidence[0].amount).toBe('6380.53');expect(evidence[0].bankDateBasis).toBe('VALUE_DATE');
        expect(await service().rankFuzzy(token,first.processingId)).toEqual(ranked);
        expect((await service().get(token,first.processingId)).rankings).toHaveLength(1);
        expect((await service().get(token,first.processingId)).proposals[0].decision).toBe('VERIFIED_SUGGESTION');
        await expect(service().rankFuzzy(otherToken,first.processingId)).rejects.toThrow();
        expect((await scoped(otherToken,`SELECT * FROM ${s}.rankings`)).rows).toEqual([]);
    });
    it('runs the real Next server: upload, retrieve, revisit and deny another organization',async()=>{
        const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));
        const webPort=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
        const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(webPort)],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'development',VERCEL:'',FINGENCE_DB04_LOCAL:'1',FINGENCE_DB04_TEST_FIXTURES:'1',SUPABASE_DATABASE_URL:`postgresql://db04_test@127.0.0.1:${port}/postgres?sslmode=disable`}});
        let diagnostics='';for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-4000).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]');});
        const base=`http://127.0.0.1:${webPort}`;
        try {
            let ready=false;const deadline=Date.now()+120000;
            while(Date.now()<deadline){try{const r=await fetch(base+'/api/db04/processing',{signal:AbortSignal.timeout(10000)});if(r.status===403){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(done=>setTimeout(done,500));}
            if(!ready)throw Error('Live server not ready: '+diagnostics);
            const upload=()=>{const form=new FormData();form.append('documents',new File([b.bytes],'bank.csv',{type:'text/csv'}));form.append('documents',new File([l.bytes],'ledger.csv',{type:'text/csv'}));return fetch(base+'/api/db04/processing',{method:'POST',headers:{authorization:`Bearer ${token}`},body:form});};
            const response=await upload();expect(response.status).toBe(200);const receipt=await response.json();
            expect((await(await upload()).json()).reused).toBe(true);
            const read=await fetch(base+`/api/db04/processing?processingId=${receipt.processingId}`,{headers:{authorization:`Bearer ${token}`}});
            expect(read.status).toBe(200);const payload=await read.json();expect(dashboardContext(payload,receipt.processingId).transactions).toHaveLength(2);
            expect(payload.financialViews.cashMovement.net).toBe('6380.53');expect(payload.financialViews.processingId).toBe(receipt.processingId);
            expect(payload.financialViews.report.sources).toEqual(payload.financialViews.sources);expect(payload.financialViews.forecast.forecast.status).toBe('UNAVAILABLE');
            expect((await fetch(base+`/api/db04/processing?processingId=${receipt.processingId}`,{headers:{authorization:`Bearer ${otherToken}`}})).status).toBe(403);
            for(const path of ['/transactions','/reconciliation','/analytics','/forecasting','/reports','/transactions']){const page=await fetch(base+path);expect(page.status).toBe(200);expect(await page.text()).toContain('Local persisted financial processing');}
        } finally {
            if(child.pid){if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');}
        }
    },180000);
    it('uploads registered documents then binds both dashboard views to persisted GET evidence',async()=>{
        vi.stubEnv('NODE_ENV','development');vi.stubEnv('FINGENCE_DB04_LOCAL','1');vi.stubEnv('VERCEL','');
        try {
            const upload=createProcessingUploadHandler(service(),registered),get=createProcessingReadHandler(service());
            const request=()=>{const form=new FormData();form.append('documents',new File([b.bytes],'bank.csv',{type:'text/csv'}));form.append('documents',new File([l.bytes],'ledger.csv',{type:'text/csv'}));return new Request('http://localhost:3000/api/db04/processing',{method:'POST',headers:{host:'localhost:3000',authorization:`Bearer ${token}`},body:form});};
            const first=await upload(request());expect(first.status).toBe(200);const receipt=await first.json();
            expect((await (await upload(request())).json()).reused).toBe(true);
            const response=await get(new Request(`http://localhost:3000/api/db04/processing?processingId=${receipt.processingId}`,{headers:{host:'localhost:3000',authorization:`Bearer ${token}`}}));
            const context=dashboardContext(await response.json(),receipt.processingId);
            expect(context.transactions).toHaveLength(2);expect(context.proposals[0].decision).toBe('VERIFIED_SUGGESTION');
            expect(()=>dashboardContext({...context,processingId:'0'.repeat(64)},receipt.processingId)).toThrow();
        }finally{vi.unstubAllEnvs();}
    });
    it('delivers one persisted context through the protected local HTTP handler', async () => {
        vi.stubEnv('NODE_ENV','development'); vi.stubEnv('FINGENCE_DB04_LOCAL','1'); vi.stubEnv('VERCEL','');
        try {
            const first=await service().persist(token,b,l), handler=createProcessingReadHandler(service());
            const request=(session:string)=>new Request(`http://localhost:3000/api/db04/processing?processingId=${first.processingId}`,{headers:{host:'localhost:3000',authorization:`Bearer ${session}`}});
            const response=await handler(request(token));
            expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
            const body=await response.json();
            expect(body.processingId).toBe(first.processingId); expect(body.transactions).toHaveLength(2);
            expect(body.transactions[0].signed_amount).toBe('6380.53');
            expect(body.proposals[0].decision).toBe('VERIFIED_SUGGESTION');
            expect((await handler(request(otherToken))).status).toBe(403);
            expect((await handler(request('invalid'))).status).toBe(403);
        } finally {vi.unstubAllEnvs();}
    });
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
        for (const file of ['phase1-clean-setup.sql', 'c3b1-grouped-persistence-upgrade.sql', 'db02-001-warning-mutation-fence.sql', 'v2-verified-document-local.sql', 'v2-m2-local.sql', 'v2-m3-local.sql', 'db04-001-reconciliation.sql', 'db04-002-reconciliation-security.sql','db04-003-ranking-evidence.sql','db04-004-proposal-verification.sql'])
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
        await owner.query(`TRUNCATE ${s}.proposal_verifications,${s}.rankings,${s}.audit,${s}.reviews,${s}.cases,${s}.decisions,${s}.proposals,${s}.transactions,${s}.job_sources,${s}.jobs,${s}.documents`);
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
        expect((await owner.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname=$1", [s])).rows[0].n).toBe(11);
        expect((await owner.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity", [s])).rows[0].n).toBe(11);
    });
    it('persists and reads exact financial rows, source fingerprints and independent evidence', async () => {
        const first = await service().persist(token, b, l), read = await service().get(token, first.processingId);
        expect(first.reused).toBe(false);
        expect(read.job.processing_id).toBe(first.processingId);
        expect(read.sources.map(r => r.sha256)).toEqual([registered.bank, registered.ledger]);
        expect(read.transactions).toHaveLength(2);
        expect(read.transactions[0]).toMatchObject({ signed_amount: '6380.53', original_amount: '06380.53', canonical_date: '2026-03-01', date_basis: 'VALUE_DATE', value_date: '2026-03-01', transaction_date: null, sha256: registered.bank });
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
        await expect(owner.query(`INSERT INTO ${s}.transactions SELECT organization_id,processing_id,sha256,kind,'new',10,'REJECTED',canonical_date,transaction_date,value_date,posting_date,date_basis,currency,signed_amount,original_amount,reference,evidence FROM ${s}.transactions LIMIT 1`)).rejects.toMatchObject({ code: '23514' });
        await expect(owner.query(`INSERT INTO ${s}.transactions SELECT organization_id,processing_id,repeat('0',64),kind,'wrong-source',10,status,canonical_date,transaction_date,value_date,posting_date,date_basis,currency,signed_amount,original_amount,reference,evidence FROM ${s}.transactions LIMIT 1`)).rejects.toMatchObject({ code: '23503' });
        await expect(owner.query(`INSERT INTO ${s}.transactions SELECT organization_id,processing_id,sha256,kind,'wrong-decimal',10,status,canonical_date,transaction_date,value_date,posting_date,date_basis,currency,1,original_amount,reference,evidence FROM ${s}.transactions LIMIT 1`)).rejects.toMatchObject({ code: '23514' });
        await expect(owner.query(`INSERT INTO ${s}.transactions SELECT organization_id,processing_id,sha256,kind,'null-amount',10,status,canonical_date,transaction_date,value_date,posting_date,date_basis,currency,NULL,original_amount,reference,evidence FROM ${s}.transactions LIMIT 1`)).rejects.toMatchObject({ code: '23502' });
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
