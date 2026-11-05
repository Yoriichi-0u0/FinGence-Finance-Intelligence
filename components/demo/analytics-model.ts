import type { ProcessingContext } from '@/lib/demo/pipeline';
import { fromCents, toCents } from '@/lib/poc-anomalies/source';
import { cashTotals } from '@/lib/poc-insights/model';
/** Existing bank-only presentation aggregations, retaining integer cents for exact readouts. */
export function analyticsDays(c: ProcessingContext) {
    const map = new Map<string, bigint>();
    for (const r of c.outputs.bankRows) map.set(r.date, (map.get(r.date) ?? 0n) + toCents(r.signedAmount));
    let total = 0n;
    return [...map.entries()].sort().map(([date, value]) => { total += value; return { date, value: Number(total) / 100, exact: fromCents(total) }; });
}
export const analyticsMonths = (c: ProcessingContext) => c.outputs.history.accepted ? c.outputs.history.months.map(period => ({ period, ...cashTotals(c.outputs.history.rows.filter(r => r.period === period)) })) : [];
export type Counterparty = { name: string; incoming: bigint; outgoing: bigint; records: number };
const compare = (a: bigint, b: bigint) => a > b ? -1 : a < b ? 1 : 0;
export function analyticsCounterparties(c: ProcessingContext): Counterparty[] {
    const map = new Map<string, Counterparty>();
    for (const r of c.outputs.bankRows) {
        const e = map.get(r.counterparty) ?? { name: r.counterparty, incoming: 0n, outgoing: 0n, records: 0 };
        const value = toCents(r.signedAmount); if (value >= 0n) e.incoming += value; else e.outgoing += value; e.records++; map.set(r.counterparty, e);
    }
    return [...map.values()].sort((a, b) => compare(a.incoming - a.outgoing, b.incoming - b.outgoing)).slice(0, 8);
}
export function exploreCounterparties(rows: Counterparty[], query: string, sort: 'gross' | 'in' | 'out') {
    return rows.filter(r => r.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => compare(sort === 'in' ? a.incoming : sort === 'out' ? -a.outgoing : a.incoming - a.outgoing, sort === 'in' ? b.incoming : sort === 'out' ? -b.outgoing : b.incoming - b.outgoing));
}
