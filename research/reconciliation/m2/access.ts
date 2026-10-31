import { featuresOf } from "./features";
import { assertBenchmark, inputErrors } from "./validator";
import type { Benchmark, SplitInput } from "./types";

function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
  return value;
}
function candidates(value: unknown, evaluation: boolean) {
  const errors = inputErrors(value);
  if (errors.length) throw new Error(errors.join("\n"));
  const input = value as SplitInput;
  if (evaluation ? input.split !== "heldout" : input.split === "heldout") throw new Error("Split is not authorized for this research purpose");
  // Explicit construction: neither annotations nor provenance are spread into features.
  return freeze({ version: input.version, split: input.split, candidates: input.records.map(r => ({
    candidateId: r.id, role: r.role, features: featuresOf(r),
  })) });
}
/** The only input-building entry point for development/tuning. Held-out data fails closed. */
export const developmentCandidates = (input: unknown) => candidates(input, false);
/** Evaluator-only input; deliberately separate from development/tuning. Contains no labels. */
export const heldoutCandidates = (input: unknown) => candidates(input, true);
/** Read-only annotation view for future evaluation. No metric, matching, or approval logic. */
export function heldoutAnnotations(benchmark: Benchmark) {
  assertBenchmark(benchmark);
  return freeze(structuredClone(benchmark.annotations.find(t => t.split === "heldout")!));
}
