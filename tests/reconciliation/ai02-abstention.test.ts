import { describe, expect, it } from "vitest";
import { runBaseline } from "../../research/reconciliation/ai02/run";
import { EXACT_CONFIG } from "../../research/reconciliation/ai02/types";
import { resolve } from "../../research/reconciliation/ai02/abstention";
import { config, row, input, frozen } from "./ai02-fixtures";
describe("AI02 conservative assignment", () => {
  it("abstains on a configured near-tie without treating ID order as evidence", () => {
    const i = input(row("b", "BANK"), row("l1", "LEDGER"), row("l2", "LEDGER"));
    const r = runBaseline(i, "E1", config);
    r.candidates[0].score = .9; r.candidates[1].score = .85;
    expect(resolve(i, r.candidates, { ...config, margin: .1 }).suggestions).toHaveLength(0);
    expect(resolve(i, r.candidates, { ...config, margin: .01 }).suggestions).toHaveLength(1);
  });
  it.each(["E0", "E1"] as const)("%s abstains on recurring indistinguishable candidates", method => {
    const r = runBaseline(input(row("b1", "BANK"), row("b2", "BANK"), row("l1", "LEDGER"), row("l2", "LEDGER")), method, method === "E0" ? EXACT_CONFIG : config);
    expect(r.suggestions).toHaveLength(0); expect(r.outcomes.every(o => o.state === "AMBIGUOUS")).toBe(true); expect(r.candidates.every(p => p.rank === 2)).toBe(true);
  });
  it("prevents two banks consuming a single ledger", () => {
    const r = runBaseline(input(row("b1", "BANK"), row("b2", "BANK"), row("l", "LEDGER")), "E0", EXACT_CONFIG);
    expect(r.suggestions).toHaveLength(0); expect(r.outcomes.filter(o => o.reason === "ASSIGNMENT_CONFLICT")).toHaveLength(2);
  });
  it("leaves unmatched and unsupported group-only records unresolved on both sides", () => {
    const r = runBaseline(input(row("b1", "BANK", { amount: "25" }), row("b2", "BANK", { amount: "75" }), row("l", "LEDGER", { amount: "100" })), "E0", EXACT_CONFIG);
    expect(r.suggestions).toHaveLength(0); expect(r.outcomes.every(o => o.reason === "NO_ELIGIBLE_PAIR_GROUPING_NOT_SUPPORTED")).toBe(true);
  });
  it.each(["E0", "E1"] as const)("%s preserves inputs and is stable under input permutation", method => {
    const { input: i } = frozen("train"), before = JSON.stringify(i);
    const a = runBaseline(i, method, config), b = runBaseline({ ...i, candidates: [...i.candidates].reverse() }, method, config);
    expect(a.fingerprint).toBe(b.fingerprint); expect(a.suggestions).toEqual(b.suggestions); expect(JSON.stringify(i)).toBe(before);
    const used = a.suggestions.flatMap(p => [p.bankId,p.ledgerId]); expect(new Set(used).size).toBe(used.length);
  });
  it("does not resolve symmetric evidence by changing addressing IDs", () => {
    const run = (a: string,b: string) => runBaseline(input(row("bank", "BANK"),row(a,"LEDGER"),row(b,"LEDGER")),"E0",EXACT_CONFIG);
    expect(run("a","z").suggestions).toEqual(run("z","a").suggestions);
  });
});
