import Papa from "papaparse";
import { expect, it } from "vitest";
import { inspectFile, createDataset } from "../../lib/ingestion/readers";
import { approveMapping, suggestMapping } from "../../lib/ingestion/mapper";
import { ingestDataset } from "../../lib/ingestion/pipeline";
import { DEFAULT_OPTIONS } from "../../lib/ingestion/models";
import { canonicalCSV, rejectedCSV, evidenceJSON } from "../../lib/ingestion/exports";

it("exports exact money and escapes spreadsheet formulas in text only", async () => {
  const data = createDataset(await inspectFile(new TextEncoder().encode("Date,Posting Date,Amount,Reference,Narration,Currency\n2026-09-01,2026-09-03,-9007199254740993.10,=1+1,Text,MYR"), { name: "e.csv" }), 0);
  const result = ingestDataset(data, approveMapping(suggestMapping(data)), { ...DEFAULT_OPTIONS, dateBasis: "posting_date" }, { batchId: "export", ingestedAt: "2026-09-28T08:00:00+08:00" });
  const csv = canonicalCSV(result.normalized);
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true }).data[0];
  expect(parsed.source_amount).toBe("-9007199254740993.1");
  expect(parsed.reference).toBe("'=1+1");
  expect(parsed).toMatchObject({ transaction_date: "2026-09-01", posting_date: "2026-09-03",
    canonical_date: "2026-09-03", canonical_date_basis: "POSTING_DATE", ingested_at: "2026-09-28T00:00:00.000Z" });
  expect(parsed).not.toHaveProperty("date_basis");
  expect(result.normalized[0].reference).toBe("=1+1");
  const evidence = JSON.parse(evidenceJSON([result]));
  expect(evidence.datasets[0].records[0].staging.reference).toBe("=1+1");
  expect(evidence.datasets[0].normalized[0].source_amount).toBe("-9007199254740993.1");
  expect(evidence.datasets[0].normalized[0]).toMatchObject({ transaction_date: "2026-09-01", posting_date: "2026-09-03", canonical_date: "2026-09-03", canonical_date_basis: "POSTING_DATE" });
  expect(evidence.datasets[0].context.ingestedAt).toBe("2026-09-28T00:00:00.000Z");
  expect(evidence.datasets[0].file.sha256).toBe(data.file.fingerprint);
});
it("exports approved default-currency and blank-side provenance without changing raw evidence", async () => {
  const data = createDataset(await inspectFile(new TextEncoder().encode("Date,debit,credit,Reference,Narration,Currency\n2026-09-01,100,,R,Text,"), { name: "default.csv" }), 0);
  const result = ingestDataset(data, approveMapping(suggestMapping(data)), { ...DEFAULT_OPTIONS, monetaryMode: "debit_credit", blankSideAsZero: true, currencyDefault: "MYR" }, { batchId: "export", ingestedAt: "2026-09-28T00:00:00Z" });
  const parsed = Papa.parse<Record<string, string>>(canonicalCSV(result.normalized), { header: true }).data[0];
  expect(parsed).toMatchObject({ currency: "MYR", currency_basis: "DATASET_DEFAULT", debit: "100", credit: "0" });
  expect(JSON.parse(parsed.transformations)).toEqual([{ field: "credit", source_column: "credit", original_value: "", normalized_value: "0", rule: "APPROVED_BLANK_SIDE_ZERO" }]);
  const evidence = JSON.parse(evidenceJSON([result]));
  expect(evidence.datasets[0].records[0].staging).toMatchObject({ credit: "", currency: "" });
  expect(evidence.datasets[0].normalized[0].transformations).toEqual(JSON.parse(parsed.transformations));
});
it("exports each rejected issue with its original value and row evidence", async () => {
  const data = createDataset(await inspectFile(new TextEncoder().encode("Date,Amount,Reference,Narration,Currency\n31/31/2026,=SUM(A1),R,Text,MYR"), { name: "bad.csv" }), 0);
  const result = ingestDataset(data, approveMapping(suggestMapping(data)), DEFAULT_OPTIONS, { batchId: "export", ingestedAt: "2026-09-28T00:00:00Z" });
  const rows = Papa.parse<Record<string, string>>(rejectedCSV(result.records), { header: true }).data;
  expect(rows).toHaveLength(2);
  expect(rows[0].source_row_number).toBe("2");
  expect(rows[1].original_value).toBe("'=SUM(A1)");
  expect(JSON.parse(rows[0].raw_record)[0]).toBe("31/31/2026");
});
