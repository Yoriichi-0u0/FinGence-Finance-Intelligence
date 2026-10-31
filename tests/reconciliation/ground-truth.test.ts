import { describe, expect, it } from "vitest";
import { generateDataset } from "../../research/reconciliation/generator";
import { defineGroundTruth } from "../../research/reconciliation/ground-truth";
import { equalDecimals, sumDecimals } from "../../research/reconciliation/decimal";
import { validateDataset } from "../../research/reconciliation/validator";
import { pilotAnnotationErrors } from "../../research/reconciliation/pilot-annotations";

describe("AI01 authored ground truth", () => {
  it("rejects deletion of every required pilot negative", () => {
    const d = generateDataset(); d.groundTruth.nonmatches = [];
    expect(validateDataset(d).valid).toBe(false);
  });
  it.each([0, 1, 2, 3, 4])("rejects omission of required pilot negative %i", index => {
    const d = generateDataset(); d.groundTruth.nonmatches.splice(index, 1);
    expect(validateDataset(d).valid).toBe(false);
  });
  it("rejects a changed required reason even if its generic label is otherwise valid", () => {
    const d = generateDataset(); d.groundTruth.nonmatches.find(n => n.reason === "AMOUNT")!.reason = "DISTINCT_EVENT";
    expect(validateDataset(d).valid).toBe(false);
  });
  it("does not impose an exact global negative count", () => {
    const d = generateDataset(), c = d.groundTruth.cases.find(c => c.family === "H")!;
    d.groundTruth.nonmatches.push({ bankId: c.recordIds.find(id => d.records.find(r => r.id === id)?.role === "BANK")!,
      ledgerId: c.recordIds.find(id => d.records.find(r => r.id === id)?.role === "LEDGER")!, reason: "DISTINCT_EVENT" });
    expect(d.groundTruth.nonmatches).toHaveLength(6);
    expect(validateDataset(d).valid).toBe(true);
  });
  it("rejects replacement of a required edge while retaining the same negative count", () => {
    const d = generateDataset(), c = d.groundTruth.cases.find(c => c.family === "H")!;
    d.groundTruth.nonmatches[0] = { bankId: c.recordIds.find(id => d.records.find(r => r.id === id)?.role === "BANK")!,
      ledgerId: c.recordIds.find(id => d.records.find(r => r.id === id)?.role === "LEDGER")!, reason: "DISTINCT_EVENT" };
    expect(d.groundTruth.nonmatches).toHaveLength(5);
    expect(validateDataset(d).errors.some(e => e.startsWith("Missing required pilot negative:"))).toBe(true);
  });
  it("scopes the annotation profile to its pilot revision without accepting unsupported datasets", () => {
    const d = generateDataset(); d.generatorVersion = "future-dataset/2.0.0"; d.groundTruth.nonmatches = [];
    expect(pilotAnnotationErrors(d)).toEqual([]);
    expect(validateDataset(d).errors).toContain("Unsupported generator version");
  });
  it("rejects positive/negative contradiction and duplicate labels", () => {
    const d = generateDataset(), rel = d.groundTruth.relationships[0];
    d.groundTruth.nonmatches.push({ bankId: rel.bankIds[0], ledgerId: rel.ledgerIds[0], reason: "DISTINCT_EVENT" });
    expect(validateDataset(d).errors).toContain("Contradictory positive/negative label");
    d.groundTruth.nonmatches.pop(); d.groundTruth.nonmatches.push(structuredClone(d.groundTruth.nonmatches[0]));
    expect(validateDataset(d).errors).toContain("Duplicate negative label");
  });
  it.each(["fingence-ai01-pilot-001", "alternate-ambiguity", "种子"])("keeps recurring candidates equal on permitted evidence for seed %s", seed => {
    const d = generateDataset({ seed }), c = d.groundTruth.cases.find(c => c.family === "D")!;
    const records = c.recordIds.map(id => d.records.find(r => r.id === id)!);
    const evidence = records.map(r => ({ amount: r.amount, currency: r.currency, direction: r.direction,
      transactionDate: r.transactionDate, postingDate: r.postingDate, canonicalDate: r.canonicalDate,
      description: r.description, counterparty: r.counterparty, reference: r.reference }));
    expect(new Set(evidence.map(e => JSON.stringify(e))).size).toBe(1);
    expect(records.every(r => r.sourceTransactionId === null)).toBe(true);
    expect(new Set(records.map(r => r.id)).size).toBe(4);
  });
  it("covers every record exactly once economically, independently of operational ambiguity", () => {
    const d = generateDataset(), g = d.groundTruth;
    const ids = [...g.relationships.flatMap(r => [...r.bankIds, ...r.ledgerIds]), ...g.unmatchedIds];
    expect(ids).toHaveLength(40); expect(new Set(ids).size).toBe(40);
    expect([...ids].sort()).toEqual(d.records.map(r => r.id).sort());
    expect(g.relationships.filter(r => r.kind === "ONE_TO_ONE")).toHaveLength(14);
    expect(g.outcomes.filter(o => o.decision === "SUGGEST_PAIR")).toHaveLength(10);
  });
  it("keeps latent true relationships while abstaining on recurring and duplicate candidates", () => {
    const d = generateDataset();
    const ambiguous = d.groundTruth.relationships.filter(r => ["D", "I"].includes(r.family));
    expect(ambiguous).toHaveLength(3);
    for (const r of ambiguous) expect(d.groundTruth.outcomes.find(o => o.relationshipId === r.id)?.decision).toBe("ABSTAIN_AMBIGUOUS");
    const duplicate = d.groundTruth.ambiguousCases.find(a => a.ledgerIds.length === 2 && a.bankIds.length === 1)!;
    const candidates = duplicate.ledgerIds.map(id => d.records.find(r => r.id === id)!);
    expect(candidates[0].amount).toBe(candidates[1].amount);
    expect(candidates[0].description).toBe(candidates[1].description);
    expect(candidates[0].id).not.toBe(candidates[1].id);
  });
  it("has explicit financial negatives and does not label the full Cartesian product", () => {
    const d = generateDataset(), g = d.groundTruth;
    expect(g.nonmatches.filter(p => p.reason === "AMOUNT")).toHaveLength(1);
    expect(g.nonmatches.filter(p => p.reason === "CURRENCY")).toHaveLength(1);
    expect(g.nonmatches.filter(p => p.reason === "DISTINCT_EVENT")).toHaveLength(3);
    expect(g.nonmatches.length).toBeLessThan(20 * 20 - 14);
    for (const p of g.nonmatches) expect(g.relationships.some(r => r.bankIds.includes(p.bankId) && r.ledgerIds.includes(p.ledgerId))).toBe(false);
  });
  it("models a two-bank to one-ledger economic group without pair suggestions", () => {
    const d = generateDataset(), group = d.groundTruth.relationships.find(r => r.kind === "GROUP")!;
    expect(group.bankIds).toHaveLength(2); expect(group.ledgerIds).toHaveLength(1);
    const amount = (id: string) => d.records.find(r => r.id === id)!.amount;
    expect(equalDecimals(sumDecimals(group.bankIds.map(amount)), amount(group.ledgerIds[0]))).toBe(true);
    expect(d.groundTruth.outcomes.find(o => o.relationshipId === group.id)?.decision).toBe("UNRESOLVED_GROUP");
    expect(d.groundTruth.relationships.filter(r => r.kind === "ONE_TO_ONE").some(r => r.bankIds.some(id => group.bankIds.includes(id)))).toBe(false);
  });
  it("keeps missing references null and does not confuse known economics with safe evidence", () => {
    const d = generateDataset(), rel = d.groundTruth.relationships.find(r => r.family === "G")!;
    for (const id of [...rel.bankIds, ...rel.ledgerIds]) expect(d.records.find(r => r.id === id)?.reference).toBeNull();
    expect(d.groundTruth.outcomes.find(o => o.relationshipId === rel.id)?.decision).toBe("ABSTAIN_INSUFFICIENT");
  });
  it("cannot create labels for missing authored identities", () => { expect(() => defineGroundTruth({})).toThrow("Missing authored record"); });
});
