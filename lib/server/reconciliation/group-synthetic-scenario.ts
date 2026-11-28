import 'server-only';
import type {TransactionDatabase} from '../db/postgres';
import {createReconciliationBackend} from './backend';
import {createGroupSyntheticAdmission,restrictedSyntheticBroker,SYNTHETIC_ROLES} from './group-synthetic';
import {digest} from './processing';
import {normalizeCashSource} from '../poc-reconciliation/normalize';
import type {Provider} from './ai03/types';

type Connections={financial:TransactionDatabase;broker:TransactionDatabase};
const expected={bank:'d496b00bcc826e6833770d373c8977fd4ff4163416e2c4e2e1c50938a9b9c2ec',ledger:'d71e68cb8aae56e87c86b9106fe8ff96f674d08f31111f79117640d1dbbf6be4'};
/** Explicit synthetic CLI operation, never called by an HTTP route. The operator
 * must establish exact target, private credentials and owner approval first.
 * Throws on first failed check; no retries, migrations or cleanup of stored data.
 */
export async function exerciseGroupSynthetic(input:{open:()=>Connections;bank:Uint8Array;ledger:Uint8Array;e5:Provider;environment:'LOCAL_SYNTHETIC'|'GROUP_HOSTED'}){
    const checks:string[]=[];
    const check=(id:string,passed:boolean)=>{if(!passed)throw Error(`SYNTHETIC_CHECK_FAILED:${id}`);checks.push(id);};
    check('REGISTERED_SOURCE_FINGERPRINTS',digest(input.bank)===expected.bank&&digest(input.ledger)===expected.ledger);
    let connections=input.open();
    let open=true;
    const close=async()=>{if(!open)return;open=false;const results=await Promise.allSettled([connections.financial.close(),connections.broker.close()]);if(results.some(r=>r.status==='rejected'))throw Error('SYNTHETIC_CONNECTION_CLEANUP_FAILED');};
    const compose=()=>createReconciliationBackend({financial:connections.financial,registry:expected,admission:createGroupSyntheticAdmission(restrictedSyntheticBroker(connections.broker))});
    try{
        for(const kind of ['runtime','broker'] as const){
            const db=kind==='runtime'?connections.financial:connections.broker;
            const role=await db.transaction(async tx=>{
                await tx.query('SET TRANSACTION READ ONLY');
                return (await tx.query(`SELECT current_database() AS database,current_user AS role,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,
                  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls,
                  EXISTS(SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolbypassrls OR p.rolcreatedb OR p.rolcreaterole OR p.rolname IN ('pg_monitor','pg_read_all_stats','pg_read_all_data','pg_write_all_data')) AND pg_has_role(current_user,p.oid,'MEMBER')) AS privileged_membership
                  FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
            });
            check(`${kind.toUpperCase()}_RESTRICTED_AUTHENTICATION`,role?.role===SYNTHETIC_ROLES[kind]&&!role.rolsuper&&!role.rolbypassrls&&!role.rolcreatedb&&!role.rolcreaterole&&!role.rolreplication&&!role.privileged_membership);
            if(input.environment==='GROUP_HOSTED')check(`${kind.toUpperCase()}_TLS`,role.tls===true&&role.database==='postgres');
        }
        const catalog=await connections.financial.transaction(async tx=>{
            await tx.query('SET TRANSACTION READ ONLY');
            return (await tx.query(`SELECT
             (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_reconciliation' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) AS forced,
             EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname IN ('anon','authenticated','service_role') AND n.nspname='fingence_reconciliation' AND c.relkind='r' AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE'))) AS public_access,
             EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('financial_records','ingestion_batches','validation_issues','persistence_attempts') AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))) AS foundation_access`)).rows[0];
        });
        check('ELEVEN_FORCED_RLS_TABLES',catalog.forced===11);check('NO_PUBLIC_FINANCIAL_GRANTS',catalog.public_access===false);check('NO_RUNTIME_FOUNDATION_ACCESS',catalog.foundation_access===false);
        const brokerAccess=await connections.broker.transaction(async tx=>{
            await tx.query('SET TRANSACTION READ ONLY');
            return (await tx.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fingence_reconciliation' AND c.relkind='r' AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))) AS unsafe`)).rows[0];
        });check('NO_BROKER_FINANCIAL_ACCESS',brokerAccess.unsafe===false);
        const direct=await connections.financial.transaction(tx=>tx.query('SELECT processing_id FROM fingence_reconciliation.jobs'));
        check('NO_CAPABILITY_READ_DENIED',direct.rows.length===0);
        const documents={version:'db04-trusted-ingestion/1',contract:'cash-source-v1',documents:[
            {document:{bytes:input.bank,filename:'bank.csv'},verified:normalizeCashSource(input.bank,'bank','bank.csv')},
            {document:{bytes:input.ledger,filename:'ledger.csv'},verified:normalizeCashSource(input.ledger,'ledger','ledger.csv')},
        ]};
        const first=await compose().process('PRIMARY',documents,input.e5);
        check('BACKEND_PROCESS_SUPPORTED',first.supported);
        if(!first.supported)throw Error('SYNTHETIC_UNSUPPORTED');
        const id=first.processingId;
        check('TWO_TRANSACTIONS_PERSISTED',first.transactions.length===2);
        check('EXACT_SOURCE_VALUES',first.transactions.some(r=>r.kind==='BANK'&&r.signed_amount==='6380.53'&&r.original_amount==='06380.53'&&r.date_basis==='VALUE_DATE')&&first.transactions.some(r=>r.kind==='LEDGER'&&r.signed_amount==='6380.53'&&r.date_basis==='POSTING_DATE'));
        // Documents are reusable within one organization; processing linkage lives
        // on job_sources and transactions. The read DTO projects row scope through
        // its parent job, so independently verify stored keys under a scoped lease.
        const lineage=await createGroupSyntheticAdmission(restrictedSyntheticBroker(connections.broker)).withFinance('PRIMARY',cap=>connections.financial.transaction(async tx=>{
            await tx.query("SELECT set_config('fingence.reconciliation_token_hash',$1,true)",[digest(cap)]);
            const rows=await tx.query(`SELECT t.organization_id::text,t.processing_id,t.kind,t.sha256 FROM fingence_reconciliation.transactions t
              JOIN fingence_reconciliation.job_sources s USING(organization_id,processing_id,sha256,kind)
              WHERE t.processing_id=$1 AND t.organization_id=fingence_reconciliation.authorized_organization() ORDER BY t.kind`,[id]);
            await tx.query("INSERT INTO fingence_reconciliation.audit(organization_id,processing_id,actor_id,action) SELECT organization_id,$1,user_id,'READ' FROM fingence_reconciliation.principal()",[id]);
            return rows.rows;
        }));
        check('SOURCE_LINEAGE_STORED',first.sources.length===2&&first.sources.every(s=>s.organization_id===first.job.organization_id&&(s.kind==='BANK'||s.kind==='LEDGER')&&s.sha256===expected[s.kind==='BANK'?'bank':'ledger'])
            &&lineage.length===2&&lineage.every(t=>t.organization_id===first.job.organization_id&&t.processing_id===id&&first.sources.some(s=>s.kind===t.kind&&s.sha256===t.sha256)));
        check('DETERMINISTIC_SUGGESTION',first.proposals.some(p=>p.decision==='VERIFIED_SUGGESTION'));
        check('FUZZY_EVIDENCE',first.rankings.some(r=>r.version==='db04-fuzzy-proposals/1'));
        check('ACTUAL_E5_EVIDENCE',first.rankings.some(r=>r.version==='db04-e5-proposals/1'&&Array.isArray(r.evidence)&&r.evidence.some(e=>e.scoringEvidence?.method==='PRETRAINED_E5')));
        check('INDEPENDENT_VERIFICATION_STORED',first.proposalVerifications.length>0&&first.proposalVerifications.every(v=>v.outcome==='UNRESOLVED'));
        check('FIVE_FINANCIAL_READ_MODELS',first.financialViews.processingId===id&&first.financialViews.report.processingId===id&&first.financialViews.cashMovement.net==='6380.53'&&first.financialViews.reconciliation.verifiedSuggestions>0&&first.financialViews.forecast.forecast.status==='UNAVAILABLE');
        check('NO_AUTOMATIC_FINANCIAL_APPROVAL',first.financialViews.aiProposals.approvedTransactions===0);
        const repeated=await compose().process('PRIMARY',documents);check('DUPLICATE_REUSE',repeated.supported&&repeated.reused&&repeated.processingId===id&&repeated.transactions.length===2);
        const concurrent=await Promise.all([compose().process('PRIMARY',documents),compose().process('PRIMARY',documents)]);
        check('CONCURRENT_DUPLICATE_REUSE',concurrent.every(r=>r.supported&&r.reused&&r.processingId===id));
        await close();connections=input.open();open=true;
        const read=await compose().get('PRIMARY',id);
        check('RECONNECTED_BACKEND_RETRIEVAL',JSON.stringify(read.transactions)===JSON.stringify(first.transactions)&&JSON.stringify(read.financialViews)===JSON.stringify(first.financialViews));
        let denied=false;try{await compose().get('OTHER',id);}catch{denied=true;}check('OTHER_ORGANIZATION_DENIED',denied);
        return {environment:input.environment,checks,passed:checks.length,failed:0,processingId:id,exactNet:'6380.53',acknowledgedFinancialCommits:true,realProductionAuthenticationVerified:false};
    }finally{await close();}
}
