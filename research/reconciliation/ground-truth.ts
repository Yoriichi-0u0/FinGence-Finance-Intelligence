import type { Decision, Family, GroundTruth } from "./types";

export interface AuthoredCase {
  family: Family;
  bankKeys: string[];
  ledgerKeys: string[];
  pairs: [string, string][];
  group?: boolean;
  decision?: Decision;
  negative?: "AMOUNT" | "CURRENCY";
  ambiguous?: boolean;
  rationale: string;
}
/** Authored before rendering text or money; never derived from a matcher or similarity score. */
export const CASES: readonly AuthoredCase[] = [
  ...Array.from({ length: 6 }, (_, i): AuthoredCase => ({ family: "A", bankKeys: [`a${i}b`], ledgerKeys: [`a${i}l`], pairs: [[`a${i}b`, `a${i}l`]], rationale: "Authored common payment event; explicit reference evidence." })),
  ...Array.from({ length: 2 }, (_, i): AuthoredCase => ({ family: "B", bankKeys: [`b${i}b`], ledgerKeys: [`b${i}l`], pairs: [[`b${i}b`, `b${i}l`]], rationale: "Authored supplier payment; description variation with shared reference." })),
  ...Array.from({ length: 2 }, (_, i): AuthoredCase => ({ family: "C", bankKeys: [`c${i}b`], ledgerKeys: [`c${i}l`], pairs: [[`c${i}b`, `c${i}l`]], rationale: "Authored common event with formatting/abbreviation variation." })),
  { family: "D", bankKeys: ["d0b", "d1b"], ledgerKeys: ["d0l", "d1l"], pairs: [["d0b", "d0l"], ["d1b", "d1l"]], ambiguous: true, decision: "ABSTAIN_AMBIGUOUS", rationale: "Author knows two distinct recurring events; visible evidence cannot disambiguate permutation." },
  { family: "E", bankKeys: ["eb"], ledgerKeys: ["el"], pairs: [], negative: "AMOUNT", rationale: "Separate events with tempting descriptions but incompatible amounts." },
  { family: "F", bankKeys: ["fb"], ledgerKeys: ["fl"], pairs: [], negative: "CURRENCY", rationale: "Separate events in differing currencies; no FX conversion policy." },
  { family: "G", bankKeys: ["gb"], ledgerKeys: ["gl"], pairs: [["gb", "gl"]], decision: "ABSTAIN_INSUFFICIENT", rationale: "Author knows common event; missing references provide insufficient operational evidence." },
  { family: "H", bankKeys: ["h0b", "h1b"], ledgerKeys: ["h0l", "h1l"], pairs: [], rationale: "Four independently authored events without opposite-side counterparts." },
  { family: "I", bankKeys: ["ib"], ledgerKeys: ["i0l", "i1l"], pairs: [["ib", "i0l"]], ambiguous: true, decision: "ABSTAIN_AMBIGUOUS", rationale: "One real counterpart and an unrelated but visibly identical candidate; author identity is privileged." },
  { family: "J", bankKeys: ["j0b", "j1b"], ledgerKeys: ["jl"], pairs: [], group: true, decision: "UNRESOLVED_GROUP", rationale: "Two bank instalments settle one ledger liability; grouping unsupported operationally in M1." },
];

export function defineGroundTruth(ids: Readonly<Record<string, string>>): GroundTruth {
  const gt: GroundTruth = { relationships: [], nonmatches: [], unmatchedIds: [], ambiguousCases: [], outcomes: [], cases: [] };
  const id = (key: string): string => { if (!ids[key]) throw new Error("Missing authored record: " + key); return ids[key]; };
  CASES.forEach((c, index) => {
    const caseId = `case-${String(index + 1).padStart(2, "0")}`;
    const bankIds = c.bankKeys.map(id), ledgerIds = c.ledgerKeys.map(id);
    gt.cases.push({ id: caseId, family: c.family, recordIds: [...bankIds, ...ledgerIds] });
    const links = c.group ? [{ bankIds, ledgerIds }] : c.pairs.map(([b, l]) => ({ bankIds: [id(b)], ledgerIds: [id(l)] }));
    links.forEach((link, n) => {
      const relationshipId = `${caseId}-economic-${n + 1}`;
      gt.relationships.push({ id: relationshipId, kind: c.group ? "GROUP" : "ONE_TO_ONE", ...link, family: c.family, rationale: c.rationale });
      gt.outcomes.push({ relationshipId, decision: c.decision ?? "SUGGEST_PAIR", reason: c.rationale });
    });
    const related = new Set(links.flatMap(l => [...l.bankIds, ...l.ledgerIds]));
    gt.unmatchedIds.push(...[...bankIds, ...ledgerIds].filter(r => !related.has(r)));
    if (c.negative) gt.nonmatches.push({ bankId: bankIds[0], ledgerId: ledgerIds[0], reason: c.negative });
    if (c.ambiguous) {
      gt.ambiguousCases.push({ id: caseId, bankIds, ledgerIds, rationale: c.rationale });
      for (const b of bankIds) for (const l of ledgerIds) if (!links.some(link => link.bankIds.includes(b) && link.ledgerIds.includes(l)))
        gt.nonmatches.push({ bankId: b, ledgerId: l, reason: "DISTINCT_EVENT" });
    }
  });
  return gt;
}
