import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  approveMapping, consolidate, createDataset, DEFAULT_OPTIONS, evidenceJSON,
  ingestDataset, inspectFile, overrideMapping, suggestMapping,
  type CanonicalTransaction, type IngestionOptions, type IngestionResult,
} from "../../lib/ingestion/index";
import { consumeAcceptedTransactions } from "../../examples/ingestion/consume";
import expected from "../../public/samples/ingestion/expected.json";

const context = {
  batchId: "synthetic-handoff-example-batch-001",
  ingestedAt: "2026-10-02T00:00:00.000Z",
};
const examplePath = new URL("../../docs/handoff/examples/ingestion-evidence.json", import.meta.url);
let results: IngestionResult[];

beforeAll(async () => {
  results = [];
  for (const fixture of expected.files) {
    const bytes = readFileSync(new URL("../../public/samples/ingestion/" + fixture.file, import.meta.url));
    const file = await inspectFile(bytes, { name: fixture.file });
    expect(file.fingerprint).toBe(createHash("sha256").update(bytes).digest("hex"));
    const dataset = createDataset(file, fixture.sheet_index);
    let mapping = suggestMapping(dataset);
    if (fixture.manual_mapping) mapping = overrideMapping(mapping, dataset.columns.indexOf("Details"), "reference");
    results.push(ingestDataset(dataset, approveMapping(mapping), {
      ...DEFAULT_OPTIONS,
      sourceSystem: fixture.sourceSystem,
      monetaryMode: fixture.monetaryMode as IngestionOptions["monetaryMode"],
      dateBasis: fixture.dateBasis as IngestionOptions["dateBasis"],
    }, context));
  }
});

