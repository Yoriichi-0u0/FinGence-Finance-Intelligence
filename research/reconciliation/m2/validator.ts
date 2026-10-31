import { equalDecimals, isDecimal, sumDecimals } from "../decimal";
import { isISODate } from "../validator";
import { REQUIRED_NEGATIVES, REQUIRED_RELATIONSHIPS, REQUIRED_UNMATCHED, FAMILY_ROWS } from "./annotations";
import { BLOCKS, PERIODS, SPLITS, TEMPLATES, VERSION } from "./schemas";
import { canonicalJSON, sha256, validSeed } from "./serialization";
import { featuresOf } from "./features";
import type { Benchmark, Family, Split, SplitInput, Transaction, Truth } from "./types";

const obj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 512 && !x.includes("\0");
const nullableText = (x: unknown) => x === null || text(x);
const keys = (x: object, allowed: readonly string[]) => Object.keys(x).length === allowed.length && Object.keys(x).every(k => allowed.includes(k));
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(text);
const sameIds = (a: readonly string[], b: readonly string[]) => canonicalJSON([...a].sort()) === canonicalJSON([...b].sort());
const pair = (b: string, l: string) => JSON.stringify([b, l]);
const positive = (v: unknown): v is string => isDecimal(v) && !v.startsWith("-") && !equalDecimals(v, "0");
const recordKeys = ["id", "role", "templateId", "systemId", "accountId", "sourceRowId", "sourceTransactionId", "provenance", "eligibility", "amount", "sourceAmount", "debit", "credit", "currency", "monetaryBasis", "direction", "transactionDate", "postingDate", "canonicalDate", "canonicalDateBasis", "description", "counterparty", "reference"];

export function recordErrors(value: unknown, split: Split): string[] {
  const errors: string[] = [], check = (ok: unknown, why: string) => { if (!ok) errors.push(why); };
  if (!obj(value)) return ["record shape"];
  check(keys(value, recordKeys), "record fields: missing field or forbidden feature/annotation");
  for (const k of ["id", "role", "templateId", "systemId", "accountId", "sourceRowId", "currency", "monetaryBasis", "direction", "canonicalDate", "canonicalDateBasis", "description"]) check(text(value[k]), "record text: " + k);
  for (const k of ["sourceTransactionId", "sourceAmount", "debit", "credit", "transactionDate", "postingDate", "counterparty", "reference"]) check(nullableText(value[k]), "nullable field: " + k);
  check(obj(value.provenance) && keys(value.provenance, ["file", "sheet", "row", "synthetic"]) && text(value.provenance.file) && nullableText(value.provenance.sheet) && Number.isSafeInteger(value.provenance.row) && Number(value.provenance.row) >= 1 && Number(value.provenance.row) <= 25 && value.provenance.synthetic === true, "source provenance");
  check(value.eligibility === "SYNTHETIC_RESEARCH_ELIGIBLE", "eligibility: synthetic research eligibility required; legacy VALID/WARNING is insufficient");
  check(positive(value.amount), "amount: positive exact decimal required");
  if (errors.length) return errors;
  const r = value as unknown as Transaction;
  const template = TEMPLATES.find(t => t.id === r.templateId);
  if (!template) return ["source: unknown template"];
  check(template.split === split && r.role === template.role && r.systemId === template.systemId && r.accountId === template.accountId, "source identity/split");
  check(r.monetaryBasis === template.basis, "monetary basis");
  check(["INFLOW", "OUTFLOW"].includes(r.direction), "direction");
  check(/^r-[a-f0-9]{24}$/.test(r.id) && r.sourceRowId === `${template.id}:${r.provenance.row}` && r.provenance.file === `${template.id}.synthetic` && r.provenance.sheet === (template.format === "XLSX_STYLE" ? "Statement" : null), "source lineage");
  check(r.sourceTransactionId === null || /^TX-[a-f0-9]{16}$/.test(r.sourceTransactionId), "source transaction identity");
  check(r.reference === null || /^REF-[A-F0-9]{16}$/.test(r.reference), "reference format/annotation contamination");
  check(![r.description, r.counterparty ?? ""].some(s => /\b(?:e|rel|c|r)-[a-f0-9]{24}\b/.test(s)), "private identity in feature text");
  check(["MYR", "USD"].includes(r.currency), "currency");
  for (const date of [r.transactionDate, r.postingDate, r.canonicalDate]) check(date === null || (isISODate(date) && date.startsWith(PERIODS[split] + "-")), "date/calendar/period");
  check(isISODate(r.canonicalDate) && r.canonicalDateBasis === template.dateBasis && r.canonicalDate === (template.dateBasis === "TRANSACTION_DATE" ? r.transactionDate : r.postingDate), "canonical date basis");
  for (const v of [r.sourceAmount, r.debit, r.credit]) check(v === null || isDecimal(v), "source monetary decimal");
  if (errors.length) return errors;
  if (["CASH_DEBIT_CREDIT", "EXPENSE_DEBIT_CREDIT"].includes(template.basis)) {
    const debitActive = template.basis === "CASH_DEBIT_CREDIT" ? r.direction === "INFLOW" : r.direction === "OUTFLOW";
    const active = debitActive ? r.debit : r.credit, inactive = debitActive ? r.credit : r.debit;
    check(r.sourceAmount === null && active !== null && equalDecimals(active, r.amount) && inactive === null, "debit/credit cash direction or null semantics");
  } else {
    const negative = template.basis === "SIGNED_CASH" ? r.direction === "OUTFLOW" : template.basis === "SIGNED_EXPENSE" && r.direction === "INFLOW";
    check(r.debit === null && r.credit === null && r.sourceAmount !== null && equalDecimals(r.sourceAmount, (negative ? "-" : "") + r.amount), "source signed amount/direction or null semantics");
  }
  return errors;
}

