import type { Features } from "./types";
import { normalizeText } from "./scoring";
/** Exact raw references: null/empty never equals evidence; formatting belongs to E1. */
export function exactScore(b: Features, l: Features) {
  const reference = b.reference?.trim() && l.reference?.trim() ? Number(b.reference === l.reference) : null;
  const counterparty = normalizeText(b.counterparty) && normalizeText(l.counterparty) ? Number(normalizeText(b.counterparty) === normalizeText(l.counterparty)) : null;
  const supported = reference === 1 && counterparty !== 0;
  return { score: supported ? 1 : 0, supported,
    reasons: [reference === 1 ? "EXACT_REFERENCE" : "MISSING_OR_DIFFERENT_REFERENCE", ...(counterparty === 0 ? ["COUNTERPARTY_CONTRADICTION"] : [])],
    evidence: { reference, description: Number(normalizeText(b.description) === normalizeText(l.description)), counterparty } };
}
