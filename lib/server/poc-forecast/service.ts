import 'server-only';
import { createHash } from 'node:crypto';
import type { SqlConnection, TransactionDatabase } from '../db/postgres';
import { persistSecurityAuditEvent } from '../security/audit-store';
import type { M2Principal } from '../ai-ingestion/m2/identity';
import { resolveM3Principal } from '../financial-m3/management';
import { parseSource, type ParsedSource, type SourceLayout } from '../../poc-anomalies/source';
import { BACKTEST_START, FORECAST_VERSION, METHODS, MIN_MONTHS, PRIMARY_METHOD, forecastBusiness, poolBacktests, type BusinessForecast, type MetricBacktest, type Metric } from '../../poc-forecast/forecast';

export type ForecastScope = { userId: string; organizationId: string; role: 'Finance'; membershipVersion: number };
export type ForecastSource = { id: string; fileName: string; sha256: string; layout: SourceLayout; rowCount: number; uploadedAt: string };
export type ForecastRefused = { status: 'REFUSED'; code: 'UNAVAILABLE' };
export type ForecastView = {
    status: 'OK'; version: 'poc-cash-forecast-view-v1'; forecastVersion: typeof FORECAST_VERSION; publicationEligible: false; dataOrigin: 'SYNTHETIC_UPLOADED_SOURCE';
    scope: ForecastScope; source: ForecastSource;
    selection: { businessId: string; businessName: string };
    options: { businessId: string; businessName: string; rows: number }[];
    business: BusinessForecast;
    portfolio: { currency: string | null; included: string[]; excluded: { businessId: string; code: string }[]; backtest: Record<Metric, Omit<MetricBacktest, 'points'>> | null };
    method: { primary: typeof PRIMARY_METHOD; windows: typeof METHODS; minimumMonths: number; backtestStart: number; description: string; wape: string; mae: string };
    limitations: string[];
};

export const FORECAST_LIMITATIONS = [
    'Synthetic PoC data only; not financial-publication eligible and not real company or banking records.',
    'Bank cash receipts (credits) and payments (debits) from uploaded statement rows. They are not revenue, profit, expenses or a statutory cash flow statement.',
    'Deterministic six-month moving-average baseline. It is not AI, machine learning or a trained model, and no confidence interval is produced.',
    'Net movement is derived as forecast receipts minus forecast payments. It is experimental and low confidence; its backtest error is far larger than for receipts or payments.',
    'Backtests are a handful of rolling-origin months per business; pooled results are dominated by the largest business. This is not evidence that the method generalizes.',
    'The last month in the file is assumed complete. Missing months are never filled in, and a gap, currency mix or sign mismatch stops the forecast.',
];
const id = /^[0-9a-f-]{36}$/;
const refused = (): ForecastRefused => ({ status: 'REFUSED', code: 'UNAVAILABLE' });
async function audit(tx: SqlConnection, p: M2Principal, action: 'financial_record.read' | 'authorization.denied', outcome: 'success' | 'denied' | 'failure', targetId: string) {
    await persistSecurityAuditEvent(tx, { actorId: p.user_id, organizationId: p.organization_id, action, outcome, targetType: 'transaction_collection', targetId, requestId: null, approvalId: null });
}
const parsedCache = new Map<string, ParsedSource>();
function parsed(sha256: string, content: Uint8Array) {
    let entry = parsedCache.get(sha256);
    if (!entry) {
        try { entry = parseSource(content); } catch { return null; }
        parsedCache.set(sha256, entry);
        if (parsedCache.size > 4) parsedCache.delete(parsedCache.keys().next().value!);
    }
    return entry;
}

