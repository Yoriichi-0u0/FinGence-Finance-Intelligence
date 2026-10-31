import { describe, expect, it, vi } from "vitest";
import { generateBenchmark, eligibilityExamples } from "../../research/reconciliation/m2/generator";
import { canonicalJSON, sha256 } from "../../research/reconciliation/m2/serialization";
import { assertBenchmark, statistics, recordErrors } from "../../research/reconciliation/m2/validator";
import { TEMPLATES } from "../../research/reconciliation/m2/schemas";
import { SOURCE_TEMPLATES } from "../../research/reconciliation/schemas";
import { equalDecimals, sumDecimals } from "../../research/reconciliation/decimal";

describe("M2 authored benchmark", () => {
  it("has 12 meaningful templates and independently specified 150/50/100 counts", () => {
    const b = generateBenchmark(); assertBenchmark(b);
    expect(statistics(b).map(({ split, templates, rows, bank, ledger, pairs, groups, partials, negatives, unmatched, ambiguous, suggested }) =>
      ({ split, templates, rows, bank, ledger, pairs, groups, partials, negatives, unmatched, ambiguous, suggested }))).toEqual([
      { split: "train", templates: 6, rows: 150, bank: 75, ledger: 75, pairs: 48, groups: 3, partials: 3, negatives: 42, unmatched: 36, ambiguous: 12, suggested: 30 },
      { split: "development", templates: 2, rows: 50, bank: 25, ledger: 25, pairs: 16, groups: 1, partials: 1, negatives: 14, unmatched: 12, ambiguous: 4, suggested: 10 },
      { split: "heldout", templates: 4, rows: 100, bank: 50, ledger: 50, pairs: 32, groups: 2, partials: 2, negatives: 28, unmatched: 24, ambiguous: 8, suggested: 20 },
    ]);
    expect(TEMPLATES).toHaveLength(12);
    expect(new Set(TEMPLATES.map(t => canonicalJSON({ basis: t.basis, date: t.dateBasis, format: t.format, sourceDate: t.sourceDateFormat, fields: t.fields }))).size).toBe(12);
    expect(TEMPLATES.some(t => SOURCE_TEMPLATES.some(m1 => m1.id === t.id))).toBe(false);
    for (const i of b.inputs) for (const t of i.templates) expect(i.records.filter(r => r.templateId === t.id)).toHaveLength(25);
  });
  it.each(["fingence-ai01-m2-frozen-001", "alternate-seed", "种子", "0"])("is reproducible and valid for %s", seed => {
    const a = generateBenchmark(seed), b = generateBenchmark(seed); assertBenchmark(a);
    expect(canonicalJSON(a)).toBe(canonicalJSON(b)); expect(sha256(canonicalJSON(a))).toBe(sha256(canonicalJSON(b)));
    for (const i of a.inputs) expect(i.records.map(r => r.id)).toEqual(i.records.map(r => r.id).sort());
  });
  it("changes values/identities across seeds without changing structural invariants", () => {
    const a = generateBenchmark("a"), b = generateBenchmark("b");
    expect(sha256(canonicalJSON(a))).not.toBe(sha256(canonicalJSON(b))); expect(statistics(a)).toEqual(statistics(b));
  });
  it("has no clock or uncontrolled randomness dependency", () => {
    const expected = canonicalJSON(generateBenchmark());
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Clock"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Random"); });
    try { expect(canonicalJSON(generateBenchmark())).toBe(expected); } finally { now.mockRestore(); random.mockRestore(); }
  });
  it.each(["", "x".repeat(129), "bad\nseed", null, 42])("rejects invalid seed %j", seed => {
    expect(() => generateBenchmark(seed as never)).toThrow("seed");
  });
  it("includes A–U and keeps the eight V rejection examples outside 300 eligible rows", () => {
    const b = generateBenchmark();
    for (const t of b.annotations) expect([...new Set(t.cases.map(c => c.family))].sort().join("")).toBe("ABCDEFGHIJKLMNOPQRSTU");
    expect(b.inputs.flatMap(i => i.records)).toHaveLength(300);
    const examples = eligibilityExamples(b); expect(examples).toHaveLength(8);
    for (const e of examples) expect(recordErrors(e.input, "train").some(error => error.includes(e.reason))).toBe(true);
  });
  it("retains multilingual text and identical-description hard negatives", () => {
    const b = generateBenchmark();
    for (const t of b.annotations) {
      const records = b.inputs.find(i => i.split === t.split)!.records;
      expect(records.some(r => r.description.includes("Bayaran bekalan"))).toBe(true);
      expect(records.some(r => r.description.includes("Payment for supplies"))).toBe(true);
      for (const n of t.negatives.filter(n => n.reason !== "DISTINCT_EVENT")) {
        const bank = records.find(r => r.id === n.bankId)!, ledger = records.find(r => r.id === n.ledgerId)!;
        expect(bank.description).toBe(ledger.description);
        if (n.reason === "AMOUNT") expect(equalDecimals(bank.amount, ledger.amount)).toBe(false);
        if (n.reason === "CURRENCY") expect(bank.currency).not.toBe(ledger.currency);
        if (n.reason === "COUNTERPARTY") expect(bank.counterparty).not.toBe(ledger.counterparty);
      }
    }
  });
  it("preserves exact money, nulls, refunds and unresolved partial/group economics", () => {
    const b = generateBenchmark(), records = b.inputs.flatMap(i => i.records);
    expect(records.filter(r => r.amount === "9007199254740993.123456789")).toHaveLength(12);
    expect(records.some(r => r.transactionDate === null)).toBe(true); expect(records.some(r => r.postingDate === null)).toBe(true);
    expect(records.some(r => r.counterparty === null && r.sourceTransactionId === null)).toBe(true);
    for (const truth of b.annotations) for (const rel of truth.relationships.filter(r => r.kind !== "PAIR")) {
      const amount = (id: string) => records.find(r => r.id === id)!.amount;
      const paid = sumDecimals(rel.bankIds.map(amount)), total = sumDecimals(rel.ledgerIds.map(amount));
      expect(truth.outcomes.find(o => o.subjectId === rel.id)?.decision).toBe("UNRESOLVED_GROUP");
      expect(equalDecimals(sumDecimals([paid, rel.remainingAmount ?? "0"]), total)).toBe(true);
      if (rel.kind === "PARTIAL") { expect(rel.remainingAmount).toBe("25.00"); expect(equalDecimals(paid, total)).toBe(false); }
    }
    for (const truth of b.annotations) for (const c of truth.cases.filter(c => c.family === "R"))
      expect(new Set(c.recordIds.map(id => records.find(r => r.id === id)!.direction))).toEqual(new Set(["INFLOW", "OUTFLOW"]));
  });
});
