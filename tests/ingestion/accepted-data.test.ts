import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  approveMapping, canonicalCSV, consolidate, createAcceptedDataPayload, createDataset, DEFAULT_OPTIONS,
  evidenceJSON, ingestDataset, inspectFile, overrideMapping, rejectedCSV, suggestMapping,
  type IngestionOptions, type IngestionResult,
} from "../../lib/ingestion/index";
import expected from "../../public/samples/ingestion/expected.json";
import { prepareAcceptedDataExample } from "../../examples/ingestion/accepted-data";

const context = { batchId: "synthetic-c1-batch-001", ingestedAt: "2026-10-05T00:00:00.000Z" };
let results: IngestionResult[];

async function run(csv: string, options: Partial<IngestionOptions> = {}) {
  const dataset = createDataset(await inspectFile(new TextEncoder().encode(csv), { name: "synthetic-c1.csv" }), 0);
  return ingestDataset(dataset, approveMapping(suggestMapping(dataset)), { ...DEFAULT_OPTIONS, ...options }, context);
}

beforeAll(async () => {
  results = [];
  for (const fixture of expected.files) {
    const file = await inspectFile(readFileSync(new URL("../../public/samples/ingestion/" + fixture.file, import.meta.url)), { name: fixture.file });
    const dataset = createDataset(file, fixture.sheet_index);
    let mapping = suggestMapping(dataset);
    if (fixture.manual_mapping) mapping = overrideMapping(mapping, dataset.columns.indexOf("Details"), "reference");
    results.push(ingestDataset(dataset, approveMapping(mapping), {
      ...DEFAULT_OPTIONS, sourceSystem: fixture.sourceSystem,
      monetaryMode: fixture.monetaryMode as IngestionOptions["monetaryMode"],
      dateBasis: fixture.dateBasis as IngestionOptions["dateBasis"],
    }, context));
  }
});

