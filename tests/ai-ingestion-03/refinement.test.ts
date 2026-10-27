import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractSemanticEvidence } from "../../lib/ai-ingestion/increment-02/extract";
import { contextRule, headingRule, observedDocumentKind } from "../../lib/ai-ingestion/increment-02/registry";
import { verifySemanticBlueprint } from "../../lib/ai-ingestion/increment-02/verify";
import { hash, materializePlan, planSchema, policyHash, prepareRequest, requestPlanSchema } from "../../lib/ai-ingestion/increment-03/plan";
import type { SemanticEvidence } from "../../lib/ai-ingestion/increment-02/contracts";
import type { InterpretationPlan03 } from "../../lib/ai-ingestion/increment-03/plan";

const source = (text: string) => extractSemanticEvidence(Buffer.from(text), "opaque.csv");
const sample = () => extractSemanticEvidence(readFileSync("public/samples/ai-ingestion-increment-03/h01.csv"), "opaque.csv");
// Offline verifier controls only. Never imported by runtime inference or materialization.
function control(b: SemanticEvidence): InterpretationPlan03 {
  return { version: "v2-plan-0.3", policyVersion: "experimental-financial-terminology-0.2", policyHash,
    documentKind: observedDocumentKind(b.items.filter(i => i.table === null).map(i => i.text)) ?? "TRANSACTION_TABLE", assumptions: [],
    conventions: { dateOrder: "ISO", numberFormat: "plain", dateBasis: "transaction_date", monetaryMode: "signed_amount" },
    fields: b.tables.flatMap(t => t.headerIds.map(id => ({ headerId: `e${b.items.findIndex(i => i.id === id)}`, ruleId: headingRule(b.items.find(i => i.id === id)!.text)?.id ?? null, reason: "RECORDED_TEST control; not model output" }))),
    context: b.items.flatMap((i, n) => i.table === null && i.text.trim() ? [{ evidenceId: `e${n}`, ruleId: contextRule(i.text) ?? "unknown", disposition: contextRule(i.text) ? "SUPPORTING_METADATA" as const : "UNRESOLVED" as const }] : []),
  };
}
const verify = (b: SemanticEvidence, p: InterpretationPlan03) => verifySemanticBlueprint(b, materializePlan(b, p), "RECORDED_TEST");

describe("03B request guidance and source-derived evidence groups", () => {
  it("separates headers, document context and read-only cells without fixture names or answers", async () => {
    const b = await sample(), r = prepareRequest(b), input = JSON.parse(r.messages[1].content);
    expect(input.evidence.headers.map((v: unknown[]) => v[0])).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
    expect(input.evidence.context).toEqual([["e0", "BANK STATEMENT"]]);
    expect(input.evidence.values).toHaveLength(12);
    expect(input.evidence.values.map((v: unknown[]) => v[4])).toContain("9007199254740995.07");
    expect(JSON.stringify(r)).not.toMatch(/h01|ground.truth|acceptedTruth|expectedAccepted/);
    expect(prepareRequest({ ...b, filename: "a-totally-different-name.csv" }).promptHash).toBe(r.promptHash);
    expect(r.inputTokenBound + 1600).toBeLessThanOrEqual(8000);
  });
  it("defines parsing separately from accounting and exposes only existing context rules", async () => {
    const r = prepareRequest(await sample()), text = r.messages.map(m => m.content).join("\n");
    for (const term of ["YYYY-MM-DD", "DMY", "MDY", "1,234.56", "1.234,56", "transaction_date", "signed_amount", "amount_direction", "debit_credit", "context.document-label", "context.metadata", "Prepared by", "Department", "Page"]) expect(text).toContain(term);
    expect(text).toContain("conventions=null");
    expect(text).toContain("cash flow");
  });
  it("constrains IDs by source group without choosing the model's classifications", async () => {
    const b = await sample(), p = control(b), schema = requestPlanSchema(b);
    expect(schema.safeParse(p).success).toBe(true);
    const swapped = structuredClone(p); swapped.context[0].evidenceId = p.fields[0].headerId;
    expect(schema.safeParse(swapped).success).toBe(false);
    const valueAsHeader = structuredClone(p); valueAsHeader.fields[0].headerId = "e7";
    expect(schema.safeParse(valueAsHeader).success).toBe(false);
    const missing = structuredClone(p); missing.context = [];
    expect(schema.safeParse(missing).success).toBe(false);
    const wrongRule = structuredClone(p); wrongRule.context[0].ruleId = "context.metadata";
    expect(schema.safeParse(wrongRule).success).toBe(true);
    expect(verify(b, wrongRule).accepted).toHaveLength(0);
    const abstain = { ...p, conventions: null };
    expect(schema.safeParse(abstain).success).toBe(true);
    expect(() => materializePlan(b, abstain)).toThrow("UNRESOLVED_CONVENTIONS");
  });
  it("allows empty context and keeps table coordinates distinct across multiple tables", async () => {
    const b = await source("Transaction ID,Date,Amount\n0001,2026-10-27,1.00\n");
    expect(requestPlanSchema(b).safeParse(control(b)).success).toBe(true);
    const second = structuredClone(b); second.tables[0].id = "other";
    second.items = second.items.map(i => ({ ...i, id: `${i.id}:other`, table: "other" })); second.tables[0].headerIds = second.items.filter(i => i.header).map(i => i.id);
    const combined = { ...b, items: [...b.items, ...second.items], tables: [...b.tables, ...second.tables] };
    const input = JSON.parse(prepareRequest(combined).messages[1].content);
    expect(new Set(input.evidence.headers.map((v: unknown[]) => v[1])).size).toBe(2);
    expect(requestPlanSchema(combined).safeParse(control(combined)).success).toBe(true);
  });
});

