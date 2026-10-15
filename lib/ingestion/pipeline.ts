import { IngestionError, RULE_VERSION, SCHEMA_VERSION, type CanonicalTransaction, type ColumnMapping, type Dataset, type IngestionContext, type IngestionOptions, type IngestionResult, type ProcessedRow, type Provenance, type StagingValues } from "./models";
import { mappingErrors } from "./mapper";
import { normalizeRecord } from "./normalize-record";
import { isMissing, normalizeIngestionTimestamp } from "./normalizer";
import { profileDataset } from "./profiler";
import { summarize } from "./summary";
import { validateRecord } from "./validator";

export function ingestDataset(dataset: Dataset, mapping: readonly ColumnMapping[], options: IngestionOptions, context: IngestionContext): IngestionResult {
  const errors = mappingErrors(dataset, mapping, options);
  if (errors.length) throw new IngestionError("MAPPING_REQUIRED", errors.join(" "));
  let ingestedAt: string;
  try {
    if (!context.batchId.trim()) throw new Error("Missing batch ID.");
    ingestedAt = normalizeIngestionTimestamp(context.ingestedAt);
  } catch {
    throw new IngestionError("CONTEXT_REQUIRED", "A batch ID and valid ISO ingestion timestamp with an explicit timezone are required.");
  }
  const profile = profileDataset(dataset);
  const duplicateRows = new Set(profile.duplicateRowNumbers);
  const normalized: CanonicalTransaction[] = [];
  const records: ProcessedRow[] = dataset.rows.map(raw => {
    const staging: StagingValues = {};
    for (const item of mapping) if (item.target) staging[item.target] = raw.cells[item.sourceIndex] ?? null;
    const provenance: Provenance = {
      source_system: options.sourceSystem.trim(), source_file: dataset.file.name, source_sheet: dataset.sheet.name,
      source_row_number: raw.rowNumber,
      source_row_id: dataset.file.fingerprint + ":" + dataset.sheet.index + ":" + raw.rowNumber,
      file_sha256: dataset.file.fingerprint, ingestion_batch_id: context.batchId, ingested_at: ingestedAt,
    };
    const { candidate, issues: technical } = normalizeRecord(staging, mapping, options, provenance);
    const issues = [...raw.issues, ...technical, ...validateRecord(candidate, staging, mapping, options, duplicateRows.has(raw.rowNumber))];
    const status = issues.some(i => i.severity === "REJECTED") ? "REJECTED" : issues.length ? "WARNING" : "VALID";
    if (status !== "REJECTED") {
      const usableMoney = options.monetaryMode === "debit_credit" ? candidate.debit !== null && candidate.credit !== null : candidate.source_amount !== null;
      if (candidate.canonical_date === null || !usableMoney) {
        throw new IngestionError("CANONICAL_INVARIANT", "Normalization could not safely produce required canonical fields.");
      }
      normalized.push({
        ...candidate, canonical_date: candidate.canonical_date,
        ingestion_status: status, validation_messages: issues,
      });
    }
    const missingDate = isMissing(staging[options.dateBasis]);
    const missingMoney = options.monetaryMode === "debit_credit"
      ? options.blankSideAsZero ? isMissing(staging.debit) && isMissing(staging.credit) : isMissing(staging.debit) || isMissing(staging.credit)
      : isMissing(staging.source_amount) || (options.monetaryMode === "amount_direction" && isMissing(staging.entry_side));
    return { provenance, raw, staging, candidate, issues, status, missingDate, missingMoney,
      populatedRequiredSlots: Number(!missingDate) + Number(!missingMoney) };
  });
  const result: IngestionResult = {
    schema_version: SCHEMA_VERSION, ruleset_version: RULE_VERSION, dataset, profile,
    mapping: mapping.map(item => ({ ...item })),
    options: { ...options }, context: { ...context, ingestedAt },
    records, normalized, summary: summarize([]),
  };
  result.summary = summarize([result]);
  return result;
}
/** Replace same-file/same-sheet results; never merge bank/ledger economic events. */
export function consolidate(results: readonly IngestionResult[]) {
  const unique = [...new Map(results.map(result => [result.dataset.id, result])).values()];
  return {
    schema_version: SCHEMA_VERSION, ruleset_version: RULE_VERSION, results: unique,
    normalized: unique.flatMap(result => result.normalized),
    rejected: unique.flatMap(result => result.records.filter(row => row.status === "REJECTED")),
    summary: summarize(unique),
  };
}