describe("accepted-data transport through the public entry point", () => {
  it("forwards the actual 20 VALID and 3 WARNING IDs from 26 processed rows, never the 3 rejected IDs", () => {
    const payload = createAcceptedDataPayload(results);
    const rows = payload.datasets.flatMap(dataset => dataset.normalized);
    const processed = results.flatMap(result => result.records);
    const rejectedIds = processed.filter(row => row.status === "REJECTED").map(row => row.provenance.source_row_id);
    expect(processed).toHaveLength(26);
    expect(rejectedIds).toHaveLength(3);
    expect(rows).toHaveLength(23);
    expect(rows.filter(row => row.ingestion_status === "VALID")).toHaveLength(20);
    expect(rows.filter(row => row.ingestion_status === "WARNING")).toHaveLength(3);
    expect(rows.map(row => row.ingestion_status)).not.toContain("REJECTED");
    expect(rows.map(row => row.source_row_id)).toEqual(consolidate(results).normalized.map(row => row.source_row_id));
    expect(rows.every(row => !rejectedIds.includes(row.source_row_id))).toBe(true);
    expect(payload).toMatchObject({ schema_version: "0.1", ruleset_version: "0.1" });
    expect(payload.datasets.reduce((count, dataset) => count + dataset.summary.rejected, 0)).toBe(3);
  });

  it.each([
    ["schema_version", "later dataset"], ["ruleset_version", "later dataset"],
    ["schema_version", "latest same dataset"], ["ruleset_version", "latest same dataset"],
    ["schema_version", "replaced earlier dataset"], ["ruleset_version", "replaced earlier dataset"],
  ] as const)("preflights %s on a %s before any accepted-record access", (field, layout) => {
    const incompatible = { ...(layout === "later dataset" ? results[1] : results[0]), [field]: "9.0" };
    const accessed = vi.fn(() => { throw new Error("Accepted rows must not be read before version preflight."); });
    const compatible = { ...results[0], get normalized() { return accessed(); } };
    const supplied = layout === "replaced earlier dataset" ? [incompatible, compatible] : [compatible, incompatible];
    expect(() => createAcceptedDataPayload(supplied)).toThrow("Unsupported " + field);
    expect(accessed).not.toHaveBeenCalled();
  });

  it("preserves every warning field, including unknown rule strings and scalar evidence", () => {
    const supplied = structuredClone(results);
    const warning = supplied[2].normalized.find(row => row.ingestion_status === "WARNING")!;
    warning.validation_messages.push({ rule: "FUTURE_NOTICE", category: "business", severity: "WARNING",
      field: "reference", sourceColumn: "Reference", originalValue: "00000", message: "Keep this unfamiliar warning." });
    const payload = createAcceptedDataPayload(supplied);
    for (const [index, dataset] of payload.datasets.entries()) {
      for (const [rowIndex, row] of dataset.normalized.entries()) {
        expect(row.validation_messages).toEqual(supplied[index].normalized[rowIndex].validation_messages);
      }
    }
    expect(payload.datasets[2].normalized.flatMap(row => row.validation_messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "DUPLICATE_ROW" }), expect.objectContaining({ rule: "FUTURE_NOTICE", originalValue: "00000" }),
    ]));
  });

  it("reconstructs exact canonical lineage from dataset context and row coordinates", () => {
    const payload = createAcceptedDataPayload(results);
    for (const [index, dataset] of payload.datasets.entries()) {
      expect(dataset.dataset_id).toBe(results[index].dataset.id);
      for (const [rowIndex, row] of dataset.normalized.entries()) {
        const source = results[index].normalized[rowIndex];
        const lineage = {
          source_system: dataset.source_system, source_file: dataset.source_file, source_sheet: dataset.source_sheet,
          file_sha256: dataset.file_sha256, ingestion_batch_id: dataset.ingestion_batch_id, ingested_at: dataset.ingested_at,
          source_row_number: row.source_row_number, source_row_id: row.source_row_id,
        };
        expect(source).toMatchObject(lineage);
        expect(lineage).toEqual(results[index].records.find(record => record.provenance.source_row_id === row.source_row_id)!.provenance);
      }
    }
    expect(payload.datasets[0].source_sheet).toBeNull();
    expect(payload.datasets[1].source_sheet).toBe("Transactions");
  });

  it("preserves existing filename text and different dataset batch contexts exactly", () => {
    const supplied = structuredClone(results);
    for (const [index, result] of supplied.entries()) {
      const batchId = index === 0 ? "  caller-kept-batch  " : "caller-batch-" + index;
      const ingestedAt = "2026-10-05T0" + index + ":00:00.000Z";
      // These are trusted producer values; the projection must not normalize them again.
      result.dataset.file.name = " existing source " + index + ".csv ";
      result.context = { batchId, ingestedAt };
      for (const row of result.normalized) Object.assign(row, {
        source_file: result.dataset.file.name, ingestion_batch_id: batchId, ingested_at: ingestedAt,
      });
    }
    const payload = createAcceptedDataPayload(supplied);
    expect(payload.datasets.map(dataset => dataset.source_file)).toEqual(supplied.map(result => result.dataset.file.name));
    expect(payload.datasets.map(dataset => dataset.ingestion_batch_id)).toEqual(supplied.map(result => result.context.batchId));
    expect(payload.datasets.map(dataset => dataset.ingested_at)).toEqual(supplied.map(result => result.context.ingestedAt));
    expect(payload).not.toHaveProperty("ingestion_batch_id");
  });

  it("preserves large signed decimals, optional source fields, zero and leading-zero identifiers", async () => {
    const result = await run("transaction_date,amount,reference,source_transaction_id,account_code,account_id,entity_id,description,counterparty,balance,currency\n2026-09-01,-9007199254740993.10,00017,00042,00100,00009,00008,Exact values,Synthetic party,0,MYR");
    const row = createAcceptedDataPayload([result]).datasets[0].normalized[0];
    expect(row).toMatchObject({ source_amount: "-9007199254740993.1", reference: "00017", source_transaction_id: "00042",
      account_code: "00100", account_id: "00009", entity_id: "00008", counterparty: "Synthetic party", balance: "0" });
    expect(typeof row.source_amount).toBe("string");
    expect(row.posting_date).toBeNull();
    expect(row.debit).toBeNull();
    expect(row.credit).toBeNull();
  });

  it.each([
    ["transaction_date", "2026-09-01", "TRANSACTION_DATE"],
    ["posting_date", "2026-09-03", "POSTING_DATE"],
  ] as const)("preserves both distinct source dates when %s is selected", async (dateBasis, canonicalDate, basis) => {
    const result = await run("transaction_date,posting_date,amount,reference,description,currency\n2026-09-01,2026-09-03,10,R,Text,MYR", { dateBasis });
    expect(createAcceptedDataPayload([result]).datasets[0].normalized[0]).toMatchObject({
      transaction_date: "2026-09-01", posting_date: "2026-09-03", canonical_date: canonicalDate, canonical_date_basis: basis,
    });
  });

  it("retains the invalid optional date's source value after that date becomes null", async () => {
    const result = await run("transaction_date,posting_date,amount,reference,description,currency\n2026-09-01,2026-02-30,10,R,Text,MYR");
    const row = createAcceptedDataPayload([result]).datasets[0].normalized[0];
    expect(row).toMatchObject({ posting_date: null, canonical_date: "2026-09-01", ingestion_status: "WARNING" });
    expect(row.validation_messages).toEqual(result.normalized[0].validation_messages);
    expect(row.validation_messages).toEqual(expect.arrayContaining([expect.objectContaining({
      rule: "INVALID_DATE", field: "posting_date", originalValue: "2026-02-30", severity: "WARNING",
    })]));
  });

  it("keeps all three monetary bases separate and excludes ledger-derived net", () => {
    const payload = createAcceptedDataPayload(results);
    expect(payload.datasets[0].normalized[0]).toMatchObject({ monetary_basis: "debit_credit", debit: "1500", credit: "0", source_amount: null });
    expect(payload.datasets[1].normalized[0]).toMatchObject({ monetary_basis: "source_amount_with_direction", source_amount: "125.5", entry_side: "DEBIT", debit: null, credit: null });
    expect(payload.datasets[2].normalized[0]).toMatchObject({ monetary_basis: "source_signed_amount", debit: null, credit: null });
    for (const row of payload.datasets.flatMap(dataset => dataset.normalized)) {
      expect(row).not.toHaveProperty("derived_ledger_net");
      expect(row).not.toHaveProperty("amount");
      expect(row).not.toHaveProperty("cash_flow");
    }
    expect(results[0].normalized[0].derived_ledger_net).toBe("1500");
  });

  it("keeps additional mapped monetary fields without interpreting them as one amount", async () => {
    const result = await run("transaction_date,debit,credit,amount,reference,description,currency\n2026-09-01,100,0,-12.50,R,Text,MYR", { monetaryMode: "debit_credit" });
    expect(createAcceptedDataPayload([result]).datasets[0].normalized[0]).toMatchObject({
      monetary_basis: "debit_credit", debit: "100", credit: "0", source_amount: "-12.5",
    });
  });

  it.each([
    ["usd", "MYR", "USD", "SOURCE", "VALID"],
    ["", "myr", "MYR", "DATASET_DEFAULT", "VALID"],
    ["", null, null, null, "WARNING"],
  ] as const)("preserves currency origin for source %s and default %s", async (source, currencyDefault, currency, basis, status) => {
    const result = await run("transaction_date,amount,reference,description,currency\n2026-09-01,10,R,Text," + source, { currencyDefault });
    const row = createAcceptedDataPayload([result]).datasets[0].normalized[0];
    expect(row).toMatchObject({ currency, currency_basis: basis, ingestion_status: status });
    expect(row.validation_messages).toEqual(result.normalized[0].validation_messages);
  });

  it.each(["", null, "  "] as const)("preserves approved zero provenance for original blank value %s", async original => {
    const first = await run("transaction_date,debit,credit,reference,description,currency\n2026-09-01,100,,R,Text,MYR", { monetaryMode: "debit_credit", blankSideAsZero: true });
    first.dataset.rows[0].cells[first.dataset.columns.indexOf("credit")] = original;
    const result = ingestDataset(first.dataset, first.mapping, first.options, context);
    const row = createAcceptedDataPayload([result]).datasets[0].normalized[0];
    expect(row).toMatchObject({ debit: "100", credit: "0" });
    expect(row.transformations).toEqual([{ field: "credit", source_column: "credit", original_value: original,
      normalized_value: "0", rule: "APPROVED_BLANK_SIDE_ZERO" }]);
  });

  it("does not invent a transformation for an actual source zero", async () => {
    const result = await run("transaction_date,debit,credit,reference,description,currency\n2026-09-01,100,0,R,Text,MYR", { monetaryMode: "debit_credit", blankSideAsZero: true });
    expect(createAcceptedDataPayload([result]).datasets[0].normalized[0].transformations).toEqual([]);
  });

  it("delegates replacement/order to consolidate, preserving fresh caller batch B and original source IDs", () => {
    const reprocessed = ingestDataset(results[0].dataset, results[0].mapping, results[0].options,
      { batchId: "synthetic-c1-batch-002", ingestedAt: "2026-10-05T01:00:00.000Z" });
    const supplied = [...results, reprocessed];
    const combined = consolidate(supplied);
    const payload = createAcceptedDataPayload(supplied);
    expect(payload.datasets.map(dataset => dataset.dataset_id)).toEqual(combined.results.map(result => result.dataset.id));
    expect(payload.datasets.flatMap(dataset => dataset.normalized.map(row => row.source_row_id))).toEqual(combined.normalized.map(row => row.source_row_id));
    expect(payload.datasets[0].ingestion_batch_id).toBe("synthetic-c1-batch-002");
    expect(payload.datasets[0].normalized.map(row => row.source_row_id)).toEqual(results[0].normalized.map(row => row.source_row_id));
    expect(payload.datasets.flatMap(dataset => dataset.normalized)).toHaveLength(23);
    expect(payload.datasets.map(dataset => dataset.summary.rowsReceived)).toEqual([10, 8, 8]);
    expect(payload.datasets[0]).not.toHaveProperty("supersedes_batch_id");
  });

  it("preserves a reused session batch ID without claiming reprocessing produced a new batch", () => {
    const reprocessed = ingestDataset(results[0].dataset, results[0].mapping, results[0].options,
      { ...context, ingestedAt: "2026-10-05T02:00:00.000Z" });
    const dataset = createAcceptedDataPayload([results[0], reprocessed]).datasets[0];
    expect(dataset.ingestion_batch_id).toBe(context.batchId);
    expect(dataset.ingested_at).toBe(reprocessed.context.ingestedAt);
    expect(dataset.normalized).toHaveLength(10);
  });

  it("does not infer changed-file supersession from an identical filename", async () => {
    const header = "transaction_date,amount,reference,description,currency\n";
    const first = await run(header + "2026-09-01,10,R,Text,MYR");
    const changed = await run(header + "2026-09-01,11,R,Text,MYR");
    const payload = createAcceptedDataPayload([first, changed]);
    expect(payload.datasets).toHaveLength(2);
    expect(payload.datasets.map(dataset => dataset.source_file)).toEqual(["synthetic-c1.csv", "synthetic-c1.csv"]);
    expect(payload.datasets[0].dataset_id).not.toBe(payload.datasets[1].dataset_id);
    expect(payload.datasets.flatMap(dataset => dataset.normalized)).toHaveLength(2);
  });

  it("copies the seven authoritative summary values without recalculating completeness", () => {
    const payload = createAcceptedDataPayload(results);
    for (const [index, dataset] of payload.datasets.entries()) {
      const summary = results[index].summary;
      expect(dataset.summary).toEqual({ rowsReceived: summary.rowsReceived, accepted: summary.accepted,
        valid: summary.valid, warning: summary.warning, rejected: summary.rejected,
        requiredCompleteness: summary.requiredCompleteness, duplicateRows: summary.duplicateRows });
    }
    expect(payload.datasets[2].summary).toMatchObject({ rowsReceived: 8, accepted: 5, valid: 2, warning: 3, rejected: 3, duplicateRows: 1 });
    expect(payload.datasets[2].summary.requiredCompleteness).toBe(87.5);
  });

  it("keeps all-rejected dataset context and counts but never falls back to its candidates", async () => {
    const result = await run("transaction_date,posting_date,amount,reference,description,currency\n2026-02-30,2026-09-03,10,R,Text,MYR", { sourceSystem: "  Source label  " });
    const dataset = createAcceptedDataPayload([result]).datasets[0];
    expect(dataset).toMatchObject({ source_system: "Source label", source_file: result.dataset.file.name,
      source_sheet: null, ingestion_batch_id: context.batchId, normalized: [],
      summary: { rowsReceived: 1, accepted: 0, valid: 0, warning: 0, rejected: 1, requiredCompleteness: 100, duplicateRows: 0 } });
    expect(result.records[0].candidate.posting_date).toBe("2026-09-03");
    expect(dataset).not.toHaveProperty("records");
  });

  it("handles empty input without inventing a batch, summary or financial values", () => {
    expect(createAcceptedDataPayload([])).toEqual({ schema_version: "0.1", ruleset_version: "0.1", datasets: [] });
  });

  it("exposes only the approved wire fields, even when input objects have unrelated extra properties", () => {
    const supplied = structuredClone(results);
    Object.assign(supplied[2].normalized[0], { backend_id: "excluded-sentinel", raw: ["excluded-sentinel"], suitable_for_forecasting: true });
    const issue = supplied[2].normalized.find(row => row.ingestion_status === "WARNING")!.validation_messages[0];
    Object.assign(issue, { raw_record: ["excluded-sentinel"] });
    Object.assign(supplied[0].summary, { financial_total: "excluded-sentinel" });
    const payload = createAcceptedDataPayload(supplied);
    expect(Object.keys(payload).sort()).toEqual(["datasets", "ruleset_version", "schema_version"]);
    for (const dataset of payload.datasets) {
      expect(Object.keys(dataset).sort()).toEqual(["dataset_id", "file_sha256", "ingested_at", "ingestion_batch_id", "normalized", "source_file", "source_sheet", "source_system", "summary"]);
      expect(Object.keys(dataset.summary).sort()).toEqual(["accepted", "duplicateRows", "rejected", "requiredCompleteness", "rowsReceived", "valid", "warning"]);
      for (const row of dataset.normalized) {
        expect(Object.keys(row).sort()).toEqual([
          "account_code", "account_id", "balance", "canonical_date", "canonical_date_basis", "counterparty", "credit", "currency", "currency_basis",
          "debit", "description", "entity_id", "entry_side", "ingestion_status", "monetary_basis", "posting_date", "reference", "source_amount",
          "source_row_id", "source_row_number", "source_transaction_id", "transaction_date", "transformations", "validation_messages",
        ]);
        for (const warning of row.validation_messages) expect(Object.keys(warning).sort()).toEqual(["category", "field", "message", "originalValue", "rule", "severity", "sourceColumn"]);
      }
    }
    expect(JSON.stringify(payload)).not.toContain("excluded-sentinel");
  });

  it("detaches typed warning and transformation scalars, arrays, metadata and summaries", async () => {
    const first = await run("transaction_date,debit,credit,reference,account_code,description,currency\n2026-09-01,100,,R,00100,Text,MYR", { monetaryMode: "debit_credit", blankSideAsZero: true });
    first.dataset.rows[0].cells[first.dataset.columns.indexOf("credit")] = { kind: "excel_number", value: "" };
    first.dataset.rows[0].cells[first.dataset.columns.indexOf("account_code")] = { kind: "excel_number", value: "100" };
    const result = ingestDataset(first.dataset, first.mapping, first.options, context);
    const before = JSON.stringify(result);
    const payload = createAcceptedDataPayload([result]);
    const row = payload.datasets[0].normalized[0];
    expect(row.validation_messages[0].originalValue).toEqual({ kind: "excel_number", value: "100" });
    expect(row.transformations[0]).toEqual({ field: "credit", source_column: "credit", original_value: { kind: "excel_number", value: "" }, normalized_value: "0", rule: "APPROVED_BLANK_SIDE_ZERO" });
    const warningValue = row.validation_messages[0].originalValue;
    const transformationValue = row.transformations[0].original_value;
    if (warningValue !== null && typeof warningValue === "object") warningValue.value = "changed";
    if (transformationValue !== null && typeof transformationValue === "object") transformationValue.value = "changed";
    row.validation_messages[0].message = "changed";
    row.validation_messages.length = 0;
    row.transformations.length = 0;
    row.source_amount = "changed";
    payload.datasets[0].source_file = "changed";
    payload.datasets[0].summary.accepted = 99;
    payload.datasets[0].normalized.length = 0;
    expect(JSON.stringify(result)).toBe(before);
  });

  it("is deterministic on deeply frozen inputs and leaves all existing export bytes unchanged", () => {
    const supplied = structuredClone(results);
    function freeze(value: unknown) {
      if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
      }
    }
    freeze(supplied);
    const original = JSON.stringify(supplied);
    const combined = consolidate(supplied);
    const before = [evidenceJSON(supplied), canonicalCSV(combined.normalized), rejectedCSV(combined.rejected)];
    const first = JSON.stringify(createAcceptedDataPayload(supplied));
    expect(JSON.stringify(createAcceptedDataPayload(supplied))).toBe(first);
    expect(JSON.stringify(supplied)).toBe(original);
    expect([evidenceJSON(supplied), canonicalCSV(combined.normalized), rejectedCSV(combined.rejected)]).toEqual(before);
  });

  it.each(["source_system", "source_file", "source_sheet", "file_sha256", "ingestion_batch_id", "ingested_at"] as const)("fails without repair when normalized shared %s disagrees with its dataset", field => {
    const supplied = structuredClone(results[0]);
    supplied.normalized[0][field] = "unexpected";
    const before = JSON.stringify(supplied);
    expect(() => createAcceptedDataPayload([supplied])).toThrow("Accepted-data provenance mismatch: " + field);
    expect(JSON.stringify(supplied)).toBe(before);
  });

  it("refuses an impossible REJECTED normalized status without reclassifying it", () => {
    const supplied = structuredClone(results[0]);
    Object.assign(supplied.normalized[0], { ingestion_status: "REJECTED" });
    expect(() => createAcceptedDataPayload([supplied])).toThrow("normalized records must be VALID or WARNING");
  });

  it("refuses a rejection issue inside accepted output instead of dropping it", () => {
    const supplied = structuredClone(results[2]);
    const row = supplied.normalized.find(row => row.ingestion_status === "WARNING")!;
    row.validation_messages[0].severity = "REJECTED";
    expect(() => createAcceptedDataPayload([supplied])).toThrow("accepted issues must be WARNING");
  });

  it("demonstrates accepted-only consumption and reconstructed warning lineage without React or financial totals", () => {
    const example = prepareAcceptedDataExample(results);
    expect(example.payload).toEqual(createAcceptedDataPayload(results));
    expect(example.lineage).toHaveLength(23);
    expect(example.lineage.filter(row => row.ingestion_status === "WARNING")).toHaveLength(3);
    expect(example.lineage.map(row => row.source_row_id)).toEqual(consolidate(results).normalized.map(row => row.source_row_id));
    expect(example.lineage.every(row => row.ingestion_batch_id === context.batchId)).toBe(true);
    expect(example.lineage.find(row => row.ingestion_status === "WARNING")!.validation_messages.length).toBeGreaterThan(0);
    expect(example.payload.datasets.map(dataset => dataset.summary.rejected)).toEqual([0, 0, 3]);
    expect(example).not.toHaveProperty("totalAmount");
  });
});
