import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { inspectFile, createDataset } from "../../lib/ingestion/readers";
import { approveMapping, suggestMapping } from "../../lib/ingestion/mapper";
import { ingestDataset } from "../../lib/ingestion/pipeline";
import { DEFAULT_OPTIONS } from "../../lib/ingestion/models";

const workbookPath = process.env.FINSIGHT_WORKBOOK_PATH;

// Optional local integration evidence. The supplied synthetic workbook remains
// outside Git, and only its Transactions sheet is transformed.
it.skipIf(!workbookPath)("preserves all 6,000 supplied positive amounts with their explicit directions", async () => {
  const file = await inspectFile(readFileSync(workbookPath!), { name: "supplied-synthetic.xlsx" });
  const sheet = file.sheets.find(sheet => sheet.name === "Transactions");
  expect(sheet).toBeDefined();
  const data = createDataset(file, sheet!.index);
  const result = ingestDataset(data, approveMapping(suggestMapping(data)), {
    ...DEFAULT_OPTIONS, monetaryMode: "amount_direction", sourceSystem: "Supplied synthetic bank",
  }, { batchId: "supplied-synthetic-check", ingestedAt: "2026-09-28T00:00:00Z" });
  expect(result.summary.rowsReceived).toBe(6000);
  expect(result.summary.rejected).toBe(0);
  expect(result.normalized).toHaveLength(6000);
  expect(result.normalized.every(row => row.source_amount !== null && !row.source_amount.startsWith("-"))).toBe(true);
  expect(result.normalized.filter(row => row.entry_side === "DEBIT")).toHaveLength(4148);
  expect(result.normalized.filter(row => row.entry_side === "CREDIT")).toHaveLength(1852);
  expect(result.normalized.every(row => row.derived_ledger_net === null && row.debit === null && row.credit === null)).toBe(true);
  expect(result.normalized.at(-1)?.source_row_number).toBe(6001);
  expect(result.normalized.every(row => row.source_sheet === "Transactions")).toBe(true);
});
