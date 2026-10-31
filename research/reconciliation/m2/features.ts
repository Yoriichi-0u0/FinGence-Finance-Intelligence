import type { Transaction } from "./types";
/** Only permitted ranking evidence. IDs, source coordinates and truth never enter this object. */
export function featuresOf(r: Transaction) {
  return { amount: r.amount, currency: r.currency, direction: r.direction,
    transactionDate: r.transactionDate, postingDate: r.postingDate, canonicalDate: r.canonicalDate,
    description: r.description, counterparty: r.counterparty, reference: r.reference };
}