/** Read-only forecasts over the organization's Finance-uploaded anomaly sources. Writes nothing except audit events. */
export function createPocForecast(db: TransactionDatabase) {
    async function finance<T>(token: string, target: string, work: (tx: SqlConnection, p: M2Principal) => Promise<T>) {
        return db.transaction(async (tx): Promise<T | ForecastRefused> => {
            const p = await resolveM3Principal(tx, token, false);
            if (p.role !== 'Finance') { await audit(tx, p, 'authorization.denied', 'denied', target); return refused(); }
            return work(tx, p);
        });
    }
    const scopeOf = (p: M2Principal): ForecastScope => ({ userId: p.user_id, organizationId: p.organization_id, role: 'Finance', membershipVersion: p.version });
    const meta = (r: { id: string; file_name: string; sha256: string; layout: SourceLayout; row_count: number; created_at: Date | string }): ForecastSource =>
        ({ id: r.id, fileName: r.file_name, sha256: r.sha256, layout: r.layout, rowCount: r.row_count, uploadedAt: new Date(r.created_at).toISOString() });
    return {
        sources: (token: string) => finance(token, 'poc-forecast-sources', async (tx, p) => {
            const rows = (await tx.query<{ id: string; file_name: string; sha256: string; layout: SourceLayout; row_count: number; created_at: Date | string }>(
                'SELECT id::text,file_name,sha256,layout,row_count,created_at FROM fingence_poc.anomaly_sources WHERE organization_id=$1 ORDER BY created_at DESC, id', [p.organization_id])).rows;
            await audit(tx, p, 'financial_record.read', 'success', 'poc-forecast-sources');
            return { status: 'OK' as const, scope: scopeOf(p), sources: rows.map(meta) };
        }),
        forecast: (token: string, input: { sourceId: string; businessId?: string }) => finance(token, 'poc-forecast', async (tx, p): Promise<ForecastView | ForecastRefused> => {
            const row = id.test(input.sourceId) ? (await tx.query<{ id: string; file_name: string; sha256: string; layout: SourceLayout; row_count: number; created_at: Date | string; content: Uint8Array }>(
                'SELECT id::text,file_name,sha256,layout,row_count,created_at,content FROM fingence_poc.anomaly_sources WHERE id=$1 AND organization_id=$2', [input.sourceId, p.organization_id])).rows[0] : undefined;
            const content = row && new Uint8Array(row.content);
            // The stored bytes must still hash to the recorded source hash; otherwise nothing is computed.
            const source = row && content && createHash('sha256').update(content).digest('hex') === row.sha256 ? parsed(row.sha256, content) : null;
            const names = new Map<string, string>(), counts = new Map<string, number>();
            for (const r of source?.rows ?? []) { names.set(r.businessId, names.get(r.businessId) ?? r.businessName); counts.set(r.businessId, (counts.get(r.businessId) ?? 0) + 1); }
            const options = [...names].sort(([a], [b]) => a.localeCompare(b)).map(([businessId, businessName]) => ({ businessId, businessName, rows: counts.get(businessId)! }));
            const chosen = input.businessId === undefined ? options[0] : options.find(o => o.businessId === input.businessId);
            if (!row || !source || !chosen) { await audit(tx, p, 'financial_record.read', 'failure', 'poc-forecast'); return refused(); }
            const forecasts = new Map(options.map(o => [o.businessId, forecastBusiness(source.rows.filter(r => r.businessId === o.businessId))]));
            const business = forecasts.get(chosen.businessId)!, currency = business.currency;
            const included = options.filter(o => { const f = forecasts.get(o.businessId)!; return f.forecast.status === 'AVAILABLE' && f.currency === currency; }).map(o => o.businessId);
            await audit(tx, p, 'financial_record.read', 'success', row.id);
            return {
                status: 'OK', version: 'poc-cash-forecast-view-v1', forecastVersion: FORECAST_VERSION, publicationEligible: false, dataOrigin: 'SYNTHETIC_UPLOADED_SOURCE',
                scope: scopeOf(p), source: meta(row), selection: { businessId: chosen.businessId, businessName: chosen.businessName }, options, business,
                portfolio: {
                    currency, included, backtest: business.forecast.status === 'AVAILABLE' ? poolBacktests(included.map(b => forecasts.get(b)!)) : null,
                    excluded: options.filter(o => !included.includes(o.businessId)).map(o => { const f = forecasts.get(o.businessId)!.forecast; return { businessId: o.businessId, code: f.status === 'UNAVAILABLE' ? f.code : 'OTHER_CURRENCY' }; }),
                },
                method: {
                    primary: PRIMARY_METHOD, windows: METHODS, minimumMonths: MIN_MONTHS, backtestStart: BACKTEST_START,
                    description: 'Next month = mean of the previous six complete months, separately for bank receipts and payment magnitudes; net = receipts minus payments. Compared with last-month and three-month baselines.',
                    wape: 'WAPE = sum of absolute forecast errors / sum of absolute observed values, over rolling-origin months forecast only from earlier months.',
                    mae: 'MAE = mean absolute forecast error per tested month, in the source currency.',
                },
                limitations: FORECAST_LIMITATIONS,
            };
        }),
    };
}
