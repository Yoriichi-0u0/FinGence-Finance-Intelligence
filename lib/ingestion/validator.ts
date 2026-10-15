import type { CanonicalCandidate, ColumnMapping, IngestionOptions, StagingValues, ValidationIssue } from "./models";

/** Business rules are provisional. No reconciliation or journal-balancing rules. */
export function validateRecord(
  candidate: CanonicalCandidate, staging: StagingValues,
  mapping: readonly ColumnMapping[], options: IngestionOptions, duplicate: boolean,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  function issue(rule: string, field: keyof StagingValues, message: string, reject = false) {
    issues.push({ rule, field, message, category: "business", severity: reject ? "REJECTED" : "WARNING",
      sourceColumn: mapping.find(m => m.target === field)?.sourceColumn ?? null, originalValue: staging[field] ?? null });
  }
  for (const field of ["debit", "credit"] as const) {
    if (candidate[field]?.startsWith("-") && options.negativeDebitCredit !== "allow") {
      issue("NEGATIVE_SIDE", field, "Negative debit/credit may represent a reversal or adjustment. Confirm the source convention.", options.negativeDebitCredit === "reject");
    }
  }
  if (options.monetaryMode === "debit_credit" && candidate.debit && candidate.credit
    && candidate.debit !== "0" && candidate.credit !== "0" && options.bothDebitCredit !== "allow") {
    issue("BOTH_SIDES_NONZERO", "debit", "Both debit and credit are nonzero. Confirm that this source structure permits dual-sided records.", options.bothDebitCredit === "reject");
  }
  if (options.monetaryMode === "amount_direction") {
    if (!candidate.entry_side) issue("INVALID_DIRECTION", "entry_side", "Amount + direction mode requires Debit/DR or Credit/CR.", true);
    if (candidate.source_amount?.startsWith("-")) issue("UNSIGNED_AMOUNT", "source_amount", "Amount + direction mode requires a non-negative magnitude. Use signed-amount mode when appropriate.", true);
  } else if (options.monetaryMode === "signed_amount" && staging.entry_side && !candidate.entry_side) {
    issue("UNKNOWN_DIRECTION", "entry_side", "Unrecognized optional direction; the signed source amount is preserved.");
  }
  if (!candidate.reference) issue("MISSING_REFERENCE", "reference", "Reference is missing; accepted with attention under the provisional schema.");
  if (!candidate.description) issue("MISSING_DESCRIPTION", "description", "Description is missing; accepted with attention under the provisional schema.");
  if (!candidate.currency) issue("MISSING_CURRENCY", "currency", "Currency is missing. No currency was guessed.");
  else if (!/^[A-Z]{3}$/.test(candidate.currency)) issue("MALFORMED_CURRENCY", "currency", "Supplied currency does not have a three-letter code structure. It is retained; authoritative ISO 4217 validation is outside this PoC.");
  if (duplicate) issues.push({
    rule: "DUPLICATE_ROW", field: "record", category: "technical", severity: "WARNING",
    sourceColumn: null, originalValue: null,
    message: "Exact raw row repeats an earlier row in this dataset. It is retained and flagged, not automatically removed.",
  });
  return issues;
}
