import 'server-only';
import Papa from 'papaparse';
import { createHash } from 'node:crypto';
import { normalizeDate, normalizeDecimal, subtractDecimals } from '../../ingestion/normalizer';
import type { CashSource, CashSourceKind } from '../../poc-reconciliation/contracts';
const common = ['BusinessID', 'Currency', 'SignedCashMovementMYR'];
const fields = {
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
export function normalizeCashSource(bytes: Uint8Array, kind: CashSourceKind, filename: string): CashSource {
    if (!/\.csv$/i.test(filename) || !bytes.length || bytes.length > 512000) throw Error('BOUNDED_CSV_REQUIRED');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', dynamicTyping: false });
    const [header, ...data] = parsed.data;
    if (parsed.errors.length || !header || new Set(header).size !== header.length || header.some(h => !h) || !data.length || data.length > 5000 || fields[kind].some(f => !header.includes(f))) throw Error('UNSUPPORTED_CSV_SCHEMA');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
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
        const evidenceIds = fields[kind].map(field => {
            const id = `${sha256}:record:${index + 2}:${field}`;
            source.evidence[id] = { sourceId: sha256, recordId, row: index + 2, field, literal: raw[field] };
            return id;
        });
        source.rows.push({ recordId, sourceId: sha256, row: index + 2, businessId: raw.BusinessID, currency: raw.Currency, date, reference: raw[kind === 'bank' ? 'BankReference' : 'LedgerReference'], description: raw[kind === 'bank' ? 'BankDescription' : 'LedgerMemo'], signedCents: signed.toString(), sourceTransactionId: kind === 'bank' ? raw.SourceTransactionID : null, evidenceIds });
    }
    return source;
}
