import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { frozenArtifacts, verifyFrozenArtifacts } from "../../research/reconciliation/m2/artifacts";
import { generateBenchmark } from "../../research/reconciliation/m2/generator";
import { sha256 } from "../../research/reconciliation/m2/serialization";

describe("M2 frozen benchmark", () => {
  it("matches nine deterministic versioned artifacts without rewriting M1", async () => {
    const generated = frozenArtifacts(generateBenchmark());
    expect(Object.keys(generated)).toHaveLength(9);
    for (const [name, text] of Object.entries(generated)) await expect(text).toMatchFileSnapshot(fileURLToPath(new URL("../../research/reconciliation/m2/fixtures/" + name, import.meta.url)));
  });
  it("independently verifies the frozen inventory, bytes, annotations and split manifests", () => {
    const generated = frozenArtifacts(generateBenchmark());
    const files = Object.fromEntries(Object.keys(generated).map(name => [name, readFileSync(new URL("../../research/reconciliation/m2/fixtures/" + name, import.meta.url), "utf8")]));
    const verified = verifyFrozenArtifacts(files);
    expect(verified.artifacts).toBe(8); expect(verified.leakage).toBe("passed");
    expect(verified.splits.map(s => s.rows)).toEqual([150, 50, 100]);
  });
  it("rejects byte corruption even when parsed data would be identical", () => {
    const files = frozenArtifacts(generateBenchmark()); files["inputs/train.json"] += " ";
    expect(() => verifyFrozenArtifacts(files)).toThrow("checksum");
  });
  it("rejects missing or unexpected artifact paths", () => {
    const files = frozenArtifacts(generateBenchmark()); delete files["evaluation-only/heldout-truth.json"];
    expect(() => verifyFrozenArtifacts(files)).toThrow("inventory");
    files["secret.json"] = "{}"; expect(() => verifyFrozenArtifacts(files)).toThrow("inventory");
  });
  it("preserves the reviewed M1 fixture byte-for-byte", () => {
    expect(sha256(readFileSync(new URL("../../research/reconciliation/fixtures/pilot-dataset.json", import.meta.url))))
      .toBe("6c5961572fc1b725f7129cec35810cbea77f8c560e70ed6f18d677a7094c7044");
  });
});
