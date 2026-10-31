import 'server-only';
import { reconciliationStatuses, type CashSource, type CashSourceRow, type FinancePoCReconciliationV1, type ReconciliationStatus } from '../../poc-reconciliation/contracts';
import { formatCents } from './normalize';
const days = (a: CashSourceRow, b: CashSourceRow) => Math.abs(Date.parse(a.date) - Date.parse(b.date)) / 86400000;
/** Deterministic evidence rules. No oracle, learned scores, SourceTransactionID join or financial publication. */
export function reconcileCashSources(organizationId: string, bank: CashSource, ledger: CashSource): FinancePoCReconciliationV1 {
    if (bank.kind !== 'bank' || ledger.kind !== 'ledger' || bank.businessId !== ledger.businessId || bank.currency !== ledger.currency || bank.period !== ledger.period) throw Error('SOURCE_SCOPE_MISMATCH');
    const result: FinancePoCReconciliationV1 = {
        version: 'finance-poc-reconciliation-v1', origin: 'DETERMINISTIC_RULES',
        scope: { organizationId, businessId: bank.businessId, period: bank.period, currency: bank.currency },
        sources: { bank: { sourceId: bank.sourceId, sha256: bank.sha256 }, ledger: { sourceId: ledger.sourceId, sha256: ledger.sha256 } },
        cashMovement: { bank: '', ledger: '', signedDifference: '' }, counts: Object.fromEntries(reconciliationStatuses.map(s => [s, 0])) as Record<ReconciliationStatus, number>, results: [],
        rows: { bank: bank.rows, ledger: ledger.rows }, evidence: { ...bank.evidence, ...ledger.evidence },
        limitations: ['Local synthetic PoC; deterministic rules, no live AI inference.', 'MYR source cash-account movement only; not revenue, profit or a reconciled closing balance.', 'Only unique reference/currency/signed-cents pairs within two posting days match automatically.', 'Review outcomes remain unresolved; no manual auto-clear or one-to-many matching.', 'Single business, currency and calendar month per source. CSV record numbers include the header; they are not physical text-line offsets.'],
    };
    const coveredBank = new Set<string>(), coveredLedger = new Set<string>();
    function add(status: ReconciliationStatus, b: CashSourceRow | null, ls: CashSourceRow[], reason: string) {
        result.counts[status]++;
        result.results.push({ status, bankRecordId: b?.recordId ?? null, ledgerRecordIds: ls.map(l => l.recordId).sort(), reason, bankEvidenceIds: b?.evidenceIds ?? [], ledgerEvidenceIds: ls.flatMap(l => l.evidenceIds).sort() });
        if (b) coveredBank.add(b.recordId); ls.forEach(l => coveredLedger.add(l.recordId));
    }
    // Evaluate whole reference groups before consuming anything: order cannot create a false unique match.
    for (const reference of [...new Set(bank.rows.map(b => b.reference))].sort()) {
        if (!reference.trim()) continue;
        const bs = bank.rows.filter(b => b.reference === reference), ls = ledger.rows.filter(l => l.reference === reference);
        if (!ls.length) continue;
        if (bs.length !== 1 || ls.length !== 1) {
            for (const b of bs) add('AMBIGUOUS_DUPLICATE_LEDGER', b, ls, 'Reference has multiple bank or ledger candidates; no candidate is cleared.');
        } else if (bs[0].signedCents !== ls[0].signedCents) add('AMOUNT_MISMATCH_REVIEW', bs[0], ls, 'Reference agrees; signed source cash amounts differ.');
        else if (days(bs[0], ls[0]) <= 2) add(days(bs[0], ls[0]) === 0 ? 'MATCH_EXACT' : 'MATCH_DATE_SHIFT', bs[0], ls, 'Unique reference, currency and signed cents; posting dates within the permitted window.');
    }
    const remainingBank = bank.rows.filter(b => !coveredBank.has(b.recordId)), remainingLedger = ledger.rows.filter(l => !coveredLedger.has(l.recordId));
    for (const b of remainingBank) {
        const candidates = remainingLedger.filter(l => l.reference !== b.reference && l.signedCents === b.signedCents && days(b, l) === 0);
        const uniqueBank = remainingBank.filter(other => other.signedCents === b.signedCents && other.date === b.date).length === 1;
        if (candidates.length === 1 && uniqueBank) add('REFERENCE_MISMATCH_REVIEW', b, candidates, 'Unique same-date signed-amount candidate, but references differ; not an automatic match.');
        else add('BANK_ONLY', b, [], 'No safely unique permitted match; unmatched or unsupported candidates remain uncleared.');
    }
    for (const l of ledger.rows) if (!coveredLedger.has(l.recordId)) add('LEDGER_ONLY', null, [l], 'No bank record safely matched or linked for review.');
    const sum = (source: CashSource) => source.rows.reduce((n, r) => n + BigInt(r.signedCents), 0n), bsum = sum(bank), lsum = sum(ledger);
    result.cashMovement = { bank: formatCents(bsum), ledger: formatCents(lsum), signedDifference: formatCents(bsum - lsum) };
    result.results.sort((a, b) => (a.bankRecordId ?? a.ledgerRecordIds.join('|')).localeCompare(b.bankRecordId ?? b.ledgerRecordIds.join('|')));
    return result;
}
