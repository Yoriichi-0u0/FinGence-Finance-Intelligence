import { describe, expect, it } from "vitest";
import { approveMapping, suggestMapping } from "../../lib/ingestion/mapper";
import { DEFAULT_OPTIONS, IngestionError, type IngestionContext, type IngestionOptions } from "../../lib/ingestion/models";
import { ingestDataset } from "../../lib/ingestion/pipeline";
import { createDataset, inspectFile } from "../../lib/ingestion/readers";

const context = { batchId: "contract-regression", ingestedAt: "2026-09-28T00:00:00.000Z" };
const header = "transaction_date,posting_date,amount,reference,description,currency\n";
const load = async (csv: string) => createDataset(await inspectFile(new TextEncoder().encode(csv), { name: "dates.csv" }), 0);
async function run(csv: string, options: Partial<IngestionOptions> = {}, suppliedContext: IngestionContext = context) {
  const dataset = await load(csv);
  return ingestDataset(dataset, approveMapping(suggestMapping(dataset)), { ...DEFAULT_OPTIONS, ...options }, suppliedContext);
}

describe("independent source dates and explicit canonical selection", () => {
  it.each([
    ["transaction_date", "2026-09-01", "TRANSACTION_DATE"],
    ["posting_date", "2026-09-03", "POSTING_DATE"],
  ] as const)("preserves both different source dates with %s selected", async (dateBasis, canonicalDate, canonicalBasis) => {
    const result = await run(header + "2026-09-01,2026-09-03,10,R,Text,MYR", { dateBasis });
    expect(result.summary.valid).toBe(1);
    expect(result.normalized[0]).toMatchObject({
      transaction_date: "2026-09-01", posting_date: "2026-09-03",
      canonical_date: canonicalDate, canonical_date_basis: canonicalBasis,
    });
    expect(result.normalized[0]).not.toHaveProperty("date_basis");
    expect(result.records[0].staging).toMatchObject({ transaction_date: "2026-09-01", posting_date: "2026-09-03" });
  });
  it.each([
    ["transaction_date", "2026-09-01,,10,R,Text,MYR", { transaction_date: "2026-09-01", posting_date: null, canonical_date: "2026-09-01", canonical_date_basis: "TRANSACTION_DATE" }],
    ["posting_date", ",2026-09-03,10,R,Text,MYR", { transaction_date: null, posting_date: "2026-09-03", canonical_date: "2026-09-03", canonical_date_basis: "POSTING_DATE" }],
  ] as const)("accepts the explicitly selected sole usable %s", async (dateBasis, row, expected) => {
    const result = await run(header + row, { dateBasis });
    expect(result.summary).toMatchObject({ valid: 1, warning: 0, rejected: 0 });
    expect(result.normalized[0]).toMatchObject(expected);
  });
  it.each([
    ["transaction_date", ",2026-09-03,10,R,Text,MYR", "MISSING_DATE", { transaction_date: null, posting_date: "2026-09-03" }],
    ["transaction_date", "2026-02-30,2026-09-03,10,R,Text,MYR", "INVALID_DATE", { transaction_date: null, posting_date: "2026-09-03" }],
    ["posting_date", "2026-09-01,,10,R,Text,MYR", "MISSING_DATE", { transaction_date: "2026-09-01", posting_date: null }],
    ["posting_date", "2026-09-01,2026-02-30,10,R,Text,MYR", "INVALID_DATE", { transaction_date: "2026-09-01", posting_date: null }],
  ] as const)("rejects selected %s for source row %s without fallback", async (dateBasis, row, rule, dates) => {
    const result = await run(header + row, { dateBasis });
    expect(result.summary).toMatchObject({ rejected: 1, accepted: 0 });
    expect(result.normalized).toEqual([]);
    expect(result.records[0].candidate).toMatchObject({ ...dates, canonical_date: null });
    expect(result.records[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: dateBasis, rule, severity: "REJECTED" })]));
    expect(result.records[0].raw.cells.slice(0, 2)).toEqual(row.split(",").slice(0, 2));
  });
  it.each([
    ["transaction_date", "2026-09-01,2026-02-30,10,R,Text,MYR", "posting_date", "2026-09-01"],
    ["posting_date", "2026-02-30,2026-09-03,10,R,Text,MYR", "transaction_date", "2026-09-03"],
  ] as const)("warns on an invalid unselected date with %s selected", async (dateBasis, row, invalidField, canonicalDate) => {
    const result = await run(header + row, { dateBasis });
    expect(result.summary).toMatchObject({ warning: 1, rejected: 0, accepted: 1 });
    expect(result.normalized[0]).toMatchObject({ [invalidField]: null, canonical_date: canonicalDate });
    expect(result.records[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: invalidField, originalValue: "2026-02-30", rule: "INVALID_DATE", severity: "WARNING" })]));
  });
  it("blocks an unmapped selected date even if the other date is usable", async () => {
    await expect(run("posting_date,amount,reference,description,currency\n2026-09-03,10,R,Text,MYR")).rejects.toThrow(/transaction_date/);
  });
});

