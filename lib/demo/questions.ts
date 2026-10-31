import { cashTotals } from '../poc-insights/model';
import type { QaFacts } from '../poc-finance-qa/answer';
import type { ProcessingContext } from './pipeline';

/** Facts for the existing rule-based answerer, taken only from one completed processing context. */
export function qaFacts(context: ProcessingContext): QaFacts | null {
    const { scope, outputs } = context, bank = context.documents.find(d => d.role === 'BANK_STATEMENT' && d.decision === 'AUTO_ACCEPTED');
    if (!scope || !bank || !outputs.totals || !outputs.forecast) return null;
    const rows = outputs.history.accepted ? outputs.history.rows : outputs.bankRows, periods = [...new Set(rows.map(r => r.period))].sort();
    return {
        selection: { sourceId: context.processingId, fileName: bank.name, sha256: bank.sha256, businessId: scope.businessId, businessName: scope.businessName, period: scope.period, currency: scope.currency },
        businesses: [scope.businessId], periods, totals: outputs.totals,
        series: periods.map(period => ({ period, ...cashTotals(rows.filter(r => r.period === period)) })),
        candidates: outputs.anomalies.map(c => ({ rowId: c.row.rowId, severity: c.severity, rules: c.findings.map(f => f.ruleId), review: 'OPEN' as const })),
        reconciliation: outputs.reconciliationView, reconciliationReviews: null, forecast: outputs.forecast, pooled: null,
    };
}
