import { z } from 'zod';
import { fromCents, toCents, validDate, type SourceRow } from '../poc-anomalies/source';

const date = z.string().refine(validDate), amount = z.string().regex(/^\d{1,12}\.\d{2}$/);
/** Selection is never authority. Organization and role come only from the current server session. */
export const insightsQuery = z.strictObject({
    source: z.uuid(), business: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/).optional(),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    search: z.string().max(120).default(''), direction: z.enum(['Credit', 'Debit']).optional(),
    from: date.optional(), to: date.optional(), minAmount: amount.optional(), maxAmount: amount.optional(),
    page: z.coerce.number().int().min(1).max(20000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).refine(q => !q.from || !q.to || q.from <= q.to)
    .refine(q => !q.minAmount || !q.maxAmount || toCents(q.minAmount) <= toCents(q.maxAmount));
export type InsightsQuery = z.infer<typeof insightsQuery>;
export type BankTotals = { rows: number; creditRows: number; debitRows: number; credits: string; debits: string; net: string };
/** Cash direction is the source's bank convention. No accounting classification or FX is inferred. */
export function cashTotals(rows: SourceRow[]): BankTotals {
    let credits = 0n, debits = 0n, creditRows = 0;
    for (const r of rows) {
        if (r.direction === 'Credit') { credits += toCents(r.signedAmount); creditRows++; }
        else debits += toCents(r.signedAmount);
    }
    return { rows: rows.length, creditRows, debitRows: rows.length - creditRows, credits: fromCents(credits), debits: fromCents(debits), net: fromCents(credits + debits) };
}
export function projectSource(rows: SourceRow[], query: InsightsQuery) {
    const options = [...new Set(rows.map(r => r.businessId))].sort().map(businessId => {
        const business = rows.filter(r => r.businessId === businessId);
        return { businessId, businessName: business[0].businessName, currencies: [...new Set(business.map(r => r.currency))].sort() };
    });
    const businessId = query.business ?? options[0]?.businessId;
    const business = options.find(o => o.businessId === businessId), currency = query.currency ?? business?.currencies[0];
    if (!business || !currency || !business.currencies.includes(currency)) throw Error('UNAVAILABLE');
    const scoped = rows.filter(r => r.businessId === businessId && r.currency === currency);
    const periods = [...new Set(scoped.map(r => r.period))].sort();
    const period = query.period ?? periods.at(-1);
    if (!period || !periods.includes(period)) throw Error('UNAVAILABLE');
    const selected = scoped.filter(r => r.period === period), search = query.search.toLowerCase().trim();
    const filtered = selected.filter(r => (!query.direction || r.direction === query.direction)
        && (!query.from || r.date >= query.from) && (!query.to || r.date <= query.to)
        && (!query.minAmount || toCents(r.amount) >= toCents(query.minAmount))
        && (!query.maxAmount || toCents(r.amount) <= toCents(query.maxAmount))
        && (!search || [r.rowId, r.sourceTransactionId, r.counterparty, r.reference, r.description].some(v => v?.toLowerCase().includes(search))))
        .sort((a, b) => a.date.localeCompare(b.date) || a.rowId.localeCompare(b.rowId));
    const records = new Map(rows.map((r, i) => [r.rowId, i + 2]));
    return {
        selection: { businessId: business.businessId, businessName: business.businessName, period, currency }, options, periods,
        totals: cashTotals(selected), filteredTotals: cashTotals(filtered),
        series: periods.map(period => ({ period, ...cashTotals(scoped.filter(r => r.period === period)) })),
        transactions: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map(r => ({ ...r, csvRecord: records.get(r.rowId)! })),
        pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / query.pageSize)) },
    };
}
export type SourceProjection = ReturnType<typeof projectSource>;
