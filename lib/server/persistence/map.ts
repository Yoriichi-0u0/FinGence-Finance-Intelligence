import type { RawCell } from "../../ingestion/models";
import type { FinancialRecordValues, PersistencePlan, RecordPlan, AcceptedTransaction } from "./contracts";
import { validatePersistenceRequest } from "./validate";

function copyCell(value: RawCell): RawCell {
  return value !== null && typeof value === "object" ? { kind: value.kind, value: value.value } : value;
}
function mapRecord(row: AcceptedTransaction): RecordPlan {
  // Explicit allowlist: source_row_id remains lineage, with no generated UUID/FK.
  const financial_record: FinancialRecordValues = {
    ingestion_batch_id: row.ingestion_batch_id,
    transaction_date: row.transaction_date, posting_date: row.posting_date,
    canonical_date: row.canonical_date, canonical_date_basis: row.canonical_date_basis,
    reference: row.reference, source_transaction_id: row.source_transaction_id,
    account_code: row.account_code, account_id: row.account_id, entity_id: row.entity_id,
    description: row.description, counterparty: row.counterparty,
    debit: row.debit, credit: row.credit, source_amount: row.source_amount,
    derived_ledger_net: row.derived_ledger_net, balance: row.balance,
    entry_side: row.entry_side, monetary_basis: row.monetary_basis,
    currency: row.currency, currency_basis: row.currency_basis,
    transformations: row.transformations.map(item => ({
      field: item.field, source_column: item.source_column, original_value: copyCell(item.original_value),
      normalized_value: item.normalized_value, rule: item.rule,
    })),
    ingestion_status: row.ingestion_status,
    source_system: row.source_system, source_file: row.source_file, source_sheet: row.source_sheet,
    source_row_number: row.source_row_number, source_row_id: row.source_row_id,
    file_sha256: row.file_sha256, ingested_at: row.ingested_at,
  };
  return {
    financial_record,
    validation_issues: row.validation_messages.map((item, issue_ordinal) => ({
      issue_ordinal, rule: item.rule, category: item.category, severity: item.severity,
      field: item.field, source_column: item.sourceColumn,
      original_value: copyCell(item.originalValue), message: item.message,
    })),
  };
}

/** Returns an owned, validated plan, never a database write or persistence receipt. */
export function preparePersistencePlan(input: unknown): PersistencePlan {
  const validated = validatePersistenceRequest(input);
  const batch: PersistencePlan["batch"] = {
    source_file: validated.source_file,
    schema_version: validated.schema_version, ruleset_version: validated.ruleset_version,
    ingestion_batch_id: validated.ingestion_batch_id,
    rows_received: 0, valid_count: 0, warning_count: 0, rejected_count: 0,
  };
  for (const dataset of validated.datasets) {
    batch.rows_received += dataset.counts.rows_received;
    batch.valid_count += dataset.counts.valid_count;
    batch.warning_count += dataset.counts.warning_count;
    batch.rejected_count += dataset.counts.rejected_count;
  }
  return {
    kind: "PREPARED", batch,
    datasets: validated.datasets.map(dataset => ({ dataset_id: dataset.dataset_id, records: dataset.records.map(mapRecord) })),
  };
}
