import Papa from 'papaparse';
import { normalizeCashSourceBytes, periodRange } from '../poc-reconciliation/engine';
import type { CashSource, FinancePoCReconciliationV1 } from '../poc-reconciliation/contracts';
import type { ReconciliationStatement } from '../poc-reconciliation/statement';
import { outcomeOf, reconcile, RECONCILIATION_SCOPE, type ReconciliationOutcome, type ReconciliationResult } from '../reconciliation/reconcile';
import { resolveAnomalies, type AnomalyOutcome } from '../anomalies/resolve';
import { parseSource, SourceError, fromCents, toCents, type SourceRow } from '../poc-anomalies/source';
import { detectAnomalies, DETECTOR_VERSION, type Candidate } from '../poc-anomalies/detector';
import { readReconciliation, type ReconciliationView } from '../poc-anomalies/reconciliation';
import { cashTotals, type BankTotals } from '../poc-insights/model';
import { forecastBusiness, FORECAST_VERSION, type BusinessForecast } from '../poc-forecast/forecast';
import type { LayoutInterpreter } from '../interpretation/contracts';
import type { Extractor } from '../interpretation/extract';
import { ingestDocuments, INGESTION_SCOPE, sha256Hex, type Check, type Decision, type Digest, type DocumentInput, type DocumentRole, type ProcessedDocument } from '../document-ingestion/ingest';

export { MAX_DOCUMENT_BYTES, sha256Hex } from '../document-ingestion/ingest';
export type { Check, Decision, Digest, DocumentInput, DocumentRole, InterpretationRecord, ProcessedDocument, Provenance } from '../document-ingestion/ingest';

/**
 * FinGence 2.0 Phase 1 processing pipeline: one action turns a bank statement and a cash-account
 * general ledger (plus an optional multi-month bank history) into one processing context that every
 * page reads. Pure and deterministic: the same document bytes always give the same processing ID and
 * outputs. Every stage records its checks and a decision; nothing is auto-accepted without an
 * independent check, and uncertain interpretations are quarantined instead of treated as facts.
 * Documents in the supported schemas are recognised deterministically. An optional layout interpreter (a
 * language model behind the server gateway) may PROPOSE how an unfamiliar document is laid out; such a
 * proposal is accepted only when deterministic gates re-derive it from every row of the original bytes.
 */
export const PIPELINE_VERSION = 'fingence-processing-v1' as const;
/** Fixed organization scope for the browser-only synthetic demo; it is never a real tenant identifier. */
export const DEMO_ORGANIZATION = 'synthetic-demo';

