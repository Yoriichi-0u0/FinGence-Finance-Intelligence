import type { Decision, Family, NegativeReason } from "./types";
export interface Scenario {
  family: Family; bank: number[]; ledger: number[]; pairs: [number, number][];
  negatives?: [number, number, NegativeReason][];
  group?: "GROUP" | "PARTIAL"; ambiguous?: boolean; decision?: Decision;
}
/** Author-only economic event board; never imported by projections or validation policy. */
export const SCENARIOS: readonly Scenario[] = [
  { family: "A", bank: [1], ledger: [1], pairs: [[1, 1]] },
  { family: "B", bank: [2], ledger: [2], pairs: [[2, 2]], negatives: [[2, 3, "DISTINCT_EVENT"], [2, 4, "DISTINCT_EVENT"]] },
  { family: "C", bank: [3], ledger: [3], pairs: [[3, 3]], negatives: [[3, 2, "DISTINCT_EVENT"], [3, 4, "DISTINCT_EVENT"]] },
  { family: "D", bank: [4], ledger: [4], pairs: [[4, 4]], negatives: [[4, 2, "DISTINCT_EVENT"], [4, 3, "DISTINCT_EVENT"]] },
  { family: "E", bank: [5, 6], ledger: [5, 6], pairs: [[5, 5], [6, 6]], negatives: [[5, 6, "DISTINCT_EVENT"], [6, 5, "DISTINCT_EVENT"]], ambiguous: true },
  { family: "F", bank: [7], ledger: [7, 8], pairs: [[7, 7]], negatives: [[7, 8, "DISTINCT_EVENT"]], ambiguous: true },
  { family: "G", bank: [8], ledger: [9], pairs: [[8, 9]], decision: "ABSTAIN_INSUFFICIENT" },
  { family: "H", bank: [9], ledger: [10], pairs: [[9, 10]] },
  { family: "I", bank: [10, 11], ledger: [], pairs: [] },
  { family: "J", bank: [], ledger: [11], pairs: [] },
  { family: "K", bank: [12], ledger: [12], pairs: [], negatives: [[12, 12, "AMOUNT"]] },
  { family: "L", bank: [13], ledger: [13], pairs: [], negatives: [[13, 13, "CURRENCY"]] },
  { family: "M", bank: [14], ledger: [14], pairs: [], negatives: [[14, 14, "COUNTERPARTY"]] },
  { family: "N", bank: [15], ledger: [15, 16], pairs: [[15, 15]], negatives: [[15, 16, "DISTINCT_EVENT"]], ambiguous: true },
  { family: "O", bank: [16, 17], ledger: [17], pairs: [[16, 17]], negatives: [[17, 17, "DISTINCT_EVENT"]], ambiguous: true },
  { family: "P", bank: [18], ledger: [18], pairs: [[18, 18]] },
  { family: "Q", bank: [19], ledger: [19], pairs: [[19, 19]] },
  { family: "R", bank: [20, 21], ledger: [20, 21], pairs: [[20, 20], [21, 21]] },
  { family: "S", bank: [22, 23], ledger: [22], pairs: [], group: "PARTIAL" },
  { family: "T", bank: [24], ledger: [23, 24], pairs: [], group: "GROUP" },
  { family: "U", bank: [25], ledger: [25], pairs: [[25, 25]] },
];
