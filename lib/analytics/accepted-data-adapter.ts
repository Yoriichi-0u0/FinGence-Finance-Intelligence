import type { AcceptedDataPayload, AcceptedTransaction } from "../ingestion/accepted-data";
import {
  aggregateSourceRecords, detectRobustAmountAnomalies, prepareAcceptedRecords,
  subtractDecimalStrings, SUPPORTED_ANALYTICS_RULESET_VERSION, SUPPORTED_ANALYTICS_SCHEMA_VERSION,
  type AnomalyFinding, type MonthlyAmountAggregate, type PreparedRecords,
  type SourceAnalysisRecord, type WarningPolicy,
} from "./index";

// Compatibility aliases refer to the producer's types; no competing transport schema.
export type { AcceptedDataPayload } from "../ingestion/accepted-data";
export type AcceptedRecordPayload = AcceptedTransaction;
export type AcceptedDatasetPayload = AcceptedDataPayload["datasets"][number];

/** Associated analysis context, outside C1. Never inferred from a filename or Debit/Credit label. */
export type ReviewedLedgerConventions = Readonly<Record<string, {
  convention: "DEBIT_MINUS_CREDIT";
  approvalReference: string;
}>>;
export type LedgerInterpretation =
  | { source_row_id: string; status: "AVAILABLE"; value: string; approvalReference: string }
  | { source_row_id: string; status: "UNAVAILABLE"; value: null; reason: string }
  | { source_row_id: string; status: "NOT_APPLICABLE"; value: null };

export interface AcceptedAnalyticsRun {
  schema_version: string;
  ruleset_version: string;
  prepared: PreparedRecords<SourceAnalysisRecord>;
  monthlyAggregates: MonthlyAmountAggregate[];
  anomalies: AnomalyFinding[];
  ledgerInterpretation: {
    available: number;
    unavailable: number;
    notApplicable: number;
    records: LedgerInterpretation[];
  };
}

/**
 * C1 trusted-producer adapter. Reconstruct only actual shared lineage, not a
 * fabricated CanonicalTransaction or external-JSON/security validation boundary.
 * No ledger convention is supplied by the current Data page or C1 payload.
 */
export function analyzeAcceptedDataPayload(
  payload: AcceptedDataPayload,
  warningPolicy: WarningPolicy = "include",
  reviewedConventions: ReviewedLedgerConventions = {},
): AcceptedAnalyticsRun {
  // Check the real envelope before inspecting datasets or records.
  if (payload.schema_version !== SUPPORTED_ANALYTICS_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema_version: ${payload.schema_version}. Analytics supports 0.1.`);
  }
  if (payload.ruleset_version !== SUPPORTED_ANALYTICS_RULESET_VERSION) {
    throw new Error(`Unsupported ruleset_version: ${payload.ruleset_version}. Analytics supports 0.1.`);
  }
  if (warningPolicy !== "include" && warningPolicy !== "exclude") throw new Error("Unknown WARNING policy.");
  for (const dataset of payload.datasets) {
    for (const field of ["dataset_id", "source_system", "source_file", "file_sha256", "ingestion_batch_id", "ingested_at"] as const) {
      if (typeof dataset[field] !== "string" || !dataset[field].trim()) {
        throw new Error(`Missing required provenance: ${field}.`);
      }
    }
    if (dataset.source_sheet !== null && typeof dataset.source_sheet !== "string") {
      throw new Error("Missing required provenance: source_sheet.");
    }
    const convention = reviewedConventions[dataset.dataset_id];
    if (convention && (convention.convention !== "DEBIT_MINUS_CREDIT" || !convention.approvalReference?.trim())) {
      throw new Error("Ledger interpretation requires an explicit supported convention and approval reference.");
    }
  }
  const interpretation = new Map<string, LedgerInterpretation>();
  const normalized: SourceAnalysisRecord[] = payload.datasets.flatMap(dataset => dataset.normalized.map(row => {
    if (row.ingestion_status !== "VALID" && row.ingestion_status !== "WARNING") {
      throw new Error(`Unexpected accepted-record status: ${String(row.ingestion_status)}.`);
    }
    if (!row.source_row_id || !Number.isInteger(row.source_row_number) || row.source_row_number < 1) {
      throw new Error("Missing required row provenance.");
    }
    const convention = reviewedConventions[dataset.dataset_id];
    const ledger: LedgerInterpretation = row.monetary_basis !== "debit_credit"
      ? { source_row_id: row.source_row_id, status: "NOT_APPLICABLE", value: null }
      : convention && row.debit !== null && row.credit !== null
        ? { source_row_id: row.source_row_id, status: "AVAILABLE", value: subtractDecimalStrings(row.debit, row.credit), approvalReference: convention.approvalReference }
        : { source_row_id: row.source_row_id, status: "UNAVAILABLE", value: null, reason: convention ? "Both ledger sides are required; a missing side is not zero." : "No associated reviewed ledger interpretation was supplied." };
    interpretation.set(row.source_row_id, ledger);
    return {
      ...structuredClone(row), source_system: dataset.source_system, source_file: dataset.source_file,
      source_sheet: dataset.source_sheet, file_sha256: dataset.file_sha256,
      ingestion_batch_id: dataset.ingestion_batch_id, ingested_at: dataset.ingested_at,
    };
  }));
  const prepared = prepareAcceptedRecords({ schema_version: payload.schema_version, ruleset_version: payload.ruleset_version, normalized }, warningPolicy);
  const interpretations = prepared.records.map(row => interpretation.get(row.source_row_id)!);
  return {
    schema_version: payload.schema_version, ruleset_version: payload.ruleset_version, prepared,
    monthlyAggregates: aggregateSourceRecords(prepared.records, row => interpretation.get(row.source_row_id)!.value),
    anomalies: detectRobustAmountAnomalies(prepared.records),
    ledgerInterpretation: {
      available: interpretations.filter(r => r.status === "AVAILABLE").length,
      unavailable: interpretations.filter(r => r.status === "UNAVAILABLE").length,
      notApplicable: interpretations.filter(r => r.status === "NOT_APPLICABLE").length,
      records: interpretations,
    },
  };
}
