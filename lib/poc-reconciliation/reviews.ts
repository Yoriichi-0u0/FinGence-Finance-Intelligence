import { z } from 'zod';
import type { FinancePoCReconciliationV1, ReconciliationStatus } from './contracts';

export const reviewStates = ['OPEN', 'INVESTIGATING', 'EXPLAINED', 'ESCALATED'] as const;
export type ReviewState = typeof reviewStates[number];
export const reviewableStatuses: readonly ReconciliationStatus[] = ['BANK_ONLY', 'LEDGER_ONLY', 'AMOUNT_MISMATCH_REVIEW', 'AMBIGUOUS_DUPLICATE_LEDGER', 'REFERENCE_MISMATCH_REVIEW'];
/** Selection/version only. No browser identity, source facts, financial values or clearing claim. */
export const reviewInput = z.strictObject({
    reconciliationId: z.uuid(), outcomeKey: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(reviewStates),
    rationale: z.string().trim().max(600).default(''), expectedVersion: z.number().int().min(0).max(2147483646),
}).refine(v => v.state === 'OPEN' || v.rationale.length > 0);
export type ReviewInput = z.infer<typeof reviewInput>;
export type ReviewRevision = { state: ReviewState; rationale: string; version: number; reviewerId: string | null; decidedAt: string | null };
export type ReconciliationReviewAggregateV1 = {
    version: 'poc-reconciliation-review-aggregate-v1'; reconciliationId: string;
    scope: FinancePoCReconciliationV1['scope']; sources: FinancePoCReconciliationV1['sources'];
    eligible: number; states: Record<ReviewState, number>;
};
export type ReconciliationReviewView = {
    status: 'OK'; version: 'poc-reconciliation-reviews-v1'; reconciliationId: string;
    scope: { userId: string; organizationId: string; role: 'Finance'; membershipVersion: number };
    aggregate: ReconciliationReviewAggregateV1;
    outcomes: { key: string; index: number; status: ReconciliationStatus; review: ReviewRevision; history: ReviewRevision[] }[];
};
export type ReviewRefused = { status: 'REFUSED'; code: 'UNAVAILABLE' | 'STALE_REVIEW' };
