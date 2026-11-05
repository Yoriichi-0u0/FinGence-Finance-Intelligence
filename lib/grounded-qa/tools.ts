/**
 * Deterministic tools for grounded Finance Q&A. They read ONLY one completed processing context (the same
 * verified records every page shows) and return facts with the record IDs behind them. No model, no I/O.
 */
import type { ProcessingContext } from '../demo/pipeline';
import { RULES } from '../poc-anomalies/detector';
import { reconciliationStatuses } from '../poc-reconciliation/contracts';
import { toCents, type SourceRow } from '../poc-anomalies/source';
import { QA_VERSION, MAX_FACTS, type Catalogue, type ToolCall } from './contracts';
import { count, money, text, type Fact, type SourceRef, type Value } from './facts';

const STATUS_LABEL: Record<string, string> = {
    MATCH_EXACT: 'Matched exactly', MATCH_DATE_SHIFT: 'Matched with a date shift', BANK_ONLY: 'Bank only (no ledger entry)', LEDGER_ONLY: 'Ledger only (not on the bank statement)',
    AMOUNT_MISMATCH_REVIEW: 'Amount mismatch (review)', AMBIGUOUS_DUPLICATE_LEDGER: 'Ambiguous duplicate ledger entry', REFERENCE_MISMATCH_REVIEW: 'Reference mismatch (review)',
};
const MATCHED = new Set(['MATCH_EXACT', 'MATCH_DATE_SHIFT']);

export type GroundingIndex = {
    processingId: string; scope: Catalogue['scope']; currency: string;
    rows: SourceRow[]; history: SourceRow[]; months: string[];
    /** The months the bank statement covers; its rows answer for these months and for the whole range. */
    statementMonths: string[];
    context: ProcessingContext;
};

/** Null unless the processing completed with a bank statement, totals and a scope. */
export function groundingIndex(context: ProcessingContext): GroundingIndex | null {
    const { scope, outputs } = context;
    if (!scope || !outputs.totals || !outputs.bankRows.length) return null;
    const history = outputs.history.accepted ? outputs.history.rows : outputs.bankRows;
    const months = [...new Set([...history.map(r => r.period), ...scope.months])].sort();
    if (scope.months.length > 1) months.push(scope.period);
    return { processingId: context.processingId, scope: { businessId: scope.businessId, businessName: scope.businessName, period: scope.period, currency: scope.currency }, currency: scope.currency, rows: outputs.bankRows, history, months, statementMonths: scope.months, context };
}
/** The verified records for one month or for the statement range: statement rows where the statement covers it, else history. */
function rowsFor(index: GroundingIndex, period: string) {
    if (period === index.scope.period) return index.rows;
    return index.statementMonths.includes(period) ? index.rows.filter(r => r.period === period) : index.history.filter(r => r.period === period);
}

export function catalogue(index: GroundingIndex): Catalogue {
    const o = index.context.outputs;
    return {
        version: QA_VERSION, scope: index.scope, months: index.months,
        counterparties: [...new Set(index.rows.map(r => r.counterparty))].sort(),
        reconciliationStatuses: o.reconciliation ? ['ALL_EXCEPTIONS', ...reconciliationStatuses.filter(s => o.reconciliation!.counts[s] > 0)] : [],
        anomalySeverities: [...new Set(o.anomalies.map(a => a.severity))].sort(),
    };
}

const cents = (r: SourceRow) => toCents(r.signedAmount);
const abs = (v: bigint) => v < 0n ? -v : v;
const rowRef = (r: SourceRow): SourceRef => ({ kind: 'BANK_ROW', id: r.rowId });
function totalsFields(rows: SourceRow[], currency: string): Record<string, Value> {
    let moneyIn = 0n, moneyOut = 0n, inflows = 0;
    for (const r of rows) { const v = cents(r); if (v > 0n) { moneyIn += v; inflows++; } else moneyOut += -v; }
    return { moneyIn: money(moneyIn, currency), moneyOut: money(moneyOut, currency), net: money(moneyIn - moneyOut, currency), transactions: count(rows.length), inflows: count(inflows), outflows: count(rows.length - inflows) };
}
function rowFields(r: SourceRow, currency: string): Record<string, Value> {
    return { amount: money(abs(cents(r)), currency), direction: text(cents(r) < 0n ? 'Money out' : 'Money in'), date: { kind: 'DATE', iso: r.date }, counterparty: text(r.counterparty), description: text(r.description), reference: text(r.reference), id: text(r.rowId) };
}