export function inputErrors(value: unknown): string[] {
  if (!obj(value) || !keys(value, ["version", "seed", "split", "period", "templates", "records"]) || !SPLITS.includes(value.split as Split) || !Array.isArray(value.templates) || !Array.isArray(value.records)) return ["input envelope: missing fields, unknown split or annotation injection"];
  const input = value as unknown as SplitInput;
  const errors: string[] = [], check = (ok: unknown, why: string) => { if (!ok) errors.push(why); };
  check(input.version === VERSION && validSeed(input.seed), "input version/seed");
  check(input.period === PERIODS[input.split], "split period");
  const expected = TEMPLATES.filter(t => t.split === input.split);
  check(canonicalJSON([...input.templates].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))) === canonicalJSON([...expected].sort((a, b) => a.id.localeCompare(b.id))), "template completeness or definition changed");
  check(input.records.length === expected.length * 25, "M2 version-specific split row count");
  for (const record of input.records) errors.push(...recordErrors(record, input.split));
  if (errors.length) return errors;
  check(new Set(input.records.map(r => r.id)).size === input.records.length, "duplicate record ID");
  check(new Set(input.records.map(r => r.sourceRowId)).size === input.records.length, "duplicate source row");
  const sourceIds = input.records.flatMap(r => r.sourceTransactionId === null ? [] : [r.sourceTransactionId]);
  check(new Set(sourceIds).size === sourceIds.length, "duplicate source transaction identity");
  for (const t of expected) check(input.records.filter(r => r.templateId === t.id).length === 25, "source template row coverage");
  for (const role of ["BANK", "LEDGER"]) check(input.records.filter(r => r.role === role).length === input.records.length / 2, "source role balance");
  return errors;
}

function truthShape(value: unknown): value is Truth {
  if (!obj(value) || !keys(value, ["version", "seed", "split", "relationships", "negatives", "unmatched", "ambiguous", "outcomes", "cases"])) return false;
  const array = (k: string, predicate: (x: Record<string, unknown>) => boolean) => Array.isArray(value[k]) && value[k].every((x: unknown) => obj(x) && predicate(x));
  return array("relationships", r => keys(r, ["id", "economicId", "family", "kind", "bankIds", "ledgerIds", "remainingAmount"]) && text(r.id) && text(r.economicId) && text(r.family) && ["PAIR", "GROUP", "PARTIAL"].includes(String(r.kind)) && strings(r.bankIds) && strings(r.ledgerIds) && (r.remainingAmount === null || isDecimal(r.remainingAmount)))
    && array("negatives", n => keys(n, ["bankId", "ledgerId", "reason"]) && text(n.bankId) && text(n.ledgerId) && ["AMOUNT", "CURRENCY", "COUNTERPARTY", "DISTINCT_EVENT"].includes(String(n.reason)))
    && array("unmatched", u => keys(u, ["recordId", "economicId", "family"]) && text(u.recordId) && text(u.economicId) && text(u.family))
    && array("ambiguous", a => keys(a, ["id", "family", "bankIds", "ledgerIds"]) && text(a.id) && text(a.family) && strings(a.bankIds) && strings(a.ledgerIds))
    && array("outcomes", o => keys(o, ["subjectId", "decision"]) && text(o.subjectId) && ["SUGGEST_PAIR", "ABSTAIN_AMBIGUOUS", "ABSTAIN_INSUFFICIENT", "UNRESOLVED_GROUP", "UNRESOLVED_UNMATCHED"].includes(String(o.decision)))
    && array("cases", c => keys(c, ["id", "family", "recordIds"]) && text(c.id) && text(c.family) && strings(c.recordIds));
}

