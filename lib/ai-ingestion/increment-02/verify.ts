import { DEFAULT_OPTIONS, type Provenance, type StagingValues } from "../../ingestion/models";
import { normalizeRecord } from "../../ingestion/normalize-record";
import { validateRecord } from "../../ingestion/validator";
import { isMissing, rawText } from "../../ingestion/normalizer";
import type { FinancialValues } from "../contracts";
import { POLICY_VERSION, semanticBlueprintSchema, type SemanticEvidence, type SemanticVerification, type SemanticOrigin } from "./contracts";
import { contextRule, exclusionValueAllowed, headingRule, observedDocumentKind } from "./registry";
import { datesUnambiguous, numbersUnambiguous } from "./conventions";

export function verifySemanticBlueprint(bundle: SemanticEvidence, input: unknown, origin: SemanticOrigin = "RECORDED_TEST"): SemanticVerification {
  const result: SemanticVerification = { version: "v2-verification-0.2", policyVersion: POLICY_VERSION, proposalOrigin: origin, approvalKind: "MACHINE_VERIFICATION", decision: "REJECTED", checks: [], documentReasons: [], dispositions: [], contextDispositions: [], accepted: [], rejected: [], unresolved: [], coverage: { sourceRows: 0, rowCountEstablished: bundle.coverage === "TABLE_ROWS" && bundle.tables.length > 0, accepted: 0, rejected: 0, unresolved: 0, populatedCells: 0, accountedCells: 0 } };
  const check = (code: string, passed: boolean, detail: string, evidenceIds: string[] = []) => { result.checks.push({ code, passed, detail, evidenceIds }); return passed; };
  const dataItems = bundle.items.filter(i => i.table !== null && !i.header && i.row !== null);
  const rows = new Map<string, typeof dataItems>();
  for (const item of dataItems) { const key = `${item.table}:${item.row}`; if (!rows.has(key)) rows.set(key, []); rows.get(key)!.push(item); }
  for (const [key, row] of rows) if (!row.some(i => i.text.trim())) rows.delete(key);
  result.coverage.sourceRows = rows.size; result.coverage.populatedCells = dataItems.filter(i => i.text.trim()).length;
  const parsed = semanticBlueprintSchema.safeParse(input);
  if (!check("BLUEPRINT_SCHEMA", parsed.success, "Only versioned declarative proposals are accepted.")) {
    result.unresolved = [...rows.values()].map((row, index) => ({ id: `${bundle.sourceId}:02:record:${index}`, evidenceIds: row.map(i => i.id), reasons: ["INVALID_BLUEPRINT"] }));
    result.coverage.unresolved = result.unresolved.length; result.documentReasons = ["INVALID_BLUEPRINT"]; return result;
  }
  const p = parsed.data!; result.dispositions = structuredClone(p.fields); result.contextDispositions = structuredClone(p.context);
  check("SOURCE_IDENTITY", p.sourceId === bundle.sourceId, "Source hash must match the exact evidence.");
  check("NO_ASSUMPTIONS", p.assumptions.length === 0, "Unresolved policy assumptions cannot authorize normalization.");
  check("READABLE_COMPLETE", bundle.coverage === "TABLE_ROWS" && !bundle.warnings.some(w => /incomplete|ambiguous|unreadable/i.test(w)), "Incomplete extraction or uncertain header selection needs review.");
  check("UNIQUE_EVIDENCE_IDS", new Set(bundle.items.map(i => i.id)).size === bundle.items.length, "Evidence identities must be unique.");
  check("EVIDENCE_VALUE_FIDELITY", bundle.items.every(i => rawText(i.value) === i.text), "The extractor's typed value and literal evidence text must agree.");
  const observed = observedDocumentKind(bundle.items.filter(i => i.table === null).map(i => i.text));
  check("DOCUMENT_CONTEXT", p.documentKind === "TRANSACTION_TABLE" ? observed === null : observed === p.documentKind, "Document classification must follow actual contextual evidence, not an invented label.");
  check("SUPPORTED_DOCUMENT", ["TRANSACTION_TABLE", "BANK_STATEMENT", "GENERAL_LEDGER"].includes(p.documentKind), "Invoice/receipt/unknown interpretations do not yet have an approved transaction normalization contract.");
  const source = new Map(bundle.items.map(i => [i.id, i])); const fields = new Map(p.fields.map(f => [f.id, f]));
  check("UNIQUE_FIELDS", fields.size === p.fields.length && new Set(p.fields.map(f => `${f.table}:${f.column}`)).size === p.fields.length, "Each source column has one explicit disposition.");
  const headers = bundle.tables.flatMap(t => t.headerIds.map(id => ({ table: t.id, item: source.get(id)! })));
  check("HEADER_FIELD_COVERAGE", p.fields.length === headers.length && headers.every(h => p.fields.some(f => f.table === h.table && f.column === h.item.text)), "All extracted columns must be declared, including unsupported ones.");
  for (const field of p.fields) {
    const trusted = headingRule(field.column);
    check(`FIELD_POLICY:${field.id}`, trusted ? trusted.id === field.ruleId && trusted.role === field.role && trusted.target === field.target && trusted.disposition === field.disposition && (!trusted.contexts || trusted.contexts.includes(p.documentKind)) : field.disposition === "UNRESOLVED" && field.target === null && field.role === "unknown", "Source heading, document context, role, disposition and target must independently agree with a registered rule.");
  }
  const context = bundle.items.filter(i => i.table === null && i.text.trim());
  check("CONTEXT_COVERAGE", p.context.length === context.length && new Set(p.context.map(c => c.evidenceId)).size === context.length && context.every(i => p.context.some(c => c.evidenceId === i.id)), "Contextual evidence cannot silently disappear.");
  for (const c of p.context) check("CONTEXT_POLICY", Boolean(source.get(c.evidenceId) && contextRule(source.get(c.evidenceId)!.text) === c.ruleId && c.disposition !== "UNRESOLVED"), "Document context must be supported, not discarded as unreviewed boilerplate.", [c.evidenceId]);
  check("SOURCE_TEXT_NOT_INSTRUCTIONS", !bundle.items.some(i => /ignore.*instructions|run sql|reveal.*(?:key|secret)/i.test(i.text)), "Source instructions are held as untrusted data; this is not a complete prompt-injection defense.");
  const financial = p.fields.filter(f => f.disposition === "FINANCIAL");
  const dateFields = new Set(financial.filter(f => f.role === "transaction_date" || f.role === "posting_date").map(f => `${f.table}:${f.column}`));
  const numberFields = new Set(financial.filter(f => ["amount", "debit", "credit", "balance"].includes(f.role)).map(f => `${f.table}:${f.column}`));
  check("DATE_CONVENTION", datesUnambiguous(dataItems.filter(i => dateFields.has(`${i.table}:${i.column}`) && i.text.trim()).map(i => i.value), p.conventions.dateOrder), "Multiple possible financial dates require policy clarification.");
  check("NUMBER_CONVENTION", numbersUnambiguous(dataItems.filter(i => numberFields.has(`${i.table}:${i.column}`) && i.text.trim()).map(i => i.value), p.conventions.numberFormat), "Multiple possible decimal meanings require policy clarification.");
  const seenRows = new Set<string>(); const accounted = new Set<string>();
  for (const record of p.records) {
    const items = record.cells.map(c => source.get(c.evidenceId));
    const keys = new Set(items.filter(Boolean).map(i => `${i!.table}:${i!.row}`));
    check("SINGLE_SOURCE_ROW", keys.size === 1 && [...keys].every(k => rows.has(k)), "Never combine cells from different financial rows.");
    for (const key of keys) { check("ROW_NOT_REUSED", !seenRows.has(key), "Each row must appear once."); seenRows.add(key); }
    check("UNIQUE_ROW_BINDINGS", new Set(record.cells.map(c => c.evidenceId)).size === record.cells.length && new Set(record.cells.map(c => c.fieldId)).size === record.cells.length, "Source cells and column assignments cannot be reused.");
    for (const c of record.cells) {
      const item = source.get(c.evidenceId); const f = fields.get(c.fieldId);
      const valid = Boolean(item && f && !item.header && item.table === f.table && item.column === f.column && item.text === c.observedText);
      check("SOURCE_BINDING", valid, "Literal text, coordinates and source column must agree with each binding.", [c.evidenceId]);
      if (valid && item!.text.trim()) accounted.add(item!.id);
    }
  }
  check("FULL_ROW_COVERAGE", seenRows.size === rows.size && [...rows.keys()].every(k => seenRows.has(k)), "All source rows must have an explicit outcome.");
  check("FULL_CELL_COVERAGE", dataItems.filter(i => i.text.trim()).every(i => accounted.has(i.id)), "No populated source field may silently disappear.");
  result.coverage.accountedCells = accounted.size;
  const globalReasons = [...new Set(result.checks.filter(c => !c.passed).map(c => c.code))];
  result.documentReasons = [...globalReasons];
  const seenRaw = new Set<string>();
  const executionId = crypto.randomUUID(); const executedAt = new Date().toISOString();
  for (const [index, row] of [...rows.values()].entries()) {
    const held = { id: `${bundle.sourceId}:02:record:${index}`, evidenceIds: row.map(i => i.id), reasons: [...globalReasons] };
    if (["INVOICE", "RECEIPT", "UNKNOWN"].includes(p.documentKind)) held.reasons.push("UNSUPPORTED_DOCUMENT");
    const staging: StagingValues = {}; const targets = new Set<string>();
    for (const item of row) {
      const field = p.fields.find(f => f.table === item.table && f.column === item.column); if (!field) continue;
      if (field.disposition === "UNRESOLVED" && item.text.trim()) held.reasons.push(field.role === "bank_in" || field.role === "bank_out" ? "UNSUPPORTED_BANK_MOVEMENT" : "UNRESOLVED_FIELD");
      if (["SUPPORTING_METADATA", "NONFINANCIAL_NARRATIVE"].includes(field.disposition) && !exclusionValueAllowed(item.text, field.ruleId)) held.reasons.push("EXCLUSION_NOT_JUSTIFIED");
      if (field.disposition === "FINANCIAL" && field.target) {
        if (targets.has(field.target)) held.reasons.push("DUPLICATE_FINANCIAL_ROLE"); targets.add(field.target); staging[field.target] = item.value;
      }
    }
    const mode = p.conventions.monetaryMode;
    const representation = mode === "debit_credit" ? targets.has("debit") && targets.has("credit") && !targets.has("source_amount") && !targets.has("entry_side") : targets.has("source_amount") && !targets.has("debit") && !targets.has("credit") && (mode === "amount_direction" ? targets.has("entry_side") : !targets.has("entry_side"));
    if (!representation) held.reasons.push("MONETARY_REPRESENTATION");
    if (!isMissing(staging.currency) && !/^[A-Za-z]{3}$/.test(String(staging.currency).trim())) held.reasons.push("INVALID_CURRENCY_EVIDENCE");
    if (mode === "amount_direction" && /^(?:IN|OUT|INFLOW|OUTFLOW|MONEY IN|MONEY OUT)$/i.test(String(staging.entry_side ?? "").trim())) held.reasons.push("UNSUPPORTED_BANK_DIRECTION");
    if (isMissing(staging.transaction_date) || (mode === "debit_credit" ? isMissing(staging.debit) || isMissing(staging.credit) : isMissing(staging.source_amount)) || mode === "amount_direction" && isMissing(staging.entry_side)) held.reasons.push("MISSING_REQUIRED_EVIDENCE");
    held.reasons = [...new Set(held.reasons)];
    if (held.reasons.length) { result.unresolved.push(held); continue; }
    const options = { ...DEFAULT_OPTIONS, sourceSystem: "V2 synthetic experiment", ...p.conventions };
    const provenance: Provenance = { source_system: options.sourceSystem, source_file: bundle.filename, source_sheet: row[0].sheet, source_row_number: row[0].row!, source_row_id: held.id, file_sha256: bundle.sourceId, ingestion_batch_id: executionId, ingested_at: executedAt };
    const normalized = normalizeRecord(staging, [], options, provenance); const key = JSON.stringify(staging);
    const issues = [...normalized.issues, ...validateRecord(normalized.candidate, staging, [], options, seenRaw.has(key))].map(i => ({ ...i, sourceColumn: p.fields.find(f => f.table === row[0].table && f.target === i.field)?.column ?? null })); seenRaw.add(key);
    if (issues.some(i => i.severity === "REJECTED") || normalized.candidate.canonical_date === null) result.rejected.push({ ...held, reasons: ["FINANCIAL_VALIDATION_FAILED"], issues });
    else result.accepted.push({ id: held.id, evidenceIds: held.evidenceIds, financial: Object.fromEntries(Object.entries(normalized.candidate).filter(([k]) => !(k in provenance) && k !== "derived_ledger_net")) as FinancialValues, status: issues.length ? "WARNING" : "VALID", issues });
  }
  Object.assign(result.coverage, { accepted: result.accepted.length, rejected: result.rejected.length, unresolved: result.unresolved.length });
  result.decision = result.accepted.length ? result.rejected.length || result.unresolved.length ? "PARTIAL" : "VERIFIED" : result.unresolved.length || globalReasons.length ? "NEEDS_REVIEW" : "REJECTED";
  return result;
}