describe("strict ingestion instants", () => {
  it.each([
    ["2026-09-28T00:00:00.123Z", "2026-09-28T00:00:00.123Z"],
    ["2026-09-28T00:00:00Z", "2026-09-28T00:00:00.000Z"],
    ["2026-09-28T08:00:00.12+08:00", "2026-09-28T00:00:00.120Z"],
    ["2026-09-28T23:30:00-02:00", "2026-09-29T01:30:00.000Z"],
  ])("normalizes %s consistently in context and all provenance", async (input, expected) => {
    const result = await run(header + "2026-09-01,2026-09-03,10,R,Text,MYR", {}, { ...context, ingestedAt: input });
    expect(result.context.ingestedAt).toBe(expected);
    expect(result.records[0].provenance.ingested_at).toBe(expected);
    expect(result.records[0].candidate.ingested_at).toBe(expected);
    expect(result.normalized[0].ingested_at).toBe(expected);
    expect(result.normalized[0].transaction_date).toBe("2026-09-01");
  });
  it.each([
    "not-a-timestamp", "09/28/2026", "2026-09-28", "2026-09-28T00:00:00",
    "2026-02-30T00:00:00Z", "2026-09-28T24:00:00Z", "2026-09-28T00:00:60Z",
    "2026-09-28T00:00:00+24:00", "2026-09-28T00:00:00.1234Z", "2026-09-28T00:00:00-00:00",
    "0001-01-01T00:00:00+01:00", "9999-12-31T23:00:00-01:00",
  ])("rejects invalid, ambiguous or unsupported instant %s", async ingestedAt => {
    await expect(run(header + "2026-09-01,2026-09-03,10,R,Text,MYR", {}, { ...context, ingestedAt })).rejects.toThrow(IngestionError);
  });
});

describe("narrow approved transformation provenance", () => {
  it.each([
    ["usd", "MYR", "USD", "SOURCE", "VALID"],
    ["", "myr", "MYR", "DATASET_DEFAULT", "VALID"],
    ["", null, null, null, "WARNING"],
  ] as const)("records currency origin for source %s and default %s", async (source, currencyDefault, currency, currencyBasis, status) => {
    const result = await run(header + "2026-09-01,2026-09-03,10,R,Text," + source, { currencyDefault });
    expect(result.normalized[0]).toMatchObject({ currency, currency_basis: currencyBasis, ingestion_status: status });
    expect(result.records[0].staging.currency).toBe(source);
  });
  it.each([
    ["100,", "credit", { debit: "100", credit: "0" }],
    [",100", "debit", { debit: "0", credit: "100" }],
  ] as const)("records approved blank-side conversion for %s", async (sides, field, money) => {
    const result = await run("transaction_date,debit,credit,reference,description,currency\n2026-09-01," + sides + ",R,Text,MYR", { monetaryMode: "debit_credit", blankSideAsZero: true });
    expect(result.normalized[0]).toMatchObject({ ...money, ingestion_status: "VALID", transformations: [{
      field, source_column: field, original_value: "", normalized_value: "0", rule: "APPROVED_BLANK_SIDE_ZERO",
    }] });
    expect(result.records[0].staging[field]).toBe("");
  });
});
