/** Authoritative, additive PoC interface shared with reporting. Not C1/V2 accepted transactions. */
export const reconciliationStatuses = ['MATCH_EXACT', 'MATCH_DATE_SHIFT', 'BANK_ONLY', 'LEDGER_ONLY', 'AMOUNT_MISMATCH_REVIEW', 'AMBIGUOUS_DUPLICATE_LEDGER', 'REFERENCE_MISMATCH_REVIEW'] as const;
export type ReconciliationStatus = typeof reconciliationStatuses[number];
export type CashSourceKind = 'bank' | 'ledger';
export interface CashSourceRow {
    recordId: string; sourceId: string; row: number; businessId: string; currency: string;
    date: string; reference: string; description: string; signedCents: string;
    sourceTransactionId: string | null; evidenceIds: string[];
}
export interface CashEvidence { sourceId: string; recordId: string; row: number; field: string; literal: string }
export interface CashSource {
    kind: CashSourceKind; sourceId: string; sha256: string; filename: string;
    businessId: string; period: string; currency: string;
    rows: CashSourceRow[]; evidence: Record<string, CashEvidence>;
}
export interface FinancePoCReconciliationV1 {
    version: 'finance-poc-reconciliation-v1'; origin: 'DETERMINISTIC_RULES';
    scope: { organizationId: string; businessId: string; period: string; currency: string };
    sources: { bank: { sourceId: string; sha256: string }; ledger: { sourceId: string; sha256: string } };
    cashMovement: { bank: string; ledger: string; signedDifference: string };
    counts: Record<ReconciliationStatus, number>;
    results: Array<{ status: ReconciliationStatus; bankRecordId: string | null; ledgerRecordIds: string[];
        reason: string; bankEvidenceIds: string[]; ledgerEvidenceIds: string[] }>;
    limitations: string[];
    /** Additive drill-down evidence, keyed by the same IDs used in results. */
    evidence: Record<string, CashEvidence>;
    rows: { bank: CashSourceRow[]; ledger: CashSourceRow[] };
}
