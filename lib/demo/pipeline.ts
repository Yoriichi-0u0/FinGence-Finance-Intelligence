import Papa from 'papaparse';
import { CASH_SOURCE_FIELDS, normalizeCashSourceBytes, reconcileCashSources } from '../poc-reconciliation/engine';
import type { CashSource, FinancePoCReconciliationV1, ReconciliationStatus } from '../poc-reconciliation/contracts';
import { EVALUATOR_COLUMNS, parseSource, SourceError, fromCents, toCents, type SourceRow } from '../poc-anomalies/source';
import { detectAnomalies, DETECTOR_VERSION, type Candidate } from '../poc-anomalies/detector';
import { readReconciliation, type ReconciliationView } from '../poc-anomalies/reconciliation';
import { cashTotals, type BankTotals } from '../poc-insights/model';
import { forecastBusiness, FORECAST_VERSION, type BusinessForecast } from '../poc-forecast/forecast';
import { InterpreterUnavailable, type LayoutInterpreter, type ModelReceipt } from '../interpretation/contracts';
import { buildEvidence, readTable } from '../interpretation/evidence';
import { verifyProposal, type FieldMapping } from '../interpretation/gates';

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

export type DocumentRole = 'BANK_STATEMENT' | 'GENERAL_LEDGER' | 'BANK_HISTORY';
export type Provenance = 'PUBLIC_SYNTHETIC_SAMPLE' | 'USER_SUPPLIED';
export type DocumentInput = { name: string; bytes: Uint8Array; provenance: Provenance };
export type Decision = 'AUTO_ACCEPTED' | 'QUARANTINED' | 'UNAVAILABLE';
export type Check = { id: string; label: string; passed: boolean; detail: string };
export type StageId = 'IDENTIFY' | 'EXTRACT' | 'INTERPRET' | 'VERIFY' | 'RECONCILE' | 'ANALYZE' | 'FORECAST' | 'REPORT';
export type Stage = { id: StageId; title: string; decision: Decision; method: string; summary: string; checks: Check[] };
export type ProcessedDocument = {
    name: string; sha256: string; bytes: number; provenance: Provenance; role: DocumentRole | null; decision: Decision; reason: string;
    rows: number | null; businessId: string | null; currency: string | null; periods: string[];
    interpretation: InterpretationRecord | null;
};
/** A model's layout proposal and what the deterministic gates concluded about it. */
export type InterpretationRecord = {
    method: 'AI_LAYOUT_PROPOSAL'; receipt: ModelReceipt | null; proposal: unknown; error: string | null;
    decision: Decision; summary: string; checks: Check[]; mapping: FieldMapping[]; disclosures: string[];
    canonicalSha256: string | null; canonicalNet: string | null; mappingHash: string | null;
};
export type ProcessingOptions = { interpreter?: LayoutInterpreter | null };
export type Quarantined = { kind: 'DOCUMENT' | 'RECONCILIATION_EXCEPTION' | 'ANOMALY_CANDIDATE' | 'HISTORY'; reference: string; status: string; reason: string };
export type ProcessingContext = {
    version: typeof PIPELINE_VERSION; processingId: string; runner: 'BROWSER_DEMO_RUNNER';
    status: 'COMPLETED' | 'COMPLETED_WITH_EXCEPTIONS' | 'QUARANTINED';
    documents: ProcessedDocument[];
    scope: { organizationId: typeof DEMO_ORGANIZATION; businessId: string; businessName: string; period: string; currency: string } | null;
    stages: Stage[];
    conventions: string[];
    outputs: {
        bank: CashSource | null; ledger: CashSource | null; bankRows: SourceRow[];
        reconciliation: FinancePoCReconciliationV1 | null; reconciliationView: ReconciliationView;
        totals: BankTotals | null; anomalies: Candidate[]; history: { accepted: boolean; rows: SourceRow[]; months: string[] };
        forecast: BusinessForecast | null; report: ManagementSummary | null;
    };
    quarantine: Quarantined[];
};
export type ManagementSummary = {
    version: 'fingence-management-summary-v1'; processingId: string; scope: NonNullable<ProcessingContext['scope']>;
    sources: { role: DocumentRole; name: string; sha256: string }[];
    cash: BankTotals; reconciliation: Pick<FinancePoCReconciliationV1, 'cashMovement' | 'counts'>;
    anomalyCandidates: number; forecast: { status: 'AVAILABLE'; period: string; credits: string; debits: string; net: string } | { status: 'UNAVAILABLE'; detail: string };
    limitations: string[];
};
export type Digest = (bytes: Uint8Array) => Promise<string>;

