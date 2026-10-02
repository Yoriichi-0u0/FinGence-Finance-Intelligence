import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  approveMapping, canonicalCSV, consolidate, createDataset, DEFAULT_OPTIONS, evidenceJSON,
  ingestDataset, inspectFile, mappingErrors, overrideMapping, suggestMapping,
  type IngestionOptions, type IngestionResult,
} from "../../lib/ingestion";
import {
  checkedValue, columnExamples, currencyDescription, defaultResultFilter, financeValues,
  filterRows, issueDetails, mappingProblem, moneyDescription, reviewState, sourceValue,
  STATUS_LABELS, transformationDescriptions,
} from "../../components/ingestion/presentation";
import expected from "../../public/samples/ingestion/expected.json";

const context = { batchId: "finance-presentation-test", ingestedAt: "2026-10-02T00:00:00.000Z" };
let results: IngestionResult[];
const run = async (csv: string, options: Partial<IngestionOptions> = {}) => {
  const dataset = createDataset(await inspectFile(new TextEncoder().encode(csv), { name: "synthetic-presentation.csv" }), 0);
  return ingestDataset(dataset, approveMapping(suggestMapping(dataset)), { ...DEFAULT_OPTIONS, ...options }, context);
};
beforeAll(async () => {
  results = [];
  for (const fixture of expected.files) {
    const dataset = createDataset(await inspectFile(readFileSync(new URL("../../public/samples/ingestion/" + fixture.file, import.meta.url)),
      { name: fixture.file }), fixture.sheet_index);
    const mapping = fixture.manual_mapping
      ? overrideMapping(suggestMapping(dataset), dataset.columns.indexOf("Details"), "reference") : suggestMapping(dataset);
    results.push(ingestDataset(dataset, approveMapping(mapping), {
      ...DEFAULT_OPTIONS, sourceSystem: fixture.sourceSystem,
      monetaryMode: fixture.monetaryMode as IngestionOptions["monetaryMode"],
      dateBasis: fixture.dateBasis as IngestionOptions["dateBasis"],
    }, context));
  }
});

