import { blueprintSchema, type EvidenceBundle, type FinancialValues, type VerificationResult } from "./contracts";
import { DEFAULT_OPTIONS, type CanonicalField, type Provenance, type StagingValues } from "../ingestion/models";
import { normalizeRecord } from "../ingestion/normalize-record";
import { validateRecord } from "../ingestion/validator";

// Independent, deliberately narrow SYNTHETIC policy, not another automatic mapper.
// Unknown headings are held for review even when the model offers a plausible interpretation.
const roles: Partial<Record<CanonicalField, readonly string[]>> = {
  source_transaction_id: ["txnno", "transactionid", "txnid", "sourcetransactionid"],
  transaction_date: ["txndate", "transactiondate", "date"], posting_date: ["postingdate"],
  source_amount: ["amount", "sourceamount", "transactionamount"],
  debit: ["debit", "debitamount"], credit: ["credit", "creditamount"],
  currency: ["ccy", "currency"], description: ["details", "description", "narration"],
  reference: ["reference", "ref"], entry_side: ["entryside", "debitcredit", "direction"],
  account_code: ["accountcode"], account_id: ["accountid"], entity_id: ["entityid"],
  balance: ["balance"], counterparty: ["counterparty"],
};

/** A new synthetic-only machine gate. Never calls approveMapping or creates IngestionResult. */
export function verifyAndExecute(bundle: EvidenceBundle, input: unknown): VerificationResult {
  const executionId = globalThis.crypto.randomUUID();
  const executedAt = new Date().toISOString();
  const result: VerificationResult = { decision: "REJECTED", policy: "synthetic-iso-no-defaults-0.1", approvalKind: "MACHINE_VERIFICATION", checks: [], accepted: [], excluded: [] };
  const check = (name: string, passed: boolean, message: string) => { result.checks.push({ name, passed, message }); return passed; };
  const parsed = blueprintSchema.safeParse(input);
  if (!check("declarative_schema", parsed.success, "Only known financial targets and declarative operations are permitted.")) return result;
  const proposal = parsed.data!;
  check("source_identity", proposal.sourceId === bundle.sourceId, "Blueprint must cite this exact source hash.");
  check("no_assumptions", !proposal.assumptions.length, "Unresolved assumptions require policy review.");
  check("declared_operations", proposal.rules.length === 3 && new Set(proposal.rules).size === 3, "The initial policy requires exactly the three declared text/date/decimal operations; omitted or duplicate operations require review.");
  check("explicit_synthetic_policy", proposal.dateOrder === "ISO" && proposal.numberFormat === "plain" && proposal.dateBasis === "transaction_date", "Initial synthetic policy permits ISO transaction-date selection and plain decimal numbers only; other conventions require review.");
  check("readable_source", bundle.items.length > 0 && !bundle.warnings.some(w => /unreadable|ambiguous|incomplete/i.test(w)), "Unreadable or incomplete evidence cannot be accepted.");
  check("source_instructions_not_authority", !bundle.items.some(i => /ignore (all|previous) instructions|run sql|reveal.*(?:key|secret)/i.test(i.text)), "Prompt-like source instructions are untrusted and held for review. This detector is not a complete prompt-injection defense.");
  // Region-only extraction cannot establish row coverage or visual numeric truth by itself.
  check("row_coverage_available", bundle.coverage === "TABLE_ROWS", "OCR/vision-only regions remain reviewable; complete row coverage is not established.");
  const source = new Map(bundle.items.map(item => [item.id, item]));
  const expectedRows = new Set(bundle.items.filter(i => !i.header && i.row !== null && i.text.trim()).map(i => `${i.table}:${i.row}`));
  const seenRows = new Set<string>();
  for (const record of proposal.records) {
    const targets = record.evidence.map(e => e.target);
    check("unique_targets", new Set(targets).size === targets.length, "One source binding per target is permitted.");
    const citedIds = new Set(record.evidence.map(e => e.evidenceId));
    check("unique_evidence", citedIds.size === record.evidence.length, "One source value cannot fill multiple financial roles.");
    const cited = record.evidence.map(e => source.get(e.evidenceId));
    check("evidence_exists", cited.every(i => i && !i.header), "Every binding must cite a non-header source item.");
    const rows = new Set(cited.filter(Boolean).map(i => `${i!.table}:${i!.row}`));
    check("same_source_row", rows.size === 1, "Do not combine values from different financial rows.");
    for (const row of rows) { check("row_not_reused", !seenRows.has(row), "A source row cannot be published twice."); seenRows.add(row); }
    check("populated_cell_coverage", bundle.items.filter(i => !i.header && i.text.trim() && rows.has(`${i.table}:${i.row}`)).every(i => citedIds.has(i.id)), "Every populated cell must be accounted for under the initial synthetic policy; do not silently drop currency, identifiers or other fields.");
    const has = (field: CanonicalField) => targets.includes(field);
    check("monetary_representation", proposal.monetaryMode === "debit_credit"
      ? has("debit") && has("credit") && !has("source_amount") && !has("entry_side")
      : has("source_amount") && !has("debit") && !has("credit") && (proposal.monetaryMode === "amount_direction" ? has("entry_side") : !has("entry_side")), "Keep ledger sides, signed amount and amount-with-direction separate. Ambiguous mixed representations require review.");
    for (const binding of record.evidence) {
      const item = source.get(binding.evidenceId); const label = item?.column?.toLowerCase() ?? "";
      check("literal_source_fidelity", item?.text === binding.observedText, "Model-observed text must agree exactly with cited extractor evidence; disagreement requires review.");
      check("column_role", roles[binding.target]?.includes(label.replace(/[^a-z0-9]/g, "")) === true, "The source heading must independently support the proposed financial role under the synthetic policy. Unknown or swapped headings require review.");
      if (/posting/.test(label)) check("date_label_fidelity", binding.target === "posting_date", "Posting-date evidence cannot be relabelled transaction date.");
      if (binding.target === "currency") check("currency_fidelity", /^[A-Za-z]{3}$/.test(item?.text.trim() ?? ""), "Currency must exist as a source code, never a guessed default.");
    }
  }
  check("complete_unique_row_coverage", proposal.records.length > 0 && seenRows.size === expectedRows.size && [...expectedRows].every(r => seenRows.has(r)), "Every extracted financial row must be accounted for exactly once.");
  if (result.checks.some(c => !c.passed)) { result.decision = "NEEDS_REVIEW"; return result; }
  const options = { ...DEFAULT_OPTIONS, sourceSystem: "Synthetic V2 experiment", monetaryMode: proposal.monetaryMode, dateBasis: proposal.dateBasis, dateOrder: proposal.dateOrder, numberFormat: proposal.numberFormat };
  const seenRaw = new Set<string>();
  for (const [index, record] of proposal.records.entries()) {
    const staging: StagingValues = {}; const ids = record.evidence.map(e => e.evidenceId);
    for (const e of record.evidence) staging[e.target] = source.get(e.evidenceId)!.value;
    const row = source.get(ids[0])!;
    // Internal helper context uses actual extracted row order. It is NOT exported as C1 lineage.
    const context: Provenance = { source_system: options.sourceSystem, source_file: bundle.filename, source_sheet: row.sheet,
      source_row_number: row.row!, source_row_id: ids[0], file_sha256: bundle.sourceId, ingestion_batch_id: executionId, ingested_at: executedAt };
    // Legacy mapping metadata is intentionally empty: no fabricated method or user approval.
    const normalized = normalizeRecord(staging, [], options, context);
    const rawKey = JSON.stringify(staging); const issues = [...normalized.issues, ...validateRecord(normalized.candidate, staging, [], options, seenRaw.has(rawKey))]; seenRaw.add(rawKey);
    const rejection = issues.some(i => i.severity === "REJECTED");
    if (rejection || normalized.candidate.canonical_date === null) result.excluded.push({ evidenceIds: ids, issues });
    else {
      const financial = Object.fromEntries(Object.entries(normalized.candidate).filter(([key]) => !(key in context) && key !== "derived_ledger_net")) as FinancialValues;
      result.accepted.push({ id: `${bundle.sourceId}:record:${index}`, evidenceIds: ids, financial, status: issues.length ? "WARNING" : "VALID", issues });
    }
  }
  result.decision = "VERIFIED";
  return result;
}
