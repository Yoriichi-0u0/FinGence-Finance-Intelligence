import 'server-only';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { TransactionDatabase, SqlConnection } from '../../db/postgres';
import type { SemanticEvidence } from '../../../ai-ingestion/increment-02/contracts';
import { hash, prepareRequest, requestPlanSchema, policyHash, promptRevision } from '../../../ai-ingestion/increment-03/plan';
import { auditM2 } from '../m2/identity';
import { resolveM3Principal } from '../../financial-m3/management';
import { offlineSemanticAdapter, InterpretationFailure, type M2Interpreter, type M2InferenceContext } from '../m2/interpreter';
import { createM2Pipeline } from '../m2/pipeline';
import { UncertainDispatchError, type Provider03, type Receipt03 } from '../increment-03/providers';
export async function installM4Schema(db: TransactionDatabase) { const sql = await readFile('supabase/sql/v2-m4-local.sql', 'utf8'); await db.transaction(async (tx) => { for (const s of sql.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim()))
    await tx.query(s); }); }
export type M4Origin = 'RECORDED_TEST' | 'LIVE_GROQ';
const receiptSchema = z.object({ mode: z.enum(['RECORDED_TEST', 'LIVE_GROQ']), model: z.string().max(100), requestId: z.string().max(300).nullable(), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(), reasoningTokens: z.number().int().nonnegative().nullable(), estimatedUsd: z.number().nonnegative().nullable(), retries: z.literal(0), durationMs: z.number().nonnegative(), outputHash: z.string().regex(/^[a-f0-9]{64}$/), finishReason: z.string().max(100).optional() });
/** Explicit dynamic test transport. No labels, fixture filenames, credentials or network. */
export function recordedControl(evidence: SemanticEvidence): Provider03 {
    return { async propose(request) {
            if (request.promptHash !== prepareRequest(evidence).promptHash)
                throw Error('SOURCE_REQUEST_MISMATCH');
            const result = await offlineSemanticAdapter.propose(evidence), aliases = new Map(evidence.items.map((item, n) => [item.id, `e${n}`]));
            const original = result.plan as import('../../../ai-ingestion/increment-03/plan').InterpretationPlan03;
            const plan = { ...original, fields: original.fields.map(f => ({ ...f, headerId: aliases.get(f.headerId)! })), context: original.context.map(c => ({ ...c, evidenceId: aliases.get(c.evidenceId)! })) };
            return { plan, receipt: { ...result.receipt, model: 'M4_RECORDED_CONTROL_V1', finishReason: 'stop', outputHash: hash(plan) } };
        } };
}
export interface M4Configuration {
    origin: M4Origin;
    /** Trusted OS-side preparation, never browser JSON. Live factory must consume owner grant + canonical ledger. */
    prepare?: (evidence: SemanticEvidence, context: M2InferenceContext) => Promise<{
        authorizationId: string;
        provider: Provider03;
        settle?: (known: boolean) => void;
    }>;
    control?: (evidence: SemanticEvidence) => Provider03;
}
async function scoped(tx: SqlConnection, context: M2InferenceContext) {
    const p = await resolveM3Principal(tx, context.token);
    if (p.user_id !== context.principal.user_id || p.organization_id !== context.principal.organization_id || p.version !== context.principal.version)
        throw Error('ACCESS_DENIED');
    const job = await tx.query("SELECT id FROM fingence_m2.jobs WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND state='PROCESSING' FOR SHARE", [context.operationId, p.organization_id, p.user_id]);
    if (!job.rows.length)
        throw Error('ACCESS_DENIED');
    return p;
}
export function createM4Interpreter(db: TransactionDatabase, config: M4Configuration): M2Interpreter {
    return { mode: config.origin, async propose(evidence, context) {
            if (!context || evidence.sourceId !== context.sourceSha256)
                throw new InterpretationFailure('SOURCE_REQUEST_MISMATCH', false);
            const request = prepareRequest(evidence);
            await db.transaction(tx => scoped(tx, context));
            let provider: Provider03, authorizationId: string | null = null, settle: ((known: boolean) => void) | undefined;
            try {
                if (config.origin === 'LIVE_GROQ') {
                    if (!config.prepare)
                        throw Error('OWNER_AUTHORIZATION_REQUIRED');
                    const prepared = await config.prepare(evidence, context);
                    provider = prepared.provider;
                    authorizationId = prepared.authorizationId;
                    settle = prepared.settle;
                }
                else
                    provider = (config.control ?? recordedControl)(evidence);
            }
            catch {
                throw new InterpretationFailure('PROVIDER_NOT_EXECUTED', false);
            }
            await db.transaction(async (tx) => {
                await scoped(tx, context);
                // Durable before transport; a crash here is intentionally unresolved, never automatically retried.
                if (config.origin === 'LIVE_GROQ' && (await tx.query("SELECT operation_id FROM fingence_m4.inferences WHERE origin='LIVE_GROQ' AND state IN ('DISPATCHING','UNKNOWN') LIMIT 1")).rows.length)
                    throw new InterpretationFailure('DISPATCH_OUTCOME_UNRESOLVED', false);
                await tx.query('INSERT INTO fingence_m4.inferences(operation_id,organization_id,user_id,execution_id,source_sha256,prompt_hash,policy_hash,prompt_revision,origin,state,authorization_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,\'DISPATCHING\',$10)', [context.operationId, context.principal.organization_id, context.principal.user_id, context.executionId, evidence.sourceId, request.promptHash, policyHash, promptRevision, config.origin, authorizationId]);
            });
            try {
                const output = await provider.propose(request), receipt = receiptSchema.parse(output.receipt);
                if (receipt.mode !== config.origin || receipt.outputHash !== hash(output.plan) || config.origin === 'LIVE_GROQ' && (receipt.model !== 'openai/gpt-oss-20b' || !receipt.requestId || receipt.inputTokens === null || receipt.outputTokens === null || receipt.estimatedUsd !== 0))
                    throw Error('INVALID_PROVIDER_RECEIPT');
                const encoded = JSON.stringify(output.plan);
                if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > 65536)
                    throw Error('INVALID_PROVIDER_RECEIPT');
                const allowed = receipt.finishReason === 'stop' && requestPlanSchema(evidence).safeParse(output.plan).success;
                await db.transaction(async (tx) => { await tx.query("UPDATE fingence_m4.inferences SET state='COMPLETED',proposal=$2::jsonb,receipt=$3::jsonb,verification_allowed=$4,reason=$5 WHERE operation_id=$1", [context.operationId, encoded, JSON.stringify(receipt), allowed, allowed ? null : receipt.finishReason !== 'stop' ? 'INCOMPLETE_OUTPUT' : 'PLAN_SCHEMA_INVALID']); });
                settle?.(true);
                return { plan: output.plan, receipt: receipt as Receipt03, verificationAllowed: allowed };
            }
            catch (error) {
                const known = error instanceof InterpretationFailure && !error.uncertain || error instanceof Error && /^(QUOTA_|ONE_SHOT_|LIVE_GROQ_UNAVAILABLE|REQUEST_CANCELED)/.test(error.message) && !(error instanceof UncertainDispatchError);
                try {
                    await db.transaction(tx => tx.query('UPDATE fingence_m4.inferences SET state=$2,reason=$3,reservation_id=$4 WHERE operation_id=$1', [context.operationId, known ? 'NOT_EXECUTED' : 'UNKNOWN', known ? 'PROVIDER_NOT_EXECUTED' : 'DISPATCHED_UNKNOWN', error instanceof UncertainDispatchError ? error.reservationId : null]));
                }
                catch { /* DISPATCHING remains a durable unresolved fence. */ }
                try {
                    settle?.(known);
                }
                catch {
                    throw new InterpretationFailure('DISPATCHED_UNKNOWN', true);
                }
                throw new InterpretationFailure(known ? 'PROVIDER_NOT_EXECUTED' : 'DISPATCHED_UNKNOWN', !known);
            }
        } };
}
export function createM4Pipeline(db: TransactionDatabase, config: M4Configuration = { origin: 'RECORDED_TEST' }) {
    const base = createM2Pipeline(db, createM4Interpreter(db, config), resolveM3Principal);
    const metadata = async (token: string, id: string) => db.transaction(async (tx) => { const p = await resolveM3Principal(tx, token); const record=(await tx.query('SELECT operation_id,execution_id,source_sha256,prompt_hash,policy_hash,prompt_revision,origin,state,receipt,verification_allowed,reason FROM fingence_m4.inferences WHERE operation_id=$1 AND organization_id=$2', [id, p.organization_id])).rows[0] ?? null; await auditM2(tx,p,'batch.read',id); return record; });
    return { ...base, async get(token: string, id: string, warnings: 'include' | 'exclude' = 'exclude') { const result = await base.get(token, id, warnings); return { ...result, inference: await metadata(token, id) }; },
        async investigate(token: string, id: string) { const record = await metadata(token, id); if (record && ['DISPATCHING', 'UNKNOWN'].includes(String(record.state)))
            return { outcome: 'UNRESOLVED' as const, reason: 'DISPATCH_OUTCOME_UNKNOWN' }; return base.investigate(token, id); }, metadata };
}
