import { describe, expect, it } from "vitest";
import { runBaseline } from "../../research/reconciliation/ai02/run";
import { EXACT_CONFIG } from "../../research/reconciliation/ai02/types";
import { row, input } from "./ai02-fixtures";
describe("AI02 E0 exact evidence", () => {
  it("suggests exact references despite different descriptions", () => {
    const r = runBaseline(input(row("b", "BANK"), row("l", "LEDGER", { description: "Baik pulih peralatan" })), "E0", EXACT_CONFIG);
    expect(r.suggestions).toEqual([{ bankId: "b", ledgerId: "l" }]); expect(r.candidates[0].reasons).toContain("EXACT_REFERENCE");
  });
  it.each([null, "", " "])("never treats %j as matching reference evidence", reference => {
    expect(runBaseline(input(row("b", "BANK", { reference }), row("l", "LEDGER", { reference })), "E0", EXACT_CONFIG).suggestions).toHaveLength(0);
  });
  it("keeps differently formatted references for E1 rather than exact equality", () => {
    expect(runBaseline(input(row("b", "BANK"), row("l", "LEDGER", { reference: "inv 123" })), "E0", EXACT_CONFIG).suggestions).toHaveLength(0);
  });
  it("does not let a reference override known counterparty contradiction", () => {
    expect(runBaseline(input(row("b", "BANK"), row("l", "LEDGER", { counterparty: "Other Supplier" })), "E0", EXACT_CONFIG).suggestions).toHaveLength(0);
  });
});
