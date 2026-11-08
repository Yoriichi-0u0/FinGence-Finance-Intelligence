import { beforeAll, describe, expect, it } from "vitest";
import { consultationResults } from "./fixtures";
import { prepareTeamAnalytics, describeExperimentalRun } from "../../examples/integration/team-reuse";
import type { IngestionResult } from "../../lib/ingestion";

let results: IngestionResult[];
beforeAll(async () => { results = await consultationResults(); });

describe("teammate reuse examples use real stable contracts", () => {
  it("passes all 23 actual producer rows through C1 and preserves warning-policy behavior", () => {
    const before = structuredClone(results);
    const included = prepareTeamAnalytics(results, "include"), excluded = prepareTeamAnalytics(results, "exclude");
    expect(included.payload.datasets.flatMap(d => d.normalized)).toHaveLength(23);
    expect(included.analysis.prepared.counts).toMatchObject({ included: 23, valid: 20, warning: 3 });
    expect(excluded.analysis.prepared.counts).toMatchObject({ included: 20, excludedWarnings: 3 });
    expect(included.analysis.anomalies).toHaveLength(2);
    expect(included.analysis.ledgerInterpretation).toMatchObject({ available: 0, unavailable: 10, notApplicable: 13 });
    expect(results).toEqual(before);
  });
  it("keeps empty C1 transport valid rather than fabricating sample transactions", () => {
    expect(prepareTeamAnalytics([], "include").payload).toEqual({ schema_version: "0.1", ruleset_version: "0.1", datasets: [] });
  });
  it("reports blocked experimental inference without inventing an accepted-data adapter", () => {
    const view = describeExperimentalRun({ version: "v2-run-0.3", mode: "NOT_EXECUTED", verification: null });
    expect(view).toMatchObject({ origin: "NOT_EXECUTED", decision: "NOT_VERIFIED", counts: null, bridgeToC1: "NOT_IMPLEMENTED" });
    expect(view).not.toHaveProperty("normalized");
    expect(view).not.toHaveProperty("payload");
  });
});
