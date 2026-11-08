import type {
  CanonicalTransaction, IngestionResult, NormalizationTransformation, Provenance,
  QualitySummary, RawCell, ValidationIssue,
} from "./models";
import { consolidate } from "./pipeline";

// Consumer compatibility is deliberately independent of future producer constants.
const supported = { schema_version: "0.1", ruleset_version: "0.1" } as const;

export type AcceptedWarning = Pick<ValidationIssue,
  "rule" | "category" | "field" | "sourceColumn" | "originalValue" | "message"
> & { severity: "WARNING" };

export type AcceptedTransaction = Pick<CanonicalTransaction,
  "source_row_number" | "source_row_id" |
  "transaction_date" | "posting_date" | "canonical_date" | "canonical_date_basis" |
  "reference" | "source_transaction_id" | "account_code" | "account_id" | "entity_id" |
  "description" | "counterparty" | "debit" | "credit" | "source_amount" | "balance" |
  "entry_side" | "monetary_basis" | "currency" | "currency_basis" | "ingestion_status"
> & {
  validation_messages: AcceptedWarning[];
  transformations: NormalizationTransformation[];
};

export type AcceptedDatasetSummary = Pick<QualitySummary,
  "rowsReceived" | "accepted" | "valid" | "warning" | "rejected" | "requiredCompleteness" | "duplicateRows"
>;

type SharedProvenance = Pick<Provenance,
  "source_system" | "source_file" | "source_sheet" | "file_sha256" | "ingestion_batch_id" | "ingested_at"
>;

export type AcceptedDataset = SharedProvenance & {
  dataset_id: IngestionResult["dataset"]["id"];
  normalized: AcceptedTransaction[];
  summary: AcceptedDatasetSummary;
};

export interface AcceptedDataPayload {
  schema_version: IngestionResult["schema_version"];
  ruleset_version: IngestionResult["ruleset_version"];
  datasets: AcceptedDataset[];
}

function copyScalar(value: RawCell): RawCell {
  return value !== null && typeof value === "object" ? { kind: value.kind, value: value.value } : value;
}

function projectTransaction(row: CanonicalTransaction, shared: SharedProvenance): AcceptedTransaction {
  if (row.ingestion_status !== "VALID" && row.ingestion_status !== "WARNING") {
    throw new Error("Accepted-data invariant: normalized records must be VALID or WARNING.");
  }
  for (const field of Object.keys(shared) as (keyof SharedProvenance)[]) {
    if (row[field] !== shared[field]) throw new Error("Accepted-data provenance mismatch: " + field + ".");
  }
  const validation_messages = row.validation_messages.map((issue): AcceptedWarning => {
    if (issue.severity !== "WARNING") throw new Error("Accepted-data invariant: accepted issues must be WARNING.");
    return {
      rule: issue.rule, category: issue.category, severity: issue.severity, field: issue.field,
      sourceColumn: issue.sourceColumn, originalValue: copyScalar(issue.originalValue), message: issue.message,
    };
  });
  return {
    source_row_number: row.source_row_number, source_row_id: row.source_row_id,
    transaction_date: row.transaction_date, posting_date: row.posting_date,
    canonical_date: row.canonical_date, canonical_date_basis: row.canonical_date_basis,
    reference: row.reference, source_transaction_id: row.source_transaction_id,
    account_code: row.account_code, account_id: row.account_id, entity_id: row.entity_id,
    description: row.description, counterparty: row.counterparty,
    debit: row.debit, credit: row.credit, source_amount: row.source_amount, balance: row.balance,
    entry_side: row.entry_side, monetary_basis: row.monetary_basis,
    currency: row.currency, currency_basis: row.currency_basis, ingestion_status: row.ingestion_status,
    validation_messages,
    transformations: row.transformations.map(change => ({
      field: change.field, source_column: change.source_column, original_value: copyScalar(change.original_value),
      normalized_value: change.normalized_value, rule: change.rule,
    })),
  };
}

/**
 * Pure projection of trusted engine results, not an external JSON/security validator.
 * Preserves caller batch IDs without creating ingestion executions or their context.
 * This snapshot neither publishes data nor implements backend supersession.
 */
export function createAcceptedDataPayload(results: readonly IngestionResult[]): AcceptedDataPayload {
  // Preflight every input, including results consolidation will replace, before rows are read.
  for (const result of results) {
    for (const field of ["schema_version", "ruleset_version"] as const) {
      if (result[field] !== supported[field]) {
        throw new Error("Unsupported " + field + ": " + result[field] + ". Accepted-data adapter supports " + supported[field] + ".");
      }
    }
  }
  const combined = consolidate(results);
  return {
    schema_version: supported.schema_version, ruleset_version: supported.ruleset_version,
    datasets: combined.results.map(result => {
      const shared: SharedProvenance = {
        // The engine already uses this reviewed, trimmed label; no new convention is applied.
        source_system: result.options.sourceSystem.trim(), source_file: result.dataset.file.name,
        source_sheet: result.dataset.sheet.name, file_sha256: result.dataset.file.fingerprint,
        ingestion_batch_id: result.context.batchId, ingested_at: result.context.ingestedAt,
      };
      const summary = result.summary;
      return {
        dataset_id: result.dataset.id, ...shared,
        normalized: result.normalized.map(row => projectTransaction(row, shared)),
        summary: {
          rowsReceived: summary.rowsReceived, accepted: summary.accepted, valid: summary.valid,
          warning: summary.warning, rejected: summary.rejected,
          requiredCompleteness: summary.requiredCompleteness, duplicateRows: summary.duplicateRows,
        },
      };
    }),
  };
}
