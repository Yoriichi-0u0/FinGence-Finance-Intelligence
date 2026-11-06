import type { BankTotals } from '@/lib/poc-insights/model';
export type VerifiedMonth = BankTotals & { period: string };
export type ChartView = 'cash' | 'net' | 'reconciliation';
export const PERIODS = [3, 6, 12] as const;
export type ChartPeriod = typeof PERIODS[number];
const monthNumber = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;
/** Presentation filtering only. No aggregation, gap filling or financial recalculation. */
export function monthlyWindow(months: VerifiedMonth[], period: ChartPeriod): VerifiedMonth[] {
    const ordered = [...months].sort((a, b) => a.period.localeCompare(b.period));
    const latest = ordered.at(-1);
    if (!latest) return [];
    const first = monthNumber(latest.period) - period + 1;
    return ordered.filter(month => monthNumber(month.period) >= first);
}
export function availablePeriods(months: VerifiedMonth[]): ChartPeriod[] {
    return PERIODS.filter(period => monthlyWindow(months, period).length >= period);
}
export function defaultPeriod(months: VerifiedMonth[]): ChartPeriod | null {
    return availablePeriods(months).at(-1) ?? null;
}
export type ReconciliationCounts = { exact: number; shifted: number; unresolved: number; total: number };
