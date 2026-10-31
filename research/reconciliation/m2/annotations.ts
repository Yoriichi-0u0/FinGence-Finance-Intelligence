import type { Decision, Family, NegativeReason, Relationship } from "./types";
/** Independent M2/1.1.0 review manifest. Not computed from SCENARIOS or submitted truth.
 * Coordinates are per logical source; each 50-row block has its own bank/ledger templates.
 */
export const REQUIRED_RELATIONSHIPS: readonly { family: Family; bank: number[]; ledger: number[]; kind: Relationship["kind"]; decision: Decision; remaining: string | null }[] = [
  { family: "A", bank: [1], ledger: [1], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
  { family: "B", bank: [2], ledger: [2], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
  { family: "C", bank: [3], ledger: [3], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
  { family: "D", bank: [4], ledger: [4], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
  { family: "E", bank: [5], ledger: [5], kind: "PAIR", decision: "ABSTAIN_AMBIGUOUS", remaining: null },
  { family: "E", bank: [6], ledger: [6], kind: "PAIR", decision: "ABSTAIN_AMBIGUOUS", remaining: null },
  { family: "F", bank: [7], ledger: [7], kind: "PAIR", decision: "ABSTAIN_AMBIGUOUS", remaining: null },
  { family: "G", bank: [8], ledger: [9], kind: "PAIR", decision: "ABSTAIN_INSUFFICIENT", remaining: null },
  { family: "H", bank: [9], ledger: [10], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
  { family: "N", bank: [15], ledger: [15], kind: "PAIR", decision: "ABSTAIN_AMBIGUOUS", remaining: null },
  { family: "O", bank: [16], ledger: [17], kind: "PAIR", decision: "ABSTAIN_AMBIGUOUS", remaining: null },
  { family: "P", bank: [18], ledger: [18], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
  { family: "Q", bank: [19], ledger: [19], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
  { family: "R", bank: [20], ledger: [20], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
  { family: "R", bank: [21], ledger: [21], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
  { family: "S", bank: [22, 23], ledger: [22], kind: "PARTIAL", decision: "UNRESOLVED_GROUP", remaining: "25.00" },
  { family: "T", bank: [24], ledger: [23, 24], kind: "GROUP", decision: "UNRESOLVED_GROUP", remaining: null },
  { family: "U", bank: [25], ledger: [25], kind: "PAIR", decision: "SUGGEST_PAIR", remaining: null },
];
export const REQUIRED_NEGATIVES: readonly [number, number, NegativeReason][] = [
  [2, 3, "DISTINCT_EVENT"], [2, 4, "DISTINCT_EVENT"], [3, 2, "DISTINCT_EVENT"],
  [3, 4, "DISTINCT_EVENT"], [4, 2, "DISTINCT_EVENT"], [4, 3, "DISTINCT_EVENT"],
  [2, 3, "DISTINCT_EVENT"], [2, 4, "DISTINCT_EVENT"], [3, 2, "DISTINCT_EVENT"],
  [3, 4, "DISTINCT_EVENT"], [4, 2, "DISTINCT_EVENT"], [4, 3, "DISTINCT_EVENT"],
  [5, 6, "DISTINCT_EVENT"], [6, 5, "DISTINCT_EVENT"], [7, 8, "DISTINCT_EVENT"],
  [12, 12, "AMOUNT"], [13, 13, "CURRENCY"], [14, 14, "COUNTERPARTY"],
  [15, 16, "DISTINCT_EVENT"], [17, 17, "DISTINCT_EVENT"],
];
export const REQUIRED_UNMATCHED = { BANK: [10, 11, 12, 13, 14, 17], LEDGER: [8, 11, 12, 13, 14, 16] } as const;
export const FAMILY_ROWS: Readonly<Record<Family, readonly [readonly number[], readonly number[]]>> = {
  A: [[1], [1]], B: [[2], [2]], C: [[3], [3]], D: [[4], [4]], E: [[5, 6], [5, 6]], F: [[7], [7, 8]],
  G: [[8], [9]], H: [[9], [10]], I: [[10, 11], []], J: [[], [11]], K: [[12], [12]], L: [[13], [13]],
  M: [[14], [14]], N: [[15], [15, 16]], O: [[16, 17], [17]], P: [[18], [18]], Q: [[19], [19]],
  R: [[20, 21], [20, 21]], S: [[22, 23], [22]], T: [[24], [23, 24]], U: [[25], [25]],
};
