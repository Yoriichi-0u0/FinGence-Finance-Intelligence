import {
  consolidate,
  type CanonicalTransaction,
  type IngestionResult,
  type Provenance,
} from "../../lib/ingestion/index";

// Deliberately pinned consumer compatibility, not automatic adoption of future rules.
const supported = { schema_version: "0.1", ruleset_version: "0.1" } as const;

/**
 * Recipe for trusted, engine-produced results; not a production API or JSON validator.
 * The visitor is synchronous and must treat records as read-only. Version
 * mismatches fail before any visit; callback failures do not roll back visits.
 */
export function consumeAcceptedTransactions(
  results: readonly IngestionResult[],
  visit: (transaction: Readonly<CanonicalTransaction>) => void,
) {
  // Validate ALL supplied results before consolidation can replace any of them,
  // and before a callback can perform downstream work.
  for (const result of results) {
    for (const field of ["schema_version", "ruleset_version"] as const) {
      if (result[field] !== supported[field]) {
        throw new Error("Unsupported " + field + ": " + result[field] + ". This example supports " + supported[field] + ".");
      }
    }
  }

  const batch = consolidate(results);
  const lineage: Provenance[] = batch.normalized.map(row => ({
    source_system: row.source_system,
    source_file: row.source_file,
    source_sheet: row.source_sheet,
    source_row_number: row.source_row_number,
    source_row_id: row.source_row_id,
    file_sha256: row.file_sha256,
    ingestion_batch_id: row.ingestion_batch_id,
    ingested_at: row.ingested_at,
  }));

  // normalized includes VALID and WARNING, with warnings/provenance intact.
  // Do not iterate result.records: it also contains quarantine and partial candidates.
  for (const transaction of batch.normalized) visit(transaction);

  return {
    schema_version: batch.schema_version,
    ruleset_version: batch.ruleset_version,
    counts: {
      received: batch.summary.rowsReceived,
      forwarded: batch.normalized.length,
      valid: batch.summary.valid,
      warning: batch.summary.warning,
      rejectedNotForwarded: batch.summary.rejected,
    },
    lineage,
  };
}
