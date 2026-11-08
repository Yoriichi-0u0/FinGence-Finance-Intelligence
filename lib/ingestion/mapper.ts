import { CANONICAL_FIELDS, type CanonicalField, type ColumnMapping, type Dataset, type IngestionOptions } from "./models";

const normalizedName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Partial<Record<CanonicalField, readonly string[]>> = {
  transaction_date: ["Date", "Txn Date", "Transaction Date", "Booking Date"],
  posting_date: ["Posting Date"],
  reference: ["journal_id", "Journal ID", "Reference", "Ref", "Bank Reference"],
  source_transaction_id: ["Transaction ID", "Txn ID"],
  account_code: ["Account Code", "GL Code"],
  account_id: ["Account Number", "Bank Account"],
  entity_id: ["Business ID", "Entity ID"],
  description: ["Transaction Details", "Narration", "Details", "Raw HF-Style Description"],
  counterparty: ["Counterparty", "Payee", "Payer"],
  debit: ["Debit", "Debit Amount"],
  credit: ["Credit", "Credit Amount"],
  source_amount: ["Amount", "Transaction Amount", "Source Amount"],
  balance: ["Balance", "Running Balance"],
  currency: ["Currency", "CCY"],
  entry_side: ["Direction", "Debit/Credit", "DR/CR", "Entry Side"],
};
export function suggestMapping(dataset: Dataset): ColumnMapping[] {
  return dataset.columns.map((sourceColumn, sourceIndex) => {
    const base = { sourceColumn, sourceIndex, userConfirmed: false };
    if (CANONICAL_FIELDS.includes(sourceColumn as CanonicalField)) return { ...base, target: sourceColumn as CanonicalField, method: "exact_match", confidence: 1 };
    for (const target of CANONICAL_FIELDS) {
      if (aliases[target]?.some(alias => alias.toLowerCase() === sourceColumn.trim().toLowerCase())) return { ...base, target, method: "alias_match", confidence: 0.95 };
    }
    const target = CANONICAL_FIELDS.find(field => normalizedName(field) === normalizedName(sourceColumn));
    return target
      ? { ...base, target, method: "normalized_match", confidence: 0.90 }
      : { ...base, target: null, method: "unmapped", confidence: null };
  });
}
export function overrideMapping(mapping: readonly ColumnMapping[], sourceIndex: number, target: CanonicalField | null): ColumnMapping[] {
  return mapping.map(item => item.sourceIndex === sourceIndex
    ? { ...item, target, method: "manual", confidence: null, userConfirmed: false }
    : { ...item, userConfirmed: false });
}
export function approveMapping(mapping: readonly ColumnMapping[]): ColumnMapping[] {
  return mapping.map(item => ({ ...item, userConfirmed: true }));
}
export function mappingErrors(dataset: Dataset, mapping: readonly ColumnMapping[], options: IngestionOptions): string[] {
  const errors: string[] = [];
  if (mapping.length !== dataset.columns.length || new Set(mapping.map(m => m.sourceIndex)).size !== dataset.columns.length
    || mapping.some(m => dataset.columns[m.sourceIndex] !== m.sourceColumn || (m.target !== null && !CANONICAL_FIELDS.includes(m.target)))) {
    errors.push("Mappings must match every source column exactly once.");
  }
  if (mapping.some(m => !m.userConfirmed)) errors.push("Review and approve every column mapping.");
  const targets = mapping.flatMap(item => item.target ? [item.target] : []);
  for (const target of new Set(targets)) if (targets.filter(t => t === target).length > 1) errors.push(target + " is assigned more than once.");
  if (!targets.includes(options.dateBasis)) errors.push("Map the selected date source: " + options.dateBasis + ".");
  if (options.monetaryMode === "debit_credit") {
    if (!targets.includes("debit") || !targets.includes("credit")) errors.push("Debit/credit mode requires both columns.");
  } else {
    if (!targets.includes("source_amount")) errors.push("Map a source_amount column.");
    if (options.monetaryMode === "amount_direction" && !targets.includes("entry_side")) errors.push("Amount + direction mode requires an entry_side mapping.");
  }
  if (!options.sourceSystem.trim()) errors.push("Choose a source-system label.");
  if (options.currencyDefault && !/^[A-Za-z]{3}$/.test(options.currencyDefault.trim())) errors.push("An explicit default currency must be a three-letter code.");
  if (!["signed_amount", "debit_credit", "amount_direction"].includes(options.monetaryMode)
    || !["ISO", "DMY", "MDY"].includes(options.dateOrder)
    || !["plain", "dot_comma", "comma_dot"].includes(options.numberFormat)
    || !["transaction_date", "posting_date"].includes(options.dateBasis)
    || !["warn", "reject", "allow"].includes(options.negativeDebitCredit)
    || !["warn", "reject", "allow"].includes(options.bothDebitCredit)) errors.push("Unsupported parsing options.");
  return errors;
}
