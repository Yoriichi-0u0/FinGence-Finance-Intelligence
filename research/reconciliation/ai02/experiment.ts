import type { Truth } from "../m2/types";
import type { Input, Config, Method } from "./types";
import { DATE_POLICY, EXACT_CONFIG } from "./types";
import { runBaseline } from "./run";
import { evaluate, latency } from "./evaluator";
/** Fixed grid and selection rule established before examining development results.
 * First minimize explicit false + unannotated suggestions, then maximize economic F1,
 * then prefer higher threshold and higher margin. No held-out input accepted.
 */
export function experiment(train: Input, development: Input, trainTruth: Truth, devTruth: Truth) {
  if (train.split !== "train" || development.split !== "development") throw new Error("Development-only experiment");
  const grid = [.75, .85, .95].flatMap(threshold => [.05, .1, .2].map(margin => {
    const config: Config = { date: DATE_POLICY, threshold, margin };
    const run = runBaseline(development, "E1", config);
    return { config, metrics: evaluate(development, devTruth, run) };
  }));
  const risk = (x: typeof grid[number]) => x.metrics.matching.explicitFalsePositives + x.metrics.matching.unannotatedSuggestions;
  const selected = [...grid].sort((a, b) => risk(a) - risk(b) || (b.metrics.matching.f1 ?? 0) - (a.metrics.matching.f1 ?? 0) || b.config.threshold - a.config.threshold || b.config.margin - a.config.margin)[0].config;
  const results = (["E0", "E1"] as Method[]).flatMap(method => [train, development].map(input => {
    const config = method === "E0" ? EXACT_CONFIG : selected;
    const truth = input.split === "train" ? trainTruth : devTruth;
    runBaseline(input, method, config); // One unmeasured warmup; no held-out evaluation.
    const runs = Array.from({ length: 7 }, () => runBaseline(input, method, config));
    if (new Set(runs.map(r => r.fingerprint)).size !== 1) throw new Error("Nondeterministic baseline");
    return { method, split: input.split, config, metrics: evaluate(input, truth, runs[0]), timing: latency(runs.map(r => r.processingMs)), run: runs[0] };
  }));
  return { version: "ai02/1.0.0", datasetVersion: train.version, heldoutEvaluated: false, selectedFuzzyConfig: selected, grid, results };
}
