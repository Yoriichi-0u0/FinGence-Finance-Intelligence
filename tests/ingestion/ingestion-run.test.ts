import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  approveMapping, canonicalCSV, consolidate, createAcceptedDataPayload, createDataset, DEFAULT_OPTIONS,
  evidenceJSON, ingestDataset, ingestDatasetRun, inspectFile, overrideMapping, rejectedCSV, suggestMapping,
  type IngestionOptions, type IngestionResult,
} from "../../lib/ingestion/index";
import expected from "../../public/samples/ingestion/expected.json";

const instant = "2026-10-07T00:00:00.123Z";
const header = "transaction_date,amount,reference,description,currency\n";
async function prepare(csv = header + "2026-09-01,9007199254740993.10,001,Text,MYR") {
  const dataset = createDataset(await inspectFile(new TextEncoder().encode(csv), { name: "synthetic-run.csv" }), 0);
  return { dataset, mapping: approveMapping(suggestMapping(dataset)), options: { ...DEFAULT_OPTIONS } };
}
function providers(ids: string[], times = ids.map(() => instant)) {
  return { idFactory: vi.fn(() => ids.shift()!), now: vi.fn(() => new Date(times.shift()!)) };
}

describe("fresh ingestion executions through the public entry point", () => {
  it("requests one ID/time pair per execution, including executions sharing the same millisecond", async () => {
    const input = await prepare();
    const generated = providers(["batch-A", "batch-B"]);
    const first = ingestDatasetRun(input.dataset, input.mapping, input.options, generated);
    const second = ingestDatasetRun(input.dataset, input.mapping, input.options, generated);
    expect(generated.idFactory).toHaveBeenCalledTimes(2);
    expect(generated.now).toHaveBeenCalledTimes(2);
    expect(first.context).toEqual({ batchId: "batch-A", ingestedAt: instant });
    expect(second.context).toEqual({ batchId: "batch-B", ingestedAt: instant });
    expect(second.dataset.id).toBe(first.dataset.id);
    expect(second.normalized.map(row => row.source_row_id)).toEqual(first.normalized.map(row => row.source_row_id));
    expect(second.summary).toEqual(first.summary);
    for (const result of [first, second]) {
      for (const row of result.records) {
        expect(row.provenance.ingestion_batch_id).toBe(result.context.batchId);
        expect(row.candidate.ingested_at).toBe(instant);
      }
      expect(result.normalized[0]).toMatchObject({ ingestion_batch_id: result.context.batchId,
        ingested_at: instant, source_amount: "9007199254740993.1", reference: "001" });
    }
  });

  it("consumes a pair for a throwing attempt, stores no result, and requests fresh context on retry", async () => {
    const input = await prepare();
    const generated = providers(["batch-A", "unused-failed-batch", "batch-C"]);
    const stored: IngestionResult[] = [];
    const attempt = (approved: boolean) => {
      const result = ingestDatasetRun(input.dataset,
        approved ? input.mapping : suggestMapping(input.dataset), input.options, generated);
      stored.push(result);
    };
    attempt(true);
    expect(() => attempt(false)).toThrow(/approve/);
    expect(stored.map(result => result.context.batchId)).toEqual(["batch-A"]);
    expect(generated.idFactory).toHaveBeenCalledTimes(2);
    expect(generated.now).toHaveBeenCalledTimes(2);
    attempt(true);
    expect(stored.map(result => result.context.batchId)).toEqual(["batch-A", "batch-C"]);
    expect(generated.idFactory).toHaveBeenCalledTimes(3);
    expect(generated.now).toHaveBeenCalledTimes(3);
  });

  it("gives an all-rejected completed result its own context without forwarding rejected rows", async () => {
    const input = await prepare(header + "31/31/2026,10,R,Text,MYR");
    const generated = providers(["rejected-execution"]);
    const result = ingestDatasetRun(input.dataset, input.mapping, input.options, generated);
    expect(result.context).toEqual({ batchId: "rejected-execution", ingestedAt: instant });
    expect(result.summary).toMatchObject({ rowsReceived: 1, rejected: 1, accepted: 0 });
    expect(result.records[0].provenance.ingestion_batch_id).toBe("rejected-execution");
    expect(createAcceptedDataPayload([result]).datasets[0]).toMatchObject({
      ingestion_batch_id: "rejected-execution", normalized: [], summary: { rejected: 1, accepted: 0 },
    });
  });

  it("uses UUID and UTC time defaults only when an execution is called", async () => {
    const input = await prepare();
    const id = "00000000-0000-4000-8000-000000000001";
    const uuid = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(id);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    try {
      expect(uuid).not.toHaveBeenCalled();
      const result = ingestDatasetRun(input.dataset, input.mapping, input.options);
      expect(uuid).toHaveBeenCalledTimes(1);
      expect(result.context).toEqual({ batchId: id, ingestedAt: instant });
    } finally { uuid.mockRestore(); vi.useRealTimers(); }
  });

  it("processes A, B, then A again with fresh IDs, stable source identity and existing replacement semantics", async () => {
    const inputs = await Promise.all(expected.files.map(async fixture => {
      const file = await inspectFile(readFileSync(new URL("../../public/samples/ingestion/" + fixture.file, import.meta.url)), { name: fixture.file });
      const dataset = createDataset(file, fixture.sheet_index);
      let mapping = suggestMapping(dataset);
      if (fixture.manual_mapping) mapping = overrideMapping(mapping, dataset.columns.indexOf("Details"), "reference");
      return { dataset, mapping: approveMapping(mapping), options: { ...DEFAULT_OPTIONS,
        sourceSystem: fixture.sourceSystem, monetaryMode: fixture.monetaryMode as IngestionOptions["monetaryMode"],
        dateBasis: fixture.dateBasis as IngestionOptions["dateBasis"] } };
    }));
    const times = [0, 1, 2, 3].map(hour => "2026-10-07T0" + hour + ":00:00.000Z");
    const generated = providers(["batch-A", "batch-B", "batch-C", "batch-D"], [...times]);
    const execute = (index: number) => ingestDatasetRun(inputs[index].dataset, inputs[index].mapping, inputs[index].options, generated);
    const first = execute(0), bank = execute(1), reprocessed = execute(0), edge = execute(2);
    expect([first, bank, reprocessed, edge].map(result => result.context.batchId)).toEqual(["batch-A", "batch-B", "batch-C", "batch-D"]);
    expect(generated.idFactory).toHaveBeenCalledTimes(4);
    expect(generated.now).toHaveBeenCalledTimes(4);
    expect(reprocessed.dataset.id).toBe(first.dataset.id);
    expect(reprocessed.records.map(row => row.provenance.source_row_id)).toEqual(first.records.map(row => row.provenance.source_row_id));
    expect(reprocessed.dataset.file.fingerprint).toBe(first.dataset.file.fingerprint);
    const combined = consolidate([first, bank, reprocessed, edge]);
    expect(combined.results).toEqual([reprocessed, bank, edge]);
    expect(combined.summary).toMatchObject({ rowsReceived: 26, accepted: 23, valid: 20, warning: 3, rejected: 3 });
    const payload = createAcceptedDataPayload([first, bank, reprocessed, edge]);
    expect(payload.datasets.map(dataset => dataset.ingestion_batch_id)).toEqual(["batch-C", "batch-B", "batch-D"]);
    expect(payload.datasets.map(dataset => dataset.ingested_at)).toEqual([times[2], times[1], times[3]]);
    const accepted = payload.datasets.flatMap(dataset => dataset.normalized);
    const rejectedIds = combined.rejected.map(row => row.provenance.source_row_id);
    expect(accepted).toHaveLength(23);
    expect(accepted.filter(row => row.ingestion_status === "VALID")).toHaveLength(20);
    expect(accepted.filter(row => row.ingestion_status === "WARNING")).toHaveLength(3);
    expect(accepted.map(row => row.source_row_id)).toEqual(combined.normalized.map(row => row.source_row_id));
    expect(accepted.every(row => !rejectedIds.includes(row.source_row_id))).toBe(true);
    expect(payload).toMatchObject({ schema_version: "0.1", ruleset_version: "0.1" });
    expect(payload.datasets.every(dataset => !("supersedes_batch_id" in dataset) && !("superseded_by_batch_id" in dataset))).toBe(true);
  });

  it("does not generate IDs when existing results are inspected, consolidated, projected or exported", async () => {
    const input = await prepare();
    const id = "00000000-0000-4000-8000-000000000002";
    const uuid = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(id);
    try {
      const result = ingestDatasetRun(input.dataset, input.mapping, input.options);
      const before = JSON.stringify(result);
      const combined = consolidate([result]);
      const payload = createAcceptedDataPayload([result]);
      expect(combined.results[0]).toBe(result);
      expect(result.records[0].provenance.ingestion_batch_id).toBe(id);
      expect(payload.datasets[0].ingestion_batch_id).toBe(id);
      const exports = [evidenceJSON([result]), canonicalCSV(combined.normalized), rejectedCSV(combined.rejected)];
      expect([evidenceJSON([result]), canonicalCSV(combined.normalized), rejectedCSV(combined.rejected)]).toEqual(exports);
      expect(JSON.stringify(result)).toBe(before);
      expect(uuid).toHaveBeenCalledTimes(1);
    } finally { uuid.mockRestore(); }
  });

  it("leaves frozen inputs and all existing serializer bytes unchanged for identical context", async () => {
    const input = await prepare();
    function freeze(value: unknown) {
      if (value !== null && typeof value === "object") {
        Object.values(value).forEach(freeze); Object.freeze(value);
      }
    }
    freeze(input);
    const before = JSON.stringify(input);
    const baseline = ingestDataset(input.dataset, input.mapping, input.options, { batchId: "same-context", ingestedAt: instant });
    const result = ingestDatasetRun(input.dataset, input.mapping, input.options, providers(["same-context"]));
    expect(JSON.stringify(input)).toBe(before);
    expect(result).toEqual(baseline);
    expect([evidenceJSON([result]), canonicalCSV(result.normalized), rejectedCSV(consolidate([result]).rejected)])
      .toEqual([evidenceJSON([baseline]), canonicalCSV(baseline.normalized), rejectedCSV(consolidate([baseline]).rejected)]);
  });

  it.each(["idFactory", "now"] as const)("allows an independently injected %s with the other production default", async field => {
    const input = await prepare();
    const id = "00000000-0000-4000-8000-000000000003";
    const uuid = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(id);
    vi.useFakeTimers(); vi.setSystemTime(new Date(instant));
    try {
      const generated = field === "idFactory" ? { idFactory: vi.fn(() => "injected-id") } : { now: vi.fn(() => new Date(instant)) };
      const result = ingestDatasetRun(input.dataset, input.mapping, input.options, generated);
      expect(result.context).toEqual({ batchId: field === "idFactory" ? "injected-id" : id, ingestedAt: instant });
      expect(generated[field]).toHaveBeenCalledTimes(1);
      expect(uuid).toHaveBeenCalledTimes(field === "idFactory" ? 0 : 1);
    } finally { uuid.mockRestore(); vi.useRealTimers(); }
  });

  it("retains existing context validation and fabricates no fallback for a blank generated ID", async () => {
    const input = await prepare();
    const generated = providers([" "]);
    expect(() => ingestDatasetRun(input.dataset, input.mapping, input.options, generated)).toThrow(/batch ID/);
    expect(generated.idFactory).toHaveBeenCalledTimes(1);
    expect(generated.now).toHaveBeenCalledTimes(1);
  });

  it("propagates an unusable clock instead of inventing an execution timestamp", async () => {
    const input = await prepare();
    const generated = providers(["unused-batch"], ["invalid-date"]);
    expect(() => ingestDatasetRun(input.dataset, input.mapping, input.options, generated)).toThrow(RangeError);
    expect(generated.idFactory).toHaveBeenCalledTimes(1);
    expect(generated.now).toHaveBeenCalledTimes(1);
  });
});
