import type {
  CanonicalCandidate, CanonicalField, ColumnMapping, DatasetProfile,
  ProcessedRow, RawCell, RowStatus, ValidationIssue,
} from "../../lib/ingestion/models";
import { rawText } from "../../lib/ingestion/normalizer";

/** Display vocabulary only. Engine fields, eligibility and export values stay unchanged. */
export const STATUS_LABELS: Record<RowStatus, string> = {
  VALID: "Ready", WARNING: "Included — needs attention", REJECTED: "Cannot include",
};
export const FIELD_LABELS: Record<CanonicalField, string> = {
  transaction_date: "Transaction date", posting_date: "Posting date",
  reference: "Reference", source_transaction_id: "Transaction ID from file",
  account_code: "Account code", account_id: "Account ID", entity_id: "Entity ID",
  description: "Description", counterparty: "Counterparty",
  debit: "Debit", credit: "Credit", source_amount: "Amount from file",
  balance: "Balance", entry_side: "Debit/Credit label", currency: "Currency",
};
export function fieldLabel(field: string): string {
  if (field === "record") return "Whole row";
  return Object.hasOwn(FIELD_LABELS, field) ? FIELD_LABELS[field as CanonicalField] : field;
}
export function sourceValue(value: RawCell | undefined): string {
  return value == null || rawText(value) === "" ? "Blank in source" : rawText(value);
}
export function checkedValue(value: string | null | undefined): string {
  return value == null ? "Not available" : value;
}
export function columnExamples(profile: DatasetProfile, index: number): string[] {
  return [...new Set(profile.sampleRows.map(row => rawText(row.cells[index])).filter(value => value.trim() !== ""))].slice(0, 3);
}
export type ResultFilter = "ALL" | "NEEDS_REVIEW" | RowStatus;
export function defaultResultFilter(rows: readonly ProcessedRow[]): ResultFilter {
  return rows.some(row => row.status !== "VALID") ? "NEEDS_REVIEW" : "ALL";
}
export function filterRows(rows: readonly ProcessedRow[], filter: ResultFilter): ProcessedRow[] {
  return rows.filter(row => filter === "ALL" || (filter === "NEEDS_REVIEW" ? row.status !== "VALID" : row.status === filter));
}
export function dateBasisLabel(basis: CanonicalCandidate["canonical_date_basis"]): string {
  return basis === "POSTING_DATE" ? "Posting date" : "Transaction date";
}
export function moneyDescription(row: CanonicalCandidate): string {
  if (row.monetary_basis === "debit_credit") return "Debit " + checkedValue(row.debit) + " · Credit " + checkedValue(row.credit);
  const amount = "Amount " + checkedValue(row.source_amount);
  return row.monetary_basis === "source_amount_with_direction"
    ? amount + " · " + (row.entry_side === "DEBIT" ? "Debit" : row.entry_side === "CREDIT" ? "Credit" : "Label not available")
    : amount + " · sign kept from file";
}
export function sourceMoneyDescription(row: ProcessedRow): string {
  return row.candidate.monetary_basis === "debit_credit"
    ? "Debit " + sourceValue(row.staging.debit) + " · Credit " + sourceValue(row.staging.credit)
    : "Amount " + sourceValue(row.staging.source_amount);
}
export function currencyDescription(row: CanonicalCandidate): string {
  if (row.currency_basis === "DATASET_DEFAULT") return checkedValue(row.currency) + " from this file's selected default; currency was blank in the source.";
  if (row.currency_basis === "SOURCE") return checkedValue(row.currency) + " supplied by the file.";
  return "No currency supplied or selected.";
}
export function transformationDescriptions(row: CanonicalCandidate): string[] {
  return row.transformations.map(change => fieldLabel(change.field) + ": " + sourceValue(change.original_value)
    + " → " + change.normalized_value + " under your selected blank-side ledger setting.");
}
export function financeValues(row: CanonicalCandidate): { field: string; label: string; value: string }[] {
  return [
    { field: "canonical_date", label: "Date used for these records", value: checkedValue(row.canonical_date) + " · using " + dateBasisLabel(row.canonical_date_basis) },
    ...(["transaction_date", "posting_date", "reference", "description", "source_transaction_id", "account_code",
      "account_id", "entity_id", "counterparty", "source_amount", "debit", "credit", "balance"] as const)
      .map(field => ({ field, label: FIELD_LABELS[field], value: checkedValue(row[field]) })),
    { field: "entry_side", label: FIELD_LABELS.entry_side, value: row.entry_side === "DEBIT" ? "Debit" : row.entry_side === "CREDIT" ? "Credit" : "Not available" },
    { field: "currency", label: FIELD_LABELS.currency, value: currencyDescription(row) },
  ];
}

