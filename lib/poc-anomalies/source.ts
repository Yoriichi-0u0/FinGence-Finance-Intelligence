import Papa from 'papaparse';

/**
 * PoC anomaly source rows. Only the feature columns below are ever read; category labels,
 * generation metadata and evaluator columns are never copied into a row.
 */
export type SourceRow = {
    rowId: string;
    sourceTransactionId: string | null;
    businessId: string;
    businessName: string;
    currency: string;
    date: string;
    period: string;
    description: string;
    direction: 'Credit' | 'Debit';
    amount: string;
    signedAmount: string;
    counterparty: string;
    reference: string;
};
export type SourceLayout = 'NORMALIZED_TRANSACTIONS' | 'BANK_STATEMENT';
export type ParsedSource = { layout: SourceLayout; rows: SourceRow[] };
export type SourceRefusal = 'NOT_UTF8' | 'UNSUPPORTED_LAYOUT' | 'EVALUATOR_FILE' | 'INVALID_ROWS' | 'EMPTY' | 'TOO_MANY_ROWS';
export class SourceError extends Error {
    constructor(readonly code: SourceRefusal, readonly details: string[] = []) { super(code); }
}

type Columns = Record<Exclude<keyof SourceRow, 'sourceTransactionId'>, string> & { sourceTransactionId?: string };
const layouts: Record<SourceLayout, Columns> = {
    NORMALIZED_TRANSACTIONS: { rowId: 'TransactionID', businessId: 'BusinessID', businessName: 'BusinessName', currency: 'Currency', date: 'TransactionDate', period: 'StatementMonth', description: 'RawBankDescription', direction: 'BankDirection', amount: 'AmountMYR', signedAmount: 'SignedCashMovementMYR', counterparty: 'Counterparty', reference: 'Reference' },
    BANK_STATEMENT: { rowId: 'BankTransactionID', businessId: 'BusinessID', businessName: 'BusinessName', currency: 'Currency', date: 'ValueDate', period: 'StatementMonth', description: 'BankDescription', direction: 'BankDirection', amount: 'BankAmountMYR', signedAmount: 'SignedCashMovementMYR', counterparty: 'Counterparty', reference: 'BankReference', sourceTransactionId: 'SourceTransactionID' },
};
/** Scoring columns: a file carrying any of these is an evaluator file and is never accepted as detector input. */
export const EVALUATOR_COLUMNS = ['IsAnomaly', 'AnomalyType', 'ReviewExpected', 'GroundTruthAnomalyType', 'GroundTruthReviewExpected', 'GroundTruthAnomalies', 'HFCategoryGroundTruth', 'BusinessCategoryGroundTruth', 'ExpectedStatus'];
export const MAX_SOURCE_ROWS = 20000;
const money = /^\d{1,12}\.\d{2}$/, signed = /^-?\d{1,12}\.\d{2}$/, id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function parseSource(bytes: Uint8Array): ParsedSource {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new SourceError('NOT_UTF8'); }
    const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy' });
    const headers = (parsed.meta.fields ?? []).map(h => h.trim());
    if (headers.some(h => EVALUATOR_COLUMNS.includes(h))) throw new SourceError('EVALUATOR_FILE');
    const layout = (Object.keys(layouts) as SourceLayout[]).find(name => Object.values(layouts[name]).every(column => headers.includes(column)));
    if (!layout) throw new SourceError('UNSUPPORTED_LAYOUT');
    if (!parsed.data.length) throw new SourceError('EMPTY');
    if (parsed.data.length > MAX_SOURCE_ROWS) throw new SourceError('TOO_MANY_ROWS');
    const columns = layouts[layout], rows: SourceRow[] = [], problems: string[] = [], seen = new Set<string>();
    parsed.data.forEach((raw, index) => {
        const get = (key: keyof Columns) => clean(raw[columns[key]!]);
        const line = index + 2, row: SourceRow = {
            rowId: get('rowId'), sourceTransactionId: columns.sourceTransactionId ? get('sourceTransactionId') || null : null, businessId: get('businessId'), businessName: get('businessName'),
            currency: get('currency'), date: get('date'), period: get('period'), description: get('description'), direction: get('direction') as SourceRow['direction'],
            amount: get('amount'), signedAmount: get('signedAmount'), counterparty: get('counterparty'), reference: get('reference'),
        };
        const issue = !id.test(row.rowId) ? 'row identifier' : !id.test(row.businessId) ? 'business identifier' : !/^[A-Z]{3}$/.test(row.currency) ? 'currency'
            : !validDate(row.date) ? 'date' : row.period !== row.date.slice(0, 7) ? 'statement month' : row.direction !== 'Credit' && row.direction !== 'Debit' ? 'direction'
            : !money.test(row.amount) ? 'amount' : !signed.test(row.signedAmount) ? 'signed amount' : !row.description || row.description.length > 300 ? 'description'
            : !row.counterparty || row.counterparty.length > 120 ? 'counterparty' : !row.reference || row.reference.length > 64 ? 'reference' : row.businessName.length > 120 ? 'business name' : null;
        if (issue) problems.push(`Line ${line}: invalid ${issue}.`);
        else if (seen.has(row.rowId)) problems.push(`Line ${line}: duplicate row identifier.`);
        else { seen.add(row.rowId); rows.push(row); }
    });
    if (parsed.errors.length) problems.push(...parsed.errors.slice(0, 5).map(e => `Line ${(e.row ?? 0) + 2}: ${e.code}.`));
    if (problems.length) throw new SourceError('INVALID_ROWS', problems.slice(0, 10));
    return { layout, rows };
}

/** Exact decimal strings with two places ↔ integer cents. */
export function toCents(value: string): bigint {
    const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
    if (!match) throw new Error('INVALID_DECIMAL');
    const cents = BigInt(match[2]) * 100n + BigInt(match[3]);
    return match[1] ? -cents : cents;
}
export function fromCents(value: bigint): string {
    const negative = value < 0n, abs = negative ? -value : value;
    return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
