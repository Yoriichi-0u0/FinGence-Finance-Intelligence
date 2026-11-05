/**
 * The stored form of a finished processing job: the reconciliation and anomaly results, the management summary,
 * each document's decision, and every flagged item, all from one processing context. Stored next to the job's
 * ingestion run (its verified records). Pure, so the browser and tests can rebuild it from the same context.
 */
import type { InterpretationResult } from '../interpretation/contracts';
import type { ProcessingContext, Quarantined, Stage } from '../demo/pipeline';

export const JOB_RESULT_VERSION = 'fingence-job-result-v1' as const;
export type FlaggedItem = {
    kind: Quarantined['kind']; reference: string; status: string;
    period: string | null; date: string | null; currency: string | null; signedAmount: string | null;
    /** What was flagged, in one sentence. */
    title: string;
    /** Why: the rule, the failed check or the refusal. */
    reason: string;
};
export type StageSummary = { id: Stage['id']; title: string; decision: Stage['decision']; summary: string; failedChecks: { id: string; label: string; detail: string }[] };
export type JobResult = {
    version: typeof JOB_RESULT_VERSION; pipelineVersion: string; processingId: string; outcome: ProcessingContext['status'];
    scope: { businessId: string; businessName: string; period: string; months: string[]; currency: string } | null;
    summary: string;
    interpretations: Record<string, InterpretationResult>;
    documents: { name: string; sha256: string; role: string | null; decision: string; reason: string; method: string; model: string | null; failedChecks: string[] }[];
    reconciliation: unknown; anomalies: unknown; report: unknown;
    flagged: FlaggedItem[];
};

const clip = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
const MONTH = /^\d{4}-\d{2}$/;
const negate = (v: string) => v.startsWith('-') ? v.slice(1) : v === '0.00' ? v : `-${v}`;
export const stageSummary = (s: Stage): StageSummary => ({
    id: s.id, title: s.title, decision: s.decision, summary: clip(s.summary, 600),
    failedChecks: s.checks.filter(k => !k.passed).slice(0, 12).map(k => ({ id: clip(k.id, 64), label: clip(k.label, 200), detail: clip(k.detail, 400) })),
});

/** Every flagged item: the context's quarantine, each enriched with the record's month, date and amount where it has one, plus documents no reader could take. */
export function flaggedItems(c: ProcessingContext): FlaggedItem[] {
    const o = c.outputs, currency = c.scope?.currency ?? null;
    const attention = new Map((o.resolution?.attention ?? []).map(i => [i.bankRecordId ?? i.ledgerRecordIds.join(', '), i]));
    const anomalies = new Map((o.anomalyResolution?.items ?? []).filter(a => a.resolution === 'FLAGGED').map(a => [a.row.rowId, a]));
    const items = c.quarantine.map((q): FlaggedItem => {
        const base = { kind: q.kind, reference: clip(q.reference, 300), status: clip(q.status, 64), period: null, date: null, currency: null, signedAmount: null, reason: clip(q.reason, 2000) };
        if (q.kind === 'RECONCILIATION_EXCEPTION') {
            const i = attention.get(q.reference);
            // The record's own signed amount: a ledger-only record moves bank − ledger by minus its amount; otherwise the effect is the bank amount (or the difference, when both sides have a record).
            if (i) return { ...base, period: MONTH.test(i.period) ? i.period : null, date: i.date || null, currency, signedAmount: !i.bankRecordId && i.ledgerRecordIds.length ? negate(i.effect) : i.effect, title: clip(i.summary, 400) };
        }
        if (q.kind === 'ANOMALY_CANDIDATE') {
            const a = anomalies.get(q.reference);
            if (a) return { ...base, period: a.row.period, date: a.row.date, currency: a.row.currency, signedAmount: a.row.signedAmount, title: clip(a.summary, 400) };
        }
        return { ...base, title: clip(q.kind === 'HISTORY' ? `Bank history ${q.reference} was not used.` : `${q.reference} could not be processed (${q.status}).`, 400) };
    });
    for (const d of c.documents) if (d.decision === 'UNAVAILABLE')
        items.push({ kind: 'DOCUMENT', reference: clip(d.name, 300), status: 'UNAVAILABLE', period: null, date: null, currency: null, signedAmount: null, title: clip(`${d.name} could not be read.`, 400), reason: clip(d.reason, 2000) });
    return items.slice(0, 500);
}

export function jobResult(c: ProcessingContext): JobResult {
    const o = c.outputs, r = o.resolution, a = o.anomalyResolution;
    const flagged = flaggedItems(c);
    const summary = c.status === 'QUARANTINED'
        ? 'Not processed: the documents did not pass verification.'
        : `${o.periods.length} month${o.periods.length === 1 ? '' : 's'} reconciled; ${r?.attention.length ?? 0} reconciliation item${r?.attention.length === 1 ? '' : 's'} and ${a?.flagged ?? 0} anomal${a?.flagged === 1 ? 'y' : 'ies'} flagged; ${flagged.length} flagged in all.`;
    return {
        version: JOB_RESULT_VERSION, pipelineVersion: c.version, processingId: c.processingId, outcome: c.status,
        scope: c.scope ? { businessId: c.scope.businessId, businessName: c.scope.businessName, period: c.scope.period, months: c.scope.months, currency: c.scope.currency } : null,
        summary,
        interpretations: Object.fromEntries(c.documents.flatMap(d => d.interpretation?.receipt ? [[d.sha256, { proposal: d.interpretation.proposal, receipt: d.interpretation.receipt }]] : [])),
        documents: c.documents.slice(0, 20).map(d => ({
            name: clip(d.name, 160), sha256: d.sha256, role: d.role, decision: d.decision, reason: clip(d.reason, 600),
            method: d.interpretation ? 'AI_LAYOUT_PROPOSAL' : d.role ? 'EXACT_SIGNATURE' : 'NONE', model: d.interpretation?.receipt?.model ?? null,
            failedChecks: (d.interpretation?.checks ?? []).filter(k => !k.passed).slice(0, 12).map(k => clip(`${k.label}: ${k.detail}`, 400)),
        })),
        // The reconciliation as resolved: per month its status, matched count, every resolved item and correcting entry, and the checks.
        reconciliation: r ? {
            version: r.version, status: r.status, scope: r.scope, totals: r.totals, summary: r.summary, notReconciled: r.notReconciled,
            cashMovement: o.reconciliation?.cashMovement ?? null, counts: o.reconciliation?.counts ?? null,
            periods: r.periods.map(p => ({ ...p, cashMovement: o.periods.find(x => x.period === p.period)?.snapshot.cashMovement ?? null })),
            entries: r.entries, checks: r.checks,
        } : null,
        anomalies: a ? {
            version: a.version, corroborated: a.corroborated, flagged: a.flagged, summary: a.summary, rules: a.rules,
            items: a.items.map(i => ({ rowId: i.row.rowId, period: i.row.period, date: i.row.date, currency: i.row.currency, signedAmount: i.row.signedAmount, counterparty: i.row.counterparty, severity: i.severity, findings: i.findings, resolution: i.resolution, rule: i.rule, summary: i.summary, booked: i.booked })),
        } : null,
        report: o.report ? { ...o.report, processingId: c.processingId } : null,
        flagged,
    };
}