const ISSUE_HELP: Record<string, { problem: string; action: string }> = {
  INVALID_DATE: { problem: "The date could not be read using the selected format, or is not a valid calendar date.", action: "Check the date format selected for this file. If the date itself is invalid, correct the original file and add it again." },
  MISSING_DATE: { problem: "The date selected for these records is blank. The other date has not been used in its place.", action: "Check the selected date column. Supply the missing date in the original file, or review which source date these records should use." },
  INVALID_NUMBER: { problem: "This value could not be read as a number using the selected format.", action: "Check the amount format and column choice. Correct non-numeric values in the original file and add it again." },
  MISSING_MONEY: { problem: "A required amount is blank.", action: "Check the amount columns and original file. A blank debit/credit side becomes zero only under the explicitly reviewed ledger setting, with the other side populated." },
  NUMERIC_IDENTIFIER: { problem: "This identifier was stored as an Excel number. Any display-only leading zeros cannot be recovered.", action: "Compare the identifier with the source system. Export identifiers as text if leading zeros matter." },
  DATE_TIME_TRUNCATED: { problem: "The time was removed when the calendar date was checked.", action: "Review whether downstream work needs the time. The original Excel value remains in the technical evidence." },
  NEGATIVE_SIDE: { problem: "A debit or credit is negative; this may be a reversal or adjustment.", action: "Confirm the source's accounting convention and review the selected ledger handling. Do not infer cash-flow direction." },
  BOTH_SIDES_NONZERO: { problem: "Both debit and credit contain nonzero values.", action: "Confirm whether this source permits both sides on one row, then review the selected ledger handling." },
  INVALID_DIRECTION: { problem: "The amount's Debit/Credit label is missing or not recognized.", action: "Check the label column and the file's amount convention. Accepted labels are Debit/DR or Credit/CR; no cash-flow direction is inferred." },
  UNSIGNED_AMOUNT: { problem: "The amount is negative in a file configured to use a non-negative amount plus a Debit/Credit label.", action: "Confirm how this file records amounts. Review the amount convention or correct the original file; do not change a sign merely to pass the check." },
  UNKNOWN_DIRECTION: { problem: "An optional Debit/Credit label was not recognized. The signed amount is kept.", action: "Review the source label if it is needed downstream. The amount's sign has not been reinterpreted." },
  MISSING_REFERENCE: { problem: "The reference is blank.", action: "Check whether a reference is required downstream. This warning alone does not exclude the row." },
  MISSING_DESCRIPTION: { problem: "The description is blank.", action: "Review the original file if a description is needed. This warning alone does not exclude the row." },
  MISSING_CURRENCY: { problem: "No currency was supplied or explicitly selected for this row.", action: "Confirm the currency with the source owner. A file-level default is applied only when you explicitly enter one and the source value is blank." },
  MALFORMED_CURRENCY: { problem: "The currency does not have a three-letter code format. Its value is kept.", action: "Check the source currency. These checks do not verify membership of the official currency-code list." },
  DUPLICATE_ROW: { problem: "This row repeats an earlier row in this file. It is kept and flagged.", action: "Check the original file for repeated entries. No row has been automatically removed and no reconciliation has been performed." },
};
export function issueDetails(issue: ValidationIssue, row: CanonicalCandidate) {
  const help = Object.hasOwn(ISSUE_HELP, issue.rule) ? ISSUE_HELP[issue.rule] : undefined;
  const value = row[issue.field as keyof CanonicalCandidate];
  return {
    field: fieldLabel(issue.field),
    problem: help?.problem ?? issue.message,
    original: issue.field === "record" ? "Whole original row — see technical row evidence" : sourceValue(issue.originalValue),
    checked: issue.field === "record" ? "Whole-row issue" : typeof value === "string" ? value : "Not available",
    action: help?.action ?? "Check the original file and selected columns/formats. The full check message is retained in technical row evidence.",
  };
}
export function mappingProblem(error: string, mapping: readonly ColumnMapping[]): string {
  const collision = error.match(/^(\w+) is assigned more than once\.$/);
  if (collision) {
    const sources = mapping.filter(item => item.target === collision[1])
      .map(item => 'column ' + (item.sourceIndex + 1) + ' "' + item.sourceColumn + '"');
    return sources.join(" and ") + " both use " + fieldLabel(collision[1]) + ". Choose a different purpose for one of these columns.";
  }
  if (error.startsWith("Map the selected date source: ")) {
    return "Choose a source column for the selected " + fieldLabel(error.slice(30, -1)) + ".";
  }
  if (error === "Map a source_amount column.") return "Choose the column containing Amount from file.";
  if (error === "Amount + direction mode requires an entry_side mapping.") return "Choose the column containing the Debit/Credit label for these amounts.";
  if (error === "Debit/credit mode requires both columns.") return "Choose both a Debit column and a Credit column for this amount convention.";
  if (error === "Choose a source-system label.") return "Enter a source name for these records.";
  return error.replace(/\b(transaction_date|posting_date|source_amount|entry_side|source_transaction_id)\b/g, fieldLabel);
}
export function reviewState(checked: boolean, reviewed: boolean, errorCount: number, needsRecheck: boolean): string {
  if (checked) return "Checked";
  if (needsRecheck) return "Needs checking again";
  if (errorCount) return "Columns or settings need correction";
  return reviewed ? "Review confirmed — not yet checked" : "Review needed";
}