type Draft = Omit<Fact, 'id' | 'query'>;
/** How FinGence resolved an anomaly candidate: confirmed by the books, or flagged to the technical team. */
function outcomeField(o: ProcessingContext['outputs'], rowId: string): Record<string, Value> {
    const r = o.anomalyResolution?.items.find(i => i.row.rowId === rowId);
    if (!r) return {};
    return { outcome: text(r.resolution === 'CORROBORATED_BY_BOOKS' ? `Confirmed by the books (${r.booked!.ledgerRecordIds.join(', ')}); no action needed` : 'Flagged for the technical team: the books do not confirm it') };
}
function run(index: GroundingIndex, q: ToolCall): Draft[] {
    const { currency } = index, o = index.context.outputs;
    switch (q.tool) {
        case 'cash_summary': {
            const rows = rowsFor(index, q.period);
            return [{ label: `Cash summary for ${q.period}`, primary: 'net', fields: { period: { kind: 'PERIOD', ym: q.period }, ...totalsFields(rows, currency) }, sources: [{ kind: q.period === index.scope.period || index.statementMonths.includes(q.period) ? 'TOTALS' : 'HISTORY', id: q.period }] }];
        }
        case 'transactions': {
            const rows = index.rows.filter(r => (q.direction === 'ANY' || (q.direction === 'IN') === (cents(r) > 0n)) && (q.counterparty === null || r.counterparty === q.counterparty));
            const sorted = [...rows].sort((a, b) => q.sort === 'LARGEST' ? Number(abs(cents(b)) - abs(cents(a))) || a.rowId.localeCompare(b.rowId) : q.sort === 'EARLIEST' ? a.date.localeCompare(b.date) || a.rowId.localeCompare(b.rowId) : b.date.localeCompare(a.date) || b.rowId.localeCompare(a.rowId));
            const scope = `${q.direction === 'IN' ? 'money-in' : q.direction === 'OUT' ? 'money-out' : 'all'} transactions${q.counterparty ? ` with ${q.counterparty}` : ''} in ${index.scope.period}`;
            const total = rows.reduce((n, r) => n + (q.direction === 'ANY' ? cents(r) : abs(cents(r))), 0n);
            return [
                { label: `Matching ${scope}`, primary: 'total', fields: { matching: count(rows.length), total: money(total, currency), ...(q.counterparty ? { counterparty: text(q.counterparty) } : {}) }, sources: rows.map(rowRef) },
                ...sorted.slice(0, q.limit).map((r, i) => ({ label: `${q.sort === 'LARGEST' ? 'Largest' : q.sort === 'EARLIEST' ? 'Earliest' : 'Latest'} #${i + 1} of ${scope}`, primary: 'amount', fields: rowFields(r, currency), sources: [rowRef(r)] })),
            ];
        }
        case 'counterparties': {
            const groups = new Map<string, SourceRow[]>();
            for (const r of index.rows) if (q.direction === 'ANY' || (q.direction === 'IN') === (cents(r) > 0n)) groups.set(r.counterparty, [...(groups.get(r.counterparty) ?? []), r]);
            const ranked = [...groups].map(([name, rows]) => ({ name, rows, volume: rows.reduce((n, r) => n + abs(cents(r)), 0n) })).sort((a, b) => Number(b.volume - a.volume) || a.name.localeCompare(b.name));
            return ranked.slice(0, q.limit).map((g, i) => ({
                label: `Counterparty #${i + 1} by ${q.direction === 'IN' ? 'money received' : q.direction === 'OUT' ? 'money paid' : 'total movement'} in ${index.scope.period}`, primary: 'total',
                fields: { name: text(g.name), total: money(g.volume, currency), transactions: count(g.rows.length), ...(q.direction === 'ANY' ? { moneyIn: totalsFields(g.rows, currency).moneyIn, moneyOut: totalsFields(g.rows, currency).moneyOut } : {}) },
                sources: g.rows.map(rowRef),
            }));
        }
        case 'reconciliation': {
            const rec = o.reconciliation;
            if (!rec) return [{ label: 'Reconciliation', primary: 'status', fields: { status: text(o.reconciliationView.status === 'UNAVAILABLE' ? o.reconciliationView.reason : 'Unavailable') }, sources: [] }];
            const items = rec.results.filter(r => q.status === 'ALL_EXCEPTIONS' ? !MATCHED.has(r.status) : r.status === q.status);
            const bank = new Map(rec.rows.bank.map(r => [r.recordId, r])), ledger = new Map(rec.rows.ledger.map(r => [r.recordId, r]));
            // The reconciliation covers only the months both documents cover: label it with those months, and disclose
            // any statement month left out, so a partial reconciliation is never presented as the whole period's.
            const reconciled = o.periods.length ? o.periods.map(p => p.period) : [rec.scope.period];
            // Bounded: the label stays within the gateway's 160 characters; the months left out go in a field (≤ 400).
            const side = (k: 'BANK' | 'LEDGER') => o.notReconciled.filter(n => n.side === k).map(n => n.period);
            const left = [['bank statement only', side('BANK')], ['books only', side('LEDGER')]] as const, omitted = o.notReconciled.length;
            const summary: Draft = {
                label: `Reconciliation of ${reconciled.length > 1 ? `${reconciled[0]} to ${reconciled.at(-1)}` : reconciled[0]} (bank minus ledger)${omitted ? `; ${omitted} month${omitted === 1 ? '' : 's'} not reconciled` : ''}`, primary: 'difference',
                fields: {
                    reconciledMonths: text(reconciled.join(', ')), ...(omitted ? { notReconciled: text(`Not in these figures, because only one document covers ${omitted === 1 ? 'it' : 'them'}: ${left.filter(([, m]) => m.length).map(([who, m]) => `${who} ${m.join(', ')}`).join('; ')}`) } : {}),
                    difference: money(toCents(rec.cashMovement.signedDifference), currency), bankMovement: money(toCents(rec.cashMovement.bank), currency), ledgerMovement: money(toCents(rec.cashMovement.ledger), currency),
                    matched: count(rec.counts.MATCH_EXACT + rec.counts.MATCH_DATE_SHIFT), exceptions: count(rec.results.filter(r => !MATCHED.has(r.status)).length), selected: count(items.length),
                    ...Object.fromEntries(Object.entries(rec.counts).map(([s, n]) => [s.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), count(n)])),
                },
                sources: [{ kind: 'RECONCILIATION', id: 'summary' }],
            };
            return [summary, ...items.slice(0, 8).map((r, i): Draft => {
                const b = r.bankRecordId ? bank.get(r.bankRecordId) : undefined, l = ledger.get(r.ledgerRecordIds[0] ?? ''), row = b ?? l;
                return {
                    label: `${STATUS_LABEL[r.status]} #${i + 1}`, primary: 'amount',
                    fields: { status: text(STATUS_LABEL[r.status]), bankRecord: text(r.bankRecordId ?? 'none'), ledgerRecords: text(r.ledgerRecordIds.join(', ') || 'none'), reason: text(r.reason), ...(row ? { amount: money(abs(BigInt(row.signedCents)), currency), date: { kind: 'DATE', iso: row.date } as Value, reference: text(row.reference) } : {}) },
                    sources: [{ kind: 'RECONCILIATION', id: r.bankRecordId ?? r.ledgerRecordIds.join('|') }, ...(r.bankRecordId ? [{ kind: 'BANK_ROW' as const, id: r.bankRecordId }] : []), ...r.ledgerRecordIds.map(id => ({ kind: 'LEDGER_ROW' as const, id }))],
                };
            })];
        }
        case 'anomalies': {
            const items = o.anomalies.filter(a => q.severity === 'ANY' || a.severity === q.severity);
            return [
                { label: `Anomaly review candidates (${q.severity === 'ANY' ? 'all severities' : q.severity})`, primary: 'candidates', fields: { candidates: count(items.length), note: text('A candidate is a reason to review, never a finding of error or fraud.') }, sources: items.map(a => ({ kind: 'ANOMALY', id: a.row.rowId })) },
                ...items.slice(0, 8).map((a, i): Draft => ({
                    label: `Review candidate #${i + 1}`, primary: 'amount',
                    fields: { ...rowFields(a.row, currency), severity: text(a.severity), rules: text(a.findings.map(f => RULES[f.ruleId].title).join('; ')), rationale: text(a.findings.map(f => f.rationale).join(' ')), ...outcomeField(o, a.row.rowId) },
                    sources: [{ kind: 'ANOMALY', id: a.row.rowId }, rowRef(a.row)],
                })),
            ];
        }
        case 'monthly_history':
            return index.months.filter(m => !m.includes('/')).map(m => ({ label: `Month ${m}`, primary: 'net', fields: { period: { kind: 'PERIOD', ym: m } as Value, ...totalsFields(rowsFor(index, m), currency) }, sources: [{ kind: 'HISTORY', id: m }] }));
        case 'forecast': {
            const f = o.forecast?.forecast;
            if (!f || f.status !== 'AVAILABLE') return [{ label: 'Next-month cash baseline', primary: 'status', fields: { status: text(f ? f.detail : 'Forecast unavailable for this processing.') }, sources: [{ kind: 'FORECAST', id: 'unavailable' }] }];
            return [{
                label: `Next-month cash baseline for ${f.period} (average of the last ${f.basis.months} months; not a prediction of specific transactions)`, primary: 'net',
                fields: { period: { kind: 'PERIOD', ym: f.period }, moneyIn: money(toCents(f.credits), currency), moneyOut: money(toCents(f.debits), currency), net: money(toCents(f.net), currency), basisFrom: { kind: 'PERIOD', ym: f.basis.first }, basisTo: { kind: 'PERIOD', ym: f.basis.last }, basisMonths: count(f.basis.months) },
                sources: [{ kind: 'FORECAST', id: f.period }],
            }];
        }
    }
}

/** Runs the plan's queries in order; facts are numbered F1… across queries and capped at MAX_FACTS. */
export function runQueries(index: GroundingIndex, queries: ToolCall[]): Fact[] {
    const facts: Fact[] = [];
    queries.forEach((q, query) => { for (const d of run(index, q)) if (facts.length < MAX_FACTS) facts.push({ ...d, id: `F${facts.length + 1}`, query }); });
    return facts;
}