export type StageId = 'IDENTIFY' | 'EXTRACT' | 'INTERPRET' | 'VERIFY' | 'RECONCILE' | 'ANALYZE' | 'FORECAST' | 'REPORT';
export type Stage = { id: StageId; title: string; decision: Decision; method: string; summary: string; checks: Check[] };
/** `job`: the server job this run belongs to (the job itself, or the browser re-checking its result). */
export type ProcessingOptions = { interpreter?: LayoutInterpreter | null; job?: { id: string; runner: ProcessingRunner['kind'] } | null; extract?: Extractor };
export type Quarantined = { kind: 'DOCUMENT' | 'RECONCILIATION_EXCEPTION' | 'ANOMALY_CANDIDATE' | 'HISTORY'; reference: string; status: string; reason: string };
export type ProcessingContext = {
    version: typeof PIPELINE_VERSION; processingId: string; runner: ProcessingRunner['kind'];
    /** Set when the run was processed by a server job: its ID. The browser's re-check of that job carries it too. */
    job: { id: string } | null;
    status: 'COMPLETED' | 'COMPLETED_WITH_EXCEPTIONS' | 'QUARANTINED';
    documents: ProcessedDocument[];
    /** `period` is one month (YYYY-MM) or the range the bank statement covers (YYYY-MM/YYYY-MM); `months` lists every statement month. */
    scope: { organizationId: typeof DEMO_ORGANIZATION; businessId: string; businessName: string; period: string; months: string[]; currency: string } | null;
    stages: Stage[];
    conventions: string[];
    outputs: {
        bank: CashSource | null; ledger: CashSource | null; bankRows: SourceRow[];
        /** The matcher snapshot for the whole run: one month's snapshot, or every reconciled month's results combined. */
        reconciliation: FinancePoCReconciliationV1 | null; reconciliationView: ReconciliationView;
        /** Proposed bank reconciliation statement for a single-month run; per month in `periods`. */
        statement: ReconciliationStatement | null;
        /** Every reconciled month: its matcher snapshot and its statement (one entry for a one-month run). */
        periods: { period: string; snapshot: FinancePoCReconciliationV1; statement: ReconciliationStatement }[];
        /** Months only one side covers: reported, never reconciled against nothing. */
        notReconciled: ReconciliationResult['notReconciled'];
        /** Reconciliation layer outcome: every exception resolved by a stated rule, correcting entries, items flagged for attention. */
        resolution: ReconciliationOutcome | null;
        totals: BankTotals | null; anomalies: Candidate[];
        /** Every anomaly candidate resolved against the books; only what they cannot confirm is flagged. */
        anomalyResolution: AnomalyOutcome | null;
        history: { accepted: boolean; rows: SourceRow[]; months: string[] };
        forecast: BusinessForecast | null; report: ManagementSummary | null;
    };
    quarantine: Quarantined[];
};
export type ManagementSummary = {
    version: 'fingence-management-summary-v1'; processingId: string; scope: NonNullable<ProcessingContext['scope']>;
    sources: { role: DocumentRole; name: string; sha256: string }[];
    cash: BankTotals; reconciliation: Pick<FinancePoCReconciliationV1, 'cashMovement' | 'counts'>;
    anomalyCandidates: number; anomaliesFlagged: number; forecast: { status: 'AVAILABLE'; period: string; credits: string; debits: string; net: string } | { status: 'UNAVAILABLE'; detail: string };
    limitations: string[];
};
export const STAGE_TITLES: Record<StageId, string> = {
    IDENTIFY: 'Identify documents and roles', EXTRACT: 'Extract and normalize records', INTERPRET: 'Interpret schema and accounting conventions',
    VERIFY: 'Independent verification', RECONCILE: 'Deterministic reconciliation', ANALYZE: 'Transaction analytics and anomaly candidates',
    FORECAST: 'Supported forecast', REPORT: 'Management summary',
};
const SERVER_LIMITATION = 'Processed on the FinGence server as a processing job. The documents were sent to the server for that job only and are not stored; their fingerprints, decisions, verified records, reconciliation and anomaly results are stored in the FinGence database, and this browser re-checked the result from the same documents.';
function limitations(models: string[], job: boolean) {
    return [
        job ? SERVER_LIMITATION : models.length
            ? 'All calculations ran in this browser. For AI-interpreted documents only the headings, column profiles and a few sample lines were sent to the FinGence server and Groq. The input documents are kept temporarily in this browser tab\'s sessionStorage until results are cleared or the tab is closed.'
            : 'Processed in this browser only; nothing is uploaded to a server or shared. The input documents are kept temporarily in this browser tab\'s sessionStorage until results are cleared or the tab is closed.',
        'Signed cash movement is bank cash in and out. It is not revenue, expenses, profit or a cash flow statement.',
        models.length
            ? `Layouts of unfamiliar documents were proposed by a language model (${models.join(', ')} on Groq) and accepted only after deterministic checks on every row of the original document; the model never supplied an amount. Other documents were recognised by exact schema signatures.`
            : 'Document roles and column meanings come from exact schema signatures and configured cash conventions, not from a language model.',
        'Every reconciliation exception is resolved automatically by a stated rule: a late match, a timing difference or a correcting entry prepared for the books (not posted to any accounting system). Only an exception no rule explains is flagged.',
        'Unusual bank records found by the anomaly rules are checked against the books: a record the ledger also shows is a known transaction; only what the books cannot confirm is flagged. Findings are never fraud conclusions.',
        'Amounts stay in the documents\' own currency; nothing is converted.',
    ];
}

