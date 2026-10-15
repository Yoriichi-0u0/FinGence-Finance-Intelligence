import { beforeAll, describe, expect, it } from "vitest";
import { createAcceptedDataPayload, consolidate, type IngestionResult } from "../../lib/ingestion";
import { analyzeAcceptedDataPayload } from "../../lib/analytics/accepted-data-adapter";
import { analyzeIngestionResults } from "../../lib/analytics/ingestion-adapter";
import { consultationResults } from "./fixtures";

let results: IngestionResult[];
beforeAll(async () => { results = await consultationResults(); });

describe("real C1 producer → Frederick analytics", () => {
  it("passes the actual 23 accepted IDs, 20 VALID and 3 WARNING, with reconstructed lineage", () => {
    const payload = createAcceptedDataPayload(results);
    const run = analyzeAcceptedDataPayload(payload, "include");
    expect(results.flatMap(r => r.records)).toHaveLength(26);
    expect(run.prepared.counts).toEqual({ received: 23, included: 23, valid: 20, warning: 3, excludedWarnings: 0 });
    expect(run.prepared.records.map(r => r.source_row_id)).toEqual(consolidate(results).normalized.map(r => r.source_row_id));
    for (const row of run.prepared.records) {
      const source = consolidate(results).normalized.find(r => r.source_row_id === row.source_row_id)!;
      const { derived_ledger_net: omitted, ...sourceValues } = source;
      expect(omitted === null || typeof omitted === "string").toBe(true);
      expect(row).toMatchObject(sourceValues);
      expect(row).not.toHaveProperty("derived_ledger_net");
    }
  });

  it("agrees with the original adapter on comparable source aggregates, warnings and anomalies", () => {
    for (const policy of ["include", "exclude"] as const) {
      const old = analyzeIngestionResults(results, policy);
      const current = analyzeAcceptedDataPayload(createAcceptedDataPayload(results), policy);
      expect(current.prepared.counts).toEqual(old.prepared.counts);
      expect(current.anomalies).toEqual(old.anomalies);
      expect(current.monthlyAggregates.map(({ ledgerNetTotal, ...r }) => ({ ...r, ledgerNetTotal }))).toEqual(
        old.monthlyAggregates.map(r => ({ ...r, ledgerNetTotal: null })),
      );
      expect(current.prepared.excludedWarningRecords.map(r => r.validation_messages)).toEqual(old.prepared.excludedWarningRecords.map(r => r.validation_messages));
    }
  });

  it("does not fabricate ledger fields or interpretation when approval metadata is absent", () => {
    const run = analyzeAcceptedDataPayload(createAcceptedDataPayload(results));
    expect(run.ledgerInterpretation).toMatchObject({ available: 0, unavailable: 10, notApplicable: 13 });
    expect(run.monthlyAggregates.every(r => r.ledgerNetTotal === null)).toBe(true);
    expect(run.prepared.records.every(r => !("derived_ledger_net" in r))).toBe(true);
  });

  it("flags only the independently verified ledger/bank extremes after the midpoint-median correction", () => {
    // Ledger median=80.125, MAD=51.925; bank median=107.8, MAD=83.725.
    // Only the 1500 magnitudes exceed robust score 4.5 in either eligible group.
    const run = analyzeAcceptedDataPayload(createAcceptedDataPayload(results));
    expect(run.anomalies.map(r => [r.source_file, r.source_row_number, r.magnitude])).toEqual([
      ["ledger.csv", 2, "1500"], ["bank_statement.xlsx", 3, "1500"],
    ]);
  });

  it("reprocessing replaces the prior batch in both C1 and derived analytics", () => {
    const replacement = structuredClone(results[0]);
    replacement.context.batchId = "fresh-reprocessing-batch";
    replacement.normalized.forEach(row => { row.ingestion_batch_id = replacement.context.batchId; });
    const run = analyzeAcceptedDataPayload(createAcceptedDataPayload([...results, replacement]));
    expect(run.prepared.records).toHaveLength(23);
    expect(run.prepared.records.filter(r => r.source_file === "ledger.csv").every(r => r.ingestion_batch_id === "fresh-reprocessing-batch")).toBe(true);
    expect(run.prepared.records.some(r => r.ingestion_batch_id === results[0].context.batchId)).toBe(false);
    expect(analyzeAcceptedDataPayload(createAcceptedDataPayload(results.slice(1))).prepared.records).toHaveLength(13);
  });
});
