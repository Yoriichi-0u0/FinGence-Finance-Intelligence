import 'server-only';
import { createHash } from 'node:crypto';
import type { SqlConnection, TransactionDatabase } from '../db/postgres';
import { persistSecurityAuditEvent } from '../security/audit-store';
import type { M2Principal } from '../ai-ingestion/m2/identity';
import { resolveM3Principal } from '../financial-m3/management';
import { readScopedReconciliation } from '../poc-reconciliation/service';
import { readReconciliationReviewAggregate } from '../poc-reconciliation/reviews';
import type { PocSource } from '../poc-anomalies/service';
import { parseSource, type ParsedSource, type SourceLayout } from '../../poc-anomalies/source';
import { detectAnomalies, type Candidate } from '../../poc-anomalies/detector';
import { readReconciliation } from '../../poc-anomalies/reconciliation';
import { forecastBusiness, poolBacktests } from '../../poc-forecast/forecast';
import { insightsQuery, projectSource } from '../../poc-insights/model';
import { answerQuestion, suggestions, MAX_QUESTION, type QaAnswer, type QaFacts } from '../../poc-finance-qa/answer';

export type QaScope = { userId: string; organizationId: string; role: 'Finance'; membershipVersion: number };
export type QaSelectionInput = { source: string; business?: string; period?: string; currency?: string };
export type QaRefused = { status: 'REFUSED'; code: 'UNAVAILABLE' };
export type QaContext = {
    status: 'OK'; version: 'poc-finance-questions-v1'; scope: QaScope; source: PocSource;
    selection: QaFacts['selection']; options: { businessId: string; businessName: string; currencies: string[] }[]; periods: string[];
    reconciliation: 'AVAILABLE' | 'UNAVAILABLE'; forecast: 'AVAILABLE' | 'UNAVAILABLE'; suggestions: string[];
};
export type QaResult = QaContext & { answer: QaAnswer };

const refused = (): QaRefused => ({ status: 'REFUSED', code: 'UNAVAILABLE' });
async function audit(tx: SqlConnection, p: M2Principal, action: 'financial_record.read' | 'authorization.denied', outcome: 'success' | 'denied' | 'failure', targetId: string) {
    await persistSecurityAuditEvent(tx, { actorId: p.user_id, organizationId: p.organization_id, action, outcome, targetType: 'transaction_collection', targetId, requestId: null, approvalId: null });
}
const analyses = new Map<string, { parsed: ParsedSource; candidates: Candidate[] }>();
function analyze(sha256: string, content: Uint8Array) {
    let entry = analyses.get(sha256);
    if (!entry) {
        const parsed = parseSource(content);
        entry = { parsed, candidates: detectAnomalies(parsed.rows) };
        analyses.set(sha256, entry);
        if (analyses.size > 4) analyses.delete(analyses.keys().next().value!);
    }
    return entry;
}

/**
 * Read-only Finance questions over one already-uploaded source. Every figure is recomputed in the
 * caller's authorized, audited transaction with the same functions the Transactions, Anomalies,
 * Reconciliation and Forecasting views use. Nothing is written except audit events.
 */
