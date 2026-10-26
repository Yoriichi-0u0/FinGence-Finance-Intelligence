import { describe, expect, it } from "vitest";
import { verifySemanticBlueprint } from "../../lib/ai-ingestion/increment-02/verify";
import { prepareRequest, materializePlan, planSchema } from "../../lib/ai-ingestion/increment-03/plan";

import { bankEvidence, proposedPlan } from "./helpers";
describe("Evidence-only materialization", () => {
  it("never sends filenames/ground truth and materializes exact fresh source values", async () => {
    const evidence = await bankEvidence(), before = structuredClone(evidence), plan = proposedPlan(evidence);
    const request = prepareRequest(evidence);
    expect(JSON.stringify(request)).not.toMatch(/do-not-leak|ground-truth|expectedAccepted|precision\.csv/);
    const p = materializePlan(evidence, plan);
    const r = verifySemanticBlueprint(evidence, p, "LIVE_GROQ");
    expect(r.proposalOrigin).toBe("LIVE_GROQ"); expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].financial).toMatchObject({ source_amount: "9007199254740993.01", source_transaction_id: "00000001234", reference: "000001", transaction_date: "2026-10-19", posting_date: "2026-10-20", canonical_date: "2026-10-19" });
    expect(evidence).toEqual(before);
  });
  it("rejects invented values, unknown/duplicate/missing header references and wrong policy", async () => {
    const b = await bankEvidence(); const p = proposedPlan(b);
    expect(planSchema.safeParse({ ...p, records: [{ amount: "999" }] }).success).toBe(false);
    for (const mutate of [
      (x: typeof p) => { x.fields[0].headerId = "fabricated"; },
      (x: typeof p) => { x.fields[1].headerId = x.fields[0].headerId; },
      (x: typeof p) => { x.fields.pop(); },
      (x: typeof p) => { x.policyHash = "0".repeat(64); },
    ]) { const x = structuredClone(p); mutate(x); expect(() => materializePlan(b, x)).toThrow(); }
  });
  it("does not repair semantically wrong model decisions", async () => {
    const b = await bankEvidence(), p = proposedPlan(b); p.fields[0].ruleId = "money.amount";
    const r = verifySemanticBlueprint(b, materializePlan(b, p), "LIVE_GROQ");
    expect(r.accepted).toHaveLength(0); expect(r.checks.some(c => !c.passed && c.code.startsWith("FIELD_POLICY"))).toBe(true);
  });
  it("holds missing conventions rather than guessing", async () => {
    const b = await bankEvidence(); expect(() => materializePlan(b, { ...proposedPlan(b), conventions: null })).toThrow(/CONVENTIONS/);
  });
});
