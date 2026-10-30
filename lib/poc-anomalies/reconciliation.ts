import { z } from 'zod';
import { toCents } from './source';

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
