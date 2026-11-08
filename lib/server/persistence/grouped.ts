import "server-only";
import type { IngestionResult } from "../../ingestion/models";
import type { TransactionDatabase } from "../db/postgres";
import { PersistenceError, type PersistedAttempt } from "./contracts";
import { preparePersistencePlan } from "./map";
import { createPersistenceRepository } from "./repository";

/** Internal trusted-engine boundary; deliberately not an external C1/C2 DTO. */
export interface GroupedPersistenceRequest {
  attempt_id: string;
  results: readonly IngestionResult[];
}
export interface GroupedPersistenceReceipt {
  attempt_id: string;
  datasets: (PersistedAttempt & { dataset_id: string; source_file: string; status: "ACTIVE" | "COMPLETED_EMPTY" })[];
}
export type AttemptInvestigation = {
  attempt_id: string;
  outcome: "CONFIRMED_COMMITTED" | "CONFIRMED_NOT_COMMITTED" | "UNRESOLVED";
};
function attemptId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new PersistenceError("INVALID_INPUT");
  }
  return value.toLowerCase();
}

/** Must use the same authoritative writable database for writes and investigation. */
export function createGroupedPersistenceService(database: TransactionDatabase) {
  return {
    async persistGroupedAttempt(input: GroupedPersistenceRequest): Promise<GroupedPersistenceReceipt> {
      const id = attemptId(input.attempt_id);
      if (!Array.isArray(input.results) || input.results.length === 0) throw new PersistenceError("INVALID_INPUT");
      // Validate every dataset before BEGIN, including zero-accepted results.
      const children = input.results.map(result => ({
        plan: preparePersistencePlan({ results: [result] }),
        metadata: structuredClone({ summary: result.summary, profile: result.profile,
          mapping: result.mapping, options: result.options, context: result.context,
          file: { name: result.dataset.file.name, type: result.dataset.file.type,
            fingerprint: result.dataset.file.fingerprint, sizeBytes: result.dataset.file.sizeBytes,
            delimiter: result.dataset.file.delimiter },
          sheet: { name: result.dataset.sheet.name, index: result.dataset.sheet.index },
          headerRow: result.dataset.headerRow, columns: result.dataset.columns }),
      }));
      if (new Set(children.map(child => JSON.stringify([child.plan.batch.ingestion_batch_id,
        child.plan.batch.source_file, child.plan.datasets[0].dataset_id]))).size !== children.length) {
        throw new PersistenceError("INVALID_INPUT");
      }
      try {
        return await database.transaction(async connection => {
          // Serialize this ID with investigation; hash collisions only serialize unrelated IDs.
          await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [id]);
          const inserted = await connection.query(
            "INSERT INTO public.persistence_attempts (id, dataset_count) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id",
            [id, children.length]);
          // No replay, automatic retry, or changed-payload reuse of an attempt ID.
          if (inserted.rowCount !== 1) throw new PersistenceError("IDEMPOTENCY_UNSUPPORTED");
          // Reuse the established writer on this exact connection. No nested BEGIN/COMMIT.
          const writer = createPersistenceRepository({ close: async () => {}, transaction: work => work(connection) }, true);
          const datasets: GroupedPersistenceReceipt["datasets"] = [];
          for (const child of children) {
            const receipt = await writer.persistNewAttempt(child.plan);
            const dataset_id = child.plan.datasets[0].dataset_id;
            const linked = await connection.query(
              "UPDATE public.ingestion_batches SET persistence_attempt_id=$1, dataset_id=$2, context=$3::jsonb WHERE id=$4",
              [id, dataset_id, JSON.stringify(child.metadata), receipt.batch_id]);
            if (linked.rowCount !== 1) throw new PersistenceError("PERSISTENCE_FAILED");
            datasets.push({ ...receipt, dataset_id, source_file: child.plan.batch.source_file,
              status: receipt.accepted_record_count === 0 ? "COMPLETED_EMPTY" : "ACTIVE" });
          }
          return { attempt_id: id, datasets };
        }, { isolationLevel: "READ COMMITTED" });
      } catch (error) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceError("PERSISTENCE_FAILED");
      }
    },
    async investigateAttempt(value: string): Promise<AttemptInvestigation> {
      const id = attemptId(value);
      try {
        return await database.transaction(async connection => {
          const primary = await connection.query<{ authoritative: boolean }>(
            "SELECT NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off' AS authoritative");
          if (primary.rows[0]?.authoritative !== true) return { attempt_id: id, outcome: "UNRESOLVED" };
          const locked = await connection.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked", [id]);
          if (locked.rows[0]?.locked !== true) return { attempt_id: id, outcome: "UNRESOLVED" };
          // Separate statement gets a fresh READ COMMITTED snapshot after the fence.
          const evidence = await connection.query<{ dataset_count: number; completed: number }>(
            `SELECT a.dataset_count, count(b.id) FILTER (WHERE b.status IN ('ACTIVE','COMPLETED_EMPTY','SUPERSEDED'))::integer AS completed
             FROM public.persistence_attempts a LEFT JOIN public.ingestion_batches b ON b.persistence_attempt_id=a.id
             WHERE a.id=$1 GROUP BY a.id`, [id]);
          const row = evidence.rows[0];
          // Absence alone is never enough: only the same primary + acquired writer fence
          // proves no preceding/in-flight grouped transaction committed this identifier.
          return { attempt_id: id, outcome: !row ? "CONFIRMED_NOT_COMMITTED"
            : row.completed === row.dataset_count ? "CONFIRMED_COMMITTED" : "UNRESOLVED" };
        }, { isolationLevel: "READ COMMITTED" });
      } catch {
        return { attempt_id: id, outcome: "UNRESOLVED" };
      }
    },
  };
}
