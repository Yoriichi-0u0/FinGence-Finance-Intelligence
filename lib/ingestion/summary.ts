import type { IngestionResult, QualitySummary } from "./models";
import { isMissing } from "./normalizer";

export function summarize(results: readonly IngestionResult[]): QualitySummary {
  const records = results.flatMap(result => result.records);
  const rowsReceived = records.length;
  const valid = records.filter(row => row.status === "VALID").length;
  const warning = records.filter(row => row.status === "WARNING").length;
  const rejected = records.filter(row => row.status === "REJECTED").length;
  const percent = (numerator: number, denominator: number) => denominator ? 100 * numerator / denominator : null;
  return {
    filesProcessed: new Set(results.map(r => r.dataset.file.fingerprint)).size,
    datasetsProcessed: results.length, rowsReceived, valid, warning, rejected, accepted: valid + warning,
    successRate: percent(valid + warning, rowsReceived),
    cleanValidityRate: percent(valid, rowsReceived),
    requiredCompleteness: percent(records.reduce((sum, row) => sum + row.populatedRequiredSlots, 0), rowsReceived * 2),
    duplicateRows: results.reduce((sum, r) => sum + r.profile.duplicateRowCount, 0),
    missingDates: records.filter(row => row.missingDate).length,
    missingMoney: records.filter(row => row.missingMoney).length,
    missingReferences: records.filter(row => isMissing(row.staging.reference)).length,
    unmappedColumns: results.reduce((sum, r) => sum + r.mapping.filter(m => m.target === null).length, 0),
  };
}
