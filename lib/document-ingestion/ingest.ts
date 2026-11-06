/**
 * The FinGence ingestion layer: documents in, verified records out. Each uploaded file (CSV, XLSX workbook,
 * PDF with a text layer, scanned PDF or image) becomes one document per table it holds. A document in a
 * supported schema is recognised by its exact column signature; any other layout may be PROPOSED by the layout
 * interpreter (a language model behind the server gateway) and is accepted only when deterministic gates
 * re-derive it from every row of the original bytes, and then materialized into the canonical layout.
 * Tables assembled from positioned words (PDF text, OCR) always go through the gates and their arithmetic anchor.
 * Nothing here reconciles, aggregates or publishes; downstream layers read `documents` and `effective`.
 */
import Papa from 'papaparse';
import { CASH_SOURCE_FIELDS } from '../poc-reconciliation/engine';
import { EVALUATOR_COLUMNS } from '../poc-anomalies/source';
import { InterpreterUnavailable, type LayoutInterpreter, type ModelReceipt } from '../interpretation/contracts';
import { buildEvidence, readTable } from '../interpretation/evidence';
import { verifyProposal, verifyWithDisputes, type FieldMapping, type GateOptions } from '../interpretation/gates';
import { expandWorkbook, isWorkbook, type WorksheetSource } from '../interpretation/workbook';
import { extractDocument, isExtractable, type ExtractedSource, type Extractor } from '../interpretation/extract';

export type DocumentRole = 'BANK_STATEMENT' | 'GENERAL_LEDGER' | 'BANK_HISTORY';
export type Provenance = 'PUBLIC_SYNTHETIC_SAMPLE' | 'USER_SUPPLIED';
export type DocumentInput = { name: string; bytes: Uint8Array; provenance: Provenance };
export type Decision = 'AUTO_ACCEPTED' | 'QUARANTINED' | 'UNAVAILABLE';
export type Check = { id: string; label: string; passed: boolean; detail: string };
export type ProcessedDocument = {
    name: string; sha256: string; bytes: number; provenance: Provenance; role: DocumentRole | null; decision: Decision; reason: string;
    rows: number | null; businessId: string | null; currency: string | null; periods: string[];
    interpretation: InterpretationRecord | null;
    /**
     * Set when the document was converted to a table: a worksheet of an XLSX workbook, or a PDF / image read by its text
     * layer or OCR. `sha256` is then that table's fingerprint; the uploaded file's own is in the source.
     */
    source: WorksheetSource | ExtractedSource | null;
    /** What FinGence read from the document, for the side-by-side document view; null when it could not be read as a table. */
    reading: DocumentReading | null;
};
/**
 * The document as read, line by line, and where each verified record came from. `rows` is the table (one entry per line
 * of the document as a table; for a PDF or scan, per line placed by position). `records` maps each verified record to its
 * line; `columns` is the column each field was read from; `aiLines` are the lines the AI model was shown (empty when no
 * model was used): the model proposes the layout from those, and the code reads every line.
 */
export type DocumentReading = { rows: string[][]; records: { id: string; line: number }[]; columns: { field: string; column: number; heading: string }[]; aiLines: number[] };
/** A model's layout proposal and what the deterministic gates concluded about it. */
export type InterpretationRecord = {
    method: 'AI_LAYOUT_PROPOSAL'; receipt: ModelReceipt | null; proposal: unknown; error: string | null;
    decision: Decision; summary: string; checks: Check[]; mapping: FieldMapping[]; disclosures: string[];
    canonicalSha256: string | null; canonicalNet: string | null; mappingHash: string | null;
};
export type Digest = (bytes: Uint8Array) => Promise<string>;

