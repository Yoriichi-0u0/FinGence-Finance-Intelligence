import { beforeEach, vi } from "vitest";

type Fault = "valid" | "missing-runtime" | "wrong-version" | "missing-model-file"
  | "corrupt-model-bytes" | "corrupt-manifest-hash" | "authoritative-pins"
  | "wrong-revision" | "wrong-dataset-version" | "wrong-date-policy";

const unit = vi.hoisted(() => ({
  fault: "valid" as Fault,
  reads: [] as string[],
  info: undefined as undefined | {
    status: string; totalFixtureBytes: number;
    authoritativeHashes: Record<string, string>; syntheticHashes: Record<string, string>;
  },
}));

export function assertUnitMode(env: { AI03_REAL?: string; AI05_STAGE?: string }) {
  if (env.AI03_REAL === "1" || env.AI05_STAGE?.trim()) {
    throw new Error("Synthetic freeze fixtures cannot run real inference or official evaluation");
  }
}
assertUnitMode({ AI03_REAL: process.env.AI03_REAL, AI05_STAGE: process.env.AI05_STAGE });

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { createHash } = await import("node:crypto");
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const modelConfig = resolve("research/reconciliation/ai03/model-config.json");
  const authoritative = JSON.parse(actual.readFileSync(modelConfig, "utf8"));
  const syntheticBytes = new Map<string, Buffer>(Object.keys(authoritative.filesSHA256).map(file => [
    file, Buffer.from("AI05 UNIT TEST ONLY; NOT A MODEL; NO INFERENCE: " + file + "\n"),
  ]));
  const syntheticHashes = Object.fromEntries([...syntheticBytes].map(([file, bytes]) => [file, digest(bytes)]));
  const runtimeFile = resolve("../ai03-runtime/node_modules/@huggingface/transformers/package.json");
  const modelRoot = resolve("../ai03-models", authoritative.revision);
  const paths = new Map([...syntheticBytes.keys()].map(file => [resolve(modelRoot, file), file]));
  unit.info = {
    status: "UNIT_TEST_ONLY_NOT_FOR_INFERENCE",
    totalFixtureBytes: [...syntheticBytes.values()].reduce((n, bytes) => n + bytes.length, 0),
    authoritativeHashes: { ...authoritative.filesSHA256 }, syntheticHashes,
  };
  const missing = (file: string): never => {
    throw Object.assign(new Error("ENOENT: missing synthetic unit asset: " + file), { code: "ENOENT" });
  };
  const mockRead = (file: Parameters<typeof actual.readFileSync>[0], options?: Parameters<typeof actual.readFileSync>[1]) => {
    const absolute = typeof file === "string" ? resolve(file) : file instanceof URL ? fileURLToPath(file) : undefined;
    let bytes: Buffer | undefined;
    if (absolute === modelConfig) {
      unit.reads.push("unit-manifest");
      const hashes = unit.fault === "authoritative-pins" ? authoritative.filesSHA256 : { ...syntheticHashes };
      if (unit.fault === "corrupt-manifest-hash") hashes["onnx/model.onnx"] = "0".repeat(64);
      bytes = Buffer.from(JSON.stringify({
        ...authoritative,
        status: "UNIT_TEST_ONLY_NOT_FOR_INFERENCE",
        originalModel: "UNIT_TEST_ONLY", modelRepository: "unit-test-only/not-an-inference-model",
        revision: unit.fault === "wrong-revision" ? "UNAPPROVED_UNIT_REVISION" : authoritative.revision,
        filesSHA256: hashes,
        weightBytes: syntheticBytes.get("onnx/model.onnx")!.length,
        weightSHA256: hashes["onnx/model.onnx"], tokenizerSHA256: hashes["tokenizer.json"],
      }));
    } else if (absolute === runtimeFile) {
      unit.reads.push("unit-runtime");
      if (unit.fault === "missing-runtime") return missing(runtimeFile);
      bytes = Buffer.from(JSON.stringify({
        unitTestOnly: true, version: unit.fault === "wrong-version" ? "0.0.0-invalid-unit-version" : authoritative.libraryVersion,
      }));
    } else if (absolute && paths.has(absolute)) {
      const name = paths.get(absolute)!;
      unit.reads.push("unit-model:" + name);
      if (unit.fault === "missing-model-file" && name === "onnx/model.onnx") return missing(absolute);
      bytes = Buffer.from(syntheticBytes.get(name)!);
      if (unit.fault === "corrupt-model-bytes" && name === "onnx/model.onnx") bytes = Buffer.concat([bytes, Buffer.from("corrupt")]);
    } else if (absolute === resolve("research/reconciliation/m2/fixtures/artifact-manifest.json") && unit.fault === "wrong-dataset-version") {
      bytes = Buffer.from(JSON.stringify({ ...JSON.parse(actual.readFileSync(file, "utf8")), version: "INVALID_UNIT_VERSION" }));
    } else if (absolute === resolve("docs/reconciliation/evidence/ai02/configuration.json") && unit.fault === "wrong-date-policy") {
      const config = JSON.parse(actual.readFileSync(file, "utf8"));
      config.E0.date.maxDays = 3;
      bytes = Buffer.from(JSON.stringify(config));
    }
    if (bytes === undefined) return actual.readFileSync(file, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? bytes.toString(encoding) : bytes;
  };
  // Preserve readFileSync's runtime encoding contract; its overload return types are narrower than this implementation signature.
  return { ...actual, readFileSync: mockRead as typeof actual.readFileSync };
});

// Defense in depth: this project must never create an official artifact or a real worker.
vi.mock("../../research/reconciliation/ai03/model-loader", () => ({
  LocalE5Provider: class {
    constructor() { throw new Error("Synthetic unit project cannot construct a real inference worker"); }
  },
}));
vi.mock("../../research/reconciliation/ai05/prediction-runner", () => ({
  predictOfficial: async () => { throw new Error("Synthetic unit project cannot generate official predictions"); },
}));
vi.mock("../../research/reconciliation/ai05/heldout-evaluator", async importOriginal => ({
  ...await importOriginal<typeof import("../../research/reconciliation/ai05/heldout-evaluator")>(),
  evaluateOfficial: () => { throw new Error("Synthetic unit project cannot perform official evaluation"); },
  validatePredictionSeal: () => { throw new Error("Synthetic unit project cannot validate an official environment"); },
}));

beforeEach(() => { unit.fault = "valid"; unit.reads.length = 0; });
export const setUnitFault = (fault: Fault) => { unit.fault = fault; };
export const unitReads = () => [...unit.reads];
export function fixtureInfo() {
  if (!unit.info) throw new Error("This test must run in the isolated AI05 CI unit project");
  return structuredClone(unit.info);
}
