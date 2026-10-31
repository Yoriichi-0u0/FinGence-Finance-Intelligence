import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { runBaseline } from "../ai02/run";
import type { Input, Config } from "../ai02/types";
import { rankSemantic } from "../ai03/semantic-ranker";
import { Embeddings } from "../ai03/embedding";
import { project } from "../ai04/projection";
import { verify } from "../ai04/orchestrator";
import { POLICY } from "../ai04/policy";
import type { VerificationInput } from "../ai04/types";
import type { SplitInput } from "../m2/types";
import { canonicalJSON, sha256 } from "../m2/serialization";

export interface Capability {
  component: string;
  supported: boolean;
  error: string | null;
}

/** Synthetic empty probes only: never loads held-out records or annotations. */
export async function probeHeldoutSupport(): Promise<{ capabilities: Capability[]; modelCalls: number }> {
  const input = { version: "ai01-m2/1.1.0", split: "heldout", candidates: [] } as unknown as Input;
  const config: Config = { date: { field: "canonicalDate", maxDays: 2 }, threshold: .9, margin: .03 };
  const capabilities: Capability[] = [];
  async function probe(component: string, operation: () => unknown | Promise<unknown>) {
    try {
      await operation();
      capabilities.push({ component, supported: true, error: null });
    } catch (error) {
      capabilities.push({ component, supported: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await probe("E0 runBaseline", () => runBaseline(input, "E0", config));
  await probe("E1 runBaseline", () => runBaseline(input, "E1", config));
  let modelCalls = 0;
  const embeddings = new Embeddings({
    kind: "UNIT_TEST_ONLY",
    initialize: async () => { modelCalls++; throw new Error("Preflight must not initialize a model"); },
    embed: async () => { modelCalls++; throw new Error("Preflight must not infer"); },
    terminate: () => {}, dispose: async () => {},
  });
  await probe("E2b rankSemantic", () => rankSemantic(input, config, embeddings));
  await embeddings.close();
  const source = { version: "ai01-m2/1.1.0", seed: "preflight-only", split: "heldout", period: "2026-07", templates: [], records: [] } as SplitInput;
  await probe("AI04 project", () => project(source));
  const evidence = { version: "ai01-m2/1.1.0", split: "heldout", records: [] } as unknown as VerificationInput;
  await probe("AI04 verify", () => verify(evidence, [], POLICY));
  return { capabilities, modelCalls };
}

/** Reviewed values are copied from their actual saved configuration files, never reconstructed. */
export function configurationSnapshot() {
  const paths = {
    dataset: "research/reconciliation/m2/fixtures/artifact-manifest.json",
    baselines: "docs/reconciliation/evidence/ai02/configuration.json",
    semantic: "docs/reconciliation/evidence/ai03/selected-config.json",
    model: "research/reconciliation/ai03/model-config.json",
  };
  function read(path: string) {
    const bytes = readFileSync(path);
    return { path, sha256: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) };
  }
  const reviewed = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, read(path)]));
  const software = {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    project: JSON.parse(readFileSync("package.json", "utf8")),
    vitest: JSON.parse(readFileSync("node_modules/vitest/package.json", "utf8")).version as string,
  };
  const snapshot = {
    version: "ai05-preflight/0.1.0",
    status: "BLOCKED_HELDOUT_RUNTIME_BOUNDARY",
    officialEvaluationStarted: false,
    truthLoadedForEvaluation: false,
    reviewed,
    verificationPolicy: POLICY,
    verificationPolicyFingerprint: sha256(canonicalJSON(POLICY)),
    software,
    note: "Preparatory snapshot only. The unchanged matching and verification entry points deny heldout. No official configuration seal, predictions, metrics or model execution is claimed.",
  };
  return { ...snapshot, fingerprint: sha256(canonicalJSON(snapshot)) };
}

export async function preflight() {
  const start = performance.now();
  const configuration = configurationSnapshot();
  const probe = await probeHeldoutSupport();
  return { configuration, ...probe, preflightMs: performance.now() - start };
}
