import { eligibilityExamples } from "./generator";
import { canonicalJSON, sha256 } from "./serialization";
import { assertBenchmark, recordErrors, statistics } from "./validator";
import { SPLITS, VERSION } from "./schemas";
import type { Benchmark, Split, SplitInput, Truth } from "./types";

export const inputPath = (split: Split) => `inputs/${split}.json`;
export const truthPath = (split: Split) => split === "heldout" ? "evaluation-only/heldout-truth.json" : `annotations/${split}.json`;
const manifestPath = "artifact-manifest.json";
const artifactPaths = [...SPLITS.flatMap(s => [inputPath(s), truthPath(s)]), "eligibility/rejections.json", "split-manifest.json"];
export function splitManifest(b: Benchmark, files: Record<string, string>) {
  return { version: VERSION, seed: b.seed, splits: b.inputs.map(i => ({ split: i.split, period: i.period,
    templateIds: i.templates.map(t => t.id).sort(), recordIds: i.records.map(r => r.id).sort(), rows: i.records.length,
    input: inputPath(i.split), inputSHA256: sha256(files[inputPath(i.split)]),
    annotations: truthPath(i.split), annotationSHA256: sha256(files[truthPath(i.split)]),
  })) };
}
/** In-memory authoring only; explicit snapshot update writes these versioned artifacts. */
export function frozenArtifacts(b: Benchmark): Record<string, string> {
  assertBenchmark(b);
  const files: Record<string, string> = {};
  for (const i of b.inputs) files[inputPath(i.split)] = canonicalJSON(i);
  for (const t of b.annotations) files[truthPath(t.split)] = canonicalJSON(t);
  files["eligibility/rejections.json"] = canonicalJSON({ version: VERSION, examples: eligibilityExamples(b) });
  files["split-manifest.json"] = canonicalJSON(splitManifest(b, files));
  files[manifestPath] = canonicalJSON({ version: VERSION, seed: b.seed, hashConvention: "SHA-256 byte-exact UTF-8", artifacts: Object.fromEntries(artifactPaths.map(p => [p, sha256(files[p])])) });
  return files;
}
export function verifyFrozenArtifacts(files: Record<string, string>) {
  if (canonicalJSON(Object.keys(files).sort()) !== canonicalJSON([...artifactPaths, manifestPath].sort())) throw new Error("Frozen artifact inventory mismatch");
  const m = JSON.parse(files[manifestPath]);
  if (m.version !== VERSION || m.hashConvention !== "SHA-256 byte-exact UTF-8" || canonicalJSON(Object.keys(m.artifacts).sort()) !== canonicalJSON([...artifactPaths].sort())) throw new Error("Frozen manifest contract mismatch");
  for (const p of artifactPaths) if (sha256(files[p]) !== m.artifacts[p]) throw new Error("Frozen artifact checksum mismatch: " + p);
  const b: Benchmark = { version: VERSION, seed: m.seed, inputs: SPLITS.map(s => JSON.parse(files[inputPath(s)]) as SplitInput), annotations: SPLITS.map(s => JSON.parse(files[truthPath(s)]) as Truth) };
  assertBenchmark(b);
  if (files["split-manifest.json"] !== canonicalJSON(splitManifest(b, files))) throw new Error("Split manifest mismatch");
  const rejected = JSON.parse(files["eligibility/rejections.json"]);
  const expected = ["number-money", "missing-money", "bad-date", "unknown-currency", "unapproved", "legacy-valid", "bad-basis", "missing-source"];
  if (rejected.version !== VERSION || !Array.isArray(rejected.examples) || canonicalJSON(rejected.examples.map((e: { id: string }) => e.id).sort()) !== canonicalJSON([...expected].sort())) throw new Error("Eligibility fixture inventory mismatch");
  for (const example of rejected.examples) {
    if (example.expected !== "REJECT" || typeof example.reason !== "string" || !recordErrors(example.input, "train").some(e => e.includes(example.reason))) throw new Error("Eligibility fixture did not reject as declared");
  }
  return { version: VERSION, artifacts: artifactPaths.length, splits: statistics(b), leakage: "passed" as const };
}
