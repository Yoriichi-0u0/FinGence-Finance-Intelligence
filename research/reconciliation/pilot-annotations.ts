import type { Dataset, GroundTruth } from "./types";

/** Independent review expectations, not derived from CASES or generated labels.
 * Source row identities are seed-independent; opaque record IDs are resolved at validation.
 * This profile is only for this pilot revision, never a global negative-count policy.
 */
export const PILOT_ANNOTATION_MANIFEST = {
  pilot: "M1",
  generatorVersion: "ai01-m1/1.0.1",
  requiredNonmatches: [
    { bankRow: "bank-signed-v1:row-6", ledgerRow: "ledger-expense-v1:row-6", reason: "DISTINCT_EVENT" },
    { bankRow: "bank-directed-v1:row-6", ledgerRow: "ledger-cash-v1:row-6", reason: "DISTINCT_EVENT" },
    { bankRow: "bank-signed-v1:row-7", ledgerRow: "ledger-cash-v1:row-7", reason: "AMOUNT" },
    { bankRow: "bank-directed-v1:row-7", ledgerRow: "ledger-expense-v1:row-7", reason: "CURRENCY" },
    { bankRow: "bank-directed-v1:row-9", ledgerRow: "ledger-cash-v1:row-10", reason: "DISTINCT_EVENT" },
  ] satisfies { bankRow: string; ledgerRow: string; reason: GroundTruth["nonmatches"][number]["reason"] }[],
} as const;

export function pilotAnnotationErrors(dataset: Dataset): string[] {
  const profile = PILOT_ANNOTATION_MANIFEST;
  if (dataset.config.pilot !== profile.pilot || dataset.generatorVersion !== profile.generatorVersion) return [];
  const errors: string[] = [];
  for (const required of profile.requiredNonmatches) {
    const bank = dataset.records.filter(r => r.role === "BANK" && r.sourceRowId === required.bankRow);
    const ledger = dataset.records.filter(r => r.role === "LEDGER" && r.sourceRowId === required.ledgerRow);
    if (bank.length !== 1 || ledger.length !== 1 || !dataset.groundTruth.nonmatches.some(p =>
      p.bankId === bank[0].id && p.ledgerId === ledger[0].id && p.reason === required.reason)) {
      errors.push(`Missing required pilot negative: ${required.bankRow} -> ${required.ledgerRow} (${required.reason})`);
    }
  }
  return errors;
}
