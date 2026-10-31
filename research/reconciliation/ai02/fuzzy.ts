import type { Features } from "./types";
import { normalizeReference, normalizeText, similarity } from "./scoring";
/** Fixed available-field weights: description .70, counterparty .20, reference .10.
 * No learned vocabulary, merchant dictionary or translation. Missing fields add no evidence.
 */
export function fuzzyScore(b: Features, l: Features) {
  const description = similarity(b.description, l.description);
  const counterparty = normalizeText(b.counterparty) && normalizeText(l.counterparty) ? similarity(b.counterparty, l.counterparty) : null;
  const rb = normalizeReference(b.reference), rl = normalizeReference(l.reference);
  const reference = rb && rl ? Number(rb === rl) : null;
  const denominator = .7 + (counterparty === null ? 0 : .2) + (reference === null ? 0 : .1);
  const score = (.7 * description + .2 * (counterparty ?? 0) + .1 * (reference ?? 0)) / denominator;
  // Shared factual contradiction guard; amount/currency/direction/date already blocked.
  const contradiction = counterparty !== null && normalizeText(b.counterparty) !== normalizeText(l.counterparty);
  return { score: contradiction ? 0 : Math.round(score * 1e12) / 1e12, supported: !contradiction && (description > 0 || reference === 1),
    reasons: ["TOKEN_AND_BIGRAM_DICE", "AVAILABLE_FIELD_WEIGHTS", ...(reference === 1 ? ["NORMALIZED_REFERENCE"] : []), ...(contradiction ? ["COUNTERPARTY_CONTRADICTION"] : [])],
    evidence: { reference, description, counterparty } };
}
