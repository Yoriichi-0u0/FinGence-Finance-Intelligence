import 'server-only';
import { createHash } from 'node:crypto';
import type { SqlConnection, TransactionDatabase } from '../db/postgres';
import type { M2Principal } from '../ai-ingestion/m2/identity';
import { resolveM3Principal } from '../financial-m3/management';
import { persistSecurityAuditEvent } from '../security/audit-store';
import type { FinancePoCReconciliationV1 } from '../../poc-reconciliation/contracts';
import { reviewInput, reviewableStatuses, type ReviewInput, type ReviewRevision, type ReviewRefused, type ReconciliationReviewView } from '../../poc-reconciliation/reviews';

const refused = (code: ReviewRefused['code'] = 'UNAVAILABLE'): ReviewRefused => ({ status: 'REFUSED', code });
/** Stable across result ordering and ledger-candidate ordering; computed only from saved source identities. */
export function reconciliationOutcomeKey(snapshot: FinancePoCReconciliationV1, result: FinancePoCReconciliationV1['results'][number]) {
    return createHash('sha256').update(JSON.stringify([snapshot.sources.bank.sha256, snapshot.sources.ledger.sha256, result.status, result.bankRecordId, [...result.ledgerRecordIds].sort()])).digest('hex');
}
const eligible = (snapshot: FinancePoCReconciliationV1) => snapshot.results.flatMap((r, index) => reviewableStatuses.includes(r.status) ? [{ key: reconciliationOutcomeKey(snapshot, r), index, status: r.status }] : []);
async function saved(tx: SqlConnection, p: M2Principal, id: string, write = false) {
    if (p.role !== 'Finance' || !/^[a-f0-9-]{36}$/.test(id)) return null;
    const row = (await tx.query<{ snapshot: FinancePoCReconciliationV1; bank_sha256: string; ledger_sha256: string }>(
        `SELECT snapshot,bank_sha256,ledger_sha256 FROM fingence_poc.reconciliations WHERE id=$1 AND organization_id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`, [id, p.organization_id])).rows[0];
    if (!row || row.snapshot.scope.organizationId !== p.organization_id || row.snapshot.sources.bank.sha256 !== row.bank_sha256 || row.snapshot.sources.ledger.sha256 !== row.ledger_sha256) return null;
    return row.snapshot;
}
async function view(tx: SqlConnection, p: M2Principal, id: string, snapshot: FinancePoCReconciliationV1): Promise<ReconciliationReviewView> {
    const outcomes = eligible(snapshot), histories = new Map<string, ReviewRevision[]>();
    const rows = (await tx.query<{ outcome_key: string; state: ReviewRevision['state']; rationale: string; version: number; decided_by: string; decided_at: Date | string }>(
        'SELECT outcome_key,state,rationale,version,decided_by::text,decided_at FROM fingence_poc.reconciliation_reviews WHERE organization_id=$1 AND reconciliation_id=$2 ORDER BY outcome_key,version DESC', [p.organization_id, id])).rows;
    const keys = new Set(outcomes.map(o => o.key));
    for (const r of rows) {
        if (!keys.has(r.outcome_key)) throw Error('REVIEW_DATA_UNAVAILABLE');
        const h = histories.get(r.outcome_key) ?? [];
        h.push({ state: r.state, rationale: r.rationale, version: r.version, reviewerId: r.decided_by, decidedAt: new Date(r.decided_at).toISOString() }); histories.set(r.outcome_key, h);
    }
    const states = { OPEN: 0, INVESTIGATING: 0, EXPLAINED: 0, ESCALATED: 0 };
    const result = outcomes.map(o => {
        const history = histories.get(o.key) ?? [], review = history[0] ?? { state: 'OPEN' as const, rationale: '', version: 0, reviewerId: null, decidedAt: null };
        states[review.state]++; return { ...o, review, history };
    });
    return { status: 'OK', version: 'poc-reconciliation-reviews-v1', reconciliationId: id,
        scope: { userId: p.user_id, organizationId: p.organization_id, role: 'Finance', membershipVersion: p.version }, outcomes: result,
        aggregate: { version: 'poc-reconciliation-review-aggregate-v1', reconciliationId: id, scope: snapshot.scope, sources: snapshot.sources, eligible: result.length, states } };
}
/** Internal read-only composition for a caller's existing authorized/audited transaction. No report wiring here. */
export async function readReconciliationReviewAggregate(tx: SqlConnection, principal: M2Principal, reconciliationId: string) {
    const snapshot = await saved(tx, principal, reconciliationId);
    return snapshot ? (await view(tx, principal, reconciliationId, snapshot)).aggregate : null;
}
async function audit(tx: SqlConnection, p: M2Principal, action: 'financial_record.read' | 'reconciliation.reviewed' | 'authorization.denied', outcome: 'success' | 'failure' | 'denied', target: string) {
    await persistSecurityAuditEvent(tx, { actorId: p.user_id, organizationId: p.organization_id, action, outcome, targetType: 'financial_record', targetId: target, requestId: null, approvalId: null });
}
export function createReconciliationReviews(db: TransactionDatabase) {
    async function scoped<T>(token: string, id: string, write: boolean, work: (tx: SqlConnection, p: M2Principal, s: FinancePoCReconciliationV1) => Promise<T>) {
        return db.transaction(async tx => {
            const p = await resolveM3Principal(tx, token, false);
            if (p.role !== 'Finance') { await audit(tx, p, 'authorization.denied', 'denied', 'poc-reconciliation-review'); return refused(); }
            const snapshot = await saved(tx, p, id, write);
            if (!snapshot) { await audit(tx, p, 'financial_record.read', 'failure', 'poc-reconciliation-review'); return refused(); }
            return work(tx, p, snapshot);
        });
    }
    return {
        get: (token: string, id: string) => scoped(token, id, false, async (tx, p, snapshot) => {
            const data = await view(tx, p, id, snapshot); await audit(tx, p, 'financial_record.read', 'success', id); return data;
        }),
        async review(token: string, raw: ReviewInput) {
            const input = reviewInput.parse(raw);
            return scoped(token, input.reconciliationId, true, async (tx, p, snapshot) => {
                const data = await view(tx, p, input.reconciliationId, snapshot), item = data.outcomes.find(o => o.key === input.outcomeKey);
                if (!item) { await audit(tx, p, 'reconciliation.reviewed', 'failure', 'poc-reconciliation-review'); return refused(); }
                if (item.review.version !== input.expectedVersion) { await audit(tx, p, 'reconciliation.reviewed', 'failure', `${input.reconciliationId}:${item.key}`); return refused('STALE_REVIEW'); }
                // The parent row lock serializes the first insert too; no absent-row upsert race or nested pool transaction.
                const next = item.review.version + 1;
                await tx.query('INSERT INTO fingence_poc.reconciliation_reviews(organization_id,reconciliation_id,outcome_key,version,state,rationale,decided_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [p.organization_id, input.reconciliationId, item.key, next, input.state, input.rationale, p.user_id]);
                await audit(tx, p, 'reconciliation.reviewed', 'success', `${input.reconciliationId}:${item.key}:v${next}`);
                return { status: 'REVIEWED' as const, view: await view(tx, p, input.reconciliationId, snapshot) };
            });
        },
    };
}
