import { describe, expect, it } from "vitest";
import { generateBenchmark } from "../../research/reconciliation/m2/generator";
import { validateBenchmark, leakageErrors } from "../../research/reconciliation/m2/validator";
import type { Benchmark } from "../../research/reconciliation/m2/types";

describe("M2 independent validation", () => {
  const mutations: [string, (b: Benchmark) => void][] = [
    ["missing schema", b => { b.inputs[0].templates.pop(); }],
    ["copied schema mapping", b => { b.inputs[0].templates[0].fields = { ...b.inputs[0].templates[1].fields }; }],
    ["missing row", b => { b.inputs[0].records.pop(); }],
    ["duplicate identity", b => { b.inputs[0].records[1].id = b.inputs[0].records[0].id; }],
    ["wrong role", b => { b.inputs[0].records[0].role = "BANK" === b.inputs[0].records[0].role ? "LEDGER" : "BANK"; }],
    ["unknown source", b => { b.inputs[0].records[0].templateId = "unknown"; }],
    ["source lineage", b => { b.inputs[0].records[0].sourceRowId = "unknown"; }],
    ["account", b => { b.inputs[0].records[0].accountId = "other"; }],
    ["provenance", b => { b.inputs[0].records[0].provenance.row = 0; }],
    ["floating-point amount", b => { b.inputs[0].records[0].amount = 0.1 as never; }],
    ["null amount", b => { b.inputs[0].records[0].amount = null as never; }],
    ["exponent amount", b => { b.inputs[0].records[0].amount = "1e3"; }],
    ["invented zero", b => { b.inputs[0].records[0].amount = "0"; }],
    ["invalid currency", b => { b.inputs[0].records[0].currency = "???"; }],
    ["undefined optional", b => { b.inputs[0].records[0].reference = undefined as never; }],
    ["bad calendar", b => { b.inputs[0].records[0].transactionDate = "2024-02-30"; }],
    ["date basis", b => { b.inputs[0].records[0].canonicalDateBasis = "UNKNOWN" as never; }],
    ["outside period", b => { b.inputs[0].records[0].canonicalDate = "2026-07-17"; }],
    ["monetary basis", b => { b.inputs[0].records[0].monetaryBasis = "UNKNOWN" as never; }],
    ["wrong sign", b => { b.inputs[0].records.find(r => r.monetaryBasis === "SIGNED_CASH")!.sourceAmount = "1"; }],
    ["swapped ledger sides", b => { const r = b.inputs[0].records.find(r => r.monetaryBasis === "EXPENSE_DEBIT_CREDIT")!; [r.debit, r.credit] = [r.credit, r.debit]; }],
    ["inactive zero", b => { const r = b.inputs[0].records.find(r => r.monetaryBasis === "CASH_DEBIT_CREDIT")!; if (r.debit === null) r.debit = "0"; else r.credit = "0"; }],
    ["legacy approval", b => { b.inputs[0].records[0].eligibility = "VALID" as never; }],
    ["extra answer feature", b => { Object.assign(b.inputs[0].records[0], { economicId: "answer" }); }],
    ["all negatives removed", b => { b.annotations[0].negatives = []; }],
    ["relationship omitted", b => { b.annotations[0].relationships.pop(); }],
    ["unmatched omitted", b => { b.annotations[0].unmatched.pop(); }],
    ["scenario omitted", b => { b.annotations[0].cases.pop(); }],
    ["extra empty scenario", b => { b.annotations[0].cases.push({ id: "extra", family: "A", recordIds: [] }); }],
    ["wrong unmatched family", b => { b.annotations[0].unmatched[0].family = "A"; }],
    ["ambiguity omitted", b => { b.annotations[0].ambiguous.pop(); }],
    ["outcome omitted", b => { b.annotations[0].outcomes.pop(); }],
    ["duplicate consumption", b => { b.annotations[0].relationships[1].bankIds = [...b.annotations[0].relationships[0].bankIds]; }],
    ["unknown label record", b => { b.annotations[0].relationships[0].bankIds[0] = "missing"; }],
    ["positive negative contradiction", b => { const r = b.annotations[0].relationships[0]; b.annotations[0].negatives.push({ bankId: r.bankIds[0], ledgerId: r.ledgerIds[0], reason: "DISTINCT_EVENT" }); }],
    ["duplicate negative", b => { b.annotations[0].negatives.push({ ...b.annotations[0].negatives[0] }); }],
    ["changed required reason", b => { b.annotations[0].negatives.find(n => n.reason === "AMOUNT")!.reason = "DISTINCT_EVENT"; }],
    ["unmatched contradiction", b => { b.annotations[0].unmatched[0].recordId = b.annotations[0].relationships[0].bankIds[0]; }],
    ["forced ambiguity", b => { b.annotations[0].outcomes.find(o => o.decision === "ABSTAIN_AMBIGUOUS")!.decision = "SUGGEST_PAIR"; }],
    ["group forced pair", b => { b.annotations[0].relationships.find(r => r.kind === "GROUP")!.kind = "PAIR"; }],
    ["partial hidden as complete", b => { b.annotations[0].relationships.find(r => r.kind === "PARTIAL")!.kind = "GROUP"; }],
    ["wrong outstanding balance", b => { b.annotations[0].relationships.find(r => r.kind === "PARTIAL")!.remainingAmount = "24.99"; }],
    ["unknown outcome", b => { b.annotations[0].outcomes[0].subjectId = "unknown"; }],
    ["duplicate economic identity", b => { b.annotations[0].relationships[1].economicId = b.annotations[0].relationships[0].economicId; }],
    ["true pair currency mismatch", b => { const id = b.annotations[0].relationships[0].ledgerIds[0]; b.inputs[0].records.find(r => r.id === id)!.currency = "USD"; }],
    ["recurring answer reference", b => { const id = b.annotations[0].ambiguous[0].bankIds[0]; b.inputs[0].records.find(r => r.id === id)!.reference = "ANSWER"; }],
    ["seed envelope mismatch", b => { b.inputs[0].seed = "other"; }],
    ["missing split", b => { b.inputs.pop(); }],
    ["duplicate split", b => { b.inputs[1] = structuredClone(b.inputs[0]); }],
  ];
  it.each(mutations)("rejects %s without repair", (_, mutate) => {
    const b = generateBenchmark(); mutate(b); const before = structuredClone(b);
    expect(validateBenchmark(b).valid).toBe(false); expect(b).toEqual(before);
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7])("requires negative edge %i", index => {
    const b = generateBenchmark(); b.annotations[0].negatives.splice(index, 1);
    expect(validateBenchmark(b).errors).toContain("required negative annotation missing/changed");
  });
  it("allows consistent extra annotations", () => {
    const b = generateBenchmark(), t = b.annotations[1], input = b.inputs[1];
    const bank = t.unmatched.find(u => input.records.find(r => r.id === u.recordId)?.role === "BANK")!.recordId;
    const ledger = t.unmatched.find(u => input.records.find(r => r.id === u.recordId)?.role === "LEDGER")!.recordId;
    t.negatives.push({ bankId: bank, ledgerId: ledger, reason: "DISTINCT_EVENT" });
    expect(validateBenchmark(b).valid).toBe(true);
  });
  it.each([null, {}, [], { version: "bad" }])("rejects malformed envelope %j", value => { expect(validateBenchmark(value).valid).toBe(false); });
  it("rejects malformed nested truth", () => {
    const b = generateBenchmark(); b.annotations[0].relationships[0] = null as never;
    expect(validateBenchmark(b).valid).toBe(false);
  });
  it.each(["template", "record", "reference", "description", "economic", "period"])("detects cross-split %s leakage", kind => {
    const b = generateBenchmark(), source = b.inputs[0], target = b.inputs[2];
    if (kind === "template") target.templates[0] = structuredClone(source.templates[0]);
    if (kind === "record") target.records[0].id = source.records[0].id;
    if (kind === "reference") target.records[0].reference = source.records.find(r => r.reference)!.reference;
    if (kind === "description") target.records[0].description = source.records[0].description.toUpperCase() + "  ";
    if (kind === "economic") b.annotations[2].relationships[0].economicId = b.annotations[0].relationships[0].economicId;
    if (kind === "period") target.period = source.period;
    expect(leakageErrors(b.inputs, b.annotations).some(e => e.startsWith("cross-split"))).toBe(true);
    expect(validateBenchmark(b).valid).toBe(false);
  });
  it("detects copied economic content with fresh IDs and shifted dates", () => {
    const b = generateBenchmark(), source = b.inputs[0].records[0], target = b.inputs[2].records.find(r => r.role === source.role)!;
    for (const k of ["amount", "currency", "direction", "description", "counterparty"] as const) Object.assign(target, { [k]: source[k] });
    expect(target.id).not.toBe(source.id); expect(target.canonicalDate).not.toBe(source.canonicalDate);
    expect(leakageErrors(b.inputs, b.annotations)).toContain("cross-split economic content leakage");
  });
});
