/**
 * Pure bank/ledger cash-source normalizer and deterministic matcher (FinancePoCReconciliationV1).
 * Shared by the authenticated local server path and the browser-only synthetic demo, so both run
 * exactly the same rules. No I/O, persistence, model inference or Node-only APIs.
 */
import Papa from 'papaparse';
import { normalizeDate, normalizeDecimal, subtractDecimals } from '../ingestion/normalizer';
import { reconciliationStatuses, type CashSource, type CashSourceKind, type CashSourceRow, type FinancePoCReconciliationV1, type ReconciliationStatus } from './contracts';
const common = ['BusinessID', 'Currency', 'SignedCashMovementMYR'];
/** Required columns per cash source; exported so document-role identification uses the same contract. */
export const CASH_SOURCE_FIELDS = {
    bank: [...common, 'BankTransactionID', 'ValueDate', 'StatementMonth', 'BankReference', 'BankDescription', 'BankDirection', 'BankAmountMYR', 'SourceTransactionID'],
    ledger: [...common, 'LedgerEntryID', 'PostingDate', 'CashAccount', 'LedgerReference', 'LedgerMemo', 'CashAccountDebitMYR', 'CashAccountCreditMYR'],
};
/** The supplied schemas explicitly name MYR and cash-account sides; no generic GL/bank polarity inference. */
export function cashCents(value: string): bigint {
    if (!/^-?\d{1,16}(?:\.\d{1,2})?$/.test(value)) throw Error('INVALID_CASH_AMOUNT');
    const normalized = normalizeDecimal(value, 'plain');
    const [whole, fraction = ''] = normalized.replace('-', '').split('.');
    return BigInt(whole + fraction.padEnd(2, '0')) * (normalized.startsWith('-') ? -1n : 1n);
}
export function formatCents(value: bigint): string {
    const digits = (value < 0n ? -value : value).toString().padStart(3, '0');
    return (value < 0n ? '-' : '') + digits.slice(0, -2) + '.' + digits.slice(-2);
}
/** `sha256` is the lowercase hex digest of exactly `bytes`; callers compute it (Node or Web Crypto). */
export function normalizeCashSourceBytes(bytes: Uint8Array, kind: CashSourceKind, filename: string, sha256: string): CashSource {
    if (!/\.csv$/i.test(filename) || !bytes.length || bytes.length > 512000) throw Error('BOUNDED_CSV_REQUIRED');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', dynamicTyping: false });
    const [header, ...data] = parsed.data;
    if (parsed.errors.length || !header || new Set(header).size !== header.length || header.some(h => !h) || !data.length || data.length > 5000 || CASH_SOURCE_FIELDS[kind].some(f => !header.includes(f))) throw Error('UNSUPPORTED_CSV_SCHEMA');
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw Error('INVALID_SOURCE_DIGEST');
    const source: CashSource = { kind, sha256, sourceId: sha256, filename: filename.split(/[/\\]/).pop()!.slice(0, 120), businessId: '', currency: '', period: '', rows: [], evidence: {} };
    const seen = new Set<string>();
    for (const [index, cells] of data.entries()) {
        if (cells.length !== header.length || cells.some(c => c.length > 2000)) throw Error('MALFORMED_CSV_ROW');
        const raw = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
        const recordId = raw[kind === 'bank' ? 'BankTransactionID' : 'LedgerEntryID'];
        const date = raw[kind === 'bank' ? 'ValueDate' : 'PostingDate'];
        if (!recordId?.trim() || seen.has(recordId) || !raw.BusinessID?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('INVALID_RECORD_ID_OR_DATE');
        seen.add(recordId); normalizeDate(date, 'ISO');
        if (raw.Currency !== 'MYR') throw Error('UNSUPPORTED_CURRENCY_BASIS');
        const signed = cashCents(raw.SignedCashMovementMYR);
        if (kind === 'bank') {
            const amount = cashCents(raw.BankAmountMYR);
            if (amount < 0n || !['Credit', 'Debit'].includes(raw.BankDirection) || signed !== (raw.BankDirection === 'Credit' ? amount : -amount) || raw.StatementMonth !== date.slice(0, 7)) throw Error('INCONSISTENT_BANK_CASH');
        } else {
            const debit = cashCents(raw.CashAccountDebitMYR), credit = cashCents(raw.CashAccountCreditMYR);
            if (raw.CashAccount !== '1000-BANK' || debit < 0n || credit < 0n || (debit !== 0n && credit !== 0n) || signed !== cashCents(subtractDecimals(raw.CashAccountDebitMYR, raw.CashAccountCreditMYR))) throw Error('INCONSISTENT_LEDGER_CASH');
        }
        const period = kind === 'bank' ? raw.StatementMonth : date.slice(0, 7);
        if (index && (source.businessId !== raw.BusinessID || source.currency !== raw.Currency || source.period !== period)) throw Error('MIXED_SOURCE_SCOPE');
        source.businessId = raw.BusinessID; source.currency = raw.Currency; source.period = period;
        const evidenceIds = CASH_SOURCE_FIELDS[kind].map(field => {
            const id = `${sha256}:record:${index + 2}:${field}`;
            source.evidence[id] = { sourceId: sha256, recordId, row: index + 2, field, literal: raw[field] };
            return id;
        });
        source.rows.push({ recordId, sourceId: sha256, row: index + 2, businessId: raw.BusinessID, currency: raw.Currency, date, reference: raw[kind === 'bank' ? 'BankReference' : 'LedgerReference'], description: raw[kind === 'bank' ? 'BankDescription' : 'LedgerMemo'], signedCents: signed.toString(), sourceTransactionId: kind === 'bank' ? raw.SourceTransactionID : null, evidenceIds });
    }
    return source;
}
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
