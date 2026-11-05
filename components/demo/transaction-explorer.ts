import type { ProcessingContext } from '@/lib/demo/pipeline';
import { fromCents, toCents, validDate } from '@/lib/poc-anomalies/source';

export type SourceTab = 'bank' | 'ledger';
export type SortOrder = 'newest' | 'oldest' | 'highest' | 'lowest';
export type TransactionFilters = { search: string; direction: string; from: string; to: string; sort: SortOrder };
export const defaultFilters: TransactionFilters = { search: '', direction: '', from: '', to: '', sort: 'newest' };
export const TRANSACTION_PAGE_SIZE = 20;
export type ExplorerRecord = {
    key: string; id: string; source: SourceTab; date: string; description: string; reference: string;
    counterparty: string | null; currency: string; signedAmount: string; sourceTransactionId: string | null;
    sourceId: string | null; fingerprint: string | null; sourceRow: number | null; evidenceIds: string[]; direction: string;
};
/** Read-only presentation projection. BANK and LEDGER never share an identity namespace. */
export function transactionRecords(c: ProcessingContext, source: SourceTab): ExplorerRecord[] {
    const original = source === 'bank' ? c.outputs.bank : c.outputs.ledger;
    if (source === 'ledger') return (original?.rows ?? []).map(r => ({
        key: `${c.processingId}:ledger:${r.sourceId}:${r.recordId}:${r.row}`, id: r.recordId, source,
        date: r.date, description: r.description, reference: r.reference, counterparty: null,
        currency: r.currency, signedAmount: fromCents(BigInt(r.signedCents)), sourceTransactionId: r.sourceTransactionId,
        sourceId: r.sourceId, fingerprint: original?.sha256 ?? null, sourceRow: r.row, evidenceIds: r.evidenceIds, direction: r.signedCents.startsWith('-') ? 'Debit' : 'Credit',
    }));
    const evidenceRows = new Map(original?.rows.map(row => [row.recordId, row]) ?? []);
    return c.outputs.bankRows.map(r => {
        const evidence = evidenceRows.get(r.rowId);
        return { key: `${c.processingId}:bank:${original?.sourceId ?? ''}:${r.rowId}`, id: r.rowId, source,
            date: r.date, description: r.description, reference: r.reference, counterparty: r.counterparty,
            currency: r.currency, signedAmount: r.signedAmount, sourceTransactionId: r.sourceTransactionId,
            sourceId: original?.sourceId ?? null, fingerprint: original?.sha256 ?? null,
            sourceRow: evidence?.row ?? null, evidenceIds: evidence?.evidenceIds ?? [], direction: r.direction,
        };
    });
}
export function dateFilterError(f: TransactionFilters): string | null {
    if ((f.from && !validDate(f.from)) || (f.to && !validDate(f.to))) return 'Enter valid dates for the date range.';
    return f.from && f.to && f.from > f.to ? 'Start date must be on or before end date.' : null;
}
export function recordMatches(r: Pick<ExplorerRecord, 'id' | 'description' | 'reference' | 'counterparty' | 'date' | 'signedAmount' | 'direction'>, f: TransactionFilters) {
    const q = f.search.trim().toLowerCase();
    return !dateFilterError(f) && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)
        && (!f.direction || r.direction === f.direction)
        && (!q || [r.id, r.description, r.reference, r.counterparty ?? ''].some(v => v.toLowerCase().includes(q)));
}
/** Copy before sorting; exact integer cents avoid rounding and absolute-value ordering. */
export function exploreRecords(rows: ExplorerRecord[], f: TransactionFilters): ExplorerRecord[] {
    return rows.filter(r => recordMatches(r, f)).sort((a, b) => {
        const delta = f.sort === 'highest' || f.sort === 'lowest'
            ? (toCents(a.signedAmount) > toCents(b.signedAmount) ? 1 : toCents(a.signedAmount) < toCents(b.signedAmount) ? -1 : 0)
            : a.date.localeCompare(b.date);
        return (f.sort === 'newest' || f.sort === 'highest' ? -delta : delta) || a.key.localeCompare(b.key);
    });
}
export const signedDisplay = (value: string) => value.startsWith('-') || value.startsWith('+') ? value : `+${value}`;
export function transactionPage(page: number, count: number) {
    const pages = Math.max(1, Math.ceil(count / TRANSACTION_PAGE_SIZE));
    return { page: Math.max(0, Math.min(page, pages - 1)), pages };
}
