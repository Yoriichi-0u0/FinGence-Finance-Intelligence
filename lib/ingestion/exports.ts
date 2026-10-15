import Papa from "papaparse";
import type { CanonicalTransaction, IngestionResult, ProcessedRow } from "./models";
import { consolidate } from "./pipeline";
import { rawText } from "./normalizer";

const columns: (keyof CanonicalTransaction)[] = [
  "source_system", "source_file", "source_sheet", "source_row_number", "source_row_id",
  "file_sha256", "ingestion_batch_id", "ingested_at", "transaction_date", "posting_date", "canonical_date", "canonical_date_basis",
  "reference", "source_transaction_id", "account_code", "account_id", "entity_id", "description", "counterparty",
  "debit", "credit", "source_amount", "derived_ledger_net", "balance", "entry_side", "monetary_basis", "currency",
  "currency_basis", "transformations", "ingestion_status", "validation_messages",
];
const numericFields = new Set(["debit", "credit", "source_amount", "derived_ledger_net", "balance", "source_row_number"]);
function spreadsheetSafe(value: string): string {
  return /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(value) ? "'" + value : value;
}
function cell(value: unknown, numeric = false): string {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return numeric && /^-?\d+(?:\.\d+)?$/.test(text) ? text : spreadsheetSafe(text);
}
export function canonicalCSV(records: readonly CanonicalTransaction[]): string {
  return Papa.unparse({ fields: columns, data: records.map(row => columns.map(field => cell(row[field], numericFields.has(field)))) });
}
/** One report line per issue on a rejected record, not one line per record. */
export function rejectedCSV(records: readonly ProcessedRow[]): string {
  const fields = ["source_file", "source_sheet", "source_row_number", "source_row_id", "status", "rule", "severity", "category", "field", "source_column", "original_value", "message", "raw_record"];
  const data = records.filter(row => row.status === "REJECTED").flatMap(row => row.issues.map(issue => [
    row.provenance.source_file, row.provenance.source_sheet, row.provenance.source_row_number,
    row.provenance.source_row_id, row.status, issue.rule, issue.severity, issue.category, issue.field,
    issue.sourceColumn, rawText(issue.originalValue), issue.message, JSON.stringify(row.raw.cells),
  ].map(value => cell(value))));
  return Papa.unparse({ fields, data });
}
export function evidenceJSON(results: readonly IngestionResult[]): string {
  const combined = consolidate(results);
  return JSON.stringify({
    schema_version: combined.schema_version,
    ruleset_version: combined.ruleset_version,
    summary: combined.summary,
    datasets: combined.results.map(result => ({
      dataset_id: result.dataset.id, schema_version: result.schema_version, ruleset_version: result.ruleset_version,
      file: { name: result.dataset.file.name, type: result.dataset.file.type, sha256: result.dataset.file.fingerprint,
        size_bytes: result.dataset.file.sizeBytes, delimiter: result.dataset.file.delimiter },
      sheet: result.dataset.sheet.name, header_row: result.dataset.headerRow, columns: result.dataset.columns,
      options: result.options, context: result.context, profile: result.profile, mapping: result.mapping,
      records: result.records, normalized: result.normalized, summary: result.summary,
    })),
  }, null, 2);
}
