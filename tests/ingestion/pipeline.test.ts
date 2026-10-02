import { describe, expect, it } from "vitest";
import { inspectFile, createDataset } from "../../lib/ingestion/readers";
import { approveMapping, overrideMapping, suggestMapping } from "../../lib/ingestion/mapper";
import { ingestDataset, consolidate } from "../../lib/ingestion/pipeline";
import { DEFAULT_OPTIONS, type IngestionOptions } from "../../lib/ingestion/models";
const context = { batchId: "test-batch", ingestedAt: "2026-09-28T00:00:00.000Z" };
const load = async (text: string) => createDataset(await inspectFile(new TextEncoder().encode(text), { name: "test.csv" }), 0);
const run = async (text: string, options: Partial<IngestionOptions> = {}) => {
  const data = await load(text);
  return ingestDataset(data, approveMapping(suggestMapping(data)), { ...DEFAULT_OPTIONS, ...options }, context);
};
const header = "transaction_date,amount,reference,description,currency\n";

describe("validated canonical pipeline", () => {
  it("requires mapping approval before producing output", async () => {
    const d = await load(header + "2026-09-01,2,R,Text,MYR");
    expect(() => ingestDataset(d, suggestMapping(d), DEFAULT_OPTIONS, context)).toThrow(/approve/);
  });
  it("preserves provenance, raw values and exact canonical money", async () => {
    const r = await run(header + "2026-09-01,9007199254740993.10, 001 , Text ,myr");
    expect(r.normalized[0]).toMatchObject({
      source_amount: "9007199254740993.1", reference: "001", description: "Text", currency: "MYR",
      source_file: "test.csv", source_row_number: 2, source_sheet: null,
      ingestion_batch_id: "test-batch", ingested_at: context.ingestedAt, ingestion_status: "VALID",
    });
    expect(r.records[0].raw.cells[1]).toBe("9007199254740993.10");
    expect(r.records[0].staging.reference).toBe(" 001 ");
  });
  it.each([
    ["31/31/2026,2,R,Text,MYR", "INVALID_DATE"],
    ["2026-09-01,nope,R,Text,MYR", "INVALID_NUMBER"],
    [",2,R,Text,MYR", "MISSING_DATE"],
    ["2026-09-01,,R,Text,MYR", "MISSING_MONEY"],
  ])("quarantines invalid row %s", async (row, rule) => {
    const r = await run(header + row);
    expect(r.summary.rejected).toBe(1);
    expect(r.normalized).toEqual([]);
    expect(r.records[0].issues.some(issue => issue.rule === rule)).toBe(true);
    expect(r.records[0].raw.cells).toHaveLength(5);
  });
  it("includes warnings with reasons and keeps duplicate rows", async () => {
    const r = await run(header + "2026-09-01,2,R,Text,MYR\n2026-09-01,2,R,Text,MYR\n2026-09-02,-3,,Text,MYRR");
    expect(r.summary).toMatchObject({ rowsReceived: 3, valid: 1, warning: 2, rejected: 0, accepted: 3, duplicateRows: 1, missingReferences: 1 });
    expect(r.normalized[2].source_amount).toBe("-3");
    expect(r.records[2].issues.map(i => i.rule)).toEqual(expect.arrayContaining(["MISSING_REFERENCE", "MALFORMED_CURRENCY"]));
  });
  it("derives ledger amount only under the approved convention", async () => {
    const r = await run("posting_date,debit,credit,reference,description,currency\n2026-09-01,0,10.01,R,Text,MYR",
      { monetaryMode: "debit_credit", dateBasis: "posting_date" });
    expect(r.normalized[0]).toMatchObject({ source_amount: null, derived_ledger_net: "-10.01", entry_side: "CREDIT", monetary_basis: "debit_credit",
      transaction_date: null, posting_date: "2026-09-01", canonical_date: "2026-09-01", canonical_date_basis: "POSTING_DATE" });
    expect(r.normalized[0]).not.toHaveProperty("amount");
  });
  it("validates currency structure without pretending to validate ISO membership", async () => {
    const chf = await run(header + "2026-09-01,2,R,Text,chf");
    expect(chf.normalized[0].currency).toBe("CHF");
    expect(chf.summary.valid).toBe(1);
    expect((await run(header + "2026-09-01,2,R,Text,ZZZ")).summary.valid).toBe(1);
    expect((await run(header + "2026-09-01,2,R,Text,MYRR")).summary.warning).toBe(1);
  });
  it("versions both the ingestion result and canonical handoff", async () => {
    const r = await run(header + "2026-09-01,2,R,Text,MYR");
    expect(r).toMatchObject({ schema_version: "0.1", ruleset_version: "0.1" });
    expect(consolidate([r])).toMatchObject({ schema_version: "0.1", ruleset_version: "0.1" });
  });
  it("warns by default on negative and dual-sided ledger values, with dataset-specific policies", async () => {
    const csv = "transaction_date,debit,credit,reference,description,currency\n2026-09-01,2,1,R,Text,MYR";
    expect((await run(csv, { monetaryMode: "debit_credit" })).summary.warning).toBe(1);
    expect((await run(csv, { monetaryMode: "debit_credit", bothDebitCredit: "reject" })).summary.rejected).toBe(1);
    expect((await run(csv, { monetaryMode: "debit_credit", bothDebitCredit: "allow" })).summary.valid).toBe(1);
    expect((await run(csv.replace(",2,1,", ",-2,0,"), { monetaryMode: "debit_credit" })).summary.warning).toBe(1);
    expect((await run(csv.replace(",2,1,", ",-2,0,"), { monetaryMode: "debit_credit", negativeDebitCredit: "reject" })).summary.rejected).toBe(1);
  });
  it("requires explicit blank-side handling, without replacing missing money", async () => {
    const csv = "transaction_date,debit,credit,reference,description,currency\n2026-09-01,2,,R,Text,MYR";
    expect((await run(csv, { monetaryMode: "debit_credit" })).summary.rejected).toBe(1);
    expect((await run(csv, { monetaryMode: "debit_credit", blankSideAsZero: true })).normalized[0].credit).toBe("0");
    expect((await run(csv.replace(",2,,", ",,,"), { monetaryMode: "debit_credit", blankSideAsZero: true })).summary.rejected).toBe(1);
  });
  it("preserves unsigned bank amounts and explicit entry side", async () => {
    const csv = "Date,Amount,Direction,Reference,Narration,Currency\n2026-09-01,20,Debit,R,Text,MYR";
    const r = await run(csv, { monetaryMode: "amount_direction" });
    expect(r.normalized[0]).toMatchObject({ source_amount: "20", entry_side: "DEBIT", monetary_basis: "source_amount_with_direction" });
    expect((await run(csv.replace(",Debit,", ",Maybe,"), { monetaryMode: "amount_direction" })).summary.rejected).toBe(1);
    expect((await run(csv.replace(",20,", ",-20,"), { monetaryMode: "amount_direction" })).summary.rejected).toBe(1);
  });
  it("uses a manual override in actual staging and output", async () => {
    const d = await load("Date,Amount,Details,Narration,Currency\n2026-09-01,2,REF-001,Description,MYR");
    const corrected = overrideMapping(suggestMapping(d), 2, "reference");
    const r = ingestDataset(d, approveMapping(corrected), DEFAULT_OPTIONS, context);
    expect(r.normalized[0]).toMatchObject({ reference: "REF-001", description: "Description" });
    expect(r.mapping[2].method).toBe("manual");
  });
  it("counts missing direction as incomplete monetary input when that representation is required", async () => {
    const r = await run("Date,Amount,Direction,Reference,Narration,Currency\n2026-09-01,20,,R,Text,MYR", { monetaryMode: "amount_direction" });
    expect(r.summary).toMatchObject({ rejected: 1, missingMoney: 1, requiredCompleteness: 50 });
    expect(r.records[0].issues.some(i => i.rule === "INVALID_DIRECTION")).toBe(true);
  });
  it("treats optional numeric errors as inspectable warnings", async () => {
    const r = await run(header.trimEnd() + ",balance\n2026-09-01,2,R,Text,MYR,not-a-number");
    expect(r.summary.warning).toBe(1);
    expect(r.normalized[0].balance).toBeNull();
    expect(r.records[0].issues[0]).toMatchObject({ field: "balance", originalValue: "not-a-number" });
  });
  it("conserves rows, replaces reprocessing and avoids invented totals", async () => {
    const a = await run(header + "2026-09-01,2,R,Text,MYR");
    const b = await run(header + "2026-09-02,3,B,Other,USD");
    const combined = consolidate([a, b, a]);
    expect(combined.summary).toMatchObject({ filesProcessed: 2, datasetsProcessed: 2, rowsReceived: 2, accepted: 2, valid: 2, successRate: 100 });
    expect(combined.normalized).toHaveLength(2);
    expect(combined).not.toHaveProperty("totalAmount");
    expect(consolidate([]).summary.successRate).toBeNull();
  });
});