describe("03B unchanged independent-verifier acceptance boundaries", () => {
  it("replays the immutable real failed response and preserves its rejection", async () => {
    const p = JSON.parse(readFileSync("tests/fixtures/ai-ingestion-03/first-live-failed-proposal.json", "utf8")), b = await sample();
    expect(hash(p)).toBe("15371b822bef91f9c99b3ec07efdfe8eb132661beea595067324e6b07022242e");
    expect(planSchema.safeParse(p).success).toBe(true);
    expect(() => materializePlan(b, p)).toThrow("UNRESOLVED_CONVENTIONS");
    expect(requestPlanSchema(b).safeParse(p).success).toBe(false);
    const result = verifySemanticBlueprint(b, null, "RECORDED_TEST");
    expect(result.accepted).toHaveLength(0); expect(result.rejected).toHaveLength(0); expect(result.unresolved).toHaveLength(2);
    // Diagnose the second defect in a clearly counterfactual copy; never repair a live proposal.
    expect(() => materializePlan(b, { ...p, conventions: control(b).conventions })).toThrow("CONTEXT_COVERAGE");
  });
  it("accepts a complete offline control with exact money, currency, IDs, independent dates and original coordinates", async () => {
    const b = await sample(), before = hash(b), p = control(b), r = verify(b, p);
    expect(r.proposalOrigin).toBe("RECORDED_TEST"); expect(r.accepted).toHaveLength(2);
    expect(r.accepted[0].financial).toMatchObject({ source_transaction_id: "0000701", reference: "000091", source_amount: "9007199254740995.07", currency: "MYR", transaction_date: "2026-10-23", posting_date: "2026-10-24", canonical_date: "2026-10-23" });
    expect(r.accepted[1].financial).toMatchObject({ source_transaction_id: "0000702", source_amount: "-31.2", currency: "USD" });
    const bp = materializePlan(b, p);
    expect(bp.records.flatMap(row => row.cells).map(c => [c.evidenceId, c.observedText])).toEqual(b.items.filter(i => i.table !== null && !i.header).map(i => [i.id, i.text]));
    expect(b.items.find(i => i.text === "9007199254740995.07")).toMatchObject({ row: 3, column: "Amount", address: "D3" });
    expect(hash(b)).toBe(before);
  });
  it.each([
    ["Transaction ID,Date,Amount\n0001,01/02/2026,10\n", { dateOrder: "DMY" }],
    ["Transaction ID,Date,Amount\n0001,2026-10-27,\"1,234\"\n", { numberFormat: "dot_comma" }],
    ["Transaction ID,Date,Amount,Debit,Credit\n0001,2026-10-27,10,10,0\n", {}],
    ["BANK STATEMENT\nTransaction ID,Date,Debit,Credit\n0001,2026-10-27,10,0\n", { monetaryMode: "debit_credit" }],
    ["BANK STATEMENT\nTransaction ID,Date,Amount,Direction\n0001,2026-10-27,10,OUT\n", { monetaryMode: "amount_direction" }],
    ["BANK STATEMENT\nTransaction ID,Date,Money In,Money Out\n0001,2026-10-27,10,0\n", {}],
    ["Transaction ID,Date,Amount,Mystery Fee\n0001,2026-10-27,10,2\n", {}],
  ] as const)("withholds unsupported/ambiguous source %s", async (text, choices) => {
    const b = await source(text), p = control(b); Object.assign(p.conventions!, choices);
    const r = verify(b, p); expect(r.accepted).toHaveLength(0); expect(r.unresolved.length).toBeGreaterThan(0);
    expect(() => materializePlan(b, { ...p, conventions: null })).toThrow("UNRESOLVED_CONVENTIONS");
  });
  it.each([
    ["13/02/2026", "DMY", "1234.56", "plain"],
    ["02/13/2026", "MDY", "1,234.56", "dot_comma"],
    ["2026-02-13", "ISO", "1.234,56", "comma_dot"],
  ] as const)("accepts uniquely supported parsing %s / %s / %s / %s", async (date, dateOrder, amount, numberFormat) => {
    const b = await source(`Transaction ID,Date,Amount\n0001,${date},"${amount}"\n`), p = control(b);
    Object.assign(p.conventions!, { dateOrder, numberFormat });
    expect(verify(b, p).accepted[0]?.financial).toMatchObject({ source_transaction_id: "0001", source_amount: "1234.56", transaction_date: "2026-02-13" });
  });
  it("retains narrow context metadata and refuses missing, unknown or fabricated evidence", async () => {
    const b = await source("BANK STATEMENT\nPrepared by: Synthetic Tester\nTransaction ID,Date,Amount\n0001,2026-10-27,10\n"), p = control(b);
    expect(p.context.map(c => c.ruleId)).toEqual(["context.document-label", "context.metadata"]);
    expect(verify(b, p).accepted).toHaveLength(1);
    const missing = structuredClone(p); missing.context.pop(); expect(() => materializePlan(b, missing)).toThrow("CONTEXT_COVERAGE");
    const invented = structuredClone(p); invented.fields[0].headerId = "e999"; expect(() => materializePlan(b, invented)).toThrow("UNKNOWN_EVIDENCE");
    const bp = materializePlan(b, p); bp.records[0].cells[2].observedText = "999999";
    expect(verifySemanticBlueprint(b, bp, "RECORDED_TEST").accepted).toHaveLength(0);
    const unknown = structuredClone(p); unknown.context[0].ruleId = "unknown"; unknown.context[0].disposition = "UNRESOLVED";
    expect(verify(b, unknown).accepted).toHaveLength(0);
    expect(() => materializePlan(b, { ...p, transactions: [{ amount: "10" }] })).toThrow();
  });
  it("accepts literal source direction and explicitly labelled ledger sides without cash-flow interpretation", async () => {
    for (const [text, monetaryMode] of [
      ["BANK STATEMENT\nTransaction ID,Date,Amount,Direction\n0001,2026-10-27,10,CR\n", "amount_direction"],
      ["GENERAL LEDGER\nTransaction ID,Date,Debit,Credit\n0001,2026-10-27,10,0\n", "debit_credit"],
    ] as const) {
      const b = await source(text), p = control(b); p.conventions!.monetaryMode = monetaryMode;
      const r = verify(b, p); expect(r.accepted).toHaveLength(1);
      expect(r.accepted[0].financial).not.toHaveProperty("cash_flow");
      expect(r.accepted[0].financial).not.toHaveProperty("derived_ledger_net");
    }
  });
  it("does not trust duplicate context IDs, wrong known field rules or tampered typed source values", async () => {
    const b = await sample(), p = control(b), duplicate = structuredClone(p);
    duplicate.context.push(duplicate.context[0]); expect(() => materializePlan(b, duplicate)).toThrow("CONTEXT_COVERAGE");
    const wrong = structuredClone(p); wrong.fields[0].ruleId = "money.amount";
    expect(verify(b, wrong).accepted).toHaveLength(0);
    const tampered = structuredClone(b); tampered.items.find(i => i.text === "9007199254740995.07")!.value = { kind: "excel_number", value: "999" };
    expect(verify(tampered, p).accepted).toHaveLength(0);
  });
});