describe("accepted-record handoff through the public ingestion entry point", () => {
  it("visits exactly 20 VALID and 3 WARNING IDs from 26 processed rows, never quarantine", () => {
    const visited: Readonly<CanonicalTransaction>[] = [];
    const report = consumeAcceptedTransactions(results, row => { visited.push(row); });
    const processed = results.flatMap(result => result.records);
    const acceptedIds = processed.filter(row => row.status !== "REJECTED").map(row => row.provenance.source_row_id);
    const rejectedIds = processed.filter(row => row.status === "REJECTED").map(row => row.provenance.source_row_id);

    expect(processed).toHaveLength(26);
    expect(results.flatMap(result => result.normalized)).toHaveLength(23);
    expect(rejectedIds).toHaveLength(3);
    expect(visited).toHaveLength(23);
    expect(visited.filter(row => row.ingestion_status === "VALID")).toHaveLength(20);
    expect(visited.filter(row => row.ingestion_status === "WARNING")).toHaveLength(3);
    expect(visited.map(row => row.ingestion_status)).not.toContain("REJECTED");
    expect(visited.map(row => row.source_row_id)).toEqual(acceptedIds);
    expect(visited.every(row => !rejectedIds.includes(row.source_row_id))).toBe(true);
    expect(report).toMatchObject({ schema_version: "0.1", ruleset_version: "0.1",
      counts: { received: 26, forwarded: 23, valid: 20, warning: 3, rejectedNotForwarded: 3 } });
  });

  it.each([
    ["schema_version", "later dataset"], ["ruleset_version", "later dataset"],
    ["schema_version", "latest same dataset"], ["ruleset_version", "latest same dataset"],
    ["schema_version", "replaced earlier dataset"], ["ruleset_version", "replaced earlier dataset"],
  ] as const)("preflights %s on a %s before any callback", (field, layout) => {
    const incompatible = { ...(layout === "later dataset" ? results[1] : results[0]), [field]: "9.0" };
    const supplied = layout === "replaced earlier dataset" ? [incompatible, results[0]] : [results[0], incompatible];
    const visitedIds: string[] = [];
    let failure: unknown;
    try {
      consumeAcceptedTransactions(supplied, row => { visitedIds.push(row.source_row_id); });
    } catch (error) { failure = error; }
    // Inspect side effects independently of whether an exception was thrown.
    expect(visitedIds).toEqual([]);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(field);
  });

  it("keeps full warning reasons and all source lineage without mutating the input", () => {
    const before = JSON.stringify(results);
    const visited: Readonly<CanonicalTransaction>[] = [];
    const report = consumeAcceptedTransactions(results, row => { visited.push(row); });
    const processed = results.flatMap(result => result.records);
    for (const row of visited) {
      const original = processed.find(source => source.provenance.source_row_id === row.source_row_id)!;
      expect(row).toMatchObject(original.provenance);
      expect(row.validation_messages).toEqual(original.issues);
      expect(report.lineage.find(source => source.source_row_id === row.source_row_id)).toEqual(original.provenance);
    }
    expect(visited.filter(row => row.ingestion_status === "WARNING").map(row => row.source_row_number)).toEqual([4, 5, 6]);
    expect(visited.flatMap(row => row.validation_messages.map(issue => issue.rule))).toEqual(expect.arrayContaining([
      "DUPLICATE_ROW", "MISSING_REFERENCE", "MALFORMED_CURRENCY",
    ]));
    expect(JSON.stringify(results)).toBe(before);
  });

  it("preserves exact large decimal strings, text identifiers, independent dates and UTC provenance", async () => {
    const csv = "transaction_date,posting_date,amount,reference,source_transaction_id,account_code,description,currency\n2026-09-01,2026-09-03,-9007199254740993.10,00017,00042,00100,Exact values,MYR";
    const dataset = createDataset(await inspectFile(new TextEncoder().encode(csv), { name: "synthetic-exact-values.csv" }), 0);
    const result = ingestDataset(dataset, approveMapping(suggestMapping(dataset)), { ...DEFAULT_OPTIONS, dateBasis: "posting_date" },
      { batchId: context.batchId, ingestedAt: "2026-10-02T08:00:00+08:00" });
    const visited: Readonly<CanonicalTransaction>[] = [];
    consumeAcceptedTransactions([result], row => { visited.push(row); });
    expect(visited).toHaveLength(1);
    expect(visited[0]).toMatchObject({ source_amount: "-9007199254740993.1", reference: "00017", source_transaction_id: "00042",
      account_code: "00100", transaction_date: "2026-09-01", posting_date: "2026-09-03", canonical_date: "2026-09-03",
      canonical_date_basis: "POSTING_DATE", ingested_at: context.ingestedAt });
    expect(typeof visited[0].source_amount).toBe("string");
    expect(visited[0]).toEqual(result.normalized[0]);
  });

  it("preserves bank direction and ledger representation without inventing financial totals", () => {
    const visited: Readonly<CanonicalTransaction>[] = [];
    const report = consumeAcceptedTransactions(results, row => { visited.push(row); });
    expect(visited[0]).toMatchObject({ monetary_basis: "debit_credit", source_amount: null, debit: "1500", credit: "0", derived_ledger_net: "1500" });
    expect(visited.find(row => row.source_file === "bank_statement.xlsx")).toMatchObject({
      monetary_basis: "source_amount_with_direction", source_amount: "125.5", entry_side: "DEBIT", derived_ledger_net: null,
    });
    expect(report).not.toHaveProperty("totalAmount");
    expect(report).not.toHaveProperty("records");
  });

  it("uses the latest same-dataset result without visiting duplicate source IDs", () => {
    const reprocessed = ingestDataset(results[0].dataset, results[0].mapping, results[0].options,
      { ...context, ingestedAt: "2026-10-02T01:00:00.000Z" });
    const visited: Readonly<CanonicalTransaction>[] = [];
    const report = consumeAcceptedTransactions([...results, reprocessed], row => { visited.push(row); });
    expect(visited).toHaveLength(23);
    expect(new Set(visited.map(row => row.source_row_id)).size).toBe(23);
    expect(visited.filter(row => row.source_file === "ledger.csv").every(row => row.ingested_at === reprocessed.context.ingestedAt)).toBe(true);
    expect(report.counts.received).toBe(26);
  });

  it("handles an empty result collection without inventing records", () => {
    const visited: string[] = [];
    const report = consumeAcceptedTransactions([], row => { visited.push(row.source_row_id); });
    expect(visited).toEqual([]);
    expect(report.counts).toEqual({ received: 0, forwarded: 0, valid: 0, warning: 0, rejectedNotForwarded: 0 });
    expect(report.lineage).toEqual([]);
  });
});

it("matches the checked synthetic evidence example to the real export and independent fixture expectations", () => {
  const combined = consolidate(results);
  for (const [index, fixture] of expected.files.entries()) expect(results[index].summary).toMatchObject(fixture.expected);
  expect(combined.summary).toMatchObject(expected.consolidated);
  for (const field of ["successRate", "cleanValidityRate", "requiredCompleteness"] as const) {
    expect(combined.summary[field]?.toFixed(2) + "%").toBe(expected.rates_displayed[field]);
  }
  expect(combined.rejected.map(row => row.provenance.source_row_number)).toEqual(expected.quarantine_source_rows);
  expect(results[0].normalized[0]).toMatchObject(expected.canonical_examples.ledger_first_dates);
  expect(results[1].normalized[0]).toMatchObject(expected.canonical_examples.bank_first_dates);
  expect(results[0].normalized[0].account_code).toBe(expected.canonical_examples.ledger_account_code);
  expect(results[1].normalized.map(row => row.source_amount)).toEqual(expected.canonical_examples.bank_source_amounts);
  expect(results[1].mapping.find(mapping => mapping.sourceColumn === "Details")).toMatchObject({ target: "reference", method: "manual", userConfirmed: true });

  const exported = evidenceJSON(results) + "\n";
  // Explicit authoring command only; ordinary verification never rewrites the example.
  if (process.env.FINSIGHT_REGENERATE_HANDOFF_EXAMPLE === "1") {
    mkdirSync(new URL("./", examplePath), { recursive: true });
    writeFileSync(examplePath, exported);
  }
  expect(readFileSync(examplePath, "utf8")).toBe(exported);
});
