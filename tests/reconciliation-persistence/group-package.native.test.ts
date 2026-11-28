import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {RecoveryLab,verifyArchive} from '../../scripts/db04-group/recovery-lab.mjs';
import {snapshotGroupSynthetic} from '../../scripts/db04-group/snapshot.mjs';
import {transactionDatabase,type TransactionDatabase} from '../../lib/server/db/postgres';
import {createReconciliationBackend} from '../../lib/server/reconciliation/backend';
import {createGroupSyntheticAdmission,restrictedSyntheticBroker} from '../../lib/server/reconciliation/group-synthetic';
import {exerciseGroupSynthetic} from '../../lib/server/reconciliation/group-synthetic-scenario';
import {createFinancialProcessingService} from '../../lib/server/reconciliation/service';
import {RESEARCH_TWO_DAY_POLICY,digest} from '../../lib/server/reconciliation/processing';
import {normalizeCashSource} from '../../lib/server/poc-reconciliation/normalize';
import {LocalE5Provider} from '../../lib/server/reconciliation/ai03/model-loader';
import {createGroupedPersistenceService} from '../../lib/server/persistence/grouped';
import {syntheticResult} from '../persistence/fixtures';
const sqlRoot='supabase/sql/db04-group-review';
const b={bytes:readFileSync(new URL('./fixtures/bank.csv',import.meta.url)),filename:'bank.csv'};
const l={bytes:readFileSync(new URL('./fixtures/ledger.csv',import.meta.url)),filename:'ledger.csv'};
const registry={bank:digest(b.bytes),ledger:digest(l.bytes)};
const documents={version:'db04-trusted-ingestion/1',contract:'cash-source-v1',documents:[{document:b,verified:normalizeCashSource(b.bytes,'bank',b.filename)},{document:l,verified:normalizeCashSource(l.bytes,'ledger',l.filename)}]};
const roles=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;`;
const available=existsSync(join(process.env.DB03_PG_BIN??'C:/Program Files/PostgreSQL/18/bin','initdb.exe'));
(available?describe:describe.skip)('reviewed group package: disposable PostgreSQL ONLY',()=>{
    let lab:RecoveryLab,cluster:Awaited<ReturnType<RecoveryLab['createCluster']>>,owner:Pool;
    let financial:TransactionDatabase,broker:TransactionDatabase,id:string,failed=false,completed=false;
    const pool=(role:string,c=cluster,database='postgres')=>new Pool({host:'127.0.0.1',port:c.port,database,user:role,max:role.endsWith('broker')?2:4,connectionTimeoutMillis:5000});
    const open=()=>{financial=transactionDatabase(pool('db04_group_test_runtime'));broker=restrictedSyntheticBroker(transactionDatabase(pool('db04_group_test_broker')));};
    const backend=()=>createReconciliationBackend({financial,registry,admission:createGroupSyntheticAdmission(broker)});
    beforeAll(async()=>{
        lab=new RecoveryLab();cluster=await lab.createCluster('group-package');owner=await lab.pool(cluster);
        await owner.query(roles);
        await owner.query(readFileSync(`${sqlRoot}/install-review.sql`,'utf8'));
        await owner.query(readFileSync(`${sqlRoot}/synthetic-seed-review.sql`,'utf8'));
        // No password in this owned trust-only lab. Hosted use requires masked
        // private password provisioning before the reviewed activation step.
        await owner.query(readFileSync(`${sqlRoot}/activate-logins-review.sql`,'utf8'));open();
    },60000);
    afterEach(context=>{if(context.task.result?.state==='fail')failed=true;});
    afterAll(async()=>{await financial?.close();await broker?.close();if(lab)await lab.cleanup(completed&&!failed);},60000);
    it('installs four closed foundation tables and eleven forced-RLS reconciliation tables',async()=>{
        expect((await owner.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity")).rows[0].n).toBe(4);
        expect((await owner.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_reconciliation' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity")).rows[0].n).toBe(11);
        expect((await owner.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname IN ('fingence_m2','fingence_m3','auth')")).rows[0].n).toBe(0);
        expect((await owner.query("SELECT count(*)::int n FROM pg_constraint x JOIN pg_namespace n ON n.oid=x.connamespace WHERE n.nspname IN ('public','fingence_reconciliation') AND NOT x.convalidated")).rows[0].n).toBe(0);
    });
    it('denies public, broker and runtime foundation access and prevents privileged runtime memberships',async()=>{
        const unsafe=await owner.query(`SELECT r.rolname,c.relname FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE r.rolname IN ('anon','authenticated','service_role','db04_group_test_runtime','db04_group_test_broker') AND n.nspname='public' AND c.relkind='r'
          AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE'))`);
        expect(unsafe.rows).toEqual([]);
        expect((await owner.query("SELECT rolname FROM pg_roles WHERE rolname IN ('db04_group_test_runtime','db04_group_test_broker') AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)")).rows).toEqual([]);
        const check=pool('db04_group_test_broker');try{await expect(check.query('SELECT * FROM fingence_reconciliation.jobs')).rejects.toMatchObject({code:'42501'});}finally{await check.end();}
    });
    it('reuses DB02 grouped persistence with exact decimals and NULLs in the owned synthetic lab only',async()=>{
        const result=await syntheticResult();
        const receipt=await createGroupedPersistenceService(transactionDatabase(owner)).persistGroupedAttempt({attempt_id:randomUUID(),results:[result]});
        expect(receipt.datasets).toHaveLength(1);
        const row=(await owner.query('SELECT source_amount::text,reference,account_id,balance::text FROM public.financial_records')).rows[0];
        expect(row).toMatchObject({source_amount:'9007199254740993.123456789',reference:'00017',account_id:'00003',balance:null});
        expect((await owner.query('SELECT count(*)::int n FROM public.persistence_attempts')).rows[0].n).toBe(1);
    });
    it('persists approved source identities, deterministic/fuzzy evidence and independent unresolved outcomes',async()=>{
        const r=await backend().process('PRIMARY',documents);if(!r.supported)throw Error('Fixture unsupported');id=r.processingId;
        expect(r.transactions).toHaveLength(2);expect(r.sources.map(s=>s.sha256)).toEqual([registry.bank,registry.ledger]);
        expect(r.transactions[0]).toMatchObject({signed_amount:'6380.53',original_amount:'06380.53',date_basis:'VALUE_DATE'});
        expect(r.proposals[0].decision).toBe('VERIFIED_SUGGESTION');expect(r.rankings).toHaveLength(1);expect(r.proposalVerifications).toHaveLength(1);
        expect(r.financialViews).toMatchObject({processingId:id,cashMovement:{net:'6380.53'},aiProposals:{approvedTransactions:0},forecast:{forecast:{status:'UNAVAILABLE'}},report:{processingId:id}});
    });
    it.each([0,86400000,-86400000])('uses database-time admission with application clock offset %i ms',async offset=>{
        const actualNow=Date.now.bind(Date),spy=vi.spyOn(Date,'now').mockImplementation(()=>actualNow()+offset);
        try{await createGroupSyntheticAdmission(broker).withFinance('PRIMARY',async token=>{
            const row=(await owner.query(`SELECT expires_at>clock_timestamp() AS live,
              expires_at<=clock_timestamp()+interval '30 seconds' AS bounded,revoked
              FROM fingence_db04_group_synthetic.sessions WHERE token_hash=$1`,[digest(token)])).rows[0];
            expect(row).toEqual({live:true,bounded:true,revoked:false});
        });}finally{spy.mockRestore();}
    });
    it.each([
        ["clock_timestamp()+interval '30 seconds'",true],
        ["clock_timestamp()+interval '31 seconds'",false],
        ["clock_timestamp()-interval '1 second'",false],
    ] as const)('enforces the unchanged database deadline boundary: %s',async(expression,accepted)=>{
        const p=pool('db04_group_test_broker');const c=await p.connect();
        try{await c.query('BEGIN');
            const query=c.query(`SELECT * FROM fingence_db04_group_synthetic.issue_hosted_grant($1,$2,$3,$4,$5,${expression})`,
                [digest(randomUUID()),randomUUID(),'urn:fingence:db04:group-synthetic:1','00000000-0000-4000-8000-000000000005',randomUUID()]);
            if(accepted)expect((await query).rows).toHaveLength(1);
            else await expect(query).rejects.toMatchObject({code:'42501'});
        }finally{await c.query('ROLLBACK');c.release();await p.end();}
    });
    it.skipIf(process.env.DB04_E5_SMOKE!=='1')('stores actual pinned offline E5 rankings and independent verification via the backend',async()=>{
        const e5=new LocalE5Provider(resolve('../ai03-runtime'),resolve('../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78'));
        const r=await backend().process('PRIMARY',documents,e5);if(!r.supported)throw Error('Fixture unsupported');
        expect(r.processingId).toBe(id);expect(r.rankings).toHaveLength(2);expect(r.proposalVerifications).toHaveLength(2);
        expect(r.rankings.find(r=>r.version==='db04-e5-proposals/1')?.evidence).toEqual([expect.objectContaining({decision:'UNRESOLVED',score:expect.any(Number)})]);
        expect(r.financialViews.aiProposals.approvedTransactions).toBe(0);
    },120000);
    it('reuses duplicate jobs concurrently and retrieves identical five read models after reconnect',async()=>{
        const before=await backend().get('PRIMARY',id);
        const r=await Promise.all([backend().process('PRIMARY',documents),backend().process('PRIMARY',documents)]);
        expect(r.every(x=>x.supported&&x.reused&&x.processingId===id)).toBe(true);
        expect((await owner.query('SELECT count(*)::int n FROM fingence_reconciliation.transactions')).rows[0].n).toBe(2);
        await financial.close();await broker.close();open();
        const after=await backend().get('PRIMARY',id);expect(after.transactions).toEqual(before.transactions);expect(after.financialViews).toEqual(before.financialViews);
    });
    it('enforces cross-organization denial and empty direct runtime reads without a capability',async()=>{
        await expect(backend().get('OTHER',id)).rejects.toMatchObject({code:'PERSISTENCE_FAILED'});
        const direct=pool('db04_group_test_runtime');try{expect((await direct.query('SELECT * FROM fingence_reconciliation.jobs')).rows).toEqual([]);
            await expect(direct.query("UPDATE fingence_reconciliation.transactions SET signed_amount=0")).rejects.toMatchObject({code:'42501'});
            await expect(direct.query('SELECT * FROM fingence_db04_group_synthetic.users')).rejects.toMatchObject({code:'42501'});
        }finally{await direct.end();}
    });
    it('rolls back accepted financial inserts if their final atomic audit fails',async()=>{
        const rows=(await owner.query('SELECT count(*)::int n FROM fingence_reconciliation.jobs')).rows[0].n;
        await owner.query("CREATE FUNCTION public.synthetic_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic' USING ERRCODE='23514'; END $$;CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON fingence_reconciliation.audit FOR EACH ROW EXECUTE FUNCTION public.synthetic_audit_failure()");
        try{await expect(createGroupSyntheticAdmission(broker).withFinance('PRIMARY',cap=>createFinancialProcessingService(financial,registry,RESEARCH_TWO_DAY_POLICY).persist(cap,b,l))).rejects.toMatchObject({code:'PERSISTENCE_FAILED'});
            expect((await owner.query('SELECT count(*)::int n FROM fingence_reconciliation.jobs')).rows[0].n).toBe(rows);
        }finally{await owner.query('DROP TRIGGER synthetic_audit_failure ON fingence_reconciliation.audit;DROP FUNCTION public.synthetic_audit_failure()');}
    });
    it('keeps immutable verification history and rejects expired or revoked grants',async()=>{
        await expect(owner.query("UPDATE fingence_reconciliation.proposal_verifications SET outcome='UNRESOLVED'")).rejects.toMatchObject({code:'23514'});
        const grant=await owner.query('SELECT token_hash FROM fingence_db04_group_synthetic.sessions LIMIT 1');
        expect(grant.rows).toHaveLength(1);
        // The test mutates only its disposable synthetic lifecycle rows.
        await owner.query('UPDATE fingence_db04_group_synthetic.users SET suspended=true');
        try{await expect(backend().get('PRIMARY',id)).rejects.toMatchObject({code:'PERSISTENCE_FAILED'});}finally{await owner.query('UPDATE fingence_db04_group_synthetic.users SET suspended=false');}
        const cap='Z'.repeat(43),hash=createHash('sha256').update(cap).digest('hex');
        await owner.query("INSERT INTO fingence_db04_group_synthetic.sessions SELECT $1,$2,user_id,organization_id,$3,clock_timestamp()-interval '1 second',false,membership_version,contract_version FROM fingence_db04_group_synthetic.sessions LIMIT 1",[randomUUID(),hash,randomUUID()]);
        await expect(createFinancialProcessingService(financial,registry).get(cap,id)).rejects.toMatchObject({code:'PERSISTENCE_FAILED'});
        const revoked='Y'.repeat(43),rh=createHash('sha256').update(revoked).digest('hex');
        await owner.query("INSERT INTO fingence_db04_group_synthetic.sessions SELECT $1,$2,user_id,organization_id,$3,clock_timestamp()+interval '1 hour',true,membership_version,contract_version FROM fingence_db04_group_synthetic.sessions LIMIT 1",[randomUUID(),rh,randomUUID()]);
        await expect(createFinancialProcessingService(financial,registry).get(revoked,id)).rejects.toMatchObject({code:'PERSISTENCE_FAILED'});
    });
    it('rejects rerun or conflicting installation without changing existing data',async()=>{
        await expect(owner.query(readFileSync(`${sqlRoot}/install-review.sql`,'utf8'))).rejects.toMatchObject({code:'55000'});await owner.query('ROLLBACK');
        expect((await owner.query('SELECT count(*)::int n FROM fingence_reconciliation.jobs')).rows[0].n).toBe(1);
        const c=await lab.createCluster('conflict'),p=await lab.pool(c);await p.query(roles);await p.query('CREATE TABLE public.unrelated(id integer)');
        await expect(p.query(readFileSync(`${sqlRoot}/install-review.sql`,'utf8'))).rejects.toMatchObject({code:'55000'});await p.query('ROLLBACK');
        expect((await p.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname='fingence_reconciliation'")).rows[0].n).toBe(0);
    },60000);
    it.skipIf(process.env.DB04_E5_SMOKE!=='1')('runs the same restricted synthetic scenario intended for separately approved hosted execution',async()=>{
        // Exercise one standalone runtime, not a second process competing with
        // this fixture's idle pools for the intentionally small broker limit.
        await financial.close();await broker.close();
        try{const r=await exerciseGroupSynthetic({environment:'LOCAL_SYNTHETIC',bank:b.bytes,ledger:l.bytes,
            open:()=>({financial:transactionDatabase(pool('db04_group_test_runtime')),broker:transactionDatabase(pool('db04_group_test_broker'))}),
            e5:new LocalE5Provider(resolve('../ai03-runtime'),resolve('../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78'))});
        expect(r.failed).toBe(0);expect(r.checks).toContain('ACTUAL_E5_EVIDENCE');expect(r.checks).toContain('RECONNECTED_BACKEND_RETRIEVAL');expect(r.checks).toContain('OTHER_ORGANIZATION_DENIED');
        mkdirSync('outputs/db04-ai06',{recursive:true});writeFileSync('outputs/db04-ai06/group-local-synthetic-scenario.json',JSON.stringify(r,null,2));
        }finally{open();}
    },120000);
    it('rolls back every new object when existing default ACLs would expose newly created tables',async()=>{
        const c=await lab.createCluster('unsafe-defaults'),p=await lab.pool(c);
        await p.query(roles+'CREATE ROLE existing_reader;ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO existing_reader');
        await expect(p.query(readFileSync(`${sqlRoot}/install-review.sql`,'utf8'))).rejects.toMatchObject({code:'42501'});await p.query('ROLLBACK');
        expect((await p.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")).rows[0].n).toBe(0);
        expect((await p.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='fingence_db04_group_runtime'")).rows[0].n).toBe(0);
        expect((await p.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='existing_reader'")).rows[0].n).toBe(1);
    },60000);
    it('restores the complete synthetic package into a separate owned cluster and verifies exact rows/security metadata',async()=>{
        const before=await snapshotGroupSynthetic(owner),archive=lab.child('group-synthetic.dump'),dump=await lab.logicalDump(cluster,archive);
        expect(()=>verifyArchive(archive,'f'.repeat(64))).toThrow();
        const recovered=await lab.createCluster('restore'),restoreOwner=await lab.pool(recovered);
        await restoreOwner.query(roles+`CREATE ROLE fingence_db04_group_runtime NOLOGIN;CREATE ROLE fingence_db04_group_broker NOLOGIN;
          CREATE ROLE db04_group_test_runtime LOGIN IN ROLE fingence_db04_group_runtime;CREATE ROLE db04_group_test_broker LOGIN IN ROLE fingence_db04_group_broker;`);
        const target=await lab.freshDatabase(recovered,'db03_group_restore');await lab.logicalRestore(target,archive,dump.sha256);
        const after=await snapshotGroupSynthetic(target.pool);expect(after).toEqual(before);
        const f=transactionDatabase(pool('db04_group_test_runtime',recovered,'db03_group_restore'));
        const br=restrictedSyntheticBroker(transactionDatabase(pool('db04_group_test_broker',recovered,'db03_group_restore')));
        try{const r=await createReconciliationBackend({financial:f,registry,admission:createGroupSyntheticAdmission(br)}).get('PRIMARY',id);expect(r.financialViews.cashMovement.net).toBe('6380.53');}
        finally{await f.close();await br.close();}
        const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
        mkdirSync('outputs/db04-ai06',{recursive:true});
        writeFileSync('outputs/db04-ai06/group-local-recovery.json',JSON.stringify({localSyntheticOnly:true,hostedRecoveryVerified:false,
            serverVersion:(await owner.query('SHOW server_version')).rows[0].server_version,processingId:id,
            archiveSHA256:dump.sha256,tableCount:Object.keys(before.rows).length,
            rowsBeforeSHA256:hash(before.rows),rowsAfterSHA256:hash(after.rows),schemaBeforeSHA256:hash(before.schema),schemaAfterSHA256:hash(after.schema),
            rowCounts:Object.fromEntries(Object.entries(before.rows).map(([table,rows])=>[table,rows.length])),
            constraintsIndexesFunctionsTriggersPoliciesACLsEqual:true,restrictedRestoredRead:true,postgres17RecoveryVerified:false},null,2));
        completed=true;
    },120000);
});
