import 'server-only';
import { createHash } from 'node:crypto';
import type { SqlConnection, TransactionDatabase } from '../db/postgres';
import { resolveM3Principal } from '../financial-m3/management';
import { auditM2, type M2Principal } from '../ai-ingestion/m2/identity';
import { parseSource } from '../../poc-anomalies/source';
import { detectAnomalies, DETECTOR_VERSION } from '../../poc-anomalies/detector';
import { readReconciliation } from '../../poc-anomalies/reconciliation';
import { readScopedReconciliation } from '../poc-reconciliation/service';
import { projectSource, type InsightsQuery } from '../../poc-insights/model';
import type { PocSource } from '../poc-anomalies/service';

const refused = () => ({ status: 'REFUSED' as const, code: 'UNAVAILABLE' as const });
const scope = (p: M2Principal) => ({ userId: p.user_id, organizationId: p.organization_id, role: 'Finance' as const, membershipVersion: p.version });
/** Read-only financial explorer. The existing upload service owns all source ingestion/storage. */
export function createPocInsights(db: TransactionDatabase) {
    async function finance<T>(token: string, work: (tx: SqlConnection, p: M2Principal) => Promise<T>) {
        return db.transaction(async tx => {
            const p = await resolveM3Principal(tx, token, false);
            if (p.role !== 'Finance') {
                await auditM2(tx, p, 'authorization.denied', 'poc-insights', 'denied');
                return refused();
            }
            return work(tx, p);
        });
    }
    return {
        sources: (token: string) => finance(token, async (tx, p) => {
            const sources = (await tx.query<PocSource>(`SELECT id::text,file_name AS "fileName",sha256,layout,row_count AS "rowCount",created_at::text AS "uploadedAt"
                FROM fingence_poc.anomaly_sources WHERE organization_id=$1 ORDER BY created_at DESC,id`, [p.organization_id])).rows;
            await auditM2(tx, p, 'financial_record.read', 'poc-insights-sources');
            return { status: 'OK' as const, scope: scope(p), sources };
        }),
        read: (token: string, query: InsightsQuery) => finance(token, async (tx, p) => {
            const row = (await tx.query<PocSource & { content: Uint8Array }>(`SELECT id::text,file_name AS "fileName",sha256,layout,row_count AS "rowCount",created_at::text AS "uploadedAt",content
                FROM fingence_poc.anomaly_sources WHERE id=$1 AND organization_id=$2 FOR SHARE`, [query.source, p.organization_id])).rows[0];
            if (!row) { await auditM2(tx, p, 'financial_record.read', query.source, 'denied'); return refused(); }
            const { content, ...source } = row;
            if (createHash('sha256').update(content).digest('hex') !== source.sha256) throw Error('SOURCE_INTEGRITY');
            const parsed = parseSource(content);
            if (parsed.rows.length !== source.rowCount || parsed.layout !== source.layout) throw Error('SOURCE_INTEGRITY');
            let projection;
            try { projection = projectSource(parsed.rows, query); }
            catch (error) {
                if (!(error instanceof Error) || error.message !== 'UNAVAILABLE') throw error;
                await auditM2(tx, p, 'financial_record.read', query.source, 'denied'); return refused();
            }
            const selected = projection.selection;
            const candidates = detectAnomalies(parsed.rows).filter(c => c.row.businessId === selected.businessId && c.row.currency === selected.currency && c.row.period === selected.period);
            const binding = { ...selected, organizationId: p.organization_id, bankSha256: source.sha256 };
            const reconciliation = readReconciliation(await readScopedReconciliation(tx, p, binding), binding);
            await auditM2(tx, p, 'financial_record.read', query.source);
            return { status: 'OK' as const, version: 'poc-financial-insights-v1' as const, publicationEligible: false as const,
                origin: 'SYNTHETIC_SOURCE_ARITHMETIC' as const, scope: scope(p), source, ...projection,
                anomalies: { detectorVersion: DETECTOR_VERSION, candidates: candidates.length, high: candidates.filter(c => c.severity === 'HIGH').length, medium: candidates.filter(c => c.severity === 'MEDIUM').length },
                reconciliation, basis: 'Source signed bank cash movement; Credit adds cash, Debit removes cash. No revenue, expense, profit, FX or statutory cash-flow classification is inferred.',
            };
        }),
    };
}
export type PocInsights = Extract<Awaited<ReturnType<ReturnType<typeof createPocInsights>['read']>>, { status: 'OK' }>;
