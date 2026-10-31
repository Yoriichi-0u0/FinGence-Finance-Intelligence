import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { datasetFingerprint, DEFAULT_SEED, generateDataset, serializeDataset } from "../../research/reconciliation/generator";
import { assertValidDataset, summarizeDataset } from "../../research/reconciliation/validator";
import expectations from "../../research/reconciliation/fixtures/pilot-expectations.json";

describe("AI01 deterministic pilot", () => {
  it("matches the frozen canonical pilot fixture", async () => {
    await expect(serializeDataset(generateDataset())).toMatchFileSnapshot(fileURLToPath(new URL("../../research/reconciliation/fixtures/pilot-dataset.json", import.meta.url)));
  });
  it("has independently specified pilot counts and four populated source schemas", () => {
    const d = generateDataset(); assertValidDataset(d);
    expect(summarizeDataset(d)).toEqual(expectations.summary);
    expect(d.templates.map(t => d.records.filter(r => r.templateId === t.id).length)).toEqual([10, 10, 10, 10]);
    const counts = Object.fromEntries(Object.keys(expectations.familyRows).map(f => [f, d.groundTruth.cases.filter(c => c.family === f).reduce((n, c) => n + c.recordIds.length, 0)]));
    expect(counts).toEqual(expectations.familyRows);
  });
  it("is byte-identical for repeated fixed-seed generation including labels", () => {
    const a = generateDataset({ seed: expectations.seed }), b = generateDataset({ seed: expectations.seed });
    expect(a).toEqual(b); expect(serializeDataset(a)).toBe(serializeDataset(b));
    expect(datasetFingerprint(a)).toMatch(/^[0-9a-f]{64}$/); expect(datasetFingerprint(a)).toBe(datasetFingerprint(b));
    expect(a.config.seed).toBe(DEFAULT_SEED);
  });
  it.each(["other-seed", "0", "SAIC synthetic seed", "种子"]) ("supports reproducible alternate seed %s", seed => {
    const a = generateDataset({ seed }); assertValidDataset(a);
    expect(serializeDataset(a)).toBe(serializeDataset(generateDataset({ seed })));
    expect(datasetFingerprint(a)).not.toBe(datasetFingerprint(generateDataset()));
    expect(summarizeDataset(a)).toEqual(expectations.summary);
  });
  it("ignores clock and Math.random", () => {
    const baseline = serializeDataset(generateDataset());
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Uncontrolled randomness"); });
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Clock dependency"); });
    try { expect(serializeDataset(generateDataset())).toBe(baseline); } finally { random.mockRestore(); now.mockRestore(); }
  });
  it("does not expose author family or relationship labels on records", () => {
    const d = generateDataset();
    for (const r of d.records) { expect(r.id).toMatch(/^syn-[a-f0-9]{24}$/); expect(r).not.toHaveProperty("family"); expect(r).not.toHaveProperty("economicId"); }
    expect(d.records.map(r => r.id)).toEqual(d.records.map(r => r.id).sort());
  });
  it("returns independent copies and canonical serialization ignores object key order", () => {
    const a = generateDataset(), b = generateDataset();
    a.templates[0].columns = ["mutated"];
    expect(b.templates[0].columns).not.toEqual(a.templates[0].columns);
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as typeof b;
    expect(serializeDataset(reordered)).toBe(serializeDataset(b));
    expect(JSON.parse(serializeDataset(b))).toEqual(b);
  });
  it.each(["", "x".repeat(129), "bad\nseed", "bad\0seed"])("rejects invalid seed %j", seed => {
    expect(() => generateDataset({ seed })).toThrow("Seed");
  });
  it("rejects unsupported configuration instead of silently expanding the pilot", () => {
    expect(() => generateDataset({ rows: 300 } as never)).toThrow("configuration");
    expect(() => generateDataset({ seed: null as never })).toThrow("Seed");
  });
});