/** Web Crypto SHA-256 (browsers and Node 20+). */
export const sha256Hex: Digest = async bytes => {
    const view = new Uint8Array(bytes.byteLength); view.set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', view.buffer);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** The record ID column of each role's canonical layout, and the field each canonical column holds. */
const ID_FIELD: Record<DocumentRole, string> = { BANK_STATEMENT: 'BankTransactionID', GENERAL_LEDGER: 'LedgerEntryID', BANK_HISTORY: 'TransactionID' };
const CANONICAL_FIELD: Record<string, string> = {
    BankTransactionID: 'recordId', LedgerEntryID: 'recordId', TransactionID: 'recordId', ValueDate: 'date', PostingDate: 'date', TransactionDate: 'date',
    BankDescription: 'description', LedgerMemo: 'description', RawBankDescription: 'description', BankReference: 'reference', LedgerReference: 'reference', Reference: 'reference',
    Counterparty: 'counterparty', SignedCashMovementMYR: 'amount', BankAmountMYR: 'unsignedAmount', AmountMYR: 'unsignedAmount', BankDirection: 'direction',
    CashAccountDebitMYR: 'debit', CashAccountCreditMYR: 'credit', Currency: 'currency', BusinessID: 'businessId',
};
function reading(bytes: Uint8Array, read: ReturnType<typeof readTable>, doc: ProcessedDocument, lineage: { canonical: Uint8Array; lines: number[] } | null, aiLines: number[]): DocumentReading | null {
    const table = read ?? readTable(bytes);
    if (!table) return null;
    const accepted = doc.decision === 'AUTO_ACCEPTED' && doc.role;
    let records: DocumentReading['records'] = [], columns: DocumentReading['columns'] = [];
    if (accepted && lineage) {
        // An AI-read document: each canonical row carries its source line.
        const rows = Papa.parse<string[]>(new TextDecoder().decode(lineage.canonical), { skipEmptyLines: true }).data, k = rows[0]?.indexOf(ID_FIELD[doc.role!]) ?? -1;
        records = k < 0 ? [] : rows.slice(1).map((r, i) => ({ id: r[k], line: lineage!.lines[i] }));
        columns = (doc.interpretation?.mapping ?? []).map(m => ({ field: m.field, column: m.column, heading: m.heading }));
    } else if (accepted) {
        // A document in a supported schema: the header is its first line, and each later line is one record.
        const header = table.rows[0] ?? [], k = header.indexOf(ID_FIELD[doc.role!]);
        records = k < 0 ? [] : table.rows.flatMap((r, line) => line > 0 && r.length > 1 && r[k] ? [{ id: r[k], line }] : []);
        columns = header.flatMap((h, column) => CANONICAL_FIELD[h] ? [{ field: CANONICAL_FIELD[h], column, heading: h }] : []);
    }
    return { rows: table.rows, records, columns, aiLines };
}

const BANK_FIELDS = [...CASH_SOURCE_FIELDS.bank, 'BusinessName', 'Counterparty'];
const LEDGER_FIELDS = CASH_SOURCE_FIELDS.ledger;
const HISTORY_FIELDS = ['TransactionID', 'BusinessID', 'BusinessName', 'Currency', 'TransactionDate', 'StatementMonth', 'RawBankDescription', 'BankDirection', 'AmountMYR', 'SignedCashMovementMYR', 'Counterparty', 'Reference'];
export const MAX_DOCUMENT_BYTES = 4_000_000;
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

/** What a document may cover: the Phase 1 pipeline reconciles one month in MYR; the ingestion layer alone accepts more. */
export const INGESTION_SCOPE: NonNullable<GateOptions['scope']> = { months: 'MANY', currencies: 'ANY' };
/** `onTable`: observes the table bytes each document is interpreted from (evaluation); it cannot change them. */
/** `extract` reads a PDF or image into a table (default: `extractDocument`); a server job's re-check replays the job's reading instead. */
export type IngestionOptions = { interpreter?: LayoutInterpreter | null; digest?: Digest; scope?: GateOptions['scope']; onTable?: (table: Uint8Array) => void; extract?: Extractor };
export type Ingested = {
    documents: ProcessedDocument[];
    /** The bytes each document continues as, index for index: canonical CSV for an AI-interpreted document, else its own table. */
    effective: Uint8Array[];
};

export async function ingestDocuments(inputs: DocumentInput[], options: IngestionOptions = {}): Promise<Ingested> {
    const digest = options.digest ?? sha256Hex, scope = options.scope;
    const documents: ProcessedDocument[] = [], effective: Uint8Array[] = [];
    // An XLSX workbook contributes one document per worksheet that holds a table; a PDF or image is read into one table.
    const entries: (DocumentInput & { source: WorksheetSource | ExtractedSource | null })[] = [];
    const unread = (input: DocumentInput, name: string, sha256: string, reason: string) => {
        documents.push({ name, sha256, bytes: input.bytes.byteLength, provenance: input.provenance, role: null, decision: 'QUARANTINED', reason, rows: null, businessId: null, currency: null, periods: [], interpretation: null, source: null, reading: null });
        effective.push(input.bytes);
    };
    for (const input of inputs) {
        const name = input.name.split(/[/\\]/).pop()!.slice(0, 120);
        if (isExtractable(input.bytes)) {
            const sha256 = await digest(input.bytes), read = await (options.extract ?? extractDocument)(name, input.bytes, sha256);
            if ('error' in read) unread(input, name, sha256, `Not read: ${read.error}`);
            else entries.push({ name, bytes: read.bytes, provenance: input.provenance, source: read.source });
            continue;
        }
        if (!isWorkbook(name, input.bytes)) { entries.push({ ...input, name, source: null }); continue; }
        const sha256 = await digest(input.bytes), expanded = await expandWorkbook(name, input.bytes, sha256);
        if ('error' in expanded) unread(input, name, sha256, `Workbook not read: ${expanded.error}`);
        else for (const w of expanded.worksheets) entries.push({ name: w.name, bytes: w.bytes, provenance: input.provenance, source: w.source });
    }
    for (const input of entries) {
        const sha256 = await digest(input.bytes), oversized = input.bytes.byteLength > MAX_DOCUMENT_BYTES;
        const extracted = input.source?.kind === 'PDF_TEXT' || input.source?.kind === 'OCR' ? input.source.kind : undefined;
        // A table assembled from positioned words is never accepted on its headings alone: it always goes through the gates and their arithmetic anchor.
        const found = oversized ? { role: null, reason: `Larger than ${MAX_DOCUMENT_BYTES / 1_000_000} MB.` }
            : extracted ? { role: null, reason: `Read from a ${extracted === 'OCR' ? 'scan or image by OCR' : 'PDF text layer'}; its layout and amounts must be verified by the AI layout proposal and arithmetic checks.`, unfamiliar: true }
                : identify(header(input.bytes));
        const name = input.name;
        const doc: ProcessedDocument = { name, sha256, bytes: input.bytes.byteLength, provenance: input.provenance, role: found.role, decision: found.role ? 'AUTO_ACCEPTED' : 'QUARANTINED', reason: found.reason, rows: null, businessId: null, currency: null, periods: [], interpretation: null, source: input.source, reading: null };
        let lineage: { canonical: Uint8Array; lines: number[] } | null = null, aiLines: number[] = [];
        let bytes = input.bytes;
        const table = !found.role && found.unfamiliar && options.interpreter ? readTable(input.bytes) : null;
        if (table) {
            const record: InterpretationRecord = { method: 'AI_LAYOUT_PROPOSAL', receipt: null, proposal: null, error: null, decision: 'QUARANTINED', summary: '', checks: [], mapping: [], disclosures: [], canonicalSha256: null, canonicalNet: null, mappingHash: null };
            try {
                options.onTable?.(input.bytes.slice());
                const evidence = buildEvidence(table, sha256, name);
                aiLines = [...evidence.head, ...evidence.tail].map(l => l.line);
                const { proposal, receipt } = await options.interpreter!.propose(evidence);
                const verdict = input.source?.kind === 'OCR' ? verifyWithDisputes(table, proposal, input.source.disputes, { extracted, scope }) : verifyProposal(table, proposal, { extracted, scope });
                Object.assign(record, { proposal, receipt, decision: verdict.decision, summary: verdict.summary, checks: verdict.checks, mapping: verdict.mapping, disclosures: verdict.disclosures });
                if (verdict.canonical && verdict.mappingKey) {
                    bytes = verdict.canonical.bytes; lineage = { canonical: bytes, lines: verdict.canonical.lineage };
                    record.canonicalSha256 = await digest(bytes); record.canonicalNet = verdict.canonical.net;
                    // Identity follows the verified canonical content, so equivalent proposals give the same processing ID.
                    record.mappingHash = record.canonicalSha256.slice(0, 16);
                    Object.assign(doc, { role: verdict.role, decision: 'AUTO_ACCEPTED', reason: `AI layout proposal accepted after ${verdict.checks.length} deterministic checks.` });
                } else doc.reason = `AI layout proposal quarantined: ${verdict.summary}`;
            } catch (error) {
                record.error = error instanceof InterpreterUnavailable ? error.code : 'INTERPRETER_FAILED';
                record.summary = 'The AI interpreter was unavailable; the document was not interpreted.';
                doc.reason = `${found.reason} AI interpretation unavailable (${record.error}).`;
            }
            doc.interpretation = record;
        }
        doc.reading = reading(input.bytes, table, doc, lineage, aiLines);
        documents.push(doc); effective.push(bytes);
    }
    return { documents, effective };
}
