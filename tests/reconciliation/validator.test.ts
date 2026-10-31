import { describe, expect, it } from "vitest";
import { generateDataset } from "../../research/reconciliation/generator";
import { assertValidDataset, isISODate, validateDataset } from "../../research/reconciliation/validator";
import { equalDecimals, isDecimal, sumDecimals } from "../../research/reconciliation/decimal";
import type { Dataset } from "../../research/reconciliation/types";

describe("AI01 independent validation", () => {
  const mutations: [string, (d: Dataset) => void][] = [
    ["duplicate ID", d => { d.records[1].id = d.records[0].id; }],
    ["invalid role", d => { d.records[0].role = "OTHER" as never; }],
    ["unknown template", d => { d.records[0].templateId = "unknown"; }],
    ["source system", d => { d.records[0].systemId = "other"; }],
    ["source account", d => { d.records[0].accountId = "other"; }],
    ["source row", d => { d.records[0].sourceRowId = "other"; }],
    ["source file", d => { d.records[0].provenance.file = "real.csv"; }],
    ["source column convention", d => { d.templates[0].convention = "other"; }],
    ["missing template", d => { d.templates.pop(); }],
    ["duplicate template", d => { d.templates[1] = structuredClone(d.templates[0]); }],
    ["wrong count", d => { d.records.pop(); }],
    ["invalid amount", d => { d.records[0].amount = "1e3"; }],
    ["Number money", d => { d.records[0].amount = 1.25 as never; }],
    ["negative magnitude", d => { d.records[0].amount = "-1"; }],
    ["zero magnitude", d => { d.records[0].amount = "0.00"; }],
    ["bad currency", d => { d.records[0].currency = "myr"; }],
    ["wrong basis", d => { d.records[0].monetaryBasis = "UNKNOWN" as never; }],
    ["unknown direction", d => { d.records[0].direction = "UNKNOWN" as never; }],
    ["impossible date", d => { d.records[0].canonicalDate = "2026-02-30"; }],
    ["date basis", d => { d.records[0].canonicalDateBasis = "UNKNOWN" as never; }],
    ["fabricated date", d => { d.records[0].canonicalDate = "2026-03-01"; }],
    ["bad optional date", d => { d.records[0].transactionDate = "2026-02-29"; }],
    ["undefined reference", d => { d.records[0].reference = undefined as never; }],
    ["zero reference", d => { d.records[0].reference = 0 as never; }],
    ["fabricated unused side", d => { const r = d.records.find(r => r.role === "LEDGER")!; if (r.debit === null) r.debit = "0"; else r.credit = "0"; }],
    ["swapped debit credit", d => { const r = d.records.find(r => r.role === "LEDGER")!; [r.debit, r.credit] = [r.credit, r.debit]; }],
    ["signed source mismatch", d => { d.records.find(r => r.monetaryBasis === "SIGNED_CASH" && r.direction === "OUTFLOW")!.sourceAmount = "1.25"; }],
    ["directed source mismatch", d => { d.records.find(r => r.monetaryBasis === "AMOUNT_DIRECTION")!.sourceAmount = "-1.25"; }],
    ["missing label record", d => { d.groundTruth.relationships[0].bankIds[0] = "missing"; }],
    ["wrong label role", d => { d.groundTruth.relationships[0].bankIds[0] = d.groundTruth.relationships[0].ledgerIds[0]; }],
    ["reused economic record", d => { d.groundTruth.relationships[1].bankIds = [...d.groundTruth.relationships[0].bankIds]; }],
    ["positive negative contradiction", d => { const r = d.groundTruth.relationships[0]; d.groundTruth.nonmatches.push({ bankId: r.bankIds[0], ledgerId: r.ledgerIds[0], reason: "DISTINCT_EVENT" }); }],
    ["unmatched contradiction", d => { d.groundTruth.unmatchedIds.push(d.groundTruth.relationships[0].bankIds[0]); }],
    ["unknown unmatched", d => { d.groundTruth.unmatchedIds[0] = "missing"; }],
    ["missing unmatched disposition", d => { d.groundTruth.unmatchedIds.pop(); }],
    ["missing outcome", d => { d.groundTruth.outcomes.pop(); }],
    ["unknown outcome", d => { d.groundTruth.outcomes[0].relationshipId = "missing"; }],
    ["duplicate outcome", d => { d.groundTruth.outcomes.push(structuredClone(d.groundTruth.outcomes[0])); }],
    ["group as pair", d => { d.groundTruth.relationships.find(r => r.kind === "GROUP")!.kind = "ONE_TO_ONE"; }],
    ["group as suggestion", d => { d.groundTruth.outcomes.find(o => o.decision === "UNRESOLVED_GROUP")!.decision = "SUGGEST_PAIR"; }],
    ["ambiguity forced", d => { d.groundTruth.outcomes.find(o => o.decision === "ABSTAIN_AMBIGUOUS")!.decision = "SUGGEST_PAIR"; }],
    ["missing ambiguity", d => { d.groundTruth.ambiguousCases.pop(); }],
    ["bad ambiguity membership", d => { d.groundTruth.ambiguousCases[0].bankIds = [d.groundTruth.relationships[0].bankIds[0]]; }],
    ["case record duplicate", d => { d.groundTruth.cases[0].recordIds.push(d.groundTruth.cases[1].recordIds[0]); }],
    ["case family mismatch", d => { d.groundTruth.cases[0].family = "B"; }],
    ["fake negative amount reason", d => { d.groundTruth.nonmatches.find(n => n.reason === "DISTINCT_EVENT")!.reason = "AMOUNT"; }],
    ["cross-currency economic match", d => { const id = d.groundTruth.relationships[0].ledgerIds[0]; d.records.find(r => r.id === id)!.currency = "USD"; }],
    ["unequal grouped total", d => { const id = d.groundTruth.relationships.find(r => r.kind === "GROUP")!.bankIds[0]; const r = d.records.find(r => r.id === id)!; r.amount = "126.00"; if (r.sourceAmount !== null) r.sourceAmount = r.sourceAmount.startsWith("-") ? "-126.00" : "126.00"; }],
  ];
  it.each(mutations)("rejects %s without repairing input", (_, mutate) => {
    const d = generateDataset(); mutate(d); const original = structuredClone(d);
    expect(validateDataset(d).valid).toBe(false); expect(d).toEqual(original);
    expect(() => assertValidDataset(d)).toThrow("Invalid synthetic dataset");
  });
  it.each([null, {}, [], { records: [] }, { config: {}, templates: [], records: [], groundTruth: {} }])("rejects malformed envelope %j", input => {
    expect(validateDataset(input).valid).toBe(false);
  });
  it("rejects malformed nested annotations without throwing", () => {
    const d = generateDataset(); d.groundTruth.relationships[0] = null as never;
    expect(validateDataset(d).valid).toBe(false);
  });
  it("preserves large values and arbitrary source precision exactly", () => {
    expect(sumDecimals(["9007199254740993.123456789", "0.000000001"])).toBe("9007199254740993.12345679");
    expect(sumDecimals(["0.1", "0.2"])).toBe("0.3");
    expect(sumDecimals(["-0.5", "0.25"])).toBe("-0.25");
    expect(equalDecimals("125.00", "125")).toBe(true);
    expect(() => sumDecimals([null as never])).toThrow();
    expect(generateDataset().records.filter(r => r.amount === "9007199254740993.123456789")).toHaveLength(2);
  });
  it("retains separate transaction/posting dates including unavailable values", () => {
    const d = generateDataset();
    expect(d.records.some(r => r.transactionDate !== null && r.postingDate !== null && r.transactionDate !== r.postingDate)).toBe(true);
    expect(d.records.some(r => r.transactionDate === null && r.canonicalDateBasis === "POSTING_DATE")).toBe(true);
    expect(d.records.some(r => r.postingDate === null && r.canonicalDateBasis === "TRANSACTION_DATE")).toBe(true);
    expect(validateDataset(d).valid).toBe(true);
  });
  it.each(["NaN", "Infinity", "1e2", "+1", "1,000.00", "01", "-0.00", " 1.00", "1."])("rejects noncanonical decimal %s", value => {
    expect(isDecimal(value)).toBe(false);
  });
  it.each([["2024-02-29", true], ["2026-02-29", false], ["2026-04-31", false], ["2026-13-01", false], ["0000-01-01", false], ["2026-2-01", false]])("validates calendar %s", (date, valid) => {
    expect(isISODate(date)).toBe(valid);
  });
});
