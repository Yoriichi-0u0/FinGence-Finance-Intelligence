import 'server-only';
import type { SqlConnection, TransactionDatabase } from '../db/postgres';
import { PersistenceError } from '../persistence/contracts';
import { tokenHash } from '../ai-ingestion/m2/identity';
import { approvedPoCSourceHashes } from '../poc-reconciliation/service';
import { PIPELINE_VERSION, prepareProcessing, supportedPolicy, SAME_DAY_POLICY, type RegisteredPair, type SourceInput, type VerificationPolicy } from './processing';
const schema = 'fingence_reconciliation';
async function principal(tx: SqlConnection, token: string) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
        throw Error('ACCESS_DENIED');
    await tx.query("SELECT set_config('fingence.reconciliation_token_hash',$1,true)", [tokenHash(token)]);
    const p = (await tx.query<{
        user_id: string;
        organization_id: string;
    }>(`SELECT p.user_id::text,p.organization_id::text FROM ${schema}.principal() p WHERE p.organization_id=${schema}.authorized_organization()`)).rows[0];
    if (!p)
        throw Error('ACCESS_DENIED');
    return p;
}
async function audit(tx: SqlConnection, p: {
    user_id: string;
    organization_id: string;
}, id: string, action: string) {
    await tx.query(`INSERT INTO ${schema}.audit(organization_id,processing_id,actor_id,action) VALUES($1,$2,$3,$4)`, [p.organization_id, id, p.user_id, action]);
}
/** Internal/local only. Runtime requires restricted role; no environment credentials or schema auto-install. */
export function createFinancialProcessingService(db: TransactionDatabase, registered: RegisteredPair = approvedPoCSourceHashes, policyInput: VerificationPolicy = SAME_DAY_POLICY) {
    const registry = Object.freeze({ ...registered }), policy = supportedPolicy(policyInput);
    return {
        async persist(token: string, bank: SourceInput, ledger: SourceInput) {
            return db.transaction(async (tx) => {
                const p = await principal(tx, token);
                const plan = prepareProcessing(p.organization_id, bank, ledger, registry, policy), id = plan.processingId, org = p.organization_id;
                // All writers use one transaction-scoped fence; READ COMMITTED reads after the fence see a winner.
                await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [org + ':' + id]);
                const existing = await tx.query(`SELECT 1 FROM ${schema}.jobs WHERE organization_id=$1 AND processing_id=$2`, [org, id]);
                if (existing.rows.length) {
                    await audit(tx, p, id, 'REUSED');
                    return { processingId: id, reused: true };
                }
                for (const document of [plan.bank, plan.ledger]) {
                    const s = document.source;
                    await tx.query(`INSERT INTO ${schema}.documents(organization_id,sha256,kind,classification_method,classification_version,original_name,byte_length)
      VALUES($1,$2,$3,'REGISTERED_SYNTHETIC_EXACT_SCHEMA','cash-source-v1',$4,$5) ON CONFLICT(organization_id,sha256) DO NOTHING`, [org, s.sha256, s.kind.toUpperCase(), s.filename, document.byteLength]);
                }
                await tx.query(`INSERT INTO ${schema}.jobs(organization_id,processing_id,created_by,pipeline_version,policy,status) VALUES($1,$2,$3,$4,$5::jsonb,$6)`, [org, id, p.user_id, PIPELINE_VERSION, JSON.stringify(policy), plan.status]);
                for (const s of [plan.bank.source, plan.ledger.source])
                    await tx.query(`INSERT INTO ${schema}.job_sources VALUES($1,$2,$3,$4)`, [org, id, s.sha256, s.kind.toUpperCase()]);
                for (const r of plan.transactions)
                    await tx.query(`INSERT INTO ${schema}.transactions
     (organization_id,processing_id,sha256,kind,record_id,source_row,status,canonical_date,transaction_date,posting_date,date_basis,currency,signed_amount,original_amount,reference,evidence)
     VALUES($1,$2,$3,$4,$5,$6,'VALID',$7,$8,$9,$10,'MYR',$11::numeric,$12,$13,$14::jsonb)`, [org, id, r.sha256, r.kind, r.recordId, r.row, r.date, r.kind === 'BANK' ? r.date : null, r.kind === 'LEDGER' ? r.date : null, r.kind === 'BANK' ? 'TRANSACTION_DATE' : 'POSTING_DATE', r.signedAmount, r.originalAmount, r.reference, JSON.stringify(r.evidence)]);
                for (const [i, r] of plan.proposals.entries()) {
                    await tx.query(`INSERT INTO ${schema}.proposals(organization_id,processing_id,ordinal,bank_record_id,ledger_record_id,algorithm_version,proposal_type) VALUES($1,$2,$3,$4,$5,'cash-rules-v1','ONE_TO_ONE')`, [org, id, i, r.bankRecordId, r.ledgerRecordId]);
                    await tx.query(`INSERT INTO ${schema}.decisions VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [org, id, i, policy.version, r.decision, JSON.stringify(r.checks)]);
                }
                for (const [i, c] of plan.cases.entries())
                    await tx.query(`INSERT INTO ${schema}.cases VALUES($1,$2,$3,$4,$5::jsonb)`, [org, id, i, c.reason, JSON.stringify(c.evidence)]);
                await audit(tx, p, id, 'PERSISTED');
                return { processingId: id, reused: false };
            }, { isolationLevel: 'READ COMMITTED' });
        },
        async get(token: string, id: string) {
            if (!/^[a-f0-9]{64}$/.test(id))
                throw Error('ACCESS_DENIED');
            return db.transaction(async (tx) => {
                const p = await principal(tx, token), args = [p.organization_id, id];
                const job = (await tx.query(`SELECT * FROM ${schema}.jobs WHERE organization_id=$1 AND processing_id=$2`, args)).rows[0];
                if (!job)
                    throw Error('ACCESS_DENIED');
                const sources = (await tx.query(`SELECT d.* FROM ${schema}.job_sources s JOIN ${schema}.documents d USING(organization_id,sha256,kind) WHERE s.organization_id=$1 AND s.processing_id=$2 ORDER BY kind`, args)).rows;
                // Explicit text projections avoid pg NUMERIC and DATE parser mutation by any other consumer.
                const transactions = (await tx.query(`SELECT kind,record_id,source_row,sha256,status,canonical_date::text,transaction_date::text,posting_date::text,date_basis,currency,signed_amount::text,original_amount,reference,evidence FROM ${schema}.transactions WHERE organization_id=$1 AND processing_id=$2 ORDER BY kind,source_row`, args)).rows;
                const proposals = (await tx.query(`SELECT p.*,d.policy_version,d.decision,d.checks FROM ${schema}.proposals p JOIN ${schema}.decisions d USING(organization_id,processing_id,ordinal) WHERE organization_id=$1 AND processing_id=$2 ORDER BY ordinal`, args)).rows;
                const cases = (await tx.query(`SELECT ordinal,reason,evidence FROM ${schema}.cases WHERE organization_id=$1 AND processing_id=$2 ORDER BY ordinal`, args)).rows;
                const reviews = (await tx.query(`SELECT case_ordinal,version,state,rationale,actor_id,created_at FROM ${schema}.reviews WHERE organization_id=$1 AND processing_id=$2 ORDER BY case_ordinal,version`, args)).rows;
                await audit(tx, p, id, 'READ');
                return { job, sources, transactions, proposals, cases, reviews };
            }, { isolationLevel: 'READ COMMITTED' });
        },
        async review(token: string, id: string, ordinal: number, expectedVersion: number, state: 'OPEN' | 'INVESTIGATING' | 'EXPLAINED' | 'ESCALATED', rationale: string) {
            if (!/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(ordinal) || ordinal < 0 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !['OPEN', 'INVESTIGATING', 'EXPLAINED', 'ESCALATED'].includes(state) || typeof rationale !== 'string' || !rationale.trim() || rationale.length > 600)
                throw new PersistenceError('INVALID_INPUT');
            return db.transaction(async (tx) => {
                const p = await principal(tx, token), args = [p.organization_id, id, ordinal];
                await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [args.join(':')]);
                if (!(await tx.query(`SELECT 1 FROM ${schema}.cases WHERE organization_id=$1 AND processing_id=$2 AND ordinal=$3`, args)).rows.length)
                    throw Error('ACCESS_DENIED');
                const latest = (await tx.query<{
                    version: number;
                }>(`SELECT COALESCE(max(version),0)::int version FROM ${schema}.reviews WHERE organization_id=$1 AND processing_id=$2 AND case_ordinal=$3`, args)).rows[0].version;
                if (latest !== expectedVersion)
                    throw new PersistenceError('INVALID_INPUT');
                await tx.query(`INSERT INTO ${schema}.reviews(organization_id,processing_id,case_ordinal,version,state,rationale,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [...args, latest + 1, state, rationale, p.user_id]);
                await audit(tx, p, id, 'REVIEWED');
                return { version: latest + 1 };
            }, { isolationLevel: 'READ COMMITTED' });
        }
    };
}
