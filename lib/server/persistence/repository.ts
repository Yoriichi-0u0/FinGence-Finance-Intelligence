import "server-only";
import type { SqlConnection, TransactionDatabase } from "../db/postgres";
import { PersistenceError, type FinancialRecordValues, type PersistencePlan, type PersistedAttempt } from "./contracts";

// Identifiers are constants, never request values. Every value is a SQL parameter.
const columns = [
  "ingestion_batch_id", "transaction_date", "posting_date", "canonical_date", "canonical_date_basis",
  "reference", "source_transaction_id", "account_code", "account_id", "entity_id", "description", "counterparty",
  "debit", "credit", "source_amount", "derived_ledger_net", "balance", "entry_side", "monetary_basis",
  "currency", "currency_basis", "transformations", "ingestion_status", "source_system", "source_file",
  "source_sheet", "source_row_number", "source_row_id", "file_sha256", "ingested_at",
] as const satisfies readonly (keyof FinancialRecordValues)[];
const insertRecordSql = `INSERT INTO public.financial_records (batch_id, ${columns.join(", ")})
  VALUES ($1, ${columns.map((_, index) => `$${index + 2}`).join(", ")}) RETURNING id`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireDatabase(condition: unknown): asserts condition {
  if (!condition) throw new PersistenceError("PERSISTENCE_FAILED");
}
async function insertedId(connection: SqlConnection, sql: string, values: unknown[]): Promise<string> {
  const result = await connection.query<{ id: string }>(sql, values);
  requireDatabase(result.rowCount === 1 && result.rows.length === 1 && uuid.test(result.rows[0].id));
  return result.rows[0].id;
}

export interface PersistenceRepository {
  persistNewAttempt(plan: PersistencePlan): Promise<PersistedAttempt>;
}
export function createPersistenceRepository(database: TransactionDatabase, allowEmpty = false): PersistenceRepository {
  return {
    async persistNewAttempt(plan) {
      // Phase 2A creates the owned plan; never expose this repository to untrusted input.
      if (!allowEmpty && !plan.datasets.some(dataset => dataset.records.length > 0)) throw new PersistenceError("EMPTY_ACCEPTED_BATCH_UNSUPPORTED");
      return database.transaction(async connection => {
        const b = plan.batch;
        const batchId = await insertedId(connection,
          `INSERT INTO public.ingestion_batches
          (ingestion_batch_id, schema_version, ruleset_version, rows_received, valid_count, warning_count, rejected_count, source_file)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [b.ingestion_batch_id, b.schema_version, b.ruleset_version, b.rows_received, b.valid_count, b.warning_count, b.rejected_count, b.source_file]);
        let issueCount = 0;
        for (const dataset of plan.datasets) for (const record of dataset.records) {
          const row = record.financial_record;
          requireDatabase(["VALID", "WARNING"].includes(row.ingestion_status) && row.ingestion_batch_id === b.ingestion_batch_id && row.source_file === b.source_file);
          const recordId = await insertedId(connection, insertRecordSql,
            [batchId, ...columns.map(key => key === "transformations" ? JSON.stringify(row[key]) : row[key])]);
          for (const issue of record.validation_issues) {
            requireDatabase(issue.severity === "WARNING");
            const inserted = await connection.query(
              `INSERT INTO public.validation_issues
              (financial_record_id, issue_ordinal, rule, category, severity, field, source_column, original_value, message, source_file)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
              [recordId, issue.issue_ordinal, issue.rule, issue.category, issue.severity, issue.field,
                issue.source_column, JSON.stringify(issue.original_value), issue.message, b.source_file]);
            requireDatabase(inserted.rowCount === 1);
            issueCount++;
          }
        }
        const counts = await connection.query<{ accepted: number; valid: number; warning: number; issues: number }>(
          `SELECT count(*)::integer AS accepted,
          count(*) FILTER (WHERE ingestion_status = 'VALID')::integer AS valid,
          count(*) FILTER (WHERE ingestion_status = 'WARNING')::integer AS warning,
          (SELECT count(*)::integer FROM public.validation_issues i JOIN public.financial_records r
            ON r.id = i.financial_record_id WHERE r.batch_id = $1) AS issues
          FROM public.financial_records WHERE batch_id = $1`, [batchId]);
        const count = counts.rows[0];
        requireDatabase(count && count.accepted === b.valid_count + b.warning_count && count.valid === b.valid_count
          && count.warning === b.warning_count && count.issues === issueCount
          && b.rows_received === b.valid_count + b.warning_count + b.rejected_count);
        // ACTIVE certifies this write's accepted rows/issues/counts only, not accounting accuracy.
        const complete = await connection.query(
          count.accepted === 0
            ? "UPDATE public.ingestion_batches SET status = 'COMPLETED_EMPTY', completed_at = clock_timestamp() WHERE id = $1 AND status = 'PROCESSING'"
            : "UPDATE public.ingestion_batches SET status = 'ACTIVE', completed_at = clock_timestamp() WHERE id = $1 AND status = 'PROCESSING'", [batchId]);
        requireDatabase(complete.rowCount === 1);
        return {
          outcome: "PERSISTED_NEW_ATTEMPT", batch_id: batchId, ingestion_batch_id: b.ingestion_batch_id,
          accepted_record_count: count.accepted, warning_count: count.warning,
        };
      });
    },
  };
}
