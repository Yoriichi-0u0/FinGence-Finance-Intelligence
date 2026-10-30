import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { TransactionDatabase, SqlConnection } from '../../db/postgres';
import { PersistenceError } from '../../persistence/contracts';
import { extractTrustedEvidence, createExperimentalBatch, createExtractionFailureBatch, createV2Persistence, type VerifiedDocumentBatchV1 } from '../v2-i1/persistence';
import { operations, validOperationId } from '../v2-i1/operations';
import { materializePlan } from '../../../ai-ingestion/increment-03/plan';
import { subtractDecimalStrings } from '../../../analytics/index';
import { offlineSemanticAdapter, type M2Interpreter } from './interpreter';
import { resolveM2Principal, auditM2 } from './identity';
export type M2Stage = {
    name: string;
    state: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
};
export async function installM2Schema(database: TransactionDatabase) {
    await database.transaction(async (tx) => {
        const exists = await tx.query<{
            present: boolean;
        }>("SELECT to_regclass('public.security_audit_events') IS NOT NULL AS present");
        const schemas = [
            ...(exists.rows[0].present ? [] : await Promise.all([
                readFile('supabase/sql/phase3-security-audit-upgrade.sql', 'utf8'),
                readFile('supabase/sql/phase3-security-audit-api-events.sql', 'utf8'),
            ])),
            await readFile('supabase/sql/v2-m2-local.sql', 'utf8'),
        ];
        // These declarative local DDL files contain no procedural bodies/string semicolons.
        for (const schema of schemas)
            for (const statement of schema.replace(/--[^\n]*/g, '').replace(/\b(?:BEGIN|COMMIT);/g, '').split(';').filter(s => s.trim()))
                await tx.query(statement);
    });
}
export async function registeredM2Source(bytes: Uint8Array) {
    const hash = createHash('sha256').update(bytes).digest('hex');
    // Explicit paths keep deployment tracing limited to approved public manifests.
    const manifests = await Promise.all([
        readFile('public/samples/ai-ingestion/manifest.json', 'utf8'),
        readFile('public/samples/ai-ingestion-increment-02/manifest.json', 'utf8'),
        readFile('public/samples/ai-ingestion-increment-03/manifest.json', 'utf8'),
        readFile('synthetic/ai-ingestion-i2/manifest.json', 'utf8'),
        readFile('synthetic/m2/manifest.json', 'utf8'),
        readFile('synthetic/m3/manifest.json', 'utf8'),
    ]);
    for (const text of manifests) {
        const manifest = JSON.parse(text);
        const entries = Object.values(manifest.files ?? manifest) as {
            sha256?: string;
        }[];
        if (entries.some(item => item?.sha256 === hash))
            return true;
    }
    return false;
}
/** Versioned V2-only calculations. Never reconstruct C1 or invent economic classifications. */
export function calculateM2Batch(batch: VerifiedDocumentBatchV1, warningPolicy: 'include' | 'exclude' = 'exclude') {
    const v = batch.verification;
    const groups = new Map<string, {
        currency: string | null;
        monetaryBasis: string | null;
        status: 'AVAILABLE' | 'UNAVAILABLE';
        reason: string | null;
        total: string | null;
        sources: {
            recordId: string;
            evidenceIds: string[];
        }[];
    }>();
    const selected = (v?.accepted ?? []).filter(r => warningPolicy === 'include' || r.status === 'VALID');
    for (const row of selected) {
        const f = row.financial;
        const key = JSON.stringify([f.currency, f.monetary_basis]);
        let group = groups.get(key);
        if (!group) {
            group = { currency: f.currency, monetaryBasis: f.monetary_basis, status: 'AVAILABLE', reason: null, total: '0', sources: [] };
            groups.set(key, group);
        }
        group.sources.push({ recordId: row.id, evidenceIds: row.evidenceIds });
        if (f.currency_basis !== 'SOURCE' || !f.currency || f.monetary_basis !== 'source_signed_amount' || f.source_amount === null || batch.documentQuarantine || !v?.coverage.rowCountEstablished) {
            group.status = 'UNAVAILABLE';
            group.reason = 'UNSUPPORTED_OR_INCOMPLETE_FINANCIAL_BASIS';
            group.total = null;
            continue;
        }
        if (group.total !== null) {
            const amount = f.source_amount;
            group.total = subtractDecimalStrings(group.total, amount.startsWith('-') ? amount.slice(1) : '-' + amount);
        }
    }
    return { version: 'm2-financial-report-v1' as const, publicationEligible: false, kind: 'SOURCE_SIGNED_AMOUNT_SUM' as const, attemptId: batch.attemptId, source: batch.source, policyVersion: batch.policyVersion, policyHash: batch.policyHash, conventions: batch.blueprint?.conventions ?? null, origin: batch.processing?.mode ?? 'NOT_EXECUTED', adapter: batch.receipt, warningPolicy, excludedWarnings: (v?.accepted.length ?? 0) - selected.length, coverage: v?.coverage ?? null, records: selected.map(row => ({ id: row.id, status: row.status, financial: row.financial, issues: row.issues, evidence: row.evidenceIds.map(id => batch.evidence?.items.find(item => item.id === id) ?? null) })), quarantine: { document: batch.documentQuarantine, rejected: v?.rejected ?? [], unresolved: v?.unresolved ?? [] }, groups: [...groups.values()], limitations: ['Experimental machine verification; not client-approved accounting conclusions.', 'Source-signed amounts are not revenue, expenses, profit or cash flow.'], answerOrigin: 'DETERMINISTIC_ONLY' as const };
}
export function createM2Pipeline(database: TransactionDatabase, interpreter: M2Interpreter = offlineSemanticAdapter) {
    const locked = (tx: SqlConnection): TransactionDatabase => ({ transaction: work => work(tx), close: async () => { } });
    const auth = (token: string) => database.transaction(tx => resolveM2Principal(tx, token));
    return {
        async reserve(token: string) { return database.transaction(async (tx) => { const p = await resolveM2Principal(tx, token), id = randomUUID(); await tx.query("INSERT INTO fingence_m2.jobs(id,organization_id,user_id,state) VALUES($1,$2,$3,'RESERVED')", [id, p.organization_id, p.user_id]); await auditM2(tx, p, 'persistence_attempt.created', id); return { id }; }); },
        async list(token: string) { return database.transaction(async (tx) => { const p = await resolveM2Principal(tx, token); const r = await tx.query('SELECT id::text,state,stages,created_at FROM fingence_m2.jobs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100', [p.organization_id]); await auditM2(tx, p, 'batch.read', 'jobs'); return r.rows; }); },
        async get(token: string, id: string, warningPolicy: 'include' | 'exclude' = 'exclude') {
            if (!validOperationId(id) || !['include', 'exclude'].includes(warningPolicy))
                throw new Error('ACCESS_DENIED');
            return database.transaction(async (tx) => {
                const p = await resolveM2Principal(tx, token);
                const job = (await tx.query('SELECT id::text,state,stages,failure_code FROM fingence_m2.jobs WHERE id=$1 AND organization_id=$2 FOR SHARE', [id, p.organization_id])).rows[0];
                if (!job)
                    throw new Error('ACCESS_DENIED');
                const owned = await tx.query('SELECT attempt_id FROM fingence_m2.batch_owners WHERE attempt_id=$1 AND organization_id=$2 FOR SHARE', [id, p.organization_id]);
                const batch = owned.rows.length ? await createV2Persistence(locked(tx)).get(id, p.organization_id) : null;
                const report = batch ? calculateM2Batch(batch, warningPolicy) : null;
                await auditM2(tx, p, 'report.read', id);
                return { job, batch, report };
            });
        },
        async reference(token:string,id:string){
            if(!validOperationId(id))throw new Error('ACCESS_DENIED');
            return database.transaction(async tx=>{const p=await resolveM2Principal(tx,token);const row=await tx.query('SELECT id FROM fingence_m2.jobs WHERE id=$1 AND organization_id=$2 AND user_id=$3',[id,p.organization_id,p.user_id]);await auditM2(tx,p,'batch.read',id);return {owned:row.rows.length===1,ownerUserId:row.rows.length===1?p.user_id:null};});
        },
        async investigate(token: string, id: string) { if (!validOperationId(id))
            throw new Error('ACCESS_DENIED'); return database.transaction(async (tx) => { const p = await resolveM2Principal(tx, token); const job = await tx.query('SELECT state FROM fingence_m2.jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE', [id, p.organization_id]); if (!job.rows.length)
            throw new Error('ACCESS_DENIED'); const result = await operations(locked(tx)).lookup(id, p.organization_id); if (result.outcome === 'CONFIRMED_NOT_COMMITTED' && job.rows[0].state === 'UNCERTAIN')
            await tx.query("UPDATE fingence_m2.jobs SET state='FAILED' WHERE id=$1 AND organization_id=$2", [id, p.organization_id]); await auditM2(tx, p, 'batch.read', id); return { outcome: result.outcome }; }); },
        async cancel(token: string, id: string) { if (!validOperationId(id))
            throw new Error('ACCESS_DENIED'); return database.transaction(async (tx) => { const p = await resolveM2Principal(tx, token); const row = await tx.query("UPDATE fingence_m2.jobs SET state='CANCELLED' WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND state='RESERVED' RETURNING id", [id, p.organization_id, p.user_id]); if (row.rowCount !== 1)
            throw new Error('OPERATION_UNRESOLVED'); await operations(locked(tx)).cancelUnclaimed(id, p.organization_id); await auditM2(tx, p, 'ingestion.rejected', id); return { state: 'CANCELLED' }; }); },
        async process(token: string, id: string, bytes: Uint8Array, filename: string, emit: (stage: M2Stage) => void = () => { }) {
            if (!validOperationId(id) || !bytes.length || bytes.length > 10 * 1024 * 1024 || !await registeredM2Source(bytes))
                throw new Error('REGISTERED_SYNTHETIC_REQUIRED');
            const principal = await auth(token);
            await database.transaction(async (tx) => { const p = await resolveM2Principal(tx, token); const result = await tx.query("UPDATE fingence_m2.jobs SET state='PROCESSING' WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND state='RESERVED' RETURNING id", [id, p.organization_id, p.user_id]); if (result.rowCount !== 1)
                throw new Error('ATTEMPT_ALREADY_CLAIMED'); if (!await operations(locked(tx)).claim(id, p.organization_id))
                throw new Error('ATTEMPT_ALREADY_CLAIMED'); await auditM2(tx, p, 'ingestion.upload_attempt', id); });
            const stages: M2Stage[] = [];
            const stage = async (name: string, state: M2Stage['state']) => { const next = { name, state }; const found = stages.findIndex(s => s.name === name); if (found < 0)
                stages.push(next);
            else
                stages[found] = next; await database.transaction(async (tx) => { await tx.query('UPDATE fingence_m2.jobs SET stages=$2::jsonb WHERE id=$1 AND organization_id=$3', [id, JSON.stringify(stages), principal.organization_id]); }); emit(next); };
            try {
                await stage('extraction', 'RUNNING');
                let evidence = null;
                try {
                    evidence = await extractTrustedEvidence(bytes, filename);
                }
                catch { }
                await stage('extraction', evidence ? 'COMPLETED' : 'FAILED');
                let blueprint = null, receipt = null;
                await stage('interpretation', 'RUNNING');
                if (evidence) {
                    const proposed = await interpreter.propose(evidence);
                    if (proposed.receipt.mode !== (interpreter.mode === 'SIMULATED' ? 'RECORDED_TEST' : 'LIVE_GROQ'))
                        throw new PersistenceError('UNSUPPORTED_VERSION');
                    receipt = proposed.receipt;
                    try {
                        blueprint = materializePlan(evidence, proposed.plan);
                    }
                    catch { /* Abstain. Verifier records every observable row as unresolved. */ }
                }
                await stage('interpretation', evidence ? 'COMPLETED' : 'BLOCKED');
                await stage('verification', 'RUNNING');
                const identity = { attemptId: id, jobId: id, executionId: randomUUID(), tenantId: principal.organization_id };
                const processing = { mode: interpreter.mode === 'SIMULATED' ? 'RECORDED_TEST' as const : 'LIVE_GROQ' as const, stages: [...stages.filter(stage => !['verification', 'persistence'].includes(stage.name)), { name: 'verification', state: 'COMPLETED' as const }, { name: 'persistence', state: 'COMPLETED' as const }] };
                const batch = evidence ? createExperimentalBatch({ ...identity, sourceBytes: bytes, evidence, blueprint, origin: receipt?.mode ?? null, receipt, processing }) : createExtractionFailureBatch({ ...identity, bytes, filename, processing });
                await stage('verification', 'COMPLETED');
                await stage('persistence', 'RUNNING');
                const owned: TransactionDatabase = { close: async () => { }, transaction: work => database.transaction(async (tx) => {
                        const p = await resolveM2Principal(tx, token);
                        if (p.organization_id !== batch.tenantId)
                            throw new Error('ACCESS_DENIED');
                        const value = await work(tx);
                        await tx.query('INSERT INTO fingence_m2.batch_owners VALUES($1,$2,$3)', [id, p.organization_id, p.user_id]);
                        await auditM2(tx, p, 'ingestion.persisted', id);
                        const done = [...stages.filter(s => s.name !== 'persistence'), { name: 'persistence', state: 'COMPLETED' }];
                        await tx.query("UPDATE fingence_m2.jobs SET state='COMPLETED',stages=$2::jsonb WHERE id=$1 AND organization_id=$3", [id, JSON.stringify(done), p.organization_id]);
                        return value;
                    }) };
                await createV2Persistence(owned).persist(batch);
                emit({ name: 'persistence', state: 'COMPLETED' });
                return { id };
            }
            catch (error) {
                const code = error instanceof PersistenceError ? error.code : 'UNCLASSIFIED_FAILURE';
                const uncertain = ['COMMIT_OUTCOME_UNKNOWN', 'ROLLBACK_UNCONFIRMED', 'UNCLASSIFIED_FAILURE'].includes(code);
                await database.transaction(async (tx) => { await tx.query("UPDATE fingence_m2.jobs SET state=$3,failure_code=$4 WHERE id=$1 AND organization_id=$2 AND state='PROCESSING'", [id, principal.organization_id, uncertain ? 'UNCERTAIN' : 'FAILED', code]); });
                await operations(database).fail(id, principal.organization_id, code, uncertain);
                throw new Error('OPERATION_NOT_CONFIRMED');
            }
        },
    };
}
