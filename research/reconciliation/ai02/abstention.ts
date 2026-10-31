import type { Config, Input, Outcome, ScoredPair } from "./types";
import { lex } from "./candidates";
const EPS = 1e-12;
export function resolve(input: Input, pairs: ScoredPair[], config: Config) {
  const lists = new Map(input.candidates.map(r => [r.candidateId, pairs.filter(p => r.role === "BANK" ? p.bankId === r.candidateId : p.ledgerId === r.candidateId).sort((a, b) => b.score - a.score || lex(a.bankId, b.bankId) || lex(a.ledgerId, b.ledgerId))]));
  function choice(id: string): { pair?: ScoredPair; reason: Outcome["reason"] } {
    const list = lists.get(id)!;
    if (!list.length) return { reason: "NO_ELIGIBLE_PAIR_GROUPING_NOT_SUPPORTED" };
    const [first, second] = list;
    if (!first.supported || first.score + EPS < config.threshold) return { reason: "INSUFFICIENT_SUPPORT" };
    if (second && (Math.abs(first.score - second.score) <= EPS || first.score - second.score + EPS < config.margin)) return { reason: "TIED_OR_CLOSE" };
    return { pair: first, reason: "MUTUAL_UNIQUE_SUPPORT" };
  }
  const outcomes: Outcome[] = input.candidates.map<Outcome>(r => {
    const selected = choice(r.candidateId), list = lists.get(r.candidateId)!;
    const partner = selected.pair ? (r.role === "BANK" ? selected.pair.ledgerId : selected.pair.bankId) : null;
    const mutual = partner !== null && choice(partner).pair === selected.pair;
    const reason = selected.pair && !mutual ? "ASSIGNMENT_CONFLICT" : selected.reason;
    return { recordId: r.candidateId, role: r.role, state: mutual ? "SUGGEST_PAIR" : reason === "TIED_OR_CLOSE" ? "AMBIGUOUS" : "UNRESOLVED", partnerId: mutual ? partner : null,
      candidateIds: list.map(p => r.role === "BANK" ? p.ledgerId : p.bankId), reason };
  }).sort((a, b) => lex(a.recordId, b.recordId));
  return { outcomes, suggestions: outcomes.filter(o => o.role === "BANK" && o.partnerId !== null).map(o => ({ bankId: o.recordId, ledgerId: o.partnerId! })) };
}
