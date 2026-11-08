import type { ColumnMapping, Dataset, IngestionOptions, IngestionResult } from "./models";
import { ingestDataset } from "./pipeline";

export interface IngestionRunProviders {
  idFactory?: () => string;
  now?: () => Date;
}

/** One attempted execution gets fresh context; only a returned result can be stored. */
export function ingestDatasetRun(
  dataset: Dataset,
  mapping: readonly ColumnMapping[],
  options: IngestionOptions,
  providers: IngestionRunProviders = {},
): IngestionResult {
  const batchId = (providers.idFactory ?? (() => globalThis.crypto.randomUUID()))();
  const ingestedAt = (providers.now ?? (() => new Date()))().toISOString();
  return ingestDataset(dataset, mapping, options, { batchId, ingestedAt });
}