const check = (id: string, label: string, passed: boolean, detail: string): Check => ({ id, label, passed, detail });
const sumCents = (values: string[]) => values.reduce((n, v) => n + toCents(v), 0n);
/** The whole run's matcher snapshot: a one-month run's own snapshot, or every reconciled month's results combined. */
function combinedSnapshot(layer: ReconciliationResult): FinancePoCReconciliationV1 {
    const list = layer.periods.map(p => p.snapshot);
    if (list.length === 1) return list[0];
    const total = (k: 'bank' | 'ledger' | 'signedDifference') => fromCents(list.reduce((n, x) => n + toCents(x.cashMovement[k]), 0n));
    const counts = Object.fromEntries(Object.keys(list[0].counts).map(k => [k, list.reduce((n, x) => n + x.counts[k as keyof typeof x.counts], 0)])) as FinancePoCReconciliationV1['counts'];
    return {
        ...list[0], scope: { ...list[0].scope, period: layer.scope.periods }, counts,
        cashMovement: { bank: total('bank'), ledger: total('ledger'), signedDifference: total('signedDifference') },
        results: list.flatMap(x => x.results), evidence: Object.assign({}, ...list.map(x => x.evidence)),
        rows: { bank: list.flatMap(x => x.rows.bank), ledger: list.flatMap(x => x.rows.ledger) },
    };
}
/** Deterministic, order-independent processing identity: pipeline version plus each accepted role and source fingerprint. */
async function processingIdentity(digest: Digest, parts: string[]) {
    return (await digest(new TextEncoder().encode([PIPELINE_VERSION, ...parts.sort()].join('\n')))).slice(0, 24);
}