function annotationErrors(input: SplitInput, truth: Truth): string[] {
  const errors: string[] = [], check = (ok: unknown, why: string) => { if (!ok) errors.push(why); };
  const records = new Map(input.records.map(r => [r.id, r]));
  const used = new Set<string>(), positiveEdges = new Set<string>();
  const lookup = (ids: string[], role: string) => {
    check(ids.length > 0 && new Set(ids).size === ids.length, "empty/duplicate annotation references");
    for (const id of ids) check(records.get(id)?.role === role, "annotation record missing or wrong role");
    return ids.flatMap(id => records.has(id) ? [records.get(id)!] : []);
  };
  check(truth.version === VERSION && truth.seed === input.seed && truth.split === input.split, "annotation envelope/split");
  check(new Set(truth.relationships.map(r => r.id)).size === truth.relationships.length, "duplicate relationship ID");
  check(new Set([...truth.relationships.map(r => r.economicId), ...truth.unmatched.map(u => u.economicId)]).size === truth.relationships.length + truth.unmatched.length, "duplicate economic event identity");
  for (const rel of truth.relationships) {
    const b = lookup(rel.bankIds, "BANK"), l = lookup(rel.ledgerIds, "LEDGER");
    for (const id of [...rel.bankIds, ...rel.ledgerIds]) { check(!used.has(id), "duplicate economic consumption"); used.add(id); }
    for (const bi of rel.bankIds) for (const li of rel.ledgerIds) positiveEdges.add(pair(bi, li));
    check(rel.kind === "PAIR" ? rel.bankIds.length === 1 && rel.ledgerIds.length === 1 : (rel.bankIds.length > 1 && rel.ledgerIds.length === 1) || (rel.bankIds.length === 1 && rel.ledgerIds.length > 1), "relationship cardinality");
    const all = [...b, ...l];
    check(new Set(all.map(r => r.currency)).size === 1, "relationship currency mismatch");
    check(new Set(all.map(r => r.direction)).size === 1, "relationship direction mismatch");
    const bank = sumDecimals(b.map(r => r.amount)), ledger = sumDecimals(l.map(r => r.amount));
    if (rel.kind === "PARTIAL") check(positive(rel.remainingAmount) && equalDecimals(sumDecimals([bank, rel.remainingAmount]), ledger), "partial payment/outstanding amount mismatch");
    else check(rel.remainingAmount === null && equalDecimals(bank, ledger), "relationship amount mismatch");
    const decisions = truth.outcomes.filter(o => o.subjectId === rel.id);
    check(decisions.length === 1 && (rel.kind === "PAIR" ? decisions[0]?.decision !== "UNRESOLVED_GROUP" : decisions[0]?.decision === "UNRESOLVED_GROUP"), "relationship operational outcome");
  }
  const negativeEdges = new Set<string>();
  for (const n of truth.negatives) {
    const b = lookup([n.bankId], "BANK")[0], l = lookup([n.ledgerId], "LEDGER")[0], edge = pair(n.bankId, n.ledgerId);
    check(!positiveEdges.has(edge), "contradictory positive/negative label"); check(!negativeEdges.has(edge), "duplicate negative label"); negativeEdges.add(edge);
    if (b && l) {
      if (n.reason === "AMOUNT") check(!equalDecimals(b.amount, l.amount), "false amount negative");
      if (n.reason === "CURRENCY") check(b.currency !== l.currency, "false currency negative");
      if (n.reason === "COUNTERPARTY") check(b.counterparty !== null && l.counterparty !== null && b.counterparty !== l.counterparty, "false counterparty negative");
    }
  }
  for (const u of truth.unmatched) {
    check(records.has(u.recordId) && !used.has(u.recordId), "unmatched reference/contradiction"); used.add(u.recordId);
    const outcomes = truth.outcomes.filter(o => o.subjectId === u.recordId);
    check(outcomes.length === 1 && outcomes[0].decision === "UNRESOLVED_UNMATCHED", "unmatched operational outcome");
  }
  check(used.size === records.size && [...records.keys()].every(id => used.has(id)), "missing economic disposition");
  const subjects = new Set([...truth.relationships.map(r => r.id), ...truth.unmatched.map(u => u.recordId)]);
  check(truth.outcomes.length === subjects.size && truth.outcomes.every(o => subjects.has(o.subjectId)), "unknown/duplicate operational outcome");
  const caseUsed = new Set<string>();
  check(new Set(truth.cases.map(c => c.id)).size === truth.cases.length, "duplicate case identity");
  check(truth.cases.length === BLOCKS.filter(b => b.split === input.split).length * Object.keys(FAMILY_ROWS).length
    && truth.cases.every(c => c.recordIds.length > 0 && Object.hasOwn(FAMILY_ROWS, c.family)), "scenario inventory");
  for (const c of truth.cases) for (const id of c.recordIds) { check(records.has(id) && !caseUsed.has(id), "case reference/duplicate"); caseUsed.add(id); }
  check(caseUsed.size === records.size, "missing scenario coverage");
  for (const u of truth.unmatched) check(truth.cases.some(c => c.family === u.family && c.recordIds.includes(u.recordId)), "unmatched scenario family");
  for (const block of BLOCKS.filter(b => b.split === input.split)) {
    const ids = (template: string, rows: readonly number[]) => rows.map(row => input.records.find(r => r.templateId === template && r.provenance.row === row)!.id);
    // Version-specific benchmark quality: B/C/D compete on identical non-description evidence.
    // This checks coverage, not whether any matching algorithm should approve a payment.
    const services = [block.bank, block.ledger].map(template => [2, 3, 4].map(row => input.records.find(r => r.templateId === template && r.provenance.row === row)!));
    check(new Set(services.flat().map(r => canonicalJSON([r.amount, r.currency, r.direction, r.transactionDate, r.postingDate, r.canonicalDate, r.counterparty]))).size === 1, "description-dependent candidate coverage");
    check(services.every(side => new Set(side.map(r => r.description)).size === 3), "distinct service description coverage");
    for (let n = 0; n < 3; n++) {
      const b = services[0][n], l = services[1][n];
      check((b.reference === null || l.reference === null || b.reference !== l.reference) && b.description !== l.description, "description-dependent pair reveals exact equality");
    }
    for (const expected of REQUIRED_RELATIONSHIPS) {
      const matches = truth.relationships.filter(r => sameIds(r.bankIds, ids(block.bank, expected.bank)) && sameIds(r.ledgerIds, ids(block.ledger, expected.ledger)));
      check(matches.length === 1 && matches[0].family === expected.family && matches[0].kind === expected.kind && matches[0].remainingAmount === expected.remaining, "required economic annotation missing/changed");
      if (matches.length === 1) check(truth.outcomes.some(o => o.subjectId === matches[0].id && o.decision === expected.decision), "required operational decision missing/changed");
    }
    for (const [b, l, reason] of REQUIRED_NEGATIVES) check(truth.negatives.some(n => n.bankId === ids(block.bank, [b])[0] && n.ledgerId === ids(block.ledger, [l])[0] && n.reason === reason), "required negative annotation missing/changed");
    for (const role of ["BANK", "LEDGER"] as const) for (const recordId of ids(role === "BANK" ? block.bank : block.ledger, REQUIRED_UNMATCHED[role])) check(truth.unmatched.some(u => u.recordId === recordId), "required unmatched annotation missing");
    for (const [family, [b, l]] of Object.entries(FAMILY_ROWS)) {
      const recordIds = [...ids(block.bank, b), ...ids(block.ledger, l)];
      const cases = truth.cases.filter(c => c.family === family && sameIds(c.recordIds, recordIds));
      check(cases.length === 1, "required scenario annotation missing/changed");
      if (["E", "F", "N", "O"].includes(family)) {
        check(truth.ambiguous.filter(a => a.id === cases[0]?.id && a.family === family && sameIds(a.bankIds, ids(block.bank, b)) && sameIds(a.ledgerIds, ids(block.ledger, l))).length === 1, "required ambiguity annotation missing/changed");
        const candidates = recordIds.map(id => records.get(id)!);
        check(new Set(candidates.map(r => canonicalJSON(featuresOf(r)))).size === 1 && candidates.every(r => r.sourceTransactionId === null), "ambiguous scenario reveals a tie-break feature");
      }
    }
  }
  check(truth.ambiguous.length === BLOCKS.filter(b => b.split === input.split).length * 4 && new Set(truth.ambiguous.map(a => a.id)).size === truth.ambiguous.length, "ambiguity completeness/duplicates");
  return errors;
}

