import type { CanonicalCandidate, ColumnMapping, IngestionOptions, Provenance, StagingValues, ValidationIssue } from "./models";
import { isMissing, normalizeDate, normalizeDecimal, normalizeText, subtractDecimals } from "./normalizer";

export function normalizeRecord(staging: StagingValues, mapping: readonly ColumnMapping[], options: IngestionOptions, provenance: Provenance) {
  const issues: ValidationIssue[] = [];
  const candidate: CanonicalCandidate = {
    ...provenance, transaction_date: null, posting_date: null, canonical_date: null,
    canonical_date_basis: options.dateBasis === "posting_date" ? "POSTING_DATE" : "TRANSACTION_DATE",
    reference: null, source_transaction_id: null, account_code: null, account_id: null, entity_id: null,
    description: null, counterparty: null, debit: null, credit: null, source_amount: null, derived_ledger_net: null,
    balance: null, entry_side: null, currency: null, currency_basis: null, transformations: [],
    monetary_basis: options.monetaryMode === "debit_credit" ? "debit_credit"
      : options.monetaryMode === "amount_direction" ? "source_amount_with_direction" : "source_signed_amount",
  };
  function issue(rule: string, field: keyof StagingValues, message: string, required: boolean) {
    issues.push({ rule, field, message, category: "technical", severity: required ? "REJECTED" : "WARNING",
      sourceColumn: mapping.find(m => m.target === field)?.sourceColumn ?? null, originalValue: staging[field] ?? null });
  }
  for (const field of ["reference", "source_transaction_id", "account_code", "account_id", "entity_id", "description", "counterparty"] as const) {
    candidate[field] = normalizeText(staging[field]);
    const value = staging[field];
    if (!["description", "counterparty"].includes(field) && typeof value === "object" && value?.kind === "excel_number") {
      issue("NUMERIC_IDENTIFIER", field, "Identifier was stored as an Excel number. Stored numeric text is retained; display-format leading zeros cannot be inferred.", false);
    }
  }
  const dates: Record<"transaction_date" | "posting_date", string | null> = { transaction_date: null, posting_date: null };
  for (const field of ["transaction_date", "posting_date"] as const) {
    const required = options.dateBasis === field;
    if (isMissing(staging[field])) {
      if (required) issue("MISSING_DATE", field, "Selected canonical date input is empty; the other date is not used as a fallback.", true);
      continue;
    }
    try {
      dates[field] = normalizeDate(staging[field], options.dateOrder);
      const raw = staging[field];
      if (typeof raw === "object" && raw?.kind === "excel_date" && !raw.value.endsWith("T00:00:00.000Z")) {
        issue("DATE_TIME_TRUNCATED", field, "Time component was removed for the canonical calendar date; the original Excel value is retained.", false);
      }
    } catch {
      issue("INVALID_DATE", field, "Unable to parse date with the selected convention, or calendar date is invalid.", required);
    }
  }
  candidate.posting_date = dates.posting_date;
  candidate.transaction_date = dates.transaction_date;
  candidate.canonical_date = dates[options.dateBasis];
  const bothMissing = isMissing(staging.debit) && isMissing(staging.credit);
  for (const field of ["debit", "credit", "source_amount", "balance"] as const) {
    const required = options.monetaryMode === "debit_credit" ? field === "debit" || field === "credit" : field === "source_amount";
    if (isMissing(staging[field])) {
      if (required && (field === "debit" || field === "credit") && options.blankSideAsZero && !bothMissing) {
        candidate[field] = "0";
        candidate.transformations.push({ field,
          source_column: mapping.find(m => m.target === field)?.sourceColumn ?? null,
          original_value: staging[field] ?? null, normalized_value: "0", rule: "APPROVED_BLANK_SIDE_ZERO" });
      }
      else if (required) issue("MISSING_MONEY", field, "Required monetary input is empty. Blank sides require explicit approval before conversion to zero.", true);
      continue;
    }
    try {
      const parsed = normalizeDecimal(staging[field], options.numberFormat);
      candidate[field] = parsed;
    } catch { issue("INVALID_NUMBER", field, "Unable to parse numeric value using the selected number convention.", required); }
  }
  if (options.monetaryMode === "debit_credit") {
    if (candidate.debit !== null && candidate.credit !== null) {
      candidate.derived_ledger_net = subtractDecimals(candidate.debit, candidate.credit);
      if (candidate.debit !== "0" && candidate.credit === "0") candidate.entry_side = "DEBIT";
      if (candidate.credit !== "0" && candidate.debit === "0") candidate.entry_side = "CREDIT";
    }
  } else {
    const direction = normalizeText(staging.entry_side)?.toUpperCase();
    if (direction && ["DEBIT", "DR", "D"].includes(direction)) candidate.entry_side = "DEBIT";
    else if (direction && ["CREDIT", "CR", "C"].includes(direction)) candidate.entry_side = "CREDIT";
  }
  const sourceCurrency = normalizeText(staging.currency);
  const defaultCurrency = normalizeText(options.currencyDefault);
  const currency = sourceCurrency ?? defaultCurrency;
  candidate.currency = currency?.toUpperCase() || null;
  candidate.currency_basis = sourceCurrency !== null ? "SOURCE" : defaultCurrency !== null ? "DATASET_DEFAULT" : null;
  return { candidate, issues };
}
