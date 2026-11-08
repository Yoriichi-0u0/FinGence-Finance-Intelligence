import { consolidate, type IngestionResult } from "../ingestion";
import {
  aggregateCanonicalRecords,
  detectRobustAmountAnomalies,
  prepareAcceptedRecords,
  SUPPORTED_ANALYTICS_RULESET_VERSION,
  SUPPORTED_ANALYTICS_SCHEMA_VERSION,
  type AnalyticsRun,
  type WarningPolicy,
} from "./index";

/** Convenience integration for trusted results produced by this repository's ingestion engine. */
export function analyzeIngestionResults(
  results: readonly IngestionResult[],
  warningPolicy: WarningPolicy = "include",
): AnalyticsRun {
  // Preflight every dataset before consolidation or downstream work.
  for (const result of results) {
    if (result.schema_version !== SUPPORTED_ANALYTICS_SCHEMA_VERSION) {
      throw new Error(`Unsupported schema_version: ${result.schema_version}. Analytics supports ${SUPPORTED_ANALYTICS_SCHEMA_VERSION}.`);
    }
    if (result.ruleset_version !== SUPPORTED_ANALYTICS_RULESET_VERSION) {
      throw new Error(`Unsupported ruleset_version: ${result.ruleset_version}. Analytics supports ${SUPPORTED_ANALYTICS_RULESET_VERSION}.`);
    }
  }
  const batch = consolidate([...results]);
  const prepared = prepareAcceptedRecords({
    schema_version: batch.schema_version,
    ruleset_version: batch.ruleset_version,
    normalized: batch.normalized,
  }, warningPolicy);
  return {
    schema_version: batch.schema_version,
    ruleset_version: batch.ruleset_version,
    prepared,
    monthlyAggregates: aggregateCanonicalRecords(prepared.records),
    anomalies: detectRobustAmountAnomalies(prepared.records),
  };
}
