import type { KpiId } from './kpi-metrics';
/** Presentation identity belongs to the metric, never its position or current value. */
export const KPI_ACCENTS = {
    'bank-net': ['#087f8c', '#66d1d5'],
    'ledger-net': ['#4d64c9', '#93a9fa'],
    difference: ['#8654bf', '#c5a0f0'],
    matched: ['#16805d', '#7bd7ac'],
    unmatched: ['#a26822', '#e3bb79'],
    exact: ['#16805d', '#7bd7ac'],
    'date-shift': ['#6c5ac2', '#b7aafa'],
    'match-rate': ['#187b79', '#79d3c4'],
    'cash-in': ['#087f8c', '#66d1d5'],
    'cash-out': ['#4d64c9', '#93a9fa'],
    anomalies: ['#a26822', '#e3bb79'],
} as const satisfies Record<KpiId, readonly [string, string]>;
