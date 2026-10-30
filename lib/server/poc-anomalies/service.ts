import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SqlConnection, TransactionDatabase } from '../db/postgres';
import { persistSecurityAuditEvent } from '../security/audit-store';
import type { SecurityAuditAction, SecurityAuditTargetType } from '../security/audit';
import type { M2Principal } from '../ai-ingestion/m2/identity';
import { resolveM3Principal } from '../financial-m3/management';
import { parseSource, SourceError, fromCents, toCents, type ParsedSource, type SourceLayout, type SourceRefusal } from '../../poc-anomalies/source';
import { detectAnomalies, DETECTOR_VERSION, RULES, THRESHOLDS, type Candidate, type RuleId, type Severity } from '../../poc-anomalies/detector';
import { readReconciliation, type ReconciliationScope, type ReconciliationView } from '../../poc-anomalies/reconciliation';
import { renderManagementReport } from './pdf';

export type ReviewState = 'OPEN' | 'EXPLAINED' | 'ESCALATED';
export type PocRefusal = 'UNAVAILABLE' | 'STALE_REVIEW' | SourceRefusal;
export type PocRefused = { status: 'REFUSED'; code: PocRefusal; details?: string[] };
export type PocSource = { id: string; fileName: string; sha256: string; layout: SourceLayout; rowCount: number; uploadedAt: string };
export type PocScope = { userId: string; organizationId: string; role: 'Finance'; membershipVersion: number };
export type PocCandidate = {
    rowId: string; sourceTransactionId: string | null; date: string; description: string; direction: 'Credit' | 'Debit'; currency: string;
    amount: string; signedAmount: string; counterparty: string; reference: string; severity: Severity;
    findings: { ruleId: RuleId; title: string; severity: Severity; rationale: string }[];
    review: { state: ReviewState; version: number; decidedAt: string | null };
};
export type PocEvaluation = { label: string; datasetVersion: string; featureFileSha256: string; detectorVersion: string; rows: number; labeledAnomalies: number; truePositives: number; falsePositives: number; falseNegatives: number; trueNegatives: number; precision: string; recall: string };
export type PocAnalysis = {
    status: 'OK'; version: 'poc-anomaly-analysis-v1'; detectorVersion: typeof DETECTOR_VERSION; publicationEligible: false; dataOrigin: 'SYNTHETIC_UPLOADED_SOURCE';
    scope: PocScope; source: PocSource;
    selection: { businessId: string; businessName: string; period: string; currency: string };
    options: { businessId: string; businessName: string; periods: string[]; currencies: string[] }[];
    cashMovement: { rows: number; creditRows: number; debitRows: number; credits: string; debits: string; net: string; basis: string };
    counts: { candidates: number; high: number; medium: number; byRule: Record<RuleId, number>; byReview: Record<ReviewState, number> };
    candidates: PocCandidate[];
    rules: { id: RuleId; title: string; basis: string }[];
    baseline: string;
    evaluation: PocEvaluation | null;
    limitations: string[];
};
export type PocReport = Omit<PocAnalysis, 'status'> & { reportVersion: 'poc-management-report-v1'; generatedAt: string; reconciliation: ReconciliationView; reportHash: string };
export type ReconciliationReader = (tx: SqlConnection, principal: M2Principal, scope: ReconciliationScope) => Promise<unknown>;
export type SelectionInput = { sourceId: string; businessId?: string; period?: string; currency?: string };

export const POC_LIMITATIONS = [
    'Synthetic PoC data only; not financial-publication eligible and not real company or banking records.',
    'Signed cash movement is a sum of source bank amounts. It is not revenue, profit or a cash flow statement.',
    'Anomaly candidates are transparent rule outputs that need human review. They are not fraud findings or model predictions.',
    'Rule statistics use every row of the same business and currency in the uploaded file, including other months.',
];
const id = /^[0-9a-f-]{36}$/, rowPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const refused = (code: PocRefusal, details?: string[]): PocRefused => details ? { status: 'REFUSED', code, details } : { status: 'REFUSED', code };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
async function audit(tx: SqlConnection, p: M2Principal, action: SecurityAuditAction, outcome: 'success' | 'denied' | 'failure', targetType: SecurityAuditTargetType, targetId: string) {
    await persistSecurityAuditEvent(tx, { actorId: p.user_id, organizationId: p.organization_id, action, outcome, targetType, targetId, requestId: null, approvalId: null });
}