/** Detect both identity reuse and copied identifying content, even after dates/IDs are changed. */
export function leakageErrors(inputs: readonly SplitInput[], annotations: readonly Truth[]): string[] {
  const errors: string[] = [], seen = new Map<string, Split>();
  const remember = (kind: string, value: string, split: Split) => {
    const key = kind + ":" + value, previous = seen.get(key);
    if (previous && previous !== split) errors.push(`cross-split ${kind} leakage`);
    seen.set(key, split);
  };
  const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, "");
  for (const input of inputs) {
    remember("period", input.period, input.split);
    for (const t of input.templates) remember("template", t.id, input.split);
    for (const r of input.records) {
      remember("record identity", r.id, input.split);
      remember("source row identity", r.sourceRowId, input.split);
      if (r.sourceTransactionId) remember("source transaction identity", r.sourceTransactionId, input.split);
      if (r.reference) remember("reference", normalize(r.reference), input.split);
      remember("identifying description", normalize(r.description), input.split);
      const content = { role: r.role, amount: sumDecimals([r.amount]), currency: r.currency, direction: r.direction, description: normalize(r.description), counterparty: r.counterparty === null ? null : normalize(r.counterparty) };
      remember("economic content", sha256(canonicalJSON(content)), input.split);
    }
  }
  for (const truth of annotations) {
    for (const r of truth.relationships) { remember("economic identity", r.economicId, truth.split); remember("relationship identity", r.id, truth.split); }
    for (const u of truth.unmatched) remember("economic identity", u.economicId, truth.split);
    for (const c of truth.cases) remember("case identity", c.id, truth.split);
  }
  return errors;
}

