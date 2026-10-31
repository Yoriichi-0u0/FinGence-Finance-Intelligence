// Import the same isolated setup first so this regression file is also safe in the ordinary local profile.
import { assertUnitMode, fixtureInfo, setUnitFault, unitReads } from "./ai05-ci-freeze.setup";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFreeze, validateFreeze } from "../../research/reconciliation/ai05/freeze";
import { LocalE5Provider } from "../../research/reconciliation/ai03/model-loader";
import { predictOfficial } from "../../research/reconciliation/ai05/prediction-runner";
import { evaluateOfficial, validatePredictionSeal } from "../../research/reconciliation/ai05/heldout-evaluator";

describe("AI05 isolated synthetic freeze boundary (never inference evidence)", () => {
  it("uses small, self-consistent synthetic hashes rather than claiming real pinned weights match", () => {
    const frozen = buildFreeze(), info = fixtureInfo();
    expect(info.status).toBe("UNIT_TEST_ONLY_NOT_FOR_INFERENCE");
    expect(info.totalFixtureBytes).toBeLessThan(4096);
    expect(frozen.model.status).toBe(info.status);
    expect(frozen.model.modelRepository).toBe("unit-test-only/not-an-inference-model");
    for (const [file, expected] of Object.entries(info.syntheticHashes)) {
      expect(expected).not.toBe(info.authoritativeHashes[file]);
      const bytes = readFileSync(frozen.modelRoot + "/" + file);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
    }
    expect(unitReads()).toContain("unit-runtime");
    expect(unitReads().filter(p => p.startsWith("unit-model:")).length).toBeGreaterThanOrEqual(6);
    validateFreeze(frozen);
  });
  it.each([
    ["missing-runtime", "ENOENT"],
    ["wrong-version", "Runtime version mismatch"],
    ["missing-model-file", "ENOENT"],
    ["corrupt-model-bytes", "Model integrity mismatch"],
    ["corrupt-manifest-hash", "Model integrity mismatch"],
    ["authoritative-pins", "Model integrity mismatch"],
    ["wrong-revision", "Missing or incorrect reviewed configuration"],
    ["wrong-dataset-version", "Missing or incorrect reviewed configuration"],
    ["wrong-date-policy", "Inconsistent frozen blocking/date policy"],
  ] as const)("fails closed for %s", (fault, message) => {
    setUnitFault(fault);
    expect(() => buildFreeze()).toThrow(message);
  });
  it("still rejects changed matching configuration and model policy", () => {
    const changed = buildFreeze();
    changed.configs.E2b.threshold = .1;
    expect(() => validateFreeze(changed)).toThrow("drift");
    const policy = buildFreeze();
    policy.model.precision = "int8";
    expect(() => validateFreeze(policy)).toThrow("drift");
  });
  it("does not accept synthetic bytes when the authoritative model hashes are requested", () => {
    setUnitFault("authoritative-pins");
    expect(() => buildFreeze()).toThrow("Model integrity mismatch");
  });
  it("cannot construct real inference or invoke official prediction/evaluation entry points", async () => {
    expect(() => new LocalE5Provider("unused", "unused")).toThrow("cannot construct");
    await expect(predictOfficial()).rejects.toThrow("cannot generate official predictions");
    expect(() => evaluateOfficial()).toThrow("cannot perform official evaluation");
    expect(() => validatePredictionSeal()).toThrow("cannot validate an official environment");
  });
  it("refuses real-inference and either official stage flags instead of silently converting them to unit tests", () => {
    for (const env of [{ AI03_REAL: "1" }, { AI05_STAGE: "predictions" }, { AI05_STAGE: "evaluation" }]) {
      expect(() => assertUnitMode(env)).toThrow("cannot run real inference or official evaluation");
    }
    expect(() => assertUnitMode({})).not.toThrow();
  });
  it.each([
    { AI03_REAL: "1", AI05_STAGE: "" },
    { AI03_REAL: "0", AI05_STAGE: "predictions" },
    { AI03_REAL: "0", AI05_STAGE: "evaluation" },
  ])("rejects forbidden mode at CI configuration load: %j", flags => {
    const result = spawnSync(process.execPath, [
      "node_modules/vitest/vitest.mjs", "run", "tests/reconciliation/ai05-ci-freeze.test.ts",
      "--config", "scripts/ai-research/vitest.ci.config.mts",
    ], { env: { ...process.env, ...flags }, encoding: "utf8", windowsHide: true, timeout: 15000 });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("synthetic CI unit profile cannot run real inference or official evaluation");
  });
});
