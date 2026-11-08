import { describe, expect, it } from "vitest";
import { extractSemanticEvidence } from "../../lib/ai-ingestion/increment-02/extract";
import { verifySemanticBlueprint } from "../../lib/ai-ingestion/increment-02/verify";
import { bindRecordedProposal } from "../../lib/ai-ingestion/increment-02/recorded";

const csv = (text: string) => extractSemanticEvidence(Buffer.from(text), "synthetic.csv");
describe("Increment 02 semantic verification; recorded TEST proposals only", () => {
  it("recognizes unfamiliar narrative and preserves exact source financial values", async () => {
    const b = await csv("Transaction Code,Transaction Date,Posting Date,Amount,Currency,Transaction Narrative\n000009,2026-10-19,2026-10-20,-9007199254740993.01,MYR,Vendor payment\n");
    const r = verifySemanticBlueprint(b, bindRecordedProposal(b, "TRANSACTION_TABLE"));
    expect(r.accepted[0].financial).toMatchObject({ source_transaction_id: "000009", source_amount: "-9007199254740993.01", transaction_date: "2026-10-19", posting_date: "2026-10-20", description: "Vendor payment" });
    expect(r.proposalOrigin).toBe("RECORDED_TEST");
  });
  it("records policy-authorized metadata exclusion without dropping its evidence", async () => {
    const b = await csv("Transaction Date,Amount,Currency,Department,Internal Note\n2026-10-19,12.34,MYR,Operations,Reviewed by clerk\n");
    const p = bindRecordedProposal(b, "TRANSACTION_TABLE"); const r = verifySemanticBlueprint(b, p);
    expect(r.accepted).toHaveLength(1); expect(r.dispositions.filter(d => d.disposition !== "FINANCIAL")).toHaveLength(2);
    expect(r.coverage.accountedCells).toBe(r.coverage.populatedCells);
  });
  it("recognizes Money In / Payment Out but never converts them to ledger debit or credit", async () => {
    const b = await csv("BANK STATEMENT\nTransaction Date,Money In,Payment Out,Currency\n2026-10-19,0,17.25,MYR\n");
    const r = verifySemanticBlueprint(b, bindRecordedProposal(b, "BANK_STATEMENT"));
    expect(r.accepted).toHaveLength(0); expect(r.unresolved[0].reasons).toContain("UNSUPPORTED_BANK_MOVEMENT");
    expect(r.dispositions.some(d => d.role === "bank_out")).toBe(true);
  });
  it("blocks debit/credit swaps even when both numbers parse", async () => {
    const b = await csv("GENERAL LEDGER\nTransaction Date,Debit,Credit,Currency\n2026-10-19,100,20,MYR\n"); const p = bindRecordedProposal(b, "GENERAL_LEDGER");
    expect(verifySemanticBlueprint(b, p).accepted).toHaveLength(1);
    const dr = p.fields.find(f => f.role === "debit")!; const cr = p.fields.find(f => f.role === "credit")!;
    [dr.target, cr.target] = [cr.target, dr.target];
    expect(verifySemanticBlueprint(b, p).accepted).toHaveLength(0);
  });
  it("does not relabel bank Debit/Credit columns as general-ledger data", async () => {
    const b = await csv("BANK STATEMENT\nTransaction Date,Debit,Credit,Currency\n2026-10-19,100,20,MYR\n");
    expect(verifySemanticBlueprint(b, bindRecordedProposal(b, "GENERAL_LEDGER")).accepted).toHaveLength(0);
  });
  it("does not trust numeric IDs as amounts or exclude an unknown monetary field", async () => {
    const b = await csv("Transaction ID,Transaction Date,Amount,Currency,Service Charge\n000009,2026-10-19,100,MYR,5.00\n"); const p = bindRecordedProposal(b, "TRANSACTION_TABLE");
    const r = verifySemanticBlueprint(b, p); expect(r.accepted).toHaveLength(0); expect(r.unresolved[0].reasons).toContain("UNRESOLVED_FIELD");
    const field = p.fields.find(f => f.column === "Service Charge")!; field.disposition = "NONFINANCIAL_NARRATIVE"; field.ruleId = "narrative.note"; field.role = "note";
    expect(verifySemanticBlueprint(b, p).accepted).toHaveLength(0);
  });
  it("holds ambiguous dates/numbers and independently verifies unambiguous DMY and grouping", async () => {
    const ambiguous = await csv("Transaction Date,Amount,Currency\n01/02/2026,\"1,234\",MYR\n");
    expect(verifySemanticBlueprint(ambiguous, bindRecordedProposal(ambiguous, "TRANSACTION_TABLE")).accepted).toHaveLength(0);
    const b = await csv("Transaction Date,Amount,Currency\n19/10/2026,\"1,234.50\",MYR\n");
    const r = verifySemanticBlueprint(b, bindRecordedProposal(b, "TRANSACTION_TABLE", { dateOrder: "DMY", numberFormat: "dot_comma" }));
    expect(r.accepted[0].financial).toMatchObject({ canonical_date: "2026-10-19", source_amount: "1234.5" });
  });
  it("distinguishes invalid financial rows from missing evidence and preserves partial results", async () => {
    const b = await csv("Transaction Date,Amount,Currency\n2026-10-19,12,MYR\n2026-10-19,wrong,MYR\n2026-10-19,,MYR\n");
    const r = verifySemanticBlueprint(b, bindRecordedProposal(b, "TRANSACTION_TABLE"));
    expect(r.accepted).toHaveLength(1); expect(r.rejected).toHaveLength(1); expect(r.unresolved).toHaveLength(1); expect(r.decision).toBe("PARTIAL");
  });
  it("keeps invoice and receipt totals unsupported, and never mutates evidence/proposals", async () => {
    const b = await csv("INVOICE\nItem,Quantity,Unit Price,Total\nService,1,100,100\n"); const p = bindRecordedProposal(b, "INVOICE"); const before = JSON.stringify([b, p]);
    const r = verifySemanticBlueprint(b, p); expect(r.accepted).toHaveLength(0); expect(r.unresolved.length).toBeGreaterThan(0);
    expect(JSON.stringify([b, p])).toBe(before);
  });
  it("does not hide financial context behind document labels or metadata exclusions", async () => {
    for (const context of ["SYNTHETIC hidden fee MYR 500", "Department: tax MYR 500"]) {
      const b = await csv(`${context}\nTransaction Date,Amount,Currency\n2026-10-19,12,MYR\n`);
      const p = bindRecordedProposal(b, "TRANSACTION_TABLE"); expect(verifySemanticBlueprint(b, p).accepted).toHaveLength(0);
    }
  });
  it("holds IN/OUT direction rather than converting it to DEBIT/CREDIT", async () => {
    const b = await csv("BANK STATEMENT\nTransaction Date,Amount,Direction,Currency\n2026-10-19,12,OUT,MYR\n");
    expect(verifySemanticBlueprint(b, bindRecordedProposal(b, "BANK_STATEMENT")).unresolved[0].reasons).toContain("UNSUPPORTED_BANK_DIRECTION");
  });
  it("blocks changed literal values, missing rows, fake policy IDs and assumptions", async () => {
    const b = await csv("Transaction Date,Amount,Currency\n2026-10-19,12,MYR\n2026-10-20,13,MYR\n");
    for (const mutate of [(p: ReturnType<typeof bindRecordedProposal>) => { p.records[0].cells[1].observedText = "99"; }, (p: ReturnType<typeof bindRecordedProposal>) => { p.records.pop(); }, (p: ReturnType<typeof bindRecordedProposal>) => { p.fields[1].ruleId = "invented"; }, (p: ReturnType<typeof bindRecordedProposal>) => { p.assumptions.push("Assume MYR"); }]) {
      const p = bindRecordedProposal(b, "TRANSACTION_TABLE"); mutate(p); expect(verifySemanticBlueprint(b, p).accepted).toHaveLength(0);
    }
  });
  it.each(["Commission RM 50.00", "Paid JPY 5000", "Additional payment 50.00", "Unrecognized free text", "5000"])("holds unproven nonfinancial note: %s", async note => {
    const b = await csv(`Transaction Date,Amount,Currency,Internal Note\n2026-10-19,12.50,MYR,${note}\n`);
    const r = verifySemanticBlueprint(b, bindRecordedProposal(b, "TRANSACTION_TABLE"));
    expect(r.accepted).toHaveLength(0); expect(r.unresolved).toHaveLength(1);
  });
  it("holds context metadata with unproven values", async () => {
    for (const context of ["Department: Commission RM 50.00", "Prepared by: Paid JPY 5000", "Page: Additional payment 50.00"]) {
      const b = await csv(`${context}\nTransaction Date,Amount,Currency\n2026-10-19,12,MYR\n`);
      expect(verifySemanticBlueprint(b, bindRecordedProposal(b, "TRANSACTION_TABLE")).accepted).toHaveLength(0);
    }
  });
  it("rejects mismatched typed value/text evidence without mutating frozen inputs", async () => {
    const b = await csv("Transaction Date,Amount,Currency\n2026-10-19,12,MYR\n");
    const p = bindRecordedProposal(b, "TRANSACTION_TABLE"); b.items.find(i => i.column === "Amount" && !i.header)!.value = "999";
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(b); freeze(p);
    const r = verifySemanticBlueprint(b, p); expect(r.accepted).toHaveLength(0); expect(r.documentReasons).toContain("EVIDENCE_VALUE_FIDELITY");
  });
});
