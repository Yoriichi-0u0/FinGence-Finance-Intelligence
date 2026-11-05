import { reconciliationStatuses, type FinancePoCReconciliationV1, type ReconciliationStatus } from '@/lib/poc-reconciliation/contracts';
import type { ProcessingContext } from '@/lib/demo/pipeline';

export type Outcome = FinancePoCReconciliationV1['results'][number];
export type ResultView = 'EXCEPTIONS' | 'ALL';
export type OutcomeFilter = ReconciliationStatus | 'ALL';
export const outcomeLabels: Record<ReconciliationStatus, string> = {
    MATCH_EXACT: 'Exact match', MATCH_DATE_SHIFT: 'Posting-date shift', BANK_ONLY: 'Bank only',
    LEDGER_ONLY: 'Ledger only', AMOUNT_MISMATCH_REVIEW: 'Amount review',
    AMBIGUOUS_DUPLICATE_LEDGER: 'Duplicate ambiguity', REFERENCE_MISMATCH_REVIEW: 'Reference review',
};
export const isMatched = (status: ReconciliationStatus) => status === 'MATCH_EXACT' || status === 'MATCH_DATE_SHIFT';
export const outcomeTypes = (view: ResultView) => reconciliationStatuses.filter(s => view === 'ALL' || !isMatched(s));
export function selectOutcomes(r: FinancePoCReconciliationV1, view: ResultView, filter: OutcomeFilter) {
    return r.results.filter(x => (view === 'ALL' || !isMatched(x.status)) && (filter === 'ALL' || x.status === filter));
}
export function outcomeHeading(view: ResultView, filter: OutcomeFilter, count: number) {
    return `${filter === 'ALL' ? view === 'EXCEPTIONS' ? 'All Quarantined Exceptions' : 'All Reconciliation Outcomes' : `${outcomeLabels[filter]}${isMatched(filter) ? ' outcomes' : ' exceptions'}`} (${count})`;
}
/** Transparent UI identity only; never an economic identity or a replacement for source provenance. */
export function reconciliationContextKey(c: ProcessingContext) {
    return JSON.stringify([c.processingId, c.outputs.reconciliation?.sources.bank.sourceId, c.outputs.reconciliation?.sources.ledger.sourceId]);
}
export function outcomeKey(c: ProcessingContext, x: Outcome) {
    return JSON.stringify([reconciliationContextKey(c), x.status, x.bankRecordId, [...x.ledgerRecordIds].sort(), x.reason, [...x.bankEvidenceIds].sort(), [...x.ledgerEvidenceIds].sort()]);
}
export function selectedOutcome(c: ProcessingContext, key: string | null) {
    return key === null ? null : c.outputs.reconciliation?.results.find(x => outcomeKey(c, x) === key) ?? null;
}
/** Return every provided evidence ID, including explicit unavailable entries; omit no source fields. */
export function evidenceRecords(r: FinancePoCReconciliationV1, x: Outcome, side: 'bank' | 'ledger') {
    const ids = side === 'bank' ? x.bankEvidenceIds : x.ledgerEvidenceIds;
    const groups = new Map<string, { recordId: string; sourceId: string; row: number; fields: { id: string; field: string; literal: string }[] }>();
    const unavailable: string[] = [];
    for (const id of ids) {
        const e = r.evidence[id];
        if (!e) { unavailable.push(id); continue; }
        const key = JSON.stringify([e.sourceId, e.recordId, e.row]);
        const group = groups.get(key) ?? { recordId: e.recordId, sourceId: e.sourceId, row: e.row, fields: [] };
        group.fields.push({ id, field: e.field, literal: e.literal }); groups.set(key, group);
    }
    return { records: [...groups.values()], unavailable, empty: ids.length === 0 };
}
export function reconciliationPage(page: number, total: number) {
    const pages = Math.max(1, Math.ceil(total / 20));
    return { page: Math.max(0, Math.min(page, pages - 1)), pages };
}
