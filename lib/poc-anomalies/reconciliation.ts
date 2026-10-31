import { z } from 'zod';
import { toCents } from './source';
import { reviewStates, reviewableStatuses, type ReviewState } from '../poc-reconciliation/reviews';

/**
 * Read-only consumer view of Codex's `FinancePoCReconciliationV1` snapshot (issue #30,
 * PoC implementation brief). Codex owns the producer and the matching rules; this module
 * only validates a supplied snapshot before the report quotes it. Nothing here matches,
 * repairs or re-derives reconciliation outcomes.
 */
export const RECONCILIATION_STATUSES = ['MATCH_EXACT', 'MATCH_DATE_SHIFT', 'BANK_ONLY', 'LEDGER_ONLY', 'AMOUNT_MISMATCH_REVIEW', 'AMBIGUOUS_DUPLICATE_LEDGER', 'REFERENCE_MISMATCH_REVIEW'] as const;
export type ReconciliationStatus = typeof RECONCILIATION_STATUSES[number];
const decimal = z.string().regex(/^-?\d{1,12}\.\d{2}$/), id = z.string().min(1).max(128), status = z.enum(RECONCILIATION_STATUSES);
const result = z.object({ status, bankRecordId: id.nullable(), ledgerRecordIds: z.array(id), reason: z.string().max(500), bankEvidenceIds: z.array(id), ledgerEvidenceIds: z.array(id) });
const snapshot = z.object({
    version: z.literal('finance-poc-reconciliation-v1'),
    origin: z.literal('DETERMINISTIC_RULES'),
    scope: z.object({ organizationId: id, businessId: id, period: z.string().regex(/^\d{4}-\d{2}$/), currency: z.string().regex(/^[A-Z]{3}$/) }),
    sources: z.object({ bank: z.object({ sourceId: id, sha256: z.string().regex(/^[0-9a-f]{64}$/) }), ledger: z.object({ sourceId: id, sha256: z.string().regex(/^[0-9a-f]{64}$/) }) }),
    cashMovement: z.object({ bank: decimal, ledger: decimal, signedDifference: decimal }),
    counts: z.partialRecord(status, z.number().int().nonnegative()),
    // The brief names row outcomes `results`; issue #30 calls them `items`. Either is accepted, never both.
    results: z.array(result).optional(),
    items: z.array(result).optional(),
    limitations: z.array(z.string().max(500)),
});
export type FinancePoCReconciliationV1 = Omit<z.infer<typeof snapshot>, 'items' | 'results'> & { results: z.infer<typeof result>[] };
export type ReconciliationView =
    | { status: 'AVAILABLE'; snapshot: FinancePoCReconciliationV1 }
    | { status: 'UNAVAILABLE'; reason: string };
export type ReconciliationScope = { organizationId: string; businessId: string; period: string; currency: string; bankSha256: string };

/** Unavailable unless the snapshot is well formed, internally consistent and exactly in scope. */
export function readReconciliation(value: unknown, scope: ReconciliationScope): ReconciliationView {
    if (value === null || value === undefined) return { status: 'UNAVAILABLE', reason: 'No unique reconciliation snapshot matches this uploaded bank source, organization, business, period and currency.' };
    const parsed = snapshot.safeParse(value);
    if (!parsed.success || (parsed.data.results && parsed.data.items)) return { status: 'UNAVAILABLE', reason: 'The reconciliation snapshot does not match the FinancePoCReconciliationV1 contract.' };
    const { items, results: listed, ...rest } = parsed.data, results = listed ?? items ?? [];
    const s = rest.scope;
    if (s.organizationId !== scope.organizationId || s.businessId !== scope.businessId || s.period !== scope.period || s.currency !== scope.currency)
        return { status: 'UNAVAILABLE', reason: 'The reconciliation snapshot belongs to a different organization, business, period or currency.' };
    if (rest.sources.bank.sha256 !== scope.bankSha256)
        return { status: 'UNAVAILABLE', reason: 'The reconciliation snapshot belongs to a different uploaded bank source (SHA-256 mismatch).' };
    const tally = Object.fromEntries(RECONCILIATION_STATUSES.map(k => [k, 0])) as Record<ReconciliationStatus, number>;
    for (const r of results) tally[r.status]++;
    if (RECONCILIATION_STATUSES.some(k => (rest.counts[k] ?? 0) !== tally[k]))
        return { status: 'UNAVAILABLE', reason: 'Reconciliation counts do not equal its row-level results.' };
    if (toCents(rest.cashMovement.bank) - toCents(rest.cashMovement.ledger) !== toCents(rest.cashMovement.signedDifference))
        return { status: 'UNAVAILABLE', reason: 'Reconciliation cash movement difference is not bank minus ledger.' };
    return { status: 'AVAILABLE', snapshot: { ...rest, counts: tally, results } };
}

