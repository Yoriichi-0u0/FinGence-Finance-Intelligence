import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configurationSnapshot, preflight, probeHeldoutSupport } from "../../research/reconciliation/ai05/preflight";

describe("AI05 preflight — no held-out truth or model execution", () => {
  it("records the actual reviewed configurations and stable preparation fingerprint", () => {
    const snapshot = configurationSnapshot();
    expect(snapshot).toEqual(configurationSnapshot());
    expect(snapshot.reviewed.dataset.value.version).toBe("ai01-m2/1.1.0");
    expect(snapshot.reviewed.baselines.value.E0).toEqual({ date: { field: "canonicalDate", maxDays: 2 }, threshold: 1, margin: 0 });
    expect(snapshot.reviewed.baselines.value.E1).toEqual({ date: { field: "canonicalDate", maxDays: 2 }, threshold: .95, margin: .2 });
    expect(snapshot.reviewed.semantic.value.config).toEqual({ date: { field: "canonicalDate", maxDays: 2 }, threshold: .9, margin: .03 });
    expect(snapshot.reviewed.model.value.revision).toBe("761b726dd34fb83930e26aab4e9ac3899aa1fa78");
    expect(snapshot.reviewed.model.value.precision).toBe("fp32");
    expect(snapshot.officialEvaluationStarted).toBe(false);
    expect(snapshot.truthLoadedForEvaluation).toBe(false);
  });
  it("demonstrates all five unchanged runtime guards using synthetic empty inputs", async () => {
    const result = await probeHeldoutSupport();
    expect(result.capabilities).toHaveLength(5);
    expect(result.capabilities.every(c => !c.supported && c.error !== null)).toBe(true);
    expect(result.capabilities.slice(0, 3).every(c => c.error === "Unsupported development input/version/split")).toBe(true);
    expect(result.modelCalls).toBe(0);
  });
  it("reports a blocker without silently treating unexecuted evaluation as passed", async () => {
    const result = await preflight();
    expect(result.configuration.status).toBe("BLOCKED_HELDOUT_RUNTIME_BOUNDARY");
    expect(result.configuration.officialEvaluationStarted).toBe(false);
    expect(result.modelCalls).toBe(0);
    if (process.env.AI05_WRITE_PREFLIGHT === "1") {
      mkdirSync("docs/reconciliation/evidence/ai05", { recursive: true });
      writeFileSync("docs/reconciliation/evidence/ai05/preflight.json", JSON.stringify(result, null, 2) + "\n");
    }
  });
});