/** Web Crypto SHA-256 (browsers and Node 20+). */
export const sha256Hex: Digest = async bytes => {
    const view = new Uint8Array(bytes.byteLength); view.set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', view.buffer);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const BANK_FIELDS = [...CASH_SOURCE_FIELDS.bank, 'BusinessName', 'Counterparty'];
const LEDGER_FIELDS = CASH_SOURCE_FIELDS.ledger;
const HISTORY_FIELDS = ['TransactionID', 'BusinessID', 'BusinessName', 'Currency', 'TransactionDate', 'StatementMonth', 'RawBankDescription', 'BankDirection', 'AmountMYR', 'SignedCashMovementMYR', 'Counterparty', 'Reference'];
export const MAX_DOCUMENT_BYTES = 4_000_000;
export const STAGE_TITLES: Record<StageId, string> = {
    IDENTIFY: 'Identify documents and roles', EXTRACT: 'Extract and normalize records', INTERPRET: 'Interpret schema and accounting conventions',
    VERIFY: 'Independent verification', RECONCILE: 'Deterministic reconciliation', ANALYZE: 'Transaction analytics and anomaly candidates',
    FORECAST: 'Supported forecast', REPORT: 'Management summary',
};
function limitations(models: string[]) {
    return [
        models.length
            ? 'All calculations ran in this browser. For AI-interpreted documents only the headings, column profiles and a few sample lines were sent to the FinGence server and Groq. The input documents are kept temporarily in this browser tab\'s sessionStorage until results are cleared or the tab is closed.'
            : 'Processed in this browser only; nothing is uploaded to a server or shared. The input documents are kept temporarily in this browser tab\'s sessionStorage until results are cleared or the tab is closed.',
        'Signed cash movement is bank cash in and out. It is not revenue, expenses, profit or a cash flow statement.',
        models.length
            ? `Layouts of unfamiliar documents were proposed by a language model (${models.join(', ')} on Groq) and accepted only after deterministic checks on every row of the original document; the model never supplied an amount. Other documents were recognised by exact schema signatures.`
            : 'Document roles and column meanings come from exact schema signatures and configured cash conventions, not from a language model.',
        'Reconciliation exceptions and anomaly candidates are quarantined for exception handling; none is cleared automatically.',
    ];
}

const check = (id: string, label: string, passed: boolean, detail: string): Check => ({ id, label, passed, detail });
const sumCents = (values: string[]) => values.reduce((n, v) => n + toCents(v), 0n);
function header(bytes: Uint8Array): string[] | null {
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
        const first = Papa.parse<string[]>(text, { preview: 1 }).data[0];
        return first ? first.map(h => h.trim()) : null;
    } catch { return null; }
}
function identify(fields: string[] | null): { role: DocumentRole | null; reason: string; unfamiliar?: boolean } {
    if (!fields) return { role: null, reason: 'Not a UTF-8 CSV with a header row.' };
    if (fields.some(f => EVALUATOR_COLUMNS.includes(f))) return { role: null, reason: 'Contains evaluation or ground-truth columns; never accepted as a source document.' };
    const has = (list: string[]) => list.every(f => fields.includes(f));
    if (has(BANK_FIELDS)) return { role: 'BANK_STATEMENT', reason: 'All bank statement columns present (exact schema signature).' };
    if (has(LEDGER_FIELDS)) return { role: 'GENERAL_LEDGER', reason: 'All cash-account general ledger columns present (exact schema signature).' };
    if (has(HISTORY_FIELDS)) return { role: 'BANK_HISTORY', reason: 'All normalized bank transaction history columns present (exact schema signature).' };
    return { role: null, reason: 'Columns do not match a supported bank statement, cash-account ledger or bank history schema.', unfamiliar: true };
}
/** Deterministic, order-independent processing identity: pipeline version plus each accepted role and source fingerprint. */
async function processingIdentity(digest: Digest, parts: string[]) {
    return (await digest(new TextEncoder().encode([PIPELINE_VERSION, ...parts.sort()].join('\n')))).slice(0, 24);
}

