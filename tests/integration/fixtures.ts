import { readFileSync } from "node:fs";
import {
  approveMapping, createDataset, DEFAULT_OPTIONS, ingestDatasetRun, inspectFile,
  overrideMapping, suggestMapping, type IngestionOptions, type IngestionResult,
} from "../../lib/ingestion";
import expected from "../../public/samples/ingestion/expected.json";

/** Exact published fixtures; no newline conversion or alternative fixture copies. */
export async function consultationResults(): Promise<IngestionResult[]> {
  const results: IngestionResult[] = [];
  for (const [index, fixture] of expected.files.entries()) {
    const file = await inspectFile(readFileSync(new URL("../../public/samples/ingestion/" + fixture.file, import.meta.url)), { name: fixture.file });
    const dataset = createDataset(file, fixture.sheet_index);
    let mapping = suggestMapping(dataset);
    if (fixture.manual_mapping) mapping = overrideMapping(mapping, dataset.columns.indexOf("Details"), "reference");
    results.push(ingestDatasetRun(dataset, approveMapping(mapping), {
      ...DEFAULT_OPTIONS, sourceSystem: fixture.sourceSystem,
      monetaryMode: fixture.monetaryMode as IngestionOptions["monetaryMode"],
      dateBasis: fixture.dateBasis as IngestionOptions["dateBasis"],
    }, {
      idFactory: () => `00000000-0000-4000-8000-00000000000${index + 1}`,
      now: () => new Date("2026-10-15T12:00:00.000Z"),
    }));
  }
  return results;
}