export function validateBenchmark(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [], result = () => ({ valid: errors.length === 0, errors });
  if (!obj(value) || !keys(value, ["version", "seed", "inputs", "annotations"]) || value.version !== VERSION || !validSeed(value.seed) || !Array.isArray(value.inputs) || !Array.isArray(value.annotations)) return { valid: false, errors: ["benchmark envelope/version"] };
  for (const input of value.inputs) errors.push(...inputErrors(input));
  if (!value.annotations.every(truthShape)) errors.push("malformed truth");
  if (errors.length) return result();
  const b = value as unknown as Benchmark;
  if (b.inputs.length !== 3 || !SPLITS.every(s => b.inputs.filter(i => i.split === s).length === 1) || b.annotations.length !== 3 || !SPLITS.every(s => b.annotations.filter(t => t.split === s).length === 1)) return { valid: false, errors: ["split completeness"] };
  for (const input of b.inputs) {
    if (input.seed !== b.seed) errors.push("benchmark seed mismatch");
    errors.push(...annotationErrors(input, b.annotations.find(t => t.split === input.split)!));
  }
  errors.push(...leakageErrors(b.inputs, b.annotations));
  return result();
}
export function assertBenchmark(value: unknown): asserts value is Benchmark {
  const r = validateBenchmark(value); if (!r.valid) throw new Error(r.errors.join("\n"));
}
export function statistics(b: Benchmark) {
  return b.inputs.map(i => { const t = b.annotations.find(t => t.split === i.split)!; return {
    split: i.split, templates: i.templates.length, rows: i.records.length, bank: i.records.filter(r => r.role === "BANK").length, ledger: i.records.filter(r => r.role === "LEDGER").length,
    pairs: t.relationships.filter(r => r.kind === "PAIR").length, groups: t.relationships.filter(r => r.kind === "GROUP").length,
    partials: t.relationships.filter(r => r.kind === "PARTIAL").length, negatives: t.negatives.length, unmatched: t.unmatched.length, ambiguous: t.ambiguous.length,
    suggested: t.outcomes.filter(o => o.decision === "SUGGEST_PAIR").length,
    families: Object.fromEntries(Object.keys(FAMILY_ROWS).map(f => [f, t.cases.filter(c => c.family === f as Family).reduce((n, c) => n + c.recordIds.length, 0)])),
  }; });
}
