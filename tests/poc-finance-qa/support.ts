import type { QaFacts } from '../../lib/poc-finance-qa/answer';
import { forecastBusiness, nextPeriod, poolBacktests, type ForecastRow } from '../../lib/poc-forecast/forecast';
import { RECONCILIATION_STATUSES, readReconciliation } from '../../lib/poc-anomalies/reconciliation';

/** Hand-built facts for one March-only and one twelve-month source, using the real forecast and snapshot readers. */
export const sha = '0a'.repeat(32), ledgerSha = '1b'.repeat(32);
export const selection = { sourceId: '11111111-1111-4111-8111-111111111111', fileName: 'bank.csv', sha256: sha, businessId: 'BUS-T', businessName: 'Test', period: '2026-03', currency: 'MYR' };
const totals = { rows: 4, creditRows: 1, debitRows: 3, credits: '500.00', debits: '-120.00', net: '380.00' };
export function snapshot(bank = '380.00', ledger = '370.00') {
    const results = [
        { status: 'MATCH_EXACT', bankRecordId: 'B1', ledgerRecordIds: ['L1'] }, { status: 'MATCH_DATE_SHIFT', bankRecordId: 'B2', ledgerRecordIds: ['L2'] },
        { status: 'BANK_ONLY', bankRecordId: 'B3', ledgerRecordIds: [] }, { status: 'LEDGER_ONLY', bankRecordId: null, ledgerRecordIds: ['L9'] }, { status: 'AMOUNT_MISMATCH_REVIEW', bankRecordId: 'B4', ledgerRecordIds: ['L4'] },
    ].map(r => ({ ...r, reason: 'rule', bankEvidenceIds: [], ledgerEvidenceIds: [] }));
    return {
        version: 'finance-poc-reconciliation-v1', origin: 'DETERMINISTIC_RULES', scope: { organizationId: 'org', businessId: 'BUS-T', period: '2026-03', currency: 'MYR' },
        sources: { bank: { sourceId: 'b', sha256: sha }, ledger: { sourceId: 'l', sha256: ledgerSha } },
        cashMovement: { bank, ledger, signedDifference: (Number(bank) - Number(ledger)).toFixed(2) },
        counts: Object.fromEntries(RECONCILIATION_STATUSES.map(k => [k, results.filter(r => r.status === k).length])), results, limitations: [],
    };
}
export const binding = { organizationId: 'org', businessId: 'BUS-T', period: '2026-03', currency: 'MYR', bankSha256: sha };
function months(start: string, n: number): ForecastRow[] {
    const rows: ForecastRow[] = [];
    for (let i = 0, p = start; i < n; i++, p = nextPeriod(p))
        rows.push({ businessId: 'BUS-T', currency: 'MYR', period: p, direction: 'Credit', amount: `${1000 + 100 * i}.00`, signedAmount: `${1000 + 100 * i}.00` },
            { businessId: 'BUS-T', currency: 'MYR', period: p, direction: 'Debit', amount: '400.00', signedAmount: '-400.00' });
    return rows;
}
export const march: QaFacts = {
    selection, businesses: ['BUS-T', 'BUS-U'], periods: ['2026-03'], totals, series: [{ period: '2026-03', ...totals }],
    candidates: [{ rowId: 'B3', severity: 'HIGH', rules: ['DUPLICATE_REFERENCE', 'AMOUNT_OUTLIER'], review: 'OPEN' }, { rowId: 'B5', severity: 'MEDIUM', rules: ['AMOUNT_OUTLIER'], review: 'EXPLAINED' }],
    reconciliation: readReconciliation(snapshot(), binding), forecast: forecastBusiness(months('2026-03', 1)), pooled: null,
};
const yearly = forecastBusiness(months('2025-09', 12)), backtest = poolBacktests([yearly])!;
export const year: QaFacts = { ...march, periods: yearly.history.map(h => h.period), series: yearly.history.map(h => ({ ...totals, period: h.period, net: h.net })), reconciliation: readReconciliation(null, binding), forecast: yearly, pooled: { businesses: 1, backtest } };

