import {
  createAcceptedDataPayload,
  type AcceptedTransaction, type IngestionResult, type Provenance,
} from "../../lib/ingestion/index";

/**
 * Usage recipe for trusted engine results; no React, file reparsing, network or storage.
 * Only `payload` is the C1 transport. `lineage` is an illustrative inspection view.
 * The adapter preflights ALL input versions before it reads accepted records.
 */
export function prepareAcceptedDataExample(results: readonly IngestionResult[]) {
  const payload = createAcceptedDataPayload(results);
  const lineage: (Provenance & Pick<AcceptedTransaction, "ingestion_status" | "validation_messages">)[] =
    payload.datasets.flatMap(dataset => dataset.normalized.map(row => ({
      source_system: dataset.source_system, source_file: dataset.source_file, source_sheet: dataset.source_sheet,
      file_sha256: dataset.file_sha256, ingestion_batch_id: dataset.ingestion_batch_id, ingested_at: dataset.ingested_at,
      source_row_number: row.source_row_number, source_row_id: row.source_row_id,
      ingestion_status: row.ingestion_status, validation_messages: row.validation_messages,
    })));
  // Decimal and identifier strings remain unchanged inside payload.datasets[].normalized.
  // Rejected rows never enter this loop; only their counts appear in dataset summaries.
  // Source IDs remain lineage. Backend IDs/supersession and analysis eligibility are downstream.
  // C1 preserves caller-provided ingestion context and generates no execution IDs.
  // C2's ingestDatasetRun() creates fresh context for each attempted execution.
  return { payload, lineage };
}
