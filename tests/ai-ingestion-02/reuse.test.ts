import { describe, expect, it } from "vitest";
import { extractSemanticEvidence } from "../../lib/ai-ingestion/increment-02/extract";
import { bindRecordedProposal } from "../../lib/ai-ingestion/increment-02/recorded";
import { createSemanticTemplate, rebindSemanticTemplate } from "../../lib/ai-ingestion/increment-02/reuse";
const source = (s: string) => extractSemanticEvidence(Buffer.from(s), "test.csv");
const original = () => source("Transaction ID,Transaction Date,Amount,Currency,Transaction Narrative\n000001,2026-10-19,12.50,MYR,First\n");
describe("0.2 semantic template reuse: no historical values or source identities", () => {
  it("rebinds fresh values, reordered columns and registered alternate headings", async () => {
    const a = await original(); const t = createSemanticTemplate(a, bindRecordedProposal(a, "TRANSACTION_TABLE"), "RECORDED_TEST");
    expect(JSON.stringify(t)).not.toContain(a.sourceId); expect(JSON.stringify(t)).not.toContain("12.50");
    const b = await source("Currency,Amount,Txn Date,Payment Narrative,Txn No\nUSD,-9007199254740993.01,2026-10-20,New,000099\n");
    const r = rebindSemanticTemplate(t, b); expect(r.decision).toBe("REUSED");
    expect(r.verification?.accepted[0].financial).toMatchObject({ source_amount: "-9007199254740993.01", source_transaction_id: "000099", currency: "USD" });
    expect(r.blueprint?.records[0].cells.every(c => c.evidenceId.startsWith(b.sourceId))).toBe(true);
  });
  it("allows new approved metadata with full source dispositions", async () => {
    const a = await original(); const t = createSemanticTemplate(a, bindRecordedProposal(a, "TRANSACTION_TABLE"), "RECORDED_TEST");
    const b = await source("Transaction ID,Transaction Date,Amount,Currency,Transaction Narrative,Department\n000009,2026-10-20,99,MYR,New,Finance\n");
    const r = rebindSemanticTemplate(t, b); expect(r.decision).toBe("REUSED"); expect(r.verification?.dispositions.some(d => d.role === "department")).toBe(true);
  });
  it.each([
    "Transaction ID,Transaction Date,Amount,Currency,Transaction Narrative,Service Charge\n000009,2026-10-20,99,MYR,New,5\n",
    "Transaction ID,Transaction Date,Currency,Transaction Narrative\n000009,2026-10-20,MYR,New\n",
    "Transaction ID,Transaction Date,Unexplained Value,Currency,Transaction Narrative\n000009,2026-10-20,99,MYR,New\n",
    "Transaction ID,Transaction Date,Amount,Currency,Transaction Narrative\n000009,01/02/2026,99,MYR,New\n",
  ])("requires fresh interpretation for changed financial structure/conventions", async text => {
    const a = await original(); const t = createSemanticTemplate(a, bindRecordedProposal(a, "TRANSACTION_TABLE"), "RECORDED_TEST");
    expect(rebindSemanticTemplate(t, await source(text)).decision).toBe("REINTERPRETATION_REQUIRED");
  });
  it("does not create templates from unresolved or rejected results", async () => {
    const b = await source("Transaction Date,Money In,Money Out\n2026-10-19,0,10\n");
    expect(() => createSemanticTemplate(b, bindRecordedProposal(b, "BANK_STATEMENT"), "RECORDED_TEST")).toThrow();
  });
});