export async function processDocuments(inputs: DocumentInput[], digest: Digest = sha256Hex, onStage?: (stage: Stage) => void | Promise<void>, options: ProcessingOptions = {}): Promise<ProcessingContext> {
    const stages: Stage[] = [], quarantine: Quarantined[] = [];
    const emit = async (id: StageId, decision: Decision, method: string, summary: string, checks: Check[]) => { const stage = { id, title: STAGE_TITLES[id], decision, method, summary, checks }; stages.push(stage); await onStage?.(stage); return stage; };
    const outputs: ProcessingContext['outputs'] = { bank: null, ledger: null, bankRows: [], reconciliation: null, reconciliationView: { status: 'UNAVAILABLE', reason: 'Documents were not processed.' }, totals: null, anomalies: [], history: { accepted: false, rows: [], months: [] }, forecast: null, report: null };
    const conventions = ['Bank: Credit adds cash, Debit removes cash; SignedCashMovementMYR must equal the signed BankAmountMYR.', 'Ledger: cash account 1000-BANK; Debit adds cash, Credit removes cash; SignedCashMovementMYR must equal Debit − Credit.', 'Currency MYR only; no foreign-exchange conversion.'];
    const finish = async (status: ProcessingContext['status'], scope: ProcessingContext['scope']) => {
        // An AI-interpreted document is identified by its bytes AND the accepted mapping, so a different accepted reading is a different processing.
        const accepted = documents.filter(d => d.decision === 'AUTO_ACCEPTED' && d.role).map(d => `${d.role}:${d.sha256}${d.interpretation?.mappingHash ? `:${d.interpretation.mappingHash}` : ''}`);
        if (outputs.report) outputs.report.limitations = limitations(aiModels());
        const processingId = await processingIdentity(digest, accepted.length ? accepted : documents.map(d => `INPUT:${d.sha256}`));
        if (outputs.report) outputs.report.processingId = processingId;
        return { version: PIPELINE_VERSION, processingId, runner: 'BROWSER_DEMO_RUNNER' as const, status, documents, scope, stages, conventions, outputs, quarantine };
    };

    // 1. Identify each document's role from its exact column signature; an unfamiliar layout may be interpreted by the model and gates.
    const documents: ProcessedDocument[] = [], effective: Uint8Array[] = [];
    const aiModels = () => [...new Set(documents.filter(d => d.interpretation?.decision === 'AUTO_ACCEPTED' && d.interpretation.receipt).map(d => d.interpretation!.receipt!.model))];
    for (const input of inputs) {
        const sha256 = await digest(input.bytes), oversized = input.bytes.byteLength > MAX_DOCUMENT_BYTES;
        const found = oversized ? { role: null, reason: `Larger than ${MAX_DOCUMENT_BYTES / 1_000_000} MB.` } : identify(header(input.bytes));
        const name = input.name.split(/[/\\]/).pop()!.slice(0, 120);
        const doc: ProcessedDocument = { name, sha256, bytes: input.bytes.byteLength, provenance: input.provenance, role: found.role, decision: found.role ? 'AUTO_ACCEPTED' : 'QUARANTINED', reason: found.reason, rows: null, businessId: null, currency: null, periods: [], interpretation: null };
        let bytes = input.bytes;
        const table = !found.role && found.unfamiliar && options.interpreter ? readTable(input.bytes) : null;
        if (table) {
            const record: InterpretationRecord = { method: 'AI_LAYOUT_PROPOSAL', receipt: null, proposal: null, error: null, decision: 'QUARANTINED', summary: '', checks: [], mapping: [], disclosures: [], canonicalSha256: null, canonicalNet: null, mappingHash: null };
            try {
                const { proposal, receipt } = await options.interpreter!.propose(buildEvidence(table, sha256, name));
                const verdict = verifyProposal(table, proposal);
                Object.assign(record, { proposal, receipt, decision: verdict.decision, summary: verdict.summary, checks: verdict.checks, mapping: verdict.mapping, disclosures: verdict.disclosures });
                if (verdict.canonical && verdict.mappingKey) {
                    bytes = verdict.canonical.bytes;
                    record.canonicalSha256 = await digest(bytes); record.canonicalNet = verdict.canonical.net;
                    record.mappingHash = (await digest(new TextEncoder().encode(verdict.mappingKey))).slice(0, 16);
                    Object.assign(doc, { role: verdict.role, decision: 'AUTO_ACCEPTED', reason: `AI layout proposal accepted after ${verdict.checks.length} deterministic checks.` });
                } else doc.reason = `AI layout proposal quarantined: ${verdict.summary}`;
            } catch (error) {
                record.error = error instanceof InterpreterUnavailable ? error.code : 'INTERPRETER_FAILED';
                record.summary = 'The AI interpreter was unavailable; the document was not interpreted.';
                doc.reason = `${found.reason} AI interpretation unavailable (${record.error}).`;
            }
            doc.interpretation = record;
        }
        documents.push(doc); effective.push(bytes);
    }
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
        bank = normalizeCashSourceBytes(bytesOf(bankDoc!), 'bank', bankDoc!.name.endsWith('.csv') ? bankDoc!.name : `${bankDoc!.name}.csv`, bankDoc!.sha256);
        ledger = normalizeCashSourceBytes(bytesOf(ledgerDoc!), 'ledger', ledgerDoc!.name.endsWith('.csv') ? ledgerDoc!.name : `${ledgerDoc!.name}.csv`, ledgerDoc!.sha256);
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
    for (const [d, s] of [[bankDoc!, bank], [ledgerDoc!, ledger]] as const) Object.assign(d, { rows: s.rows.length, businessId: s.businessId, currency: s.currency, periods: [s.period] });
    if (historyDoc && !historyProblem) Object.assign(historyDoc, { rows: history.length, businessId: [...new Set(history.map(r => r.businessId))].join(', '), currency: [...new Set(history.map(r => r.currency))].join(', '), periods: [...new Set(history.map(r => r.period))].sort() });
    await emit('EXTRACT', 'AUTO_ACCEPTED', 'Shared normalizer (lib/poc-reconciliation/engine.ts)', `${bank.rows.length} bank records and ${ledger.rows.length} ledger cash entries normalized${historyDoc ? historyProblem ? '; bank history unreadable' : `; ${history.length} history records read` : ''}.`, [
        check('bank-rows', 'Bank records normalized', true, `${bank.rows.length} rows, unique record IDs, ISO dates, MYR`),
        check('ledger-rows', 'Ledger cash entries normalized', true, `${ledger.rows.length} rows, cash account 1000-BANK`),
        ...(historyDoc ? [check('history-rows', 'Bank history readable', !historyProblem, historyProblem ?? `${history.length} rows`)] : []),
    ]);

    // 3. Interpret: one consistent business, period and currency across documents, under the configured conventions.
    let bankRows: SourceRow[] = [];
    try { bankRows = parseSource(bytesOf(bankDoc!)).rows; } catch { /* reported by verification below */ }
    const businessName = bankRows[0]?.businessName ?? bank.businessId;
    const scope = { organizationId: DEMO_ORGANIZATION, businessId: bank.businessId, businessName, period: bank.period, currency: bank.currency } as const;
    const sameScope = ledger.businessId === bank.businessId && ledger.period === bank.period && ledger.currency === bank.currency;
    const historyScoped = history.filter(r => r.businessId === scope.businessId && r.currency === scope.currency);
    const aiAccepted = [bankDoc!, ledgerDoc!].filter(d => d.interpretation?.decision === 'AUTO_ACCEPTED');
    for (const d of aiAccepted) conventions.push(`${d.name}: layout proposed by ${d.interpretation!.receipt?.model ?? 'the AI interpreter'} — ${d.interpretation!.mapping.map(m => `${m.heading} → ${m.field}`).join(', ')}.`);
    const scoped = await emit('INTERPRET', sameScope ? 'AUTO_ACCEPTED' : 'QUARANTINED', aiAccepted.length ? 'AI layout proposal verified by deterministic gates; configured cash conventions' : 'Configured cash conventions (deterministic)', sameScope ? `${scope.businessId} · ${scope.period} · ${scope.currency}; bank and ledger describe the same business, month and currency.` : 'Bank and ledger describe different businesses, months or currencies; no pairing is assumed.', [
        check('scope', 'Bank and ledger share business, month and currency', sameScope, `bank ${bank.businessId}/${bank.period}/${bank.currency}; ledger ${ledger.businessId}/${ledger.period}/${ledger.currency}`),
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
    const historyPeriod = historyScoped.filter(r => r.period === scope.period);
    const historyNet = historyPeriod.length ? sumCents(historyPeriod.map(r => r.signedAmount)) : null;
    const historyChecks = historyDoc && !historyProblem ? [check('history-period', 'History month equals the verified statement', historyNet === bankNormalized && historyPeriod.length === bank.rows.length, historyNet === null ? `${scope.period} absent from history` : `history ${fromCents(historyNet)} over ${historyPeriod.length} rows; statement ${fromCents(bankNormalized)} over ${bank.rows.length} rows`)] : [];
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
    await emit('VERIFY', verified ? 'AUTO_ACCEPTED' : 'QUARANTINED', 'Independent parser and sums', verified ? `Bank and ledger figures independently verified${historyDoc ? outputs.history.accepted ? '; history agrees with the statement month' : '; history quarantined' : ''}.` : 'Independent checks disagree; nothing downstream is computed.', [...coreChecks, ...historyChecks]);
    if (!verified) { quarantine.push({ kind: 'DOCUMENT', reference: `${bankDoc!.name} + ${ledgerDoc!.name}`, status: 'VERIFICATION_FAILED', reason: 'Independent checks disagree with the normalized records.' }); return finish('QUARANTINED', scope); }
    outputs.bank = bank; outputs.ledger = ledger; outputs.bankRows = bankRows;
    if (outputs.history.accepted) { outputs.history.rows = historyScoped; outputs.history.months = [...new Set(historyScoped.map(r => r.period))].sort(); }

    // 5. Reconcile with the shared deterministic matcher, then re-validate the snapshot independently.
    const snapshot = reconcileCashSources(DEMO_ORGANIZATION, bank, ledger);
    const view = readReconciliation(snapshot, { ...scope, bankSha256: bank.sha256 });
    outputs.reconciliation = snapshot; outputs.reconciliationView = view;
    const matched = (s: ReconciliationStatus) => s === 'MATCH_EXACT' || s === 'MATCH_DATE_SHIFT';
    for (const r of snapshot.results.filter(r => !matched(r.status))) quarantine.push({ kind: 'RECONCILIATION_EXCEPTION', reference: r.bankRecordId ?? r.ledgerRecordIds.join(', '), status: r.status, reason: r.reason });
    const exceptions = snapshot.results.filter(r => !matched(r.status)).length;
    await emit('RECONCILE', view.status === 'AVAILABLE' ? 'AUTO_ACCEPTED' : 'QUARANTINED', 'Deterministic matching rules', `${snapshot.results.length - exceptions} outcomes matched automatically; ${exceptions} exceptions quarantined for exception handling, never cleared.`, [
        check('contract', 'Snapshot passes the reconciliation contract', view.status === 'AVAILABLE', view.status === 'AVAILABLE' ? 'Counts equal row-level results; difference equals bank − ledger' : view.reason),
        check('bank-movement', 'Reconciled bank movement equals the verified bank total', snapshot.cashMovement.bank === fromCents(bankNormalized), `${snapshot.cashMovement.bank}`),
    ]);

    // 6. Analytics and anomaly candidates from the same verified bank records.
    outputs.totals = cashTotals(bankRows);
    outputs.anomalies = detectAnomalies(bankRows);
    for (const c of outputs.anomalies) quarantine.push({ kind: 'ANOMALY_CANDIDATE', reference: c.row.rowId, status: c.severity, reason: c.findings.map(f => f.rationale).join(' ') });
    await emit('ANALYZE', 'AUTO_ACCEPTED', `Exact cent arithmetic; ${DETECTOR_VERSION}`, `Net signed bank movement ${scope.currency} ${outputs.totals.net}; ${outputs.anomalies.length} anomaly candidates quarantined for review.`, [
        check('consistency', 'Analytics total equals the reconciled bank movement', outputs.totals.net === snapshot.cashMovement.bank, outputs.totals.net),
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
        cash: outputs.totals, reconciliation: { cashMovement: snapshot.cashMovement, counts: snapshot.counts }, anomalyCandidates: outputs.anomalies.length,
        forecast: f.status === 'AVAILABLE' ? { status: 'AVAILABLE', period: f.period, credits: f.credits, debits: f.debits, net: f.net } : { status: 'UNAVAILABLE', detail: f.detail },
        limitations: limitations(aiModels()),
    };
    await emit('REPORT', 'AUTO_ACCEPTED', 'Generated from the processing context', 'Summary, JSON evidence and printable report use the same figures.', [check('same-source', 'Every figure comes from this processing context', true, `${outputs.report.sources.length} source fingerprints`)]);
    return finish(exceptions || outputs.anomalies.length || quarantine.length ? 'COMPLETED_WITH_EXCEPTIONS' : 'COMPLETED', scope);
}

/** The future backend job system implements the same contract; the browser demo runner is the Phase 1 implementation. */
export interface ProcessingRunner {
    readonly kind: 'BROWSER_DEMO_RUNNER' | 'BACKEND_JOB_RUNNER';
    run(inputs: DocumentInput[], onStage?: (stage: Stage) => void | Promise<void>, options?: ProcessingOptions): Promise<ProcessingContext>;
}
export const browserDemoRunner: ProcessingRunner = { kind: 'BROWSER_DEMO_RUNNER', run: (inputs, onStage, options) => processDocuments(inputs, sha256Hex, onStage, options) };
