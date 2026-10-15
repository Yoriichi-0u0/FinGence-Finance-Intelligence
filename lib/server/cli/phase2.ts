import "server-only";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { approveMapping, createDataset, DEFAULT_OPTIONS, ingestDataset, inspectFile, suggestMapping } from "../../ingestion/index";
import type { TransactionDatabase } from "../db/postgres";
import { PersistenceError } from "../persistence/contracts";
import { preparePersistencePlan } from "../persistence/map";
import { createPersistenceRepository } from "../persistence/repository";
import { createPersistenceService } from "../persistence/service";
import { validateSourceFile } from "../persistence/source-file";

/** Extract a POSIX or Windows basename once; validation never rewrites it. */
export function sourceFileFromPath(path: string): string {
  return validateSourceFile(basename(path.replace(/\\/g, "/")));
}

/** Internal new-attempt tool, never an application authorization bypass. */
export async function runPhase2File(path: string, initializeDatabase: () => TransactionDatabase, print: (line: string) => void) {
  print(`Reading financial file: ${path}`);
  const source_file = sourceFileFromPath(path);
  const file = await inspectFile(await readFile(path), { name: source_file });
  if (file.name !== source_file) throw new PersistenceError("INVALID_INPUT");
  const context = { batchId: randomUUID(), ingestedAt: new Date().toISOString() };
  const results = file.sheets.map(sheet => {
    const dataset = createDataset(file, sheet.index);
    return ingestDataset(dataset, approveMapping(suggestMapping(dataset)), { ...DEFAULT_OPTIONS }, context);
  });
  print("\nCHIA INGESTION RESULT");
  for (const [label, field] of [["Rows received", "rowsReceived"], ["VALID", "valid"], ["WARNING", "warning"], ["REJECTED", "rejected"]] as const) print(`${label}: ${results.reduce((sum, result) => sum + result.summary[field], 0)}`);
  const plan = preparePersistencePlan({ results, source_file });
  print("\nPHASE 2\nValidation: PASSED\nMapping: PASSED");
  const database = initializeDatabase();
  const receipt = await createPersistenceService(createPersistenceRepository(database)).persistNewAttempt({ intent: "NEW_ATTEMPT_NO_RETRY", results, source_file });
  const observed = await database.transaction(async connection => (await connection.query<{ status: string; accepted: number; issues: number }>(
    `SELECT b.status,
    (SELECT count(*)::int FROM public.financial_records r WHERE r.batch_id=b.id) AS accepted,
    (SELECT count(*)::int FROM public.validation_issues i JOIN public.financial_records r ON r.id=i.financial_record_id WHERE r.batch_id=b.id) AS issues
    FROM public.ingestion_batches b WHERE b.id=$1`, [receipt.batch_id])).rows);
  const expectedIssues = plan.datasets.reduce((sum, dataset) => sum + dataset.records.reduce((n, record) => n + record.validation_issues.length, 0), 0);
  if (observed.length !== 1 || observed[0].status !== "ACTIVE" || observed[0].accepted !== receipt.accepted_record_count || observed[0].issues !== expectedIssues) throw new PersistenceError("PERSISTENCE_FAILED");
  print(`\nDATABASE\nBatch ID: ${receipt.batch_id}\nAccepted records inserted: ${observed[0].accepted}\nWarning issues inserted: ${observed[0].issues}\nTransaction: COMMITTED\nBatch status: ${observed[0].status}`);
  print("\nSUCCESS");
  return receipt;
}
