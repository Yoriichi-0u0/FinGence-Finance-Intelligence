import { describe, expect, it } from "vitest";
import { runBaseline } from "../../research/reconciliation/ai02/run";
import { normalizeText, normalizeReference, similarity } from "../../research/reconciliation/ai02/scoring";
import { config, row, input } from "./ai02-fixtures";
describe("AI02 E1 lexical scores", () => {
  it("normalizes Unicode, case, punctuation and references without translation", () => {
    expect(normalizeText("  ＲＥＰＡＩＲ—servis  ")).toBe("repair servis"); expect(normalizeReference(" INV - 123 ")).toBe("inv123");
    expect(similarity("Equipment repair", "equipment repair")).toBe(1); expect(similarity(null, null)).toBe(0);
  });
  it("provides explainable formatted-reference evidence", () => {
    const r = runBaseline(input(row("b", "BANK"), row("l", "LEDGER", { reference: "inv 123" })), "E1", config);
    expect(r.suggestions).toHaveLength(1); expect(r.candidates[0].evidence.reference).toBe(1);
  });
  it("compares missing-reference text rather than dropping the pair", () => {
    const r = runBaseline(input(row("b", "BANK", { reference: null }), row("l", "LEDGER", { reference: null, description: "equipment repair service" })), "E1", config);
    expect(r.candidates).toHaveLength(1); expect(r.candidates[0].evidence.reference).toBeNull(); expect(r.candidates[0].score).toBeGreaterThan(0);
  });
  it("reports insufficient score and does not promise multilingual superiority", () => {
    const r = runBaseline(input(row("b", "BANK", { reference: null, counterparty: null }), row("l", "LEDGER", { reference: null, counterparty: null, description: "Bayaran bekalan" })), "E1", { ...config, threshold: .99 });
    expect(r.suggestions).toHaveLength(0); expect(r.outcomes.every(o => o.reason === "INSUFFICIENT_SUPPORT")).toBe(true);
  });
  it.each([["a", "a"], ["repair", "repairs"], ["bayaran", "payment"], ["é", "é"]])("has symmetric bounded similarity %s/%s", (a, b) => {
    expect(similarity(a,b)).toBe(similarity(b,a)); expect(similarity(a,b)).toBeGreaterThanOrEqual(0); expect(similarity(a,b)).toBeLessThanOrEqual(1);
  });
});
