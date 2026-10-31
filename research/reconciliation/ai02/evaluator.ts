import type { Truth } from "../m2/types";
import type { Input, Run } from "./types";
import { blockedReason } from "./candidates";
const edge = (b: string, l: string) => JSON.stringify([b, l]);
const ratio = (a: number, b: number): number | null => b ? a / b : null;
/** Separate evaluator-only module. Sparse unlabelled edges are not silently negatives. */
export function evaluate(input: Input, truth: Truth, run: Run) {
  if (input.split === ("heldout" as string) || truth.split !== input.split || run.split !== input.split || truth.version !== input.version || run.datasetVersion !== input.version) throw new Error("Evaluation split/version mismatch or held-out access");
  const records = new Map(input.candidates.map(r => [r.candidateId, r]));
  const positives = new Set(truth.relationships.filter(r => r.kind === "PAIR").map(r => edge(r.bankIds[0], r.ledgerIds[0])));
  const negatives = new Set(truth.negatives.map(n => edge(n.bankId, n.ledgerId)));
  if ([...positives].some(p => negatives.has(p))) throw new Error("Contradictory evaluation truth");
  const pool = new Set(run.candidates.map(p => edge(p.bankId, p.ledgerId)));
  const suggestions = new Set(run.suggestions.map(p => edge(p.bankId, p.ledgerId)));
  const tp = [...suggestions].filter(p => positives.has(p)).length;
  const fp = [...suggestions].filter(p => negatives.has(p)).length;
  const unannotated = suggestions.size - tp - fp, fn = positives.size - tp;
  const precision = ratio(tp, tp + fp), recall = ratio(tp, positives.size);
  const f1 = precision === null || recall === null ? null : precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  const used = run.suggestions.flatMap(p => [p.bankId, p.ledgerId]);
  const duplicateConflicts = used.length - new Set(used).size;
  const invalid = run.candidates.filter(p => { const b = records.get(p.bankId), l = records.get(p.ledgerId); return !b || !l || b.role !== "BANK" || l.role !== "LEDGER" || blockedReason(b.features, l.features, run.config) !== null; }).length;
  const banks = input.candidates.filter(r => r.role === "BANK").length;
  const countOutcomes = (state: string) => run.outcomes.filter(o => o.role === "BANK" && o.state === state).length;
  const groups = truth.relationships.filter(r => r.kind !== "PAIR");
  const groupIds = new Set(groups.flatMap(r => [...r.bankIds, ...r.ledgerIds]));
  const unavailable = truth.outcomes.filter(o => o.decision !== "SUGGEST_PAIR").map(o => o.subjectId);
  return {
    denominators: { genuinePairs: positives.size, bankRecords: banks, allRecords: records.size, suggestions: suggestions.size, assessedSuggestions: tp + fp, unmatchedRecords: truth.unmatched.length, unsupportedGroups: groups.length },
    retrieval: { candidateGenerationRecall: ratio([...positives].filter(p => pool.has(p)).length, positives.size), survivingGenuinePairs: [...positives].filter(p => pool.has(p)).length,
      recallAt1: ratio(run.candidates.filter(p => p.rank <= 1 && positives.has(edge(p.bankId, p.ledgerId))).length, positives.size),
      recallAt3: ratio(run.candidates.filter(p => p.rank <= 3 && positives.has(edge(p.bankId, p.ledgerId))).length, positives.size),
      recallAt5: ratio(run.candidates.filter(p => p.rank <= 5 && positives.has(edge(p.bankId, p.ledgerId))).length, positives.size) },
    matching: { truePositives: tp, explicitFalsePositives: fp, falseNegatives: fn, unannotatedSuggestions: unannotated, precision, recall, f1,
      assessedSuggestionRatio: ratio(tp + fp, suggestions.size), precisionBounds: suggestions.size ? [tp / suggestions.size, (tp + unannotated) / suggestions.size] : null },
    operational: { suggestionCoverage: ratio(countOutcomes("SUGGEST_PAIR"), banks), unresolvedRatio: ratio(banks - countOutcomes("SUGGEST_PAIR"), banks),
      ambiguousBankRecords: countOutcomes("AMBIGUOUS"), unresolvedBankRecords: countOutcomes("UNRESOLVED"),
      assignmentConflictRecords: run.outcomes.filter(o => o.reason === "ASSIGNMENT_CONFLICT").length, duplicateAssignmentConflicts: duplicateConflicts, invalidCandidates: invalid,
      annotatedAmbiguousCasesFullyAbstained: truth.ambiguous.filter(a => a.bankIds.every(id => run.outcomes.some(o => o.recordId === id && o.state !== "SUGGEST_PAIR"))).length,
      unmatchedRecordsSuggested: truth.unmatched.filter(u => run.outcomes.some(o => o.recordId === u.recordId && o.state === "SUGGEST_PAIR")).length,
      groupAssociatedSuggestions: run.suggestions.filter(p => groupIds.has(p.bankId) || groupIds.has(p.ledgerId)).length,
      trueSuggestionsAgainstAuthoredAbstention: truth.relationships.filter(r => r.kind === "PAIR" && unavailable.includes(r.id) && suggestions.has(edge(r.bankIds[0], r.ledgerIds[0]))).length },
    performance: { processingMs: run.processingMs, candidatePairsEvaluated: run.candidateCount }, fingerprint: run.fingerprint,
  };
}
export function latency(samples: number[]) {
  if (!samples.length || samples.some(s => !Number.isFinite(s) || s < 0)) throw new Error("Invalid timing samples");
  const sorted = [...samples].sort((a, b) => a - b);
  return { samplesMs: samples, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], count: samples.length };
}