/** Offline evaluation artifact; shown only for the exact file it measured. Labels never reach this process. */
async function evaluationFor(sha256: string): Promise<PocEvaluation | null> {
    try {
        const artifact = JSON.parse(await readFile('docs/poc/anomaly-evaluation.json', 'utf8')) as PocEvaluation;
        return artifact.featureFileSha256 === sha256 && artifact.detectorVersion === DETECTOR_VERSION ? artifact : null;
    } catch { return null; }
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

export function createPocAnomalies(db: TransactionDatabase, options: { reconciliation?: ReconciliationReader } = {}) {
    /** Finance only. Other authenticated roles get a committed, audited denial; invalid sessions throw. */
    async function finance<T>(token: string, target: [SecurityAuditTargetType, string], work: (tx: SqlConnection, p: M2Principal) => Promise<T>) {
        return db.transaction(async (tx): Promise<T | PocRefused> => {
            const p = await resolveM3Principal(tx, token, false);
            if (p.role !== 'Finance') {
                await audit(tx, p, 'authorization.denied', 'denied', ...target);
                return refused('UNAVAILABLE');
            }
            return work(tx, p);
        });
    }
    const scopeOf = (p: M2Principal): PocScope => ({ userId: p.user_id, organizationId: p.organization_id, role: 'Finance', membershipVersion: p.version });
    async function source(tx: SqlConnection, p: M2Principal, sourceId: string) {
        if (!id.test(sourceId)) return null;
        const row = (await tx.query<{ id: string; file_name: string; sha256: string; layout: SourceLayout; row_count: number; created_at: Date | string; content: Uint8Array }>(
            'SELECT id::text,file_name,sha256,layout,row_count,created_at,content FROM fingence_poc.anomaly_sources WHERE id=$1 AND organization_id=$2', [sourceId, p.organization_id])).rows[0];
        return row ? { meta: { id: row.id, fileName: row.file_name, sha256: row.sha256, layout: row.layout, rowCount: row.row_count, uploadedAt: new Date(row.created_at).toISOString() } satisfies PocSource, content: row.content } : null;
    }
    async function build(tx: SqlConnection, p: M2Principal, input: SelectionInput): Promise<Omit<PocAnalysis, 'status'> | null> {
        const loaded = await source(tx, p, input.sourceId);
        if (!loaded) return null;
        const { parsed, candidates } = analyze(loaded.meta.sha256, new Uint8Array(loaded.content));
        const businesses = new Map<string, { businessId: string; businessName: string; periods: Set<string>; currencies: Set<string> }>();
        for (const r of parsed.rows) {
            const b = businesses.get(r.businessId) ?? { businessId: r.businessId, businessName: r.businessName, periods: new Set(), currencies: new Set() };
            b.periods.add(r.period); b.currencies.add(r.currency); businesses.set(r.businessId, b);
        }
        const options = [...businesses.values()].sort((a, b) => a.businessId.localeCompare(b.businessId)).map(b => ({ businessId: b.businessId, businessName: b.businessName, periods: [...b.periods].sort(), currencies: [...b.currencies].sort() }));
        const business = input.businessId === undefined ? options[0] : options.find(o => o.businessId === input.businessId);
        if (!business) return null;
        const period = input.period ?? business.periods.at(-1)!, currency = input.currency ?? business.currencies[0];
        if (!business.periods.includes(period) || !business.currencies.includes(currency)) return null;
        const inScope = (r: { businessId: string; period: string; currency: string }) => r.businessId === business.businessId && r.period === period && r.currency === currency;
        const rows = parsed.rows.filter(inScope), scoped = candidates.filter(c => inScope(c.row));
        const reviews = new Map((await tx.query<{ row_id: string; state: ReviewState; version: number; decided_at: Date | string }>(
            'SELECT row_id,state,version,decided_at FROM fingence_poc.anomaly_reviews WHERE source_id=$1', [loaded.meta.id])).rows.map(r => [r.row_id, r]));
        let credits = 0n, debits = 0n;
        for (const r of rows) { const v = toCents(r.signedAmount); if (v >= 0n) credits += v; else debits += v; }
        const list: PocCandidate[] = scoped.map(({ row, severity, findings }) => {
            const review = reviews.get(row.rowId);
            return { rowId: row.rowId, sourceTransactionId: row.sourceTransactionId, date: row.date, description: row.description, direction: row.direction, currency: row.currency, amount: row.amount, signedAmount: row.signedAmount, counterparty: row.counterparty, reference: row.reference, severity,
                findings: findings.map(f => ({ ...f, title: RULES[f.ruleId].title })), review: { state: review?.state ?? 'OPEN', version: review?.version ?? 0, decidedAt: review ? new Date(review.decided_at).toISOString() : null } };
        });
        const ruleIds = Object.keys(RULES) as RuleId[];
        return {
            version: 'poc-anomaly-analysis-v1', detectorVersion: DETECTOR_VERSION, publicationEligible: false, dataOrigin: 'SYNTHETIC_UPLOADED_SOURCE', scope: scopeOf(p), source: loaded.meta,
            selection: { businessId: business.businessId, businessName: business.businessName, period, currency }, options,
            cashMovement: { rows: rows.length, creditRows: rows.filter(r => r.direction === 'Credit').length, debitRows: rows.filter(r => r.direction === 'Debit').length, credits: fromCents(credits), debits: fromCents(debits), net: fromCents(credits + debits), basis: 'Sum of source SignedCashMovementMYR; bank credit adds cash.' },
            counts: { candidates: list.length, high: list.filter(c => c.severity === 'HIGH').length, medium: list.filter(c => c.severity === 'MEDIUM').length,
                byRule: Object.fromEntries(ruleIds.map(r => [r, list.filter(c => c.findings.some(f => f.ruleId === r)).length])) as Record<RuleId, number>,
                byReview: { OPEN: list.filter(c => c.review.state === 'OPEN').length, EXPLAINED: list.filter(c => c.review.state === 'EXPLAINED').length, ESCALATED: list.filter(c => c.review.state === 'ESCALATED').length } },
            candidates: list, rules: ruleIds.map(r => ({ id: r, ...RULES[r] })),
            baseline: `Every ${business.businessId} ${currency} row in this file (${parsed.rows.filter(r => r.businessId === business.businessId && r.currency === currency).length} rows); thresholds: robust z ${THRESHOLDS.robustZ}, direction share ${THRESHOLDS.directionShare * 100}%.`,
            evaluation: await evaluationFor(loaded.meta.sha256), limitations: POC_LIMITATIONS,
        };
    }
    return {
        sources: (token: string) => finance(token, ['transaction_collection', 'poc-anomaly-sources'], async (tx, p) => {
            const rows = (await tx.query<{ id: string; file_name: string; sha256: string; layout: SourceLayout; row_count: number; created_at: Date | string }>(
                'SELECT id::text,file_name,sha256,layout,row_count,created_at FROM fingence_poc.anomaly_sources WHERE organization_id=$1 ORDER BY created_at DESC, id', [p.organization_id])).rows;
            return { status: 'OK' as const, scope: scopeOf(p), sources: rows.map(r => ({ id: r.id, fileName: r.file_name, sha256: r.sha256, layout: r.layout, rowCount: r.row_count, uploadedAt: new Date(r.created_at).toISOString() })) };
        }),
        /** Parses before opening the transaction; the source is stored byte-exact once per organization. */
        async upload(token: string, fileName: string, bytes: Uint8Array) {
            const sha256 = createHash('sha256').update(bytes).digest('hex');
            let parsed: ParsedSource | null = null, failure: SourceError | null = null;
            try { parsed = parseSource(bytes); } catch (e) { if (e instanceof SourceError) failure = e; else throw e; }
            return finance(token, ['ingestion_batch', 'poc-anomaly-upload'], async (tx, p) => {
                if (!parsed) {
                    await audit(tx, p, 'ingestion.rejected', 'failure', 'ingestion_batch', 'poc-anomaly-upload');
                    return refused(failure!.code, failure!.details.length ? failure!.details : undefined);
                }
                const inserted = (await tx.query<{ id: string }>('INSERT INTO fingence_poc.anomaly_sources(id,organization_id,uploaded_by,file_name,sha256,layout,row_count,content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id,sha256) DO NOTHING RETURNING id::text',
                    [randomUUID(), p.organization_id, p.user_id, fileName, sha256, parsed.layout, parsed.rows.length, bytes])).rows[0];
                const stored = inserted ?? (await tx.query<{ id: string }>('SELECT id::text FROM fingence_poc.anomaly_sources WHERE organization_id=$1 AND sha256=$2', [p.organization_id, sha256])).rows[0];
                await audit(tx, p, 'ingestion.persisted', 'success', 'ingestion_batch', stored.id);
                return { status: 'STORED' as const, sourceId: stored.id, sha256, rowCount: parsed.rows.length, layout: parsed.layout, duplicate: !inserted };
            });
        },
        analysis: (token: string, input: SelectionInput) => finance(token, ['transaction_collection', 'poc-anomaly-analysis'], async (tx, p) => {
            const result = await build(tx, p, input);
            if (!result) { await audit(tx, p, 'financial_record.read', 'failure', 'transaction_collection', 'poc-anomaly-analysis'); return refused('UNAVAILABLE'); }
            await audit(tx, p, 'financial_record.read', 'success', 'transaction_collection', result.source.id);
            return { status: 'OK' as const, ...result } satisfies PocAnalysis;
        }),
        /** Records an explicit Finance decision on a current candidate. Optimistic version check; never auto-cleared. */
        review: (token: string, input: { sourceId: string; rowId: string; state: ReviewState; expectedVersion: number }) => finance(token, ['financial_record', 'poc-anomaly-review'], async (tx, p) => {
            const loaded = rowPattern.test(input.rowId) ? await source(tx, p, input.sourceId) : null;
            const candidate = loaded && analyze(loaded.meta.sha256, new Uint8Array(loaded.content)).candidates.some(c => c.row.rowId === input.rowId);
            if (!loaded || !candidate) { await audit(tx, p, 'anomaly.reviewed', 'failure', 'financial_record', 'poc-anomaly-review'); return refused('UNAVAILABLE'); }
            const target = `${loaded.meta.id}:${input.rowId}`;
            const current = (await tx.query<{ version: number }>('SELECT version FROM fingence_poc.anomaly_reviews WHERE source_id=$1 AND row_id=$2 FOR UPDATE', [loaded.meta.id, input.rowId])).rows[0]?.version ?? 0;
            if (current !== input.expectedVersion) { await audit(tx, p, 'anomaly.reviewed', 'failure', 'financial_record', target); return refused('STALE_REVIEW'); }
            await tx.query(`INSERT INTO fingence_poc.anomaly_reviews(source_id,row_id,state,version,decided_by) VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (source_id,row_id) DO UPDATE SET state=EXCLUDED.state, version=EXCLUDED.version, decided_by=EXCLUDED.decided_by, decided_at=clock_timestamp()`, [loaded.meta.id, input.rowId, input.state, current + 1, p.user_id]);
            await audit(tx, p, 'anomaly.reviewed', 'success', 'financial_record', target);
            return { status: 'REVIEWED' as const, rowId: input.rowId, state: input.state, version: current + 1 };
        }),
        /** One report model feeds the PDF and the JSON evidence, so both carry the same figures and hash. */
        report: (token: string, input: SelectionInput, format: 'pdf' | 'json') => finance(token, ['report', 'poc-management-report'], async (tx, p) => {
            const analysis = await build(tx, p, input);
            if (!analysis) { await audit(tx, p, 'report.downloaded', 'failure', 'report', 'poc-management-report'); return refused('UNAVAILABLE'); }
            const s = analysis.selection, scope = { organizationId: p.organization_id, businessId: s.businessId, period: s.period, currency: s.currency };
            const reconciliation = readReconciliation(options.reconciliation ? await options.reconciliation(tx, p, scope) : null, scope);
            const unsigned = { ...analysis, reportVersion: 'poc-management-report-v1' as const, generatedAt: new Date().toISOString(), reconciliation };
            const report: PocReport = { ...unsigned, reportHash: createHash('sha256').update(JSON.stringify(canonical(unsigned))).digest('hex') };
            await audit(tx, p, 'report.downloaded', 'success', 'report', analysis.source.id);
            return { status: 'OK' as const, report, bytes: format === 'pdf' ? await renderManagementReport(report) : new TextEncoder().encode(JSON.stringify(report, null, 2)) };
        }),
    };
}