/**
 * Human reconciliation-review annotations (issue #51). Read-only summary of the reviewers'
 * current states over the snapshot's original review-eligible outcomes. Annotations never
 * change the snapshot: EXPLAINED is not matched, reconciled, cleared or settled.
 */
export type HumanReviewState = ReviewState;
export type HumanReviewView =
    | { status: 'AVAILABLE'; version: 'poc-report-reconciliation-review-v1'; reconciliationId: string; originalEligible: number; eligibleByStatus: Partial<Record<ReconciliationStatus, number>>; states: Record<HumanReviewState, number>; basis: string }
    | { status: 'UNAVAILABLE'; reason: string };
export const HUMAN_REVIEW_BASIS = 'Current reviewer annotations on the original review-eligible reconciliation outcomes. Explained records an explanation only; it does not mean matched, reconciled, cleared or settled. Original outcomes and the signed difference are unchanged.';
const unavailable = (reason: string): HumanReviewView => ({ status: 'UNAVAILABLE', reason });

/** Unavailable unless the aggregate describes exactly this snapshot's scope and source pair and accounts for every eligible outcome once. */
export function readHumanReview(value: unknown, reconciliation: ReconciliationView): HumanReviewView {
    if (reconciliation.status !== 'AVAILABLE') return unavailable('Reconciliation is unavailable for this source, so no human review summary is reported.');
    if (value === null || value === undefined) return unavailable('Human review decisions are unavailable: no unique, consistent persisted reconciliation matches this bank and ledger source pair.');
    const a = value as { version?: unknown; reconciliationId?: unknown; scope?: Record<string, unknown>; sources?: { bank?: Record<string, unknown>; ledger?: Record<string, unknown> }; eligible?: unknown; states?: Record<string, unknown> };
    const snap = reconciliation.snapshot;
    const eligibleByStatus = Object.fromEntries(reviewableStatuses.map(k => [k, snap.counts[k] ?? 0])) as Partial<Record<ReconciliationStatus, number>>;
    const originalEligible = Object.values(eligibleByStatus).reduce((sum, n) => sum + (n ?? 0), 0);
    const bound = a.version === 'poc-reconciliation-review-aggregate-v1' && typeof a.reconciliationId === 'string'
        && (['organizationId', 'businessId', 'period', 'currency'] as const).every(k => a.scope?.[k] === snap.scope[k])
        && (['bank', 'ledger'] as const).every(k => a.sources?.[k]?.sha256 === snap.sources[k].sha256 && a.sources?.[k]?.sourceId === snap.sources[k].sourceId);
    if (!bound) return unavailable('The human review summary does not belong to this reconciliation scope and source pair.');
    const states = a.states ?? {}, keys = Object.keys(states);
    if (keys.length !== reviewStates.length || !reviewStates.every(k => Number.isSafeInteger(states[k]) && (states[k] as number) >= 0))
        return unavailable('The human review summary is not well formed.');
    const counted = reviewStates.reduce((sum, k) => sum + (states[k] as number), 0);
    if (a.eligible !== originalEligible || counted !== originalEligible)
        return unavailable('Human review states do not account for every original review-eligible outcome exactly once.');
    return { status: 'AVAILABLE', version: 'poc-report-reconciliation-review-v1', reconciliationId: a.reconciliationId as string, originalEligible, eligibleByStatus,
        states: Object.fromEntries(reviewStates.map(k => [k, states[k]])) as Record<HumanReviewState, number>, basis: HUMAN_REVIEW_BASIS };
}
