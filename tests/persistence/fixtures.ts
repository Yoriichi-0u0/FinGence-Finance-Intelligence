import {
  approveMapping, createDataset, DEFAULT_OPTIONS, ingestDataset, inspectFile, suggestMapping,
  type IngestionOptions, type IngestionResult,
} from "../../lib/ingestion/index";

export const context = { batchId: "synthetic-persistence-001", ingestedAt: "2026-10-03T00:00:00.000Z" };
export const header = "transaction_date,posting_date,amount,reference,source_transaction_id,account_code,account_id,entity_id,description,currency";
export const validRow = "2026-09-01,2026-09-03,9007199254740993.123456789,00017,00042,00100,00003,00004,Synthetic only,MYR";
export async function syntheticResult(
  csv = `${header}\n${validRow}`,
  options: Partial<IngestionOptions> = {},
  producer = context,
  filename = "synthetic-persistence.csv",
): Promise<IngestionResult> {
  const dataset = createDataset(await inspectFile(new TextEncoder().encode(csv), { name: filename }), 0);
  return ingestDataset(dataset, approveMapping(suggestMapping(dataset)), { ...DEFAULT_OPTIONS, ...options }, producer);
}
export function clone<T>(value: T): T {
  return structuredClone(value);
}
