import { equalDecimals, isDecimal, sumDecimals } from "./decimal";
import { SOURCE_TEMPLATES } from "./schemas";
import { PILOT_ANNOTATION_MANIFEST, pilotAnnotationErrors } from "./pilot-annotations";
import type { Dataset, ResearchRecord } from "./types";

export interface ValidationResult { valid: boolean; errors: string[] }
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !v.includes("\0");
const nullableText = (v: unknown): boolean => v === null || text(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export function isISODate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith("0000")) return false;
  const time = Date.parse(v + "T00:00:00.000Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === v;
}
const pairKey = (b: string, l: string): string => JSON.stringify([b, l]);

/** Independent internal JSON/fixture validator, not an external security or ingestion boundary. */
export function validateDataset(input: unknown): ValidationResult {
  const errors: string[] = [];
  const check = (condition: unknown, message: string): void => { if (!condition) errors.push(message); };
  const result = (): ValidationResult => ({ valid: errors.length === 0, errors });
  if (!object(input) || !object(input.config) || !Array.isArray(input.templates) || !Array.isArray(input.records) || !object(input.groundTruth))
    return { valid: false, errors: ["Invalid dataset envelope"] };
  check(input.generatorVersion === PILOT_ANNOTATION_MANIFEST.generatorVersion, "Unsupported generator version");
  check(input.config.pilot === "M1" && text(input.config.seed) && input.config.seed.length <= 128 && !/[\u0000-\u001f]/.test(input.config.seed), "Invalid pilot configuration");
  check(input.templates.length === 4, "Exactly four source templates required");
  check(input.records.length === 40, "Exactly 40 transaction rows required");
  for (const t of input.templates) {
    if (!object(t) || !text(t.id)) { errors.push("Malformed template"); continue; }
    const expected = SOURCE_TEMPLATES.find(s => s.id === t.id);
    check(expected && Object.keys(expected).every(k => JSON.stringify(t[k]) === JSON.stringify(expected[k as keyof typeof expected])), "Invalid source template: " + t.id);
  }
  check(new Set(input.templates.map(t => object(t) ? t.id : null)).size === 4, "Duplicate template identity");
  for (const r of input.records) {
    if (!object(r)) { errors.push("Malformed record"); continue; }
    for (const field of ["id", "role", "systemId", "templateId", "sourceRowId", "amount", "currency", "monetaryBasis", "direction", "accountId", "canonicalDate", "canonicalDateBasis", "description"])
      check(text(r[field]), "Missing text field: " + field);
    for (const field of ["sourceTransactionId", "sourceAmount", "debit", "credit", "transactionDate", "postingDate", "counterparty", "reference"])
      check(nullableText(r[field]), "Invalid nullable field: " + field);
    check(object(r.provenance) && text(r.provenance.file) && nullableText(r.provenance.sheet) && Number.isSafeInteger(r.provenance.row) && Number(r.provenance.row) >= 1 && r.provenance.synthetic === true, "Invalid source provenance");
  }
  const truth = input.groundTruth;
  for (const key of ["relationships", "nonmatches", "unmatchedIds", "ambiguousCases", "outcomes", "cases"]) check(Array.isArray(truth[key]), "Missing annotation array: " + key);
  if (errors.length) return result();
  const d = input as unknown as Dataset;
  for (const r of d.groundTruth.relationships) check(object(r) && text(r.id) && text(r.kind) && text(r.family) && text(r.rationale) && Array.isArray(r.bankIds) && r.bankIds.every(text) && Array.isArray(r.ledgerIds) && r.ledgerIds.every(text), "Malformed economic relationship");
  for (const p of d.groundTruth.nonmatches) check(object(p) && text(p.bankId) && text(p.ledgerId) && ["AMOUNT", "CURRENCY", "DISTINCT_EVENT"].includes(p.reason), "Malformed negative label");
  check(d.groundTruth.unmatchedIds.every(text), "Malformed unmatched labels");
  for (const a of d.groundTruth.ambiguousCases) check(object(a) && text(a.id) && text(a.rationale) && Array.isArray(a.bankIds) && a.bankIds.every(text) && Array.isArray(a.ledgerIds) && a.ledgerIds.every(text), "Malformed ambiguous case");
  for (const o of d.groundTruth.outcomes) check(object(o) && text(o.relationshipId) && text(o.reason) && ["SUGGEST_PAIR", "ABSTAIN_AMBIGUOUS", "ABSTAIN_INSUFFICIENT", "UNRESOLVED_GROUP"].includes(o.decision), "Malformed operational outcome");
  for (const c of d.groundTruth.cases) check(object(c) && text(c.id) && text(c.family) && Array.isArray(c.recordIds) && c.recordIds.every(text), "Malformed scenario case");
  if (errors.length) return result();

  const records = new Map(d.records.map(r => [r.id, r]));
  check(records.size === d.records.length, "Duplicate record identity");
  check(new Set(d.records.map(r => pairKey(r.templateId, r.sourceRowId))).size === d.records.length, "Duplicate source row identity");
  check(new Set(d.records.map(r => pairKey(r.provenance.file, String(r.provenance.row)))).size === d.records.length, "Duplicate source coordinate");
  const financialOK = new Set<string>();
  for (const r of d.records) {
    const start = errors.length;
    const t = SOURCE_TEMPLATES.find(t => t.id === r.templateId);
    check(t && d.templates.some(s => s.id === r.templateId), "Unknown source template: " + r.id);
    if (!t) continue;
    check(r.role === t.role && r.systemId === t.systemId && r.accountId === t.accountId && r.monetaryBasis === t.monetaryBasis, "Source identity/basis mismatch: " + r.id);
    check(["INFLOW", "OUTFLOW"].includes(r.direction), "Invalid direction: " + r.id);
    check(r.provenance.file === `synthetic-${t.id}.csv` && r.provenance.sheet === null && r.sourceRowId === `${t.id}:row-${r.provenance.row}`, "Source lineage mismatch: " + r.id);
    check(["MYR", "USD"].includes(r.currency), "Unsupported pilot currency: " + r.id);
    check(isDecimal(r.amount) && !r.amount.startsWith("-") && !equalDecimals(r.amount, "0"), "Invalid positive amount: " + r.id);
    for (const field of ["sourceAmount", "debit", "credit"] as const) check(r[field] === null || isDecimal(r[field]), "Invalid decimal field: " + field);
    for (const value of [r.transactionDate, r.postingDate]) check(value === null || isISODate(value), "Invalid calendar date: " + r.id);
    check(isISODate(r.canonicalDate) && r.canonicalDateBasis === t.dateBasis && r.canonicalDate === (t.dateBasis === "TRANSACTION_DATE" ? r.transactionDate : r.postingDate), "Canonical date/basis mismatch: " + r.id);
    if (errors.length !== start) continue;
    if (r.role === "BANK") {
      check(r.debit === null && r.credit === null && r.sourceAmount !== null, "Bank field availability mismatch: " + r.id);
      if (r.sourceAmount !== null) {
        const expected = r.monetaryBasis === "SIGNED_CASH" && r.direction === "OUTFLOW" ? "-" + r.amount : r.amount;
        check(equalDecimals(r.sourceAmount, expected), "Bank source sign/direction mismatch: " + r.id);
      }
    } else {
      check(r.sourceAmount === null, "Ledger source amount must be unavailable: " + r.id);
      const debitActive = r.monetaryBasis === "CASH_DEBIT_CREDIT" ? r.direction === "INFLOW" : r.direction === "OUTFLOW";
      const active = debitActive ? r.debit : r.credit, inactive = debitActive ? r.credit : r.debit;
      check(active !== null && equalDecimals(active, r.amount) && inactive === null, "Ledger debit/credit direction mismatch: " + r.id);
    }
    if (errors.length === start) financialOK.add(r.id);
  }
  for (const t of d.templates) check(d.records.filter(r => r.templateId === t.id).length === 10, "Each template must contain ten rows");
  for (const role of ["BANK", "LEDGER"]) check(d.records.filter(r => r.role === role).length === 20, "Pilot requires 20 rows per role");
  const lookup = (ids: string[], role: "BANK" | "LEDGER"): ResearchRecord[] => {
    check(ids.length > 0 && new Set(ids).size === ids.length, "Empty or duplicate label references");
    for (const id of ids) check(records.get(id)?.role === role, "Missing record or incorrect label role: " + id);
    return ids.flatMap(id => records.get(id) ? [records.get(id)!] : []);
  };
  const used = new Set<string>(), positives = new Set<string>();
  check(new Set(d.groundTruth.relationships.map(r => r.id)).size === d.groundTruth.relationships.length, "Duplicate relationship ID");
  for (const rel of d.groundTruth.relationships) {
    const b = lookup(rel.bankIds, "BANK"), l = lookup(rel.ledgerIds, "LEDGER");
    check(rel.kind === "ONE_TO_ONE" ? rel.bankIds.length === 1 && rel.ledgerIds.length === 1 : rel.kind === "GROUP" && ((rel.bankIds.length > 1 && rel.ledgerIds.length === 1) || (rel.bankIds.length === 1 && rel.ledgerIds.length > 1)), "Invalid economic relationship cardinality");
    for (const id of [...rel.bankIds, ...rel.ledgerIds]) { check(!used.has(id), "Record reused across economic relationships: " + id); used.add(id); }
    for (const bi of rel.bankIds) for (const li of rel.ledgerIds) positives.add(pairKey(bi, li));
    const all = [...b, ...l];
    if (all.length && all.every(r => financialOK.has(r.id))) {
      check(new Set(all.map(r => r.currency)).size === 1, "Economic relationship currency mismatch");
      check(new Set(all.map(r => r.direction)).size === 1, "Economic relationship cash direction mismatch");
      check(equalDecimals(sumDecimals(b.map(r => r.amount)), sumDecimals(l.map(r => r.amount))), "Economic relationship amount mismatch");
    }
    const outcomes = d.groundTruth.outcomes.filter(o => o.relationshipId === rel.id);
    check(outcomes.length === 1, "Exactly one operational outcome required per relationship");
    const decision = outcomes[0]?.decision;
    if (rel.kind === "GROUP") check(decision === "UNRESOLVED_GROUP", "Grouped relationship cannot become a one-to-one suggestion");
    else check(decision !== "UNRESOLVED_GROUP", "One-to-one relationship mislabeled grouped");
    if (rel.family === "D" || rel.family === "I") check(decision === "ABSTAIN_AMBIGUOUS", "Ambiguous relationship requires abstention");
    else if (rel.family === "G") check(decision === "ABSTAIN_INSUFFICIENT", "Missing-reference relationship requires abstention");
    else if (rel.kind === "ONE_TO_ONE") check(decision === "SUGGEST_PAIR", "Established pilot pair requires provisional suggestion");
  }
  for (const o of d.groundTruth.outcomes) check(d.groundTruth.relationships.some(r => r.id === o.relationshipId), "Outcome refers to unknown relationship");
  const negatives = new Set<string>();
  for (const p of d.groundTruth.nonmatches) {
    const b = lookup([p.bankId], "BANK")[0], l = lookup([p.ledgerId], "LEDGER")[0], key = pairKey(p.bankId, p.ledgerId);
    check(!positives.has(key), "Contradictory positive/negative label"); check(!negatives.has(key), "Duplicate negative label"); negatives.add(key);
    if (b && l && financialOK.has(b.id) && financialOK.has(l.id)) {
      if (p.reason === "AMOUNT") check(!equalDecimals(b.amount, l.amount), "False amount-mismatch label");
      if (p.reason === "CURRENCY") check(b.currency !== l.currency, "False currency-mismatch label");
    }
  }
  errors.push(...pilotAnnotationErrors(d));
  check(new Set(d.groundTruth.unmatchedIds).size === d.groundTruth.unmatchedIds.length, "Duplicate unmatched label");
  for (const id of d.groundTruth.unmatchedIds) { check(records.has(id), "Unknown unmatched record"); check(!used.has(id), "Matched record also marked unmatched"); used.add(id); }
  check(used.size === records.size && [...records.keys()].every(id => used.has(id)), "Every pilot record needs an economic disposition");
  const caseUsed = new Set<string>(), families: Record<string, number> = {};
  check(new Set(d.groundTruth.cases.map(c => c.id)).size === d.groundTruth.cases.length, "Duplicate case ID");
  for (const c of d.groundTruth.cases) {
    families[c.family] = (families[c.family] ?? 0) + c.recordIds.length;
    check(c.recordIds.length > 0, "Empty case");
    for (const id of c.recordIds) { check(records.has(id) && !caseUsed.has(id), "Unknown or reused scenario record"); caseUsed.add(id); }
    for (const rel of d.groundTruth.relationships) if ([...rel.bankIds, ...rel.ledgerIds].some(id => c.recordIds.includes(id)))
      check(rel.family === c.family && [...rel.bankIds, ...rel.ledgerIds].every(id => c.recordIds.includes(id)), "Economic relationship crosses scenario families");
  }
  const expected: Record<string, number> = { A: 12, B: 4, C: 4, D: 4, E: 2, F: 2, G: 2, H: 4, I: 3, J: 3 };
  check(Object.keys(families).length === 10 && Object.entries(expected).every(([family, count]) => families[family] === count) && caseUsed.size === 40, "Pilot scenario distribution mismatch");
  check(new Set(d.groundTruth.ambiguousCases.map(a => a.id)).size === d.groundTruth.ambiguousCases.length && d.groundTruth.ambiguousCases.length === 2, "Exactly two distinct ambiguous cases required");
  for (const a of d.groundTruth.ambiguousCases) {
    lookup(a.bankIds, "BANK"); lookup(a.ledgerIds, "LEDGER");
    const c = d.groundTruth.cases.find(c => c.id === a.id);
    check(c && ["D", "I"].includes(c.family) && a.bankIds.length * a.ledgerIds.length > 1 && JSON.stringify([...a.bankIds, ...a.ledgerIds].sort()) === JSON.stringify([...c.recordIds].sort()), "Invalid ambiguity membership");
  }
  return result();
}

export function assertValidDataset(input: unknown): asserts input is Dataset {
  const result = validateDataset(input);
  if (!result.valid) throw new Error("Invalid synthetic dataset:\n" + result.errors.join("\n"));
}

export function summarizeDataset(d: Dataset) {
  return { rows: d.records.length, bankRows: d.records.filter(r => r.role === "BANK").length,
    ledgerRows: d.records.filter(r => r.role === "LEDGER").length, templates: d.templates.length,
    truePairs: d.groundTruth.relationships.filter(r => r.kind === "ONE_TO_ONE").length,
    explicitNegativePairs: d.groundTruth.nonmatches.length, unmatchedRecords: d.groundTruth.unmatchedIds.length,
    ambiguousCases: d.groundTruth.ambiguousCases.length, unsupportedGroups: d.groundTruth.relationships.filter(r => r.kind === "GROUP").length,
    suggestedPairs: d.groundTruth.outcomes.filter(o => o.decision === "SUGGEST_PAIR").length };
}
