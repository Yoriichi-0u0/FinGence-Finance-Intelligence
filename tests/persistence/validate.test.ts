import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { approveMapping, createDataset, DEFAULT_OPTIONS, ingestDataset, inspectFile, overrideMapping, suggestMapping } from "../../lib/ingestion/index";
import expected from "../../public/samples/ingestion/expected.json";
import type { IngestionOptions } from "../../lib/ingestion/models";
import type { IngestionResult } from "../../lib/ingestion/models";
import { PersistenceError, type PersistenceErrorCode } from "../../lib/server/persistence/contracts";
import { validatePersistenceRequest } from "../../lib/server/persistence/validate";
import { clone, context, header, syntheticResult, validRow } from "./fixtures";

let valid: IngestionResult, warning: IngestionResult;
beforeAll(async () => {
  valid = await syntheticResult();
  warning = await syntheticResult(`${header}\n2026-09-01,2026-09-03,-2,,,,,,,MYRR`);
});
function fails(input: unknown, code: PersistenceErrorCode = "INVALID_INPUT") {
  let caught: unknown;
  try { validatePersistenceRequest(input); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(PersistenceError);
  expect(caught).toMatchObject({ code });
  expect((caught as Error).message).not.toContain(validRow);
}

describe("persistence preflight", () => {
  it("accepts all 23 current engine-produced synthetic handoff records", async () => {
    const results: IngestionResult[] = [];
    for (const fixture of expected.files) {
      const bytes = readFileSync(new URL("../../public/samples/ingestion/" + fixture.file, import.meta.url));
      const dataset = createDataset(await inspectFile(bytes, { name: fixture.file }), fixture.sheet_index);
      let mapping = suggestMapping(dataset);
      if (fixture.manual_mapping) mapping = overrideMapping(mapping, dataset.columns.indexOf("Details"), "reference");
      results.push(ingestDataset(dataset, approveMapping(mapping), {
        ...DEFAULT_OPTIONS, sourceSystem: fixture.sourceSystem,
        monetaryMode: fixture.monetaryMode as IngestionOptions["monetaryMode"],
        dateBasis: fixture.dateBasis as IngestionOptions["dateBasis"],
      }, context));
    }
    const outputs = [...new Set(results.map(result => result.dataset.file.name))]
      .map(name => validatePersistenceRequest({ results: results.filter(result => result.dataset.file.name === name) }));
    const output = { datasets: outputs.flatMap(item => item.datasets) };
    expect(output.datasets.flatMap(dataset => dataset.records)).toHaveLength(23);
    expect(output.datasets.reduce((total, dataset) => total + dataset.counts.valid_count, 0)).toBe(20);
    expect(output.datasets.reduce((total, dataset) => total + dataset.counts.warning_count, 0)).toBe(3);
    expect(output.datasets.reduce((total, dataset) => total + dataset.counts.rejected_count, 0)).toBe(3);
  });
  it("accepts VALID and WARNING results without mutating them", () => {
    for (const result of [valid, warning]) {
      const before = clone(result);
      const output = validatePersistenceRequest({ results: [result] });
      expect(output.datasets[0].records[0]).toEqual(result.normalized[0]);
      expect(result).toEqual(before);
      expect(output.datasets[0].records[0]).not.toBe(result.normalized[0]);
    }
  });
  it.each(["schema_version", "ruleset_version"] as const)("preflights every %s before consolidation", field => {
    const old = clone(valid);
    old[field] = "9.0";
    fails({ results: [old, valid] }, "UNSUPPORTED_VERSION");
    fails({ results: [valid, old] }, "UNSUPPORTED_VERSION");
  });
  it.each([null, undefined, [], {}, { results: [] }, { results: [null] }, { results: "no" }])("rejects malformed request %#", value => {
    fails(value);
  });
  it("rejects sparse arrays and does not execute object accessors", () => {
    fails({ results: Array(1) });
    let accessed = false;
    fails({ get results() { accessed = true; throw new Error("private"); } });
    expect(accessed).toBe(false);
  });
  it("accepts genuine quarantine evidence but never forwards rejected candidates", async () => {
    const result = await syntheticResult(`${header}\n${validRow}\ninvalid,2026-09-03,nope,R,ID,A,B,C,Synthetic,MYR`);
    expect(result.records[1].status).toBe("REJECTED");
    const output = validatePersistenceRequest({ results: [result] });
    expect(output.datasets[0].records).toHaveLength(1);
    expect(output.datasets[0].counts).toEqual({ rows_received: 2, valid_count: 1, warning_count: 0, rejected_count: 1 });
    const tampered = clone(result);
    tampered.normalized.push({ ...result.records[1].candidate, canonical_date: "2026-09-01",
      ingestion_status: "REJECTED", validation_messages: result.records[1].issues } as unknown as IngestionResult["normalized"][number]);
    fails({ results: [tampered] });
  });
  it("allows all-rejected input as a zero-record plan without deciding activation", async () => {
    const result = await syntheticResult(`${header}\ninvalid,2026-09-03,nope,R,ID,A,B,C,Synthetic,MYR`);
    const output = validatePersistenceRequest({ results: [result] });
    expect(output.datasets[0].records).toEqual([]);
    expect(output.datasets[0].counts.rejected_count).toBe(1);
  });
  it.each([
    ["REJECTED status", (r: IngestionResult) => { Object.assign(r.normalized[0], { ingestion_status: "REJECTED" }); }],
    ["VALID carrying issues", (r: IngestionResult) => { r.normalized[0].validation_messages = clone(warning.normalized[0].validation_messages); }],
    ["WARNING without issues", (r: IngestionResult) => { r.normalized[0].ingestion_status = "WARNING"; }],
    ["missing accepted record", (r: IngestionResult) => { r.normalized = []; }],
    ["duplicate accepted record", (r: IngestionResult) => { r.normalized.push(clone(r.normalized[0])); }],
    ["modified candidate amount", (r: IngestionResult) => { r.records[0].candidate.source_amount = "99"; }],
    ["modified candidate reference", (r: IngestionResult) => { r.records[0].candidate.reference = "private"; }],
  ])("rejects %s", (_, tamper) => {
    const r = clone(valid); tamper(r); fails({ results: [r] });
  });
  it.each([
    ["reject severity", { severity: "REJECTED" }], ["unknown category", { category: "other" }],
    ["missing message", { message: undefined }], ["numeric source column", { sourceColumn: 4 }],
    ["numeric original", { originalValue: 42 }], ["invalid original object", { originalValue: { kind: "excel_number", value: 42 } }],
    ["extra original properties", { originalValue: { kind: "excel_number", value: "42", extra: "private" } }],
  ])("rejects warning issue %s", (_, change) => {
    const r = clone(warning); Object.assign(r.normalized[0].validation_messages[0], change); fails({ results: [r] });
  });
  it.each(["2026-02-30", "2025-02-29", "0000-01-01", "2026-1-01", "2026-01-01T00:00:00Z", "private"])("rejects invalid date %s", value => {
    const r = clone(valid); r.normalized[0].transaction_date = value; fails({ results: [r] });
  });
  it.each(["1e3", "NaN", "Infinity", " 1", "1,000", "1.2.3", "+1", "", "1; DROP TABLE x", "9".repeat(129), 2])("rejects invalid decimal %#", value => {
    const r = clone(valid); Object.assign(r.normalized[0], { source_amount: value }); fails({ results: [r] });
  });
  it.each([
    ["batch mismatch", { ingestion_batch_id: "other" }], ["hash mismatch", { file_sha256: "f".repeat(64) }],
    ["file mismatch", { source_file: "other.csv" }], ["sheet mismatch", { source_sheet: "Sheet2" }],
    ["system mismatch", { source_system: "other" }], ["lineage mismatch", { source_row_id: "00017" }],
    ["zero row", { source_row_number: 0 }], ["fractional row", { source_row_number: 2.5 }],
    ["timestamp mismatch", { ingested_at: "2026-10-03T01:00:00.000Z" }],
    ["date-only timestamp", { ingested_at: "2026-10-03" }],
    ["invalid basis", { canonical_date_basis: "OTHER" }], ["basis/date disagreement", { canonical_date: "2026-09-03" }],
    ["invalid money basis", { monetary_basis: "cash" }], ["invalid side", { entry_side: "OUTFLOW" }],
    ["invalid currency origin", { currency_basis: "OTHER" }], ["currency/null mismatch", { currency: null }],
    ["numeric identifier", { reference: 17 }], ["NUL text", { description: "private\u0000text" }],
  ])("rejects %s", (_, change) => {
    const r = clone(valid); Object.assign(r.normalized[0], change); fails({ results: [r] });
  });
  it.each(["rowsReceived", "valid", "warning", "rejected", "accepted"] as const)("rejects inconsistent summary %s", field => {
    const r = clone(valid); r.summary[field]++; fails({ results: [r] });
  });
  it("rejects inconsistent producer/dataset/processed metadata", () => {
    const mutations = [
      (r: IngestionResult) => { r.context.batchId = "other"; },
      (r: IngestionResult) => { r.context.ingestedAt = "2026-10-03T00:00:00Z"; },
      (r: IngestionResult) => { r.dataset.id = "other"; },
      (r: IngestionResult) => { r.records[0].provenance.source_row_id = "other"; },
      (r: IngestionResult) => { r.records[0].raw.rowNumber = 3; },
      (r: IngestionResult) => { r.options.dateBasis = "posting_date"; },
      (r: IngestionResult) => { r.options.monetaryMode = "debit_credit"; },
    ];
    for (const mutate of mutations) { const r = clone(valid); mutate(r); fails({ results: [r] }); }
  });
  it("rejects mixed producer IDs including a replaced earlier dataset", async () => {
    const other = await syntheticResult(undefined, {}, { ...context, batchId: "other" });
    fails({ results: [other, valid] }, "MIXED_BATCH_IDS");
  });
  it("consolidates latest same dataset only after all-result preflight", async () => {
    const newer = await syntheticResult(undefined, {}, { ...context, ingestedAt: "2026-10-03T01:00:00.000Z" });
    const output = validatePersistenceRequest({ results: [valid, newer] });
    expect(output.datasets).toHaveLength(1);
    expect(output.datasets[0].counts.rows_received).toBe(1);
    expect(output.datasets[0].records[0].ingested_at).toBe(newer.context.ingestedAt);
    const broken = clone(valid); broken.summary.accepted = 99;
    fails({ results: [broken, newer] });
  });
  it("checks exact ledger subtraction and direction requirements", async () => {
    const ledger = await syntheticResult("transaction_date,debit,credit,reference,description,currency\n2026-09-01,9007199254740993.1,0.000000001,R,Synthetic,MYR", { monetaryMode: "debit_credit" });
    expect(validatePersistenceRequest({ results: [ledger] }).datasets[0].records[0].derived_ledger_net).toBe("9007199254740993.099999999");
    ledger.normalized[0].derived_ledger_net = "9007199254740993.1";
    fails({ results: [ledger] });
    const directed = await syntheticResult("transaction_date,amount,entry_side,reference,description,currency\n2026-09-01,12.3,Debit,R,Synthetic,MYR", { monetaryMode: "amount_direction" });
    expect(validatePersistenceRequest({ results: [directed] }).datasets[0].records[0].source_amount).toBe("12.3");
    for (const change of [{ entry_side: null }, { source_amount: "-12.3" }, { derived_ledger_net: "1" }]) {
      const r = clone(directed); Object.assign(r.normalized[0], change); fails({ results: [r] });
    }
  });
  it("does not reject reviewed negative/dual-sided ledger values or malformed warned currency", async () => {
    const result = await syntheticResult("transaction_date,debit,credit,reference,description,currency\n2026-09-01,-10,2,R,Synthetic,MYRR", { monetaryMode: "debit_credit" });
    const row = validatePersistenceRequest({ results: [result] }).datasets[0].records[0];
    expect(row).toMatchObject({ debit: "-10", credit: "2", derived_ledger_net: "-12", currency: "MYRR", ingestion_status: "WARNING" });
  });
  it("accepts object key reordering but detects warning issue reordering", () => {
    const result = clone(warning);
    result.records[0].issues = result.records[0].issues.map(value => Object.fromEntries(Object.entries(value).reverse()) as typeof value);
    expect(validatePersistenceRequest({ results: [result] }).datasets[0].records[0].validation_messages).toEqual(warning.normalized[0].validation_messages);
    result.normalized[0].validation_messages.reverse();
    fails({ results: [result] });
  });
  it("checks transformation approval, shape and target consistency", async () => {
    const ledger = await syntheticResult("transaction_date,debit,credit,reference,description,currency\n2026-09-01,,12,R,Synthetic,MYR", { monetaryMode: "debit_credit", blankSideAsZero: true });
    expect(validatePersistenceRequest({ results: [ledger] }).datasets[0].records[0].transformations).toEqual(ledger.normalized[0].transformations);
    for (const change of [{ rule: "OTHER" }, { normalized_value: "1" }, { field: "credit" }, { original_value: "12" }]) {
      const r = clone(ledger); Object.assign(r.normalized[0].transformations[0], change); fails({ results: [r] });
    }
    const unapproved = clone(ledger); unapproved.options.blankSideAsZero = false; fails({ results: [unapproved] });
  });
});
