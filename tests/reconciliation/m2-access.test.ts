import { describe, expect, it } from "vitest";
import { generateBenchmark } from "../../research/reconciliation/m2/generator";
import { developmentCandidates, heldoutCandidates, heldoutAnnotations } from "../../research/reconciliation/m2/access";
import { featuresOf } from "../../research/reconciliation/m2/features";
import { canonicalJSON } from "../../research/reconciliation/m2/serialization";

describe("M2 candidate/evaluator boundaries", () => {
  it("development rejects held-out input and relabelled held-out templates", () => {
    const b = generateBenchmark();
    expect(developmentCandidates(b.inputs[0]).candidates).toHaveLength(150);
    expect(developmentCandidates(b.inputs[1]).candidates).toHaveLength(50);
    expect(() => developmentCandidates(b.inputs[2])).toThrow("purpose");
    const disguised = structuredClone(b.inputs[2]); disguised.split = "train";
    expect(() => developmentCandidates(disguised)).toThrow();
    expect(() => heldoutCandidates(b.inputs[0])).toThrow("purpose");
  });
  it("returns only whitelisted features, with opaque addressing outside the feature vector", () => {
    const b = generateBenchmark();
    for (const i of b.inputs) {
      const p = i.split === "heldout" ? heldoutCandidates(i) : developmentCandidates(i);
      expect(Object.keys(p).sort()).toEqual(["candidates", "split", "version"]);
      for (const c of p.candidates) {
        expect(Object.keys(c).sort()).toEqual(["candidateId", "features", "role"]);
        expect(Object.keys(c.features).sort()).toEqual(["amount", "canonicalDate", "counterparty", "currency", "description", "direction", "postingDate", "reference", "transactionDate"]);
        const text = canonicalJSON(c.features);
        for (const truth of b.annotations) for (const rel of truth.relationships) {
          expect(text).not.toContain(rel.economicId); expect(text).not.toContain(rel.id);
        }
        expect(text).not.toContain(c.candidateId);
      }
      expect(Object.isFrozen(p.candidates[0].features)).toBe(true);
    }
  });
  it.each(["groundTruth", "annotations", "economicId", "expectedDecision", "family"])("rejects %s injection into model input", key => {
    const b = generateBenchmark();
    expect(() => developmentCandidates({ ...b.inputs[0], [key]: b.annotations[2] })).toThrow();
    Object.assign(b.inputs[0].records[0], { [key]: b.annotations[2] });
    expect(() => developmentCandidates(b.inputs[0])).toThrow();
  });
  it("does not accidentally accept a complete benchmark as candidate input", () => {
    expect(() => developmentCandidates(generateBenchmark())).toThrow();
  });
  it("rejects held-out annotation JSON or private identities copied into feature text", () => {
    const b = generateBenchmark(), input = structuredClone(b.inputs[0]);
    input.records[0].description = JSON.stringify(b.annotations[2]);
    expect(() => developmentCandidates(input)).toThrow();
    input.records[0].description = "Payment " + b.annotations[2].relationships[0].economicId;
    expect(() => developmentCandidates(input)).toThrow("private identity");
    input.records[0].description = b.inputs[0].records[0].description;
    input.records[0].reference = b.annotations[2].relationships[0].id;
    expect(() => developmentCandidates(input)).toThrow("reference format");
  });
  it("keeps held-out annotations in an explicit read-only evaluator view", () => {
    const b = generateBenchmark(), labels = heldoutAnnotations(b);
    expect(labels.split).toBe("heldout"); expect(labels.relationships).toHaveLength(36);
    expect(Object.isFrozen(labels.relationships[0].bankIds)).toBe(true);
    expect(() => { labels.relationships[0].bankIds.push("tampered"); }).toThrow();
    expect(b.annotations[2].relationships[0].bankIds).not.toContain("tampered");
  });
  it.each(["fingence-ai01-m2-frozen-001", "other"])("keeps ambiguity unresolved on all permitted features for %s", seed => {
    const b = generateBenchmark(seed);
    for (const t of b.annotations) {
      const rows = b.inputs.find(i => i.split === t.split)!.records;
      for (const a of t.ambiguous) {
        const candidates = [...a.bankIds, ...a.ledgerIds].map(id => rows.find(r => r.id === id)!);
        expect(new Set(candidates.map(r => canonicalJSON(featuresOf(r)))).size).toBe(1);
        expect(candidates.every(r => r.sourceTransactionId === null)).toBe(true);
        expect(new Set(candidates.map(r => r.id)).size).toBe(candidates.length);
      }
    }
  });
});