export function createPocFinanceQa(db: TransactionDatabase) {
    async function finance<T>(token: string, target: string, work: (tx: SqlConnection, p: M2Principal) => Promise<T>) {
        return db.transaction(async (tx): Promise<T | QaRefused> => {
            const p = await resolveM3Principal(tx, token, false);
            if (p.role !== 'Finance') { await audit(tx, p, 'authorization.denied', 'denied', target); return refused(); }
            return work(tx, p);
        });
    }
    const scopeOf = (p: M2Principal): QaScope => ({ userId: p.user_id, organizationId: p.organization_id, role: 'Finance', membershipVersion: p.version });
    /** Server-resolved selection and facts; null when the source is not this organization's or the selection is not observed. */
    async function context(tx: SqlConnection, p: M2Principal, input: QaSelectionInput): Promise<{ context: QaContext; facts: QaFacts } | null> {
        const query = insightsQuery.safeParse(input);
        if (!query.success) return null;
        const row = (await tx.query<{ id: string; file_name: string; sha256: string; layout: SourceLayout; row_count: number; created_at: Date | string; content: Uint8Array }>(
            'SELECT id::text,file_name,sha256,layout,row_count,created_at,content FROM fingence_poc.anomaly_sources WHERE id=$1 AND organization_id=$2 FOR SHARE', [query.data.source, p.organization_id])).rows[0];
        if (!row) return null;
        const content = new Uint8Array(row.content), source: PocSource = { id: row.id, fileName: row.file_name, sha256: row.sha256, layout: row.layout, rowCount: row.row_count, uploadedAt: new Date(row.created_at).toISOString() };
        if (createHash('sha256').update(content).digest('hex') !== source.sha256) throw Error('SOURCE_INTEGRITY');
        const { parsed, candidates } = analyze(source.sha256, content);
        if (parsed.rows.length !== source.rowCount || parsed.layout !== source.layout) throw Error('SOURCE_INTEGRITY');
        let projection;
        try { projection = projectSource(parsed.rows, query.data); }
        catch (error) { if (error instanceof Error && error.message === 'UNAVAILABLE') return null; throw error; }
        const sel = projection.selection, inScope = (r: { businessId: string; currency: string; period: string }) => r.businessId === sel.businessId && r.currency === sel.currency && r.period === sel.period;
        const reviews = new Map((await tx.query<{ row_id: string; state: 'OPEN' | 'EXPLAINED' | 'ESCALATED' }>('SELECT row_id,state FROM fingence_poc.anomaly_reviews WHERE source_id=$1', [source.id])).rows.map(r => [r.row_id, r.state]));
        const binding = { organizationId: p.organization_id, businessId: sel.businessId, period: sel.period, currency: sel.currency, bankSha256: source.sha256 };
        const forecasts = new Map(projection.options.map(o => [o.businessId, forecastBusiness(parsed.rows.filter(r => r.businessId === o.businessId))]));
        const forecast = forecasts.get(sel.businessId)!, peers = [...forecasts.values()].filter(f => f.forecast.status === 'AVAILABLE' && f.currency === forecast.currency);
        const pooled = forecast.forecast.status === 'AVAILABLE' ? poolBacktests(peers) : null;
        const reconciliation = readReconciliation(await readScopedReconciliation(tx, p, binding), binding);
        let reconciliationReviews: QaFacts['reconciliationReviews'] = null;
        if (reconciliation.status === 'AVAILABLE') {
            const snap = reconciliation.snapshot;
            const row = (await tx.query<{ id: string }>(`SELECT id::text FROM fingence_poc.reconciliations
                WHERE organization_id=$1 AND bank_sha256=$2 AND ledger_sha256=$3
                AND snapshot #>> '{scope,businessId}'=$4 AND snapshot #>> '{scope,period}'=$5
                AND snapshot #>> '{scope,currency}'=$6 FOR SHARE`,
                [p.organization_id, snap.sources.bank.sha256, snap.sources.ledger.sha256, sel.businessId, sel.period, sel.currency])).rows[0];
            if (row) reconciliationReviews = await readReconciliationReviewAggregate(tx, p, row.id);
        }
        const facts: QaFacts = {
            selection: { sourceId: source.id, fileName: source.fileName, sha256: source.sha256, ...sel },
            businesses: projection.options.map(o => o.businessId), periods: projection.periods, totals: projection.totals, series: projection.series,
            candidates: candidates.filter(c => inScope(c.row)).map(c => ({ rowId: c.row.rowId, severity: c.severity, rules: c.findings.map(f => f.ruleId), review: reviews.get(c.row.rowId) ?? 'OPEN' })),
            reconciliation, reconciliationReviews,
            forecast, pooled: pooled && { businesses: peers.length, backtest: pooled },
        };
        return { facts, context: {
            status: 'OK', version: 'poc-finance-questions-v1', scope: scopeOf(p), source, selection: facts.selection, options: projection.options, periods: projection.periods,
            reconciliation: facts.reconciliation.status, forecast: forecast.forecast.status, suggestions: suggestions(facts),
        } };
    }
    return {
        sources: (token: string) => finance(token, 'poc-finance-questions-sources', async (tx, p) => {
            const rows = (await tx.query<{ id: string; file_name: string; sha256: string; layout: SourceLayout; row_count: number; created_at: Date | string }>(
                'SELECT id::text,file_name,sha256,layout,row_count,created_at FROM fingence_poc.anomaly_sources WHERE organization_id=$1 ORDER BY created_at DESC, id', [p.organization_id])).rows;
            await audit(tx, p, 'financial_record.read', 'success', 'poc-finance-questions-sources');
            return { status: 'OK' as const, scope: scopeOf(p), sources: rows.map(r => ({ id: r.id, fileName: r.file_name, sha256: r.sha256, layout: r.layout, rowCount: r.row_count, uploadedAt: new Date(r.created_at).toISOString() })) };
        }),
        context: (token: string, input: QaSelectionInput) => finance(token, 'poc-finance-questions', async (tx, p): Promise<QaContext | QaRefused> => {
            const built = await context(tx, p, input);
            if (!built) { await audit(tx, p, 'financial_record.read', 'failure', 'poc-finance-questions'); return refused(); }
            await audit(tx, p, 'financial_record.read', 'success', built.context.source.id);
            return built.context;
        }),
        /** Answers one question for the server-resolved selection. The question never selects data. */
        ask: (token: string, input: QaSelectionInput, question: string) => finance(token, 'poc-finance-questions', async (tx, p): Promise<QaResult | QaRefused> => {
            const built = typeof question === 'string' && question.trim() && question.length <= MAX_QUESTION ? await context(tx, p, input) : null;
            if (!built) { await audit(tx, p, 'financial_record.read', 'failure', 'poc-finance-questions'); return refused(); }
            await audit(tx, p, 'financial_record.read', 'success', built.context.source.id);
            return { ...built.context, answer: answerQuestion(built.facts, question) };
        }),
    };
}
