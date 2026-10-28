import "server-only";
import { randomUUID } from "node:crypto";
import { rebindSemanticTemplate, type SemanticTemplate } from "../../../ai-ingestion/increment-02/reuse";
import { liveEnabled03, processLiveDocument03, providerStatus03, registeredSynthetic03 } from "../increment-03/service";
import type { TransactionDatabase } from "../../db/postgres";
import { PersistenceError } from "../../persistence/contracts";
import { createExperimentalBatch, createExtractionFailureBatch, createV2Persistence, extractTrustedEvidence, type VerifiedDocumentBatchV1 } from "./persistence";

export interface SyntheticJobResult {
  mode: "VERIFIED_BLUEPRINT_REUSE" | "NOT_EXECUTED";
  origin: "RECORDED_TEST" | "LIVE_GROQ" | "LIVE_OLLAMA" | "LIVE_OPENAI" | null;
  stages: { name: string; state: "COMPLETED" | "BLOCKED" | "FAILED" }[];
  batch: VerifiedDocumentBatchV1;
}
export class JobPersistenceError extends Error {
  constructor(readonly attemptId: string, readonly code: "COMMIT_OUTCOME_UNKNOWN" | "ROLLBACK_UNCONFIRMED" | "PERSISTENCE_FAILED" | "IDEMPOTENCY_UNSUPPORTED") { super(code); }
}
/** Local registered synthetic files only; no model dispatch or recorded substitution. */
export async function runSyntheticJob(input: { bytes: Uint8Array; filename: string; tenantId: string;
  template: SemanticTemplate | null; database: TransactionDatabase }): Promise<SyntheticJobResult> {
  if (input.bytes.length > 10 * 1024 * 1024 || !(await registeredSynthetic03(input.bytes))) throw new Error("REGISTERED_SYNTHETIC_REQUIRED");
  const identity = { jobId: randomUUID(), executionId: randomUUID(), attemptId: randomUUID(), tenantId: input.tenantId };
  let evidence;
  try { evidence = await extractTrustedEvidence(input.bytes, input.filename); } catch { evidence = null; }
  let reuse: ReturnType<typeof rebindSemanticTemplate> | null = null;
  const reasonCodes: string[] = [];
  if (evidence && input.template) {
    try { reuse = rebindSemanticTemplate(input.template, evidence); }
    catch { reasonCodes.push("BLUEPRINT_REBIND_FAILED"); }
  } else if (evidence) reasonCodes.push("NO_BLUEPRINT_AVAILABLE");
  if (reuse?.decision === "REINTERPRETATION_REQUIRED") reasonCodes.push(...reuse.reasons);
  const reusable = reuse && reuse.decision === "REUSED" && reuse.blueprint !== null ? reuse : null;
  const usable = reusable !== null;
  const origin = reusable?.origin ?? null;
  const processing: NonNullable<VerifiedDocumentBatchV1["processing"]> = {
    mode: usable ? "VERIFIED_BLUEPRINT_REUSE" : "NOT_EXECUTED",
    stages: [{ name: "extraction", state: evidence ? "COMPLETED" : "FAILED" },
      { name: "interpretation", state: usable ? "COMPLETED" : "BLOCKED" },
      { name: "verification", state: evidence ? "COMPLETED" : "BLOCKED" },
      { name: "persistence", state: "COMPLETED" }], reasonCodes,
  };
  const batch = evidence ? createExperimentalBatch({ ...identity, sourceBytes: input.bytes, evidence,
    blueprint: reusable?.blueprint ?? null, origin, receipt: null, processing })
    : createExtractionFailureBatch({ ...identity, bytes: input.bytes, filename: input.filename, processing });
  try { await createV2Persistence(input.database).persist(batch); }
  catch (error) {
    const code = error instanceof PersistenceError && (error.code === "COMMIT_OUTCOME_UNKNOWN" || error.code === "ROLLBACK_UNCONFIRMED" || error.code === "PERSISTENCE_FAILED" || error.code === "IDEMPOTENCY_UNSUPPORTED") ? error.code : "COMMIT_OUTCOME_UNKNOWN";
    throw new JobPersistenceError(identity.attemptId, code);
  }
  return { mode: usable ? "VERIFIED_BLUEPRINT_REUSE" : "NOT_EXECUTED", stages: processing.stages as SyntheticJobResult["stages"], origin, batch };
}

/** Internal future path only: no HTTP entrypoint and an additional explicit dispatch gate. */
export async function runAuthorizedModelJob(input: { bytes: Uint8Array; filename: string; tenantId: string; database: TransactionDatabase }) {
  if (!liveEnabled03() || process.env.FINGENCE_V2_I1_LIVE_DISPATCH_AUTHORIZED !== "1" || !providerStatus03().ready) throw new Error("LIVE_DISPATCH_NOT_AUTHORIZED");
  const run = await processLiveDocument03(input.bytes, input.filename);
  const identity = { jobId: randomUUID(), executionId: run.runId, attemptId: randomUUID(), tenantId: input.tenantId };
  const processing: NonNullable<VerifiedDocumentBatchV1["processing"]> = { mode: run.mode, stages: run.stages, dispatch: run.dispatch };
  const origin = run.receipt?.mode ?? null;
  // Re-extract at the persistence trust boundary; a mismatching proposal is quarantined.
  let evidence = null;
  if (run.evidence) { try { evidence = await extractTrustedEvidence(input.bytes, input.filename); } catch { /* Retain source and receipt as a failed extraction. */ } }
  const batch = evidence ? createExperimentalBatch({ ...identity, sourceBytes: input.bytes, evidence, blueprint: run.blueprint, origin, receipt: run.receipt, processing })
    : createExtractionFailureBatch({ ...identity, bytes: input.bytes, filename: input.filename, processing, origin, receipt: run.receipt });
  try { await createV2Persistence(input.database).persist(batch); }
  catch (error) {
    const code = error instanceof PersistenceError && (error.code === "COMMIT_OUTCOME_UNKNOWN" || error.code === "ROLLBACK_UNCONFIRMED" || error.code === "PERSISTENCE_FAILED" || error.code === "IDEMPOTENCY_UNSUPPORTED") ? error.code : "COMMIT_OUTCOME_UNKNOWN";
    throw new JobPersistenceError(identity.attemptId, code);
  }
  return { mode: run.mode, origin, stages: run.stages, batch };
}