export async function processDocuments(inputs: DocumentInput[], digest: Digest = sha256Hex, onStage?: (stage: Stage) => void | Promise<void>, options: ProcessingOptions = {}): Promise<ProcessingContext> {
    const stages: Stage[] = [], quarantine: Quarantined[] = [];
    const emit = async (id: StageId, decision: Decision, method: string, summary: string, checks: Check[]) => { const stage = { id, title: STAGE_TITLES[id], decision, method, summary, checks }; stages.push(stage); await onStage?.(stage); return stage; };
    const outputs: ProcessingContext['outputs'] = { bank: null, ledger: null, bankRows: [], reconciliation: null, reconciliationView: { status: 'UNAVAILABLE', reason: 'Documents were not processed.' }, statement: null, periods: [], notReconciled: [], resolution: null, totals: null, anomalies: [], anomalyResolution: null, history: { accepted: false, rows: [], months: [] }, forecast: null, report: null };
    const conventions = ['Bank: Credit adds cash, Debit removes cash; SignedCashMovementMYR must equal the signed BankAmountMYR.', 'Ledger: cash account 1000-BANK; Debit adds cash, Credit removes cash; SignedCashMovementMYR must equal Debit − Credit.', 'One currency per processing, as the documents state it; no foreign-exchange conversion.'];
    const finish = async (status: ProcessingContext['status'], scope: ProcessingContext['scope']) => {
        // An AI-interpreted document is identified by its bytes AND the accepted mapping, so a different accepted reading is a different processing.
        const accepted = documents.filter(d => d.decision === 'AUTO_ACCEPTED' && d.role).map(d => `${d.role}:${d.sha256}${d.interpretation?.mappingHash ? `:${d.interpretation.mappingHash}` : ''}`);
        if (outputs.report) outputs.report.limitations = limitations(aiModels(), !!options.job);
        const processingId = await processingIdentity(digest, accepted.length ? accepted : documents.map(d => `INPUT:${d.sha256}`));
        if (outputs.report) outputs.report.processingId = processingId;
        return { version: PIPELINE_VERSION, processingId, runner: options.job?.runner ?? 'BROWSER_DEMO_RUNNER', job: options.job ? { id: options.job.id } : null, status, documents, scope, stages, conventions, outputs, quarantine };
    };

    // 1. Identify each document's role from its exact column signature; an unfamiliar layout may be interpreted by the model and gates.
    // Ingestion scope: several months and any stated currency; one business and one currency per pair is enforced below.
    const { documents, effective } = await ingestDocuments(inputs, { digest, interpreter: options.interpreter, scope: INGESTION_SCOPE, extract: options.extract });
    const aiModels = () => [...new Set(documents.filter(d => d.interpretation?.decision === 'AUTO_ACCEPTED' && d.interpretation.receipt).map(d => d.interpretation!.receipt!.model))];
    const byRole = (role: DocumentRole) => documents.filter(d => d.role === role);
    for (const role of ['BANK_STATEMENT', 'GENERAL_LEDGER', 'BANK_HISTORY'] as const) {
        const list = byRole(role);
        if (list.length > 1) for (const d of list) { d.decision = 'QUARANTINED'; d.reason = `More than one ${role.toLowerCase().replace('_', ' ')} supplied; the intended document is ambiguous.`; }
    }
    for (const d of documents) if (d.decision === 'QUARANTINED') quarantine.push({ kind: 'DOCUMENT', reference: d.name, status: 'UNIDENTIFIED_OR_AMBIGUOUS', reason: d.reason });
    const bankDoc = byRole('BANK_STATEMENT').find(d => d.decision === 'AUTO_ACCEPTED'), ledgerDoc = byRole('GENERAL_LEDGER').find(d => d.decision === 'AUTO_ACCEPTED'), historyDoc = byRole('BANK_HISTORY').find(d => d.decision === 'AUTO_ACCEPTED');
    const interpreted = documents.filter(d => d.interpretation);
    const identifyMethod = interpreted.length ? `Exact schema signature; AI layout proposal + deterministic gates for ${interpreted.length} document${interpreted.length === 1 ? '' : 's'}` : 'Exact schema signature';
    const identified = await emit('IDENTIFY', bankDoc && ledgerDoc ? 'AUTO_ACCEPTED' : 'QUARANTINED', identifyMethod, bankDoc && ledgerDoc ? `Bank statement and general ledger identified${historyDoc ? ', plus bank history' : ''}.` : 'A single bank statement and a single cash-account general ledger are both required.', [
        check('bank', 'Exactly one bank statement', !!bankDoc, bankDoc ? bankDoc.name : `${byRole('BANK_STATEMENT').length} identified`),
        check('ledger', 'Exactly one cash-account general ledger', !!ledgerDoc, ledgerDoc ? ledgerDoc.name : `${byRole('GENERAL_LEDGER').length} identified`),
        check('unidentified', 'No unidentified or evaluation documents', documents.every(d => d.decision === 'AUTO_ACCEPTED'), `${documents.filter(d => d.decision !== 'AUTO_ACCEPTED').length} quarantined`),
        ...interpreted.map(d => check(`ai-${d.sha256.slice(0, 8)}`, `AI layout proposal for ${d.name}`, d.interpretation!.decision === 'AUTO_ACCEPTED', d.interpretation!.receipt ? `${d.interpretation!.receipt.model}${d.interpretation!.receipt.mode === 'REPLAYED' ? ' (replayed)' : ''} · ${d.interpretation!.summary}` : d.interpretation!.summary)),
    ]);
    if (identified.decision !== 'AUTO_ACCEPTED') return finish('QUARANTINED', null);
    // AI-interpreted documents continue as their verified canonical form; the original fingerprint stays the document identity.
    const bytesOf = (d: ProcessedDocument) => effective[documents.indexOf(d)];

    // 2. Extract and normalize with the shared reconciliation normalizer and the history reader.
    let bank: CashSource, ledger: CashSource, history: SourceRow[] = [], historyProblem: string | null = null;
    try {
        bank = normalizeCashSourceBytes(bytesOf(bankDoc!), 'bank', bankDoc!.name.endsWith('.csv') ? bankDoc!.name : `${bankDoc!.name}.csv`, bankDoc!.sha256, RECONCILIATION_SCOPE);
        ledger = normalizeCashSourceBytes(bytesOf(ledgerDoc!), 'ledger', ledgerDoc!.name.endsWith('.csv') ? ledgerDoc!.name : `${ledgerDoc!.name}.csv`, ledgerDoc!.sha256, RECONCILIATION_SCOPE);
    } catch (error) {
        const code = error instanceof Error ? error.message : 'UNREADABLE';
        quarantine.push({ kind: 'DOCUMENT', reference: 'bank statement / general ledger', status: code, reason: 'Records could not be normalized under the supported schema and cash conventions.' });
        await emit('EXTRACT', 'QUARANTINED', 'Shared normalizer', `Normalization refused the documents (${code}).`, [check('normalize', 'Rows normalize under the supported schema', false, code)]);
        return finish('QUARANTINED', null);
    }
    if (historyDoc) {
        try { history = parseSource(bytesOf(historyDoc)).rows; }
        catch (error) { historyProblem = error instanceof SourceError ? `${error.code}${error.details.length ? `: ${error.details[0]}` : ''}` : 'UNREADABLE'; }
    }
    const monthsOf = (s: CashSource) => [...new Set(s.rows.map(r => r.date.slice(0, 7)))].sort();
    for (const [d, s] of [[bankDoc!, bank], [ledgerDoc!, ledger]] as const) Object.assign(d, { rows: s.rows.length, businessId: s.businessId, currency: s.currency, periods: monthsOf(s) });
    if (historyDoc && !historyProblem) Object.assign(historyDoc, { rows: history.length, businessId: [...new Set(history.map(r => r.businessId))].join(', '), currency: [...new Set(history.map(r => r.currency))].join(', '), periods: [...new Set(history.map(r => r.period))].sort() });
    await emit('EXTRACT', 'AUTO_ACCEPTED', 'Shared normalizer (lib/poc-reconciliation/engine.ts)', `${bank.rows.length} bank records and ${ledger.rows.length} ledger cash entries normalized${historyDoc ? historyProblem ? '; bank history unreadable' : `; ${history.length} history records read` : ''}.`, [
        check('bank-rows', 'Bank records normalized', true, `${bank.rows.length} rows, unique record IDs, ISO dates, ${bank.currency}`),
        check('ledger-rows', 'Ledger cash entries normalized', true, `${ledger.rows.length} rows, cash account 1000-BANK`),
        ...(historyDoc ? [check('history-rows', 'Bank history readable', !historyProblem, historyProblem ?? `${history.length} rows`)] : []),
    ]);

    // 3. Interpret: one business and one currency across documents, and at least one month both cover, under the configured conventions.
    let bankRows: SourceRow[] = [];
    try { bankRows = parseSource(bytesOf(bankDoc!)).rows; } catch { /* reported by verification below */ }
    const businessName = bankRows[0]?.businessName ?? bank.businessId;
    const bankMonths = monthsOf(bank), ledgerMonths = monthsOf(ledger), common = bankMonths.filter(m => ledgerMonths.includes(m));
    const scope: NonNullable<ProcessingContext["scope"]> = { organizationId: DEMO_ORGANIZATION, businessId: bank.businessId, businessName, period: periodRange(bankMonths), months: bankMonths, currency: bank.currency };
    const sameScope = ledger.businessId === bank.businessId && ledger.currency === bank.currency && common.length > 0;
    conventions[2] = `Currency ${bank.currency}, as the documents state it; one currency per processing and no foreign-exchange conversion.`;
    const historyScoped = history.filter(r => r.businessId === scope.businessId && r.currency === scope.currency);
    const aiAccepted = [bankDoc!, ledgerDoc!].filter(d => d.interpretation?.decision === 'AUTO_ACCEPTED');
    for (const d of aiAccepted) conventions.push(`${d.name}: layout proposed by ${d.interpretation!.receipt?.model ?? 'the AI interpreter'} — ${d.interpretation!.mapping.map(m => `${m.heading} → ${m.field}`).join(', ')}.`);
    const scoped = await emit('INTERPRET', sameScope ? 'AUTO_ACCEPTED' : 'QUARANTINED', aiAccepted.length ? 'AI layout proposal verified by deterministic gates; configured cash conventions' : 'Configured cash conventions (deterministic)', sameScope ? `${scope.businessId} · ${scope.period} · ${scope.currency}; bank and ledger describe the same business${bankMonths.length > 1 || ledgerMonths.length > 1 ? ` and currency, with ${common.length} month${common.length === 1 ? '' : 's'} in common` : ', month and currency'}.` : 'Bank and ledger describe different businesses or currencies, or share no month; no pairing is assumed.', [
        check('scope', 'Bank and ledger share business and currency, and at least one month', sameScope, `bank ${bank.businessId}/${bank.period}/${bank.currency}; ledger ${ledger.businessId}/${ledger.period}/${ledger.currency}`),
        check('conventions', 'Cash sign conventions hold on every row', true, 'Enforced row by row during normalization'),
        ...(historyDoc && !historyProblem ? [check('history-scope', 'History covers the same business and currency', historyScoped.length > 0, `${historyScoped.length} of ${history.length} rows`)] : []),
        ...aiAccepted.flatMap(d => d.interpretation!.checks.map(k => check(`${d.role === 'BANK_STATEMENT' ? 'bank' : 'ledger'}-ai-${k.id}`, `${d.role === 'BANK_STATEMENT' ? 'Bank' : 'Ledger'} (AI layout): ${k.label}`, k.passed, k.detail))),
    ]);
    if (scoped.decision !== 'AUTO_ACCEPTED') {
        quarantine.push({ kind: 'DOCUMENT', reference: `${bankDoc!.name} + ${ledgerDoc!.name}`, status: 'SCOPE_MISMATCH', reason: 'Bank and ledger scope differ.' });
        return finish('QUARANTINED', null);
    }

    // 4. Independent verification: a second parser and independent sums must agree with the normalized records.
    const ledgerRaw = Papa.parse<Record<string, string>>(new TextDecoder().decode(bytesOf(ledgerDoc!)).replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy' }).data;
    const bankNormalized = bank.rows.reduce((n, r) => n + BigInt(r.signedCents), 0n), ledgerNormalized = ledger.rows.reduce((n, r) => n + BigInt(r.signedCents), 0n);
    const bankIndependent = bankRows.length ? sumCents(bankRows.map(r => r.signedAmount)) : null;
    let ledgerSides: bigint | null = null, ledgerColumn: bigint | null = null;
    try { ledgerSides = ledgerRaw.reduce((n, r) => n + toCents(r.CashAccountDebitMYR.trim()) - toCents(r.CashAccountCreditMYR.trim()), 0n); ledgerColumn = sumCents(ledgerRaw.map(r => r.SignedCashMovementMYR.trim())); } catch { /* recorded as a failed check */ }
    const sameIds = bankRows.length === bank.rows.length && bankRows.every((r, i) => r.rowId === bank.rows[i].recordId);
    // Every statement month must appear in the history with exactly the statement's records and net.
    const monthAgreement = bankMonths.map(m => {
        const h = historyScoped.filter(r => r.period === m), b = bank.rows.filter(r => r.date.startsWith(m));
        const hNet = h.length ? sumCents(h.map(r => r.signedAmount)) : null, bNet = b.reduce((n, r) => n + BigInt(r.signedCents), 0n);
        return { m, ok: hNet === bNet && h.length === b.length, detail: hNet === null ? `${m} absent from history` : `${m}: history ${fromCents(hNet)} over ${h.length} rows; statement ${fromCents(bNet)} over ${b.length} rows` };
    });
    const historyChecks = historyDoc && !historyProblem ? [check('history-period', bankMonths.length > 1 ? 'History months equal the verified statement' : 'History month equals the verified statement', monthAgreement.every(a => a.ok), monthAgreement.map(a => a.detail).join('; '))] : [];
    const coreChecks = [
        check('bank-parser', 'Second bank parser reads the same records', sameIds, `${bankRows.length} rows from the anomaly-source reader vs ${bank.rows.length} normalized`),
        check('bank-total', 'Bank signed total agrees across parsers', bankIndependent === bankNormalized, `${bankIndependent === null ? 'unavailable' : fromCents(bankIndependent)} vs ${fromCents(bankNormalized)}`),
        check('ledger-sides', 'Ledger Debit − Credit equals the signed column', ledgerSides !== null && ledgerSides === ledgerColumn, `${ledgerSides === null ? 'unavailable' : fromCents(ledgerSides)} vs ${ledgerColumn === null ? 'unavailable' : fromCents(ledgerColumn)}`),
        check('ledger-total', 'Ledger total agrees with normalized entries', ledgerSides === ledgerNormalized && ledgerRaw.length === ledger.rows.length, `${ledgerRaw.length} raw rows; ${ledgerSides === null ? 'unavailable' : fromCents(ledgerSides)} vs ${fromCents(ledgerNormalized)}`),
    ];
    // An AI-interpreted document's canonical form must carry exactly the total the gates computed from the original bytes.
    for (const [d, normalized] of [[bankDoc!, bankNormalized], [ledgerDoc!, ledgerNormalized]] as const) {
        if (d.interpretation?.canonicalNet) coreChecks.push(check(`${d.role === 'BANK_STATEMENT' ? 'bank' : 'ledger'}-roundtrip`, `${d.role === 'BANK_STATEMENT' ? 'Bank' : 'Ledger'} canonical form equals the original document`, d.interpretation.canonicalNet === fromCents(normalized), `original ${d.interpretation.canonicalNet} vs normalized ${fromCents(normalized)}`));
    }
    const verified = coreChecks.every(c => c.passed);
    outputs.history.accepted = verified && historyChecks.length > 0 && historyChecks.every(c => c.passed) && historyScoped.length > 0;
    if (historyDoc && !outputs.history.accepted) {
        historyDoc.decision = 'QUARANTINED'; historyDoc.reason = historyProblem ?? (historyScoped.length ? 'History does not agree with the verified statement month.' : 'History does not cover the statement business and currency.');
        quarantine.push({ kind: 'HISTORY', reference: historyDoc.name, status: 'NOT_CONSISTENT', reason: historyDoc.reason });
    }
    await emit('VERIFY', verified ? 'AUTO_ACCEPTED' : 'QUARANTINED', 'Independent parser and sums', verified ? `Bank and ledger figures independently verified${historyDoc ? outputs.history.accepted ? `; history agrees with the statement month${bankMonths.length > 1 ? 's' : ''}` : '; history quarantined' : ''}.` : 'Independent checks disagree; nothing downstream is computed.', [...coreChecks, ...historyChecks]);
    if (!verified) { quarantine.push({ kind: 'DOCUMENT', reference: `${bankDoc!.name} + ${ledgerDoc!.name}`, status: 'VERIFICATION_FAILED', reason: 'Independent checks disagree with the normalized records.' }); return finish('QUARANTINED', scope); }
    outputs.bank = bank; outputs.ledger = ledger; outputs.bankRows = bankRows;
    if (outputs.history.accepted) { outputs.history.rows = historyScoped; outputs.history.months = [...new Set(historyScoped.map(r => r.period))].sort(); }

    // 5. Reconcile through the reconciliation layer: every month both documents cover goes through the unchanged
    //    matcher, then every exception is resolved by a stated rule. Only what no rule explains is quarantined.
    const layer = reconcile(bank, ledger, { organizationId: DEMO_ORGANIZATION, scope: RECONCILIATION_SCOPE });
    const snapshot = combinedSnapshot(layer), multi = layer.periods.length > 1;
    const view = readReconciliation(snapshot, { ...scope, period: layer.scope.periods, bankSha256: bank.sha256 });
    outputs.reconciliation = snapshot; outputs.reconciliationView = view; outputs.resolution = outcomeOf(layer);
    outputs.periods = layer.periods.map(p => ({ period: p.period, snapshot: p.snapshot, statement: p.statement }));
    outputs.statement = multi ? null : layer.periods[0].statement; outputs.notReconciled = layer.notReconciled;
    for (const i of layer.attention) quarantine.push({ kind: 'RECONCILIATION_EXCEPTION', reference: i.bankRecordId ?? i.ledgerRecordIds.join(', '), status: 'UNEXPLAINED', reason: i.rule });
    const allItems = layer.periods.flatMap(p => p.items);
    const matchedCount = layer.totals.matched, resolvedCount = allItems.length - layer.attention.length, exceptions = layer.attention.length;
    const layerPassed = layer.checks.every(k => k.passed) && layer.periods.every(p => p.checks.every(k => k.passed));
    const reconciledBank = layer.periods.reduce((n, p) => n + toCents(p.snapshot.cashMovement.bank), 0n);
    const bankOutside = bank.rows.filter(r => !layer.scope.months.includes(r.date.slice(0, 7))).reduce((n, r) => n + BigInt(r.signedCents), 0n);
    const notReconciledText = layer.notReconciled.map(n => `${n.period} (${n.side === 'BANK' ? 'bank only' : 'ledger only'}, ${n.records} records)`).join(', ');
    await emit('RECONCILE', view.status === 'AVAILABLE' && layerPassed ? 'AUTO_ACCEPTED' : 'QUARANTINED', 'Deterministic matching rules; reconciliation layer v1 resolution rules', `${multi ? `${layer.periods.length} months reconciled (${layer.scope.periods}); ` : ''}${matchedCount} outcomes matched automatically; ${resolvedCount} exceptions resolved by stated rules (${layer.totals.entries} correcting entries prepared); ${exceptions} unexplained${exceptions ? ' and flagged' : ''}.${notReconciledText ? ` Not reconciled, one side only: ${notReconciledText}.` : ''}`, [
        check('contract', 'Snapshot passes the reconciliation contract', view.status === 'AVAILABLE', view.status === 'AVAILABLE' ? 'Counts equal row-level results; difference equals bank − ledger' : view.reason),
        check('bank-movement', 'Reconciled bank movement equals the verified bank total', reconciledBank + bankOutside === bankNormalized && snapshot.cashMovement.bank === fromCents(reconciledBank), `${snapshot.cashMovement.bank}${bankOutside ? ` reconciled + ${fromCents(bankOutside)} in months without a ledger` : ''}`),
        ...layer.periods.flatMap(p => p.checks.map(k => check(`statement-${multi ? `${p.period}-` : ''}${k.id}`, multi ? `${p.period}: ${k.label}` : k.label, k.passed, k.detail))),
        ...layer.checks.map(k => check(`layer-${k.id}`, k.label, k.passed, k.detail)),
    ]);

    // 6. Analytics and anomaly candidates from the same verified bank records; each candidate is checked against the books.
    outputs.totals = cashTotals(bankRows);
    outputs.anomalies = detectAnomalies(bankRows);
    outputs.anomalyResolution = resolveAnomalies(outputs.anomalies, layer);
    for (const a of outputs.anomalyResolution.items) if (a.resolution === 'FLAGGED') quarantine.push({ kind: 'ANOMALY_CANDIDATE', reference: a.row.rowId, status: a.severity, reason: `${a.rule} ${a.findings.map(f => f.rationale).join(' ')}` });
    const ar = outputs.anomalyResolution;
    await emit('ANALYZE', 'AUTO_ACCEPTED', `Exact cent arithmetic; ${DETECTOR_VERSION}; ${ar.version}`, `Net signed bank movement ${scope.currency} ${outputs.totals.net}; ${outputs.anomalies.length} anomaly candidate${outputs.anomalies.length === 1 ? '' : 's'}: ${ar.corroborated} confirmed by the books, ${ar.flagged} flagged.`, [
        check('consistency', 'Analytics total equals the verified bank movement', toCents(outputs.totals.net) === bankNormalized, `${outputs.totals.net}${bankOutside ? ` (${snapshot.cashMovement.bank} reconciled + ${fromCents(bankOutside)} in months without a ledger)` : ''}`),
        check('anomalies-resolved', 'Every anomaly candidate has exactly one resolution', ar.items.length === outputs.anomalies.length && ar.corroborated + ar.flagged === ar.items.length, `${ar.corroborated} confirmed by the books, ${ar.flagged} flagged`),
    ]);

    // 7. Forecast only from an accepted consecutive monthly history; otherwise the engine's own refusal is shown.
    outputs.forecast = forecastBusiness(outputs.history.accepted ? outputs.history.rows : bankRows);
    const f = outputs.forecast.forecast;
    await emit('FORECAST', f.status === 'AVAILABLE' ? 'AUTO_ACCEPTED' : 'UNAVAILABLE', `${FORECAST_VERSION} (six-month mean, rolling backtests)`, f.status === 'AVAILABLE' ? `${f.period} baseline from ${f.basis.months} months with ${f.tests} backtests.` : f.detail, [
        check('history', 'At least seven consecutive observed months', f.status === 'AVAILABLE', `${outputs.forecast.history.length} month${outputs.forecast.history.length === 1 ? '' : 's'} observed`),
    ]);

    // 8. Management summary from the same outputs.
    outputs.report = {
        version: 'fingence-management-summary-v1', processingId: '', scope,
        sources: documents.filter(d => d.decision === 'AUTO_ACCEPTED' && d.role).map(d => ({ role: d.role!, name: d.name, sha256: d.sha256 })),
        cash: outputs.totals, reconciliation: { cashMovement: snapshot.cashMovement, counts: snapshot.counts }, anomalyCandidates: outputs.anomalies.length, anomaliesFlagged: ar.flagged,
        forecast: f.status === 'AVAILABLE' ? { status: 'AVAILABLE', period: f.period, credits: f.credits, debits: f.debits, net: f.net } : { status: 'UNAVAILABLE', detail: f.detail },
        limitations: limitations(aiModels(), !!options.job),
    };
    await emit('REPORT', 'AUTO_ACCEPTED', 'Generated from the processing context', 'Summary, JSON evidence and printable report use the same figures.', [check('same-source', 'Every figure comes from this processing context', true, `${outputs.report.sources.length} source fingerprints`)]);
    return finish(exceptions || ar.flagged || quarantine.length ? 'COMPLETED_WITH_EXCEPTIONS' : 'COMPLETED', scope);
}

/** Both runners execute the same pure pipeline: the browser demo runner, and the server job runner (lib/server/processing/jobs.ts). */
export interface ProcessingRunner {
    readonly kind: 'BROWSER_DEMO_RUNNER' | 'BACKEND_JOB_RUNNER';
    run(inputs: DocumentInput[], onStage?: (stage: Stage) => void | Promise<void>, options?: ProcessingOptions): Promise<ProcessingContext>;
}
export const browserDemoRunner: ProcessingRunner = { kind: 'BROWSER_DEMO_RUNNER', run: (inputs, onStage, options) => processDocuments(inputs, sha256Hex, onStage, options) };
