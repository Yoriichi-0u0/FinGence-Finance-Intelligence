import "server-only";

// Shared explicit SQL projection for accepted transaction list/detail reads.
// Only constant identifiers appear here; request values remain SQL parameters.
const columns = ["id", "batch_id", "ingestion_batch_id", "source_row_id", "canonical_date",
  "transaction_date", "posting_date", "canonical_date_basis", "reference", "source_transaction_id",
  "description", "account_code", "monetary_basis", "debit", "credit", "source_amount", "entry_side",
  "derived_ledger_net", "balance", "currency", "currency_basis", "ingestion_status"] as const;
const dateColumns = new Set<string>(["canonical_date", "transaction_date", "posting_date"]);
const textColumns = new Set<string>(["debit", "credit", "source_amount", "derived_ledger_net", "balance"]);
// DateStyle-independent output; predicates and ordering keep native date values.
export const TRANSACTION_ROW_SELECTION = columns.map(column => `${dateColumns.has(column)
  ? `to_char(r.${column}, 'YYYY-MM-DD')`
  : `r.${column}${textColumns.has(column) ? "::text" : ""}`} AS ${column}`).join(", ");
