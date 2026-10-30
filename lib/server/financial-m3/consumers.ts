import 'server-only';
import { createHash } from 'node:crypto';
import type { TransactionDatabase, SqlConnection } from '../db/postgres';
import { createM2Pipeline, type calculateM2Batch } from '../ai-ingestion/m2/pipeline';
import { auditM2 } from '../ai-ingestion/m2/identity';
import { resolveM3Principal } from './management';
import { subtractDecimalStrings } from '../../analytics/index';
type Report = ReturnType<typeof calculateM2Batch>;
export type WarningPolicy = 'include' | 'exclude';
const add = (a: string, b: string) => subtractDecimalStrings(a, b.startsWith('-') ? b.slice(1) : '-' + b);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
function derive(report: Report) {
    return report.groups.map(group => {
        const ids = new Set(group.sources.map(s => s.recordId)), rows = report.records.filter(r => ids.has(r.id));
        const dateSupported = report.conventions?.dateBasis === 'transaction_date' && rows.every(r => r.financial.canonical_date_basis === 'TRANSACTION_DATE' && r.financial.transaction_date !== null && /^\d{4}-\d{2}-\d{2}$/.test(r.financial.transaction_date));
        const series = (size: number) => {
            const map = new Map<string, {
                period: string;
                total: string | null;
                recordCount: number;
                recordIds: string[];
                evidenceIds: string[];
            }>();
            if (!dateSupported)
                return [];
            for (const row of rows) {
                const period = row.financial.transaction_date!.slice(0, size);
                const point = map.get(period) ?? { period, total: group.status === 'AVAILABLE' ? '0' : null, recordCount: 0, recordIds: [], evidenceIds: [] };
                point.recordCount++;
                point.recordIds.push(row.id);
                point.evidenceIds.push(...row.evidence.flatMap(e => e ? [e.id] : []));
                if (point.total !== null)
                    point.total = add(point.total, row.financial.source_amount!);
                map.set(period, point);
            }
            return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
        };
        const values = group.status === 'AVAILABLE' ? rows.map(r => r.financial.source_amount!) : [];
        const ordered = [...values].sort((a, b) => { const difference = subtractDecimalStrings(a, b); return difference === '0' ? 0 : difference.startsWith('-') ? -1 : 1; });
        return { currency: group.currency, monetaryBasis: group.monetaryBasis, status: group.status, reason: group.reason, recordCount: rows.length, sourceSignedTotal: group.total, recordIds: rows.map(r => r.id), evidenceIds: group.sources.flatMap(s => s.evidenceIds), dateStatus: dateSupported ? 'AVAILABLE' as const : 'UNAVAILABLE' as const, days: series(10), months: series(7), minimum: ordered[0] ?? null, maximum: ordered.at(-1) ?? null, signCounts: values.length ? { positive: values.filter(v => subtractDecimalStrings(v, '0') !== '0' && !v.startsWith('-')).length, negative: values.filter(v => subtractDecimalStrings(v, '0') !== '0' && v.startsWith('-')).length, zero: values.filter(v => subtractDecimalStrings(v, '0') === '0').length } : null };
    });
}
function financialFacts(report: Report) {
    const analytics = derive(report), counts = { accepted: report.coverage?.accepted ?? 0, rejected: report.coverage?.rejected ?? 0, unresolved: report.coverage?.unresolved ?? 0, selected: report.records.length, excludedWarnings: report.excludedWarnings, sourceRows: report.coverage?.rowCountEstablished ? report.coverage.sourceRows : null };
    const facts = { version: 'v2-financial-consumers-v1' as const, publicationEligible: false as const, source: report.source, policyVersion: report.policyVersion, policyHash: report.policyHash, conventions: report.conventions, origin: report.adapter, interpretation: report.origin === 'LIVE_GROQ' ? 'LIVE_GROQ' : report.origin === 'LIVE_OLLAMA' ? 'LIVE_OLLAMA' : report.origin === 'RECORDED_TEST' ? ((report.adapter as {model?:string}|null)?.model==='SIMULATED_OFFLINE_SEMANTIC_ADAPTER_V1'?'SIMULATED':'RECORDED_TEST') : 'NOT_EXECUTED', records: report.records, counts, analytics, capabilities: { reconciliation: { status: 'UNAVAILABLE' as const, reason: 'No verified counterpart dataset and authorized matching policy.' }, forecasting: { status: 'UNAVAILABLE' as const, reason: 'Insufficient verified historical series and no validated forecast enabled.', observedPeriods: Math.max(0, ...analytics.map(g => g.months.length)) }, model: { status: 'UNAVAILABLE' as const, reason: 'No live provider authorized or configured.' } }, limitations: report.limitations };
    const selection = { attemptId: report.attemptId, warningPolicy: report.warningPolicy, hash: createHash('sha256').update(JSON.stringify(canonical({ attemptId: report.attemptId, warningPolicy: report.warningPolicy, ...facts }))).digest('hex') };
    return { ...facts, selection };
}
export type FinancialFacts = ReturnType<typeof financialFacts>;
export type FinancialSnapshot = FinancialFacts & {
    scope: {
        userId: string;
        organizationId: string;
        role: 'Finance';
        membershipVersion: number;
    };
};
export function prepareGroundedRequest(snapshot: FinancialFacts, question: string) {
    if (typeof question !== 'string' || question.length > 500)
        throw new Error('INVALID_QUESTION');
    const allowedClaims = snapshot.analytics.filter(g => g.status === 'AVAILABLE').map(g => ({ kind: 'SOURCE_SIGNED_AMOUNT_SUM' as const, value: g.sourceSignedTotal!, currency: g.currency!, monetaryBasis: g.monetaryBasis!, recordIds: g.recordIds, evidenceIds: g.evidenceIds }));
    return { version: 'v2-grounded-financial-request-v1' as const, mode: 'MODEL_NOT_CONFIGURED' as const, question, selectionHash: snapshot.selection.hash, allowedClaims, instructions: 'Only these exact deterministic source claims and citations may be returned. No new accounting interpretation or model-generated figures.' };
}
export function validateGroundedClaims(snapshot: FinancialFacts, proposal: unknown): boolean {
    if (!Array.isArray(proposal) || !proposal.length)
        return false;
    const allowed = prepareGroundedRequest(snapshot, 'source claims').allowedClaims.map(claim => JSON.stringify(canonical(claim)));
    return proposal.every(claim => allowed.includes(JSON.stringify(canonical(claim))));
}
export function createFinancialConsumers(database: TransactionDatabase) {
    const locked = (tx: SqlConnection): TransactionDatabase => ({ transaction: work => work(tx), close: async () => { } });
    async function read<T>(token: string, id: string, warnings: WarningPolicy, compose: (facts: FinancialFacts, tx: SqlConnection, p: Awaited<ReturnType<typeof resolveM3Principal>>) => Promise<T>) {
        return database.transaction(async (tx) => {
            const p = await resolveM3Principal(tx, token);
            const result = await createM2Pipeline(locked(tx)).get(token, id, warnings);
            if (result.job.state !== 'COMPLETED' || !result.batch || !result.report)
                throw new Error('BATCH_UNAVAILABLE');
            const facts = financialFacts(result.report);
            return compose(facts, tx, p);
        });
    }
    return {
        async list(token: string) { return database.transaction(async (tx) => { await resolveM3Principal(tx, token); return createM2Pipeline(locked(tx)).list(token); }); },
        snapshot: (token: string, id: string, warnings: WarningPolicy): Promise<FinancialSnapshot> => read(token, id, warnings, async (facts, _tx, p) => ({ ...facts, scope: { userId: p.user_id, organizationId: p.organization_id, role: 'Finance', membershipVersion: p.version } })),
        export: (token: string, id: string, warnings: WarningPolicy) => read(token, id, warnings, async (facts, tx, p) => { await auditM2(tx, p, 'report.downloaded', id); return facts; }),
        answer: (token: string, id: string, warnings: WarningPolicy, question: string) => read(token, id, warnings, async (facts) => {
            if (typeof question !== 'string' || !question.trim() || question.length > 500)
                throw new Error('INVALID_QUESTION');
            const q = question.trim().toLowerCase(), request = prepareGroundedRequest(facts, question);
            if (['what is the source-signed total?', 'what is the sum of signed source amounts?'].includes(q))
                return { status: request.allowedClaims.length ? 'DETERMINISTIC_SOURCE_CLAIMS' as const : 'UNAVAILABLE' as const, selectionHash: facts.selection.hash, claims: request.allowedClaims, reason: request.allowedClaims.length ? null : 'No supported source-signed amount basis.' };
            if (['how many verified records?', 'how many selected records?'].includes(q))
                return { status: 'DETERMINISTIC_RECORD_COUNT' as const, selectionHash: facts.selection.hash, claims: [], count: facts.records.length, recordIds: facts.records.map(r => r.id), reason: null };
            return { status: 'UNSUPPORTED' as const, selectionHash: facts.selection.hash, claims: [], reason: 'Revenue, expenses, cash flow, reconciliation, forecasts and live AI require additional verified evidence/capabilities.' };
        }),
    };
}
