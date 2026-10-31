import { describe, expect, it } from "vitest";
import { generateCandidates } from "../../research/reconciliation/ai02/candidates";
import { runBaseline } from "../../research/reconciliation/ai02/run";
import { EXACT_CONFIG } from "../../research/reconciliation/ai02/types";
import { config, input, row, frozen } from "./ai02-fixtures";
import { readFileSync } from "node:fs";
import { prepareDevelopment } from "../../research/reconciliation/ai02/adapter";

describe("AI02 shared financial blocking", () => {
  it("requires approved synthetic eligibility at the raw-input adapter", () => {
    const raw = JSON.parse(readFileSync(new URL("../../research/reconciliation/m2/fixtures/inputs/train.json", import.meta.url), "utf8"));
    raw.records[0].eligibility = "VALID";
    expect(() => prepareDevelopment(raw)).toThrow("eligibility");
    expect(() => prepareDevelopment({ ...raw, annotations: {} })).toThrow();
  });
  it.each([["amount", "100.01", "AMOUNT"], ["currency", "USD", "CURRENCY"], ["direction", "INFLOW", "DIRECTION"], ["canonicalDate", "2024-01-20", "DATE_WINDOW"]])("blocks %s mismatch", (field, value, reason) => {
    const result = generateCandidates(input(row("b", "BANK"), row("l", "LEDGER", { [field]: value })), config);
    expect(result.pairs).toHaveLength(0); expect(result.blocked[reason]).toBe(1);
  });
  it("compares exact large money without rounding and permits scale-equivalent values", () => {
    const b = row("b", "BANK", { amount: "9007199254740993.123456789" });
    expect(generateCandidates(input(b, row("l", "LEDGER", { amount: "9007199254740993.1234567890" })), config).pairs).toHaveLength(1);
    expect(generateCandidates(input(b, row("l", "LEDGER", { amount: "9007199254740993.123456788" })), config).pairs).toHaveLength(0);
  });
  it.each([null, 100, "NaN", "1e2", "-1", "0"])("rejects invalid money %j", amount => {
    expect(() => generateCandidates(input(row("b", "BANK", { amount: amount as never })), config)).toThrow();
  });
  it("does not substitute posting date for a missing transaction date", () => {
    const i = input(row("b", "BANK", { transactionDate: null }), row("l", "LEDGER"));
    expect(generateCandidates(i, { ...config, date: { field: "transactionDate", maxDays: 2 } }).blocked.MISSING_SELECTED_DATE).toBe(1);
    expect(generateCandidates(i, { ...config, date: { field: "postingDate", maxDays: 0 } }).pairs).toHaveLength(1);
  });
  it("preserves optional nulls and blocks no pairs on absent references", () => {
    expect(generateCandidates(input(row("b", "BANK", { reference: null, counterparty: null }), row("l", "LEDGER", { reference: null })), config).pairs).toHaveLength(1);
  });
  it("rejects duplicate identity, invalid dates and injected labels", () => {
    expect(() => generateCandidates(input(row("x", "BANK"), row("x", "LEDGER")), config)).toThrow();
    expect(() => generateCandidates(input(row("b", "BANK", { canonicalDate: "2024-02-30" })), config)).toThrow();
    const r = row("b", "BANK"); Object.assign(r.features, { economicId: "answer" });
    expect(() => generateCandidates(input(r), config)).toThrow();
  });
  it.each(["train", "development"] as const)("retains every genuine pair and description-dependent pair in %s", split => {
    const { input: i, truth } = frozen(split), pool = generateCandidates(i, config).pairs;
    const pairs = truth.relationships.filter(r => r.kind === "PAIR");
    expect(pairs.every(r => pool.some(p => p.bankId === r.bankIds[0] && p.ledgerId === r.ledgerIds[0]))).toBe(true);
    // 9 train + 3 development description-dependent pairs. Held-out six are NOT evaluated.
    const descriptive = pairs.filter(r => ["B", "C", "D"].includes(r.family));
    expect(descriptive).toHaveLength(split === "train" ? 9 : 3);
    expect(descriptive.every(r => pool.filter(p => p.bankId === r.bankIds[0]).length >= 3)).toBe(true);
    const e0 = runBaseline(i, "E0", EXACT_CONFIG), e1 = runBaseline(i, "E1", config);
    const keys = (r: typeof e0) => r.candidates.map(p => p.bankId + p.ledgerId).sort();
    expect(keys(e0)).toEqual(keys(e1)); expect(new Set(keys(e0)).size).toBe(pool.length);
  });
  it("rejects held-out execution and invalid policies", () => {
    expect(() => generateCandidates({ ...input(), split: "heldout" as never }, config)).toThrow();
    for (const maxDays of [-1, .5, 32, NaN]) expect(() => generateCandidates(input(), { ...config, date: { ...config.date, maxDays } })).toThrow();
  });
});
