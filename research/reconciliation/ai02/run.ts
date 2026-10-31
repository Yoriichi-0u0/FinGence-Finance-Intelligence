import { performance } from "node:perf_hooks";
import { canonicalJSON, sha256 } from "../m2/serialization";
import { generateCandidates, lex } from "./candidates";
import { exactScore } from "./exact";
import { fuzzyScore } from "./fuzzy";
import { resolve } from "./abstention";
import { ALGORITHM_VERSION, type Input, type Config, type Method, type Run, type ScoredPair } from "./types";
/** Pure projected-input matcher: never reads fixtures or imports truth/authoring modules. */
export function runBaseline(input: Input, method: Method, config: Config): Run {
  const start = performance.now();
  if (!["E0", "E1"].includes(method)) throw new Error("Unknown baseline");
  const pool = generateCandidates(input, config), records = new Map(input.candidates.map(r => [r.candidateId, r.features]));
  const candidates: ScoredPair[] = pool.pairs.map(p => {
    const score = (method === "E0" ? exactScore : fuzzyScore)(records.get(p.bankId)!, records.get(p.ledgerId)!);
    return { ...p, method, rank: 0, ...score, reasons: ["EXACT_AMOUNT", "SAME_CURRENCY", "SAME_DIRECTION", "DATE_POLICY_PASS", ...score.reasons] };
  });
  for (const p of candidates) p.rank = candidates.filter(q => q.bankId === p.bankId && q.score >= p.score - 1e-12).length;
  candidates.sort((a, b) => lex(a.bankId, b.bankId) || b.score - a.score || lex(a.ledgerId, b.ledgerId));
  const result = { method, algorithmVersion: ALGORITHM_VERSION, datasetVersion: input.version, split: input.split, config: structuredClone(config), candidateCount: candidates.length,
    blockedCount: pool.blockedCount, blockingReasons: pool.blocked, candidates, ...resolve(input, candidates, config) };
  // Wall time excluded; input fingerprint prevents aliasing runs on changed feature data.
  const inputCanonical = { ...input, candidates: [...input.candidates].sort((a, b) => lex(a.candidateId, b.candidateId)) };
  return { ...result, processingMs: performance.now() - start, fingerprint: sha256(canonicalJSON({ input: inputCanonical, result })) };
}