describe("finance presentation without contract changes", () => {
  it("keeps three distinct finance labels without changing codes or accepted IDs", () => {
    expect(STATUS_LABELS).toEqual({ VALID: "Ready", WARNING: "Included — needs attention", REJECTED: "Cannot include" });
    const all = results.flatMap(result => result.records);
    const combined = consolidate(results);
    expect(all).toHaveLength(26);
    expect(all.filter(row => row.status === "VALID")).toHaveLength(20);
    expect(all.filter(row => row.status === "WARNING")).toHaveLength(3);
    const excluded = all.filter(row => row.status === "REJECTED");
    expect(excluded.map(row => row.provenance.source_row_number)).toEqual([7, 8, 9]);
    expect(combined.normalized).toHaveLength(23);
    expect(combined.normalized.map(row => row.source_row_id)).toEqual(all.filter(row => row.status !== "REJECTED").map(row => row.provenance.source_row_id));
    expect(combined.normalized.every(row => !excluded.some(source => source.provenance.source_row_id === row.source_row_id))).toBe(true);
  });
  it("prioritizes exactly the six edge-case warning/rejected rows in original order", () => {
    const rows = results[2].records;
    expect(defaultResultFilter(rows)).toBe("NEEDS_REVIEW");
    expect(defaultResultFilter(results[0].records)).toBe("ALL");
    const review = filterRows(rows, "NEEDS_REVIEW");
    expect(review.map(row => row.provenance.source_row_number)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(review.map(row => row.status)).toEqual(["WARNING", "WARNING", "WARNING", "REJECTED", "REJECTED", "REJECTED"]);
    expect(review.every(row => rows.includes(row))).toBe(true);
    expect(filterRows(rows, "VALID").map(row => row.provenance.source_row_number)).toEqual([2, 3]);
    expect(filterRows(rows, "ALL")).toEqual(rows);
    expect(filterRows(rows, "REJECTED").map(row => row.provenance.source_row_number)).toEqual([7, 8, 9]);
  });
  it.each(["transaction_date", "posting_date"] as const)("keeps different source dates and explicit selection of %s", async dateBasis => {
    const result = await run("transaction_date,posting_date,amount,reference,description,currency\n2026-09-01,2026-09-03,2,00017,Dates,MYR", { dateBasis });
    const values = financeValues(result.records[0].candidate);
    expect(values.find(value => value.field === "transaction_date")?.value).toBe("2026-09-01");
    expect(values.find(value => value.field === "posting_date")?.value).toBe("2026-09-03");
    expect(values.find(value => value.field === "canonical_date")?.value).toBe(dateBasis === "posting_date"
      ? "2026-09-03 · using Posting date" : "2026-09-01 · using Transaction date");
  });
  it("keeps exact large decimal strings, negative signs and leading-zero identifiers", async () => {
    const result = await run("transaction_date,amount,reference,source_transaction_id,account_code,description,currency\n2026-09-01,-9007199254740993.10,00017,00042,00100,Exact,MYR");
    const values = financeValues(result.records[0].candidate);
    expect(values.find(value => value.field === "source_amount")?.value).toBe("-9007199254740993.1");
    expect(values.find(value => value.field === "reference")?.value).toBe("00017");
    expect(values.find(value => value.field === "source_transaction_id")?.value).toBe("00042");
    expect(values.find(value => value.field === "account_code")?.value).toBe("00100");
    expect(moneyDescription(result.records[0].candidate)).toContain("-9007199254740993.1");
  });
  it("does not present zero, false or source whitespace as missing", () => {
    expect(sourceValue("0")).toBe("0");
    expect(sourceValue({ kind: "excel_number", value: "0" })).toBe("0");
    expect(sourceValue(false)).toBe("false");
    expect(sourceValue(" 001 ")).toBe(" 001 ");
    expect(sourceValue(null)).toBe("Blank in source");
    expect(checkedValue("0")).toBe("0");
    expect(checkedValue(null)).toBe("Not available");
  });
  it("distinguishes source currency, reviewed defaults and approved blank-side changes", async () => {
    const result = await run("transaction_date,debit,credit,reference,description,currency\n2026-09-01,100,,R,Ledger,", {
      monetaryMode: "debit_credit", blankSideAsZero: true, currencyDefault: "MYR",
    });
    const row = result.records[0];
    expect(row.status).toBe("VALID");
    expect(row.staging.credit).toBe("");
    expect(row.candidate.credit).toBe("0");
    expect(currencyDescription(row.candidate)).toBe("MYR from this file's selected default; currency was blank in the source.");
    expect(transformationDescriptions(row.candidate)).toEqual(["Credit: Blank in source → 0 under your selected blank-side ledger setting."]);
    expect(currencyDescription(results[0].records[0].candidate)).toBe("MYR supplied by the file.");
    expect(transformationDescriptions(results[0].records[0].candidate)).toEqual([]);
  });
  it("keeps bank labels and ledger sides separate without creating a financial total", () => {
    expect(moneyDescription(results[0].records[0].candidate)).toBe("Debit 1500 · Credit 0");
    expect(moneyDescription(results[1].records[0].candidate)).toBe("Amount 125.5 · Debit");
    expect(financeValues(results[0].records[0].candidate).some(value => value.field === "source_amount" && value.value === "Not available")).toBe(true);
    expect(financeValues(results[1].records[0].candidate).some(value => value.field === "debit" && value.value === "Not available")).toBe(true);
  });
  it("distinguishes unreadable dates, missing dates and whole-row issues", () => {
    const invalid = results[2].records.find(row => row.provenance.source_row_number === 7)!;
    const missing = results[2].records.find(row => row.provenance.source_row_number === 9)!;
    const duplicate = results[2].records.find(row => row.provenance.source_row_number === 4)!;
    expect(issueDetails(invalid.issues[0], invalid.candidate)).toMatchObject({ original: "31/31/2026", checked: "Not available" });
    expect(issueDetails(missing.issues.find(issue => issue.rule === "MISSING_DATE")!, missing.candidate).original).toBe("Blank in source");
    const repeated = issueDetails(duplicate.issues.find(issue => issue.rule === "DUPLICATE_ROW")!, duplicate.candidate);
    expect(repeated.original).toContain("Whole original row");
    expect(repeated.problem).toContain("kept");
    expect(repeated.original).not.toBe("Blank in source");
  });
  it("retains every issue and uses the engine message for an unknown rule", () => {
    const row = results[2].records[7];
    expect(row.issues).toHaveLength(2);
    const details = row.issues.map(issue => issueDetails(issue, row.candidate));
    expect(details).toHaveLength(2);
    expect(details.map(issue => issue.field)).toEqual(["Transaction date", "Amount from file"]);
    const unknown = { ...row.issues[0], rule: "FUTURE_CHECK", message: "Future check explanation retained verbatim." };
    expect(issueDetails(unknown, row.candidate).problem).toBe(unknown.message);
    expect(issueDetails(unknown, row.candidate).action).toContain("original file");
  });
  it("identifies the actual bank-column collision without changing authoritative errors", () => {
    const dataset = results[1].dataset;
    const mapping = suggestMapping(dataset);
    const errors = mappingErrors(dataset, approveMapping(mapping), results[1].options);
    const before = JSON.stringify(errors);
    expect(errors).toContain("description is assigned more than once.");
    expect(mappingProblem(errors[0], mapping)).toContain('column 2 "Details" and column 3 "Narration"');
    expect(mappingProblem(errors[0], mapping)).toContain("Description");
    expect(JSON.stringify(errors)).toBe(before);
    expect(mappingProblem("Map the selected date source: posting_date.", mapping)).toContain("Posting date");
    expect(mappingProblem("Unfamiliar blocking check.", mapping)).toBe("Unfamiliar blocking check.");
  });
  it("offers source examples without stripping leading zeros or changing typed source values", () => {
    expect(columnExamples(results[0].profile, 2)).toEqual(["00100"]);
    expect(columnExamples(results[1].profile, 1)).toEqual(["BANK-001", "BANK-002", "BANK-003"]);
  });
  it("does not mutate engine output, messages, lineage or serialized exports", () => {
    const before = JSON.stringify(results);
    const evidence = evidenceJSON(results);
    const csv = canonicalCSV(consolidate(results).normalized);
    for (const result of results) for (const row of result.records) {
      financeValues(row.candidate); currencyDescription(row.candidate); moneyDescription(row.candidate);
      transformationDescriptions(row.candidate); row.issues.forEach(issue => issueDetails(issue, row.candidate));
    }
    expect(JSON.stringify(results)).toBe(before);
    expect(evidenceJSON(results)).toBe(evidence);
    expect(canonicalCSV(consolidate(results).normalized)).toBe(csv);
  });
  it("does not confuse reviewed, blocked, checked and invalidated UI states", () => {
    expect(reviewState(false, false, 0, false)).toBe("Review needed");
    expect(reviewState(false, true, 0, false)).toBe("Review confirmed — not yet checked");
    expect(reviewState(false, true, 1, false)).toBe("Columns or settings need correction");
    expect(reviewState(true, true, 0, false)).toBe("Checked");
    expect(reviewState(false, false, 0, true)).toBe("Needs checking again");
  });
});
