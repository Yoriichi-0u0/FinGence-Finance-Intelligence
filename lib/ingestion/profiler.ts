import type { Dataset, DatasetProfile, RawCell } from "./models";
import { isMissing, rawText } from "./normalizer";

function inferred(value: RawCell): string {
  if (isMissing(value)) return "empty";
  if (typeof value === "object") return value?.kind === "excel_date" ? "date-like" : "numeric-like";
  if (typeof value === "boolean") return "boolean";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) || /^\d{1,2}[/.]\d{1,2}[/.]\d{4}$/.test(value.trim())) return "date-like";
  return /^[+-]?\d+(?:[.,]\d+)*$/.test(rawText(value).trim()) ? "numeric-like" : "text";
}
export function profileDataset(dataset: Dataset): DatasetProfile {
  const seen = new Set<string>();
  const duplicateRowNumbers: number[] = [];
  for (const row of dataset.rows) {
    const key = JSON.stringify(row.cells);
    if (seen.has(key)) duplicateRowNumbers.push(row.rowNumber);
    else seen.add(key);
  }
  return {
    rowCount: dataset.rows.length, columnCount: dataset.columns.length,
    columns: dataset.columns.map((name, index) => {
      const values = dataset.rows.map(row => row.cells[index] ?? null);
      const types = new Set(values.filter(value => !isMissing(value)).map(inferred));
      return { name, inferredType: types.size > 1 ? "mixed" : [...types][0] ?? "empty", missing: values.filter(isMissing).length };
    }),
    duplicateRowCount: duplicateRowNumbers.length, duplicateRowNumbers,
    sampleRows: dataset.rows.slice(0, 8),
  };
}
