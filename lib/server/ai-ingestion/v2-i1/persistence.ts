import "server-only";
import { createHash } from "node:crypto";
import { detectFormat } from "../../../ai-ingestion/extract";
import { extractSemanticEvidence } from "../../../ai-ingestion/increment-02/extract";
import { verifySemanticBlueprint } from "../../../ai-ingestion/increment-02/verify";
import { policyHash } from "../../../ai-ingestion/increment-03/plan";
import type { SemanticBlueprint, SemanticEvidence, SemanticOrigin, SemanticVerification } from "../../../ai-ingestion/increment-02/contracts";
import { POLICY_VERSION } from "../../../ai-ingestion/increment-02/contracts";
import type { TransactionDatabase } from "../../db/postgres";
import { PersistenceError } from "../../persistence/contracts";

export interface VerifiedDocumentBatchV1 {
  version: "verified-document-batch-v1";
  policyHash: string;
  policyVersion: typeof POLICY_VERSION;
  attemptId: string; jobId: string; executionId: string; tenantId: string;
  publicationEligible: false;
  source: { sha256: string; filename: string; format: SemanticEvidence["format"] | null };
  evidence: SemanticEvidence | null; blueprint: SemanticBlueprint | null;
  verification: (Omit<SemanticVerification, "proposalOrigin"> & { proposalOrigin: SemanticOrigin | null }) | null;
  documentFailure: { code: "EXTRACTION_FAILED"; rowCountEstablished: false } | null;
  documentQuarantine: { reasons: string[]; evidenceIds: string[] } | null;
  origin: SemanticOrigin | null; receipt: unknown | null;
  processing: { mode: "VERIFIED_BLUEPRINT_REUSE" | "NOT_EXECUTED" | "DISPATCHED_UNKNOWN" | "LIVE_GROQ" | "LIVE_OLLAMA" | "RECORDED_TEST"; stages: { name: string; state: "PENDING" | "RUNNING" | "COMPLETED" | "BLOCKED" | "FAILED" }[]; reasonCodes?: string[]; dispatch?: { provider: "LIVE_GROQ" | "LIVE_OLLAMA"; reservationId: string } | null } | null;
}
type BatchInput = Pick<VerifiedDocumentBatchV1, "attemptId" | "jobId" | "executionId" | "tenantId" | "blueprint" | "origin" | "receipt"> & { sourceBytes: Uint8Array; evidence: SemanticEvidence; processing?: VerifiedDocumentBatchV1["processing"] };
type Identity = Pick<VerifiedDocumentBatchV1, "attemptId" | "jobId" | "executionId" | "tenantId">;
const trusted = new WeakMap<VerifiedDocumentBatchV1, VerifiedDocumentBatchV1>();
const extracted = new WeakMap<SemanticEvidence, SemanticEvidence>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checkIdentity(input: Identity) {
  if (![input.attemptId, input.jobId, input.executionId, input.tenantId].every(id => uuid.test(id))) throw new Error("INVALID_IDENTITY");
}
function seal(batch: VerifiedDocumentBatchV1) { trusted.set(batch, structuredClone(batch)); return batch; }

/** Only evidence freshly produced by the server extractor can enter this boundary. */
export async function extractTrustedEvidence(bytes: Uint8Array, filename: string): Promise<SemanticEvidence> {
  const evidence = await extractSemanticEvidence(bytes, filename);
  extracted.set(evidence, structuredClone(evidence));
  return evidence;
}

/** Trusted in-process input only. The database boundary never accepts a caller's verification claim. */
export function createExperimentalBatch(input: BatchInput): VerifiedDocumentBatchV1 {
  checkIdentity(input);
  const snapshot = extracted.get(input.evidence);
  if (!snapshot) throw new Error("UNTRUSTED_EVIDENCE");
  if (createHash("sha256").update(input.sourceBytes).digest("hex") !== snapshot.sourceId) throw new Error("SOURCE_HASH_MISMATCH");
  const { sourceBytes: _sourceBytes, evidence: _evidence, ...rest } = input;
  void _sourceBytes; void _evidence;
  const source = structuredClone(rest);
  const evidence = structuredClone(snapshot);
  const verification = { ...verifySemanticBlueprint(evidence, source.blueprint, source.origin ?? "RECORDED_TEST"), proposalOrigin: source.origin };
  if ((!verification.coverage.rowCountEstablished || verification.checks.some(check => !check.passed)) && verification.accepted.length) throw new Error("INCONSISTENT_VERIFICATION");
  const documentQuarantine = !verification.coverage.rowCountEstablished || (verification.coverage.sourceRows === 0 && verification.documentReasons.length > 0)
    ? { reasons: [...new Set([...(verification.coverage.rowCountEstablished ? [] : ["SOURCE_ROW_COUNT_UNESTABLISHED"]), ...verification.documentReasons])], evidenceIds: evidence.items.map(item => item.id) } : null;
  return seal({ version: "verified-document-batch-v1", policyHash, policyVersion: POLICY_VERSION, ...source, evidence, source: { sha256: evidence.sourceId, filename: evidence.filename, format: evidence.format }, publicationEligible: false, verification, documentFailure: null, documentQuarantine, processing: source.processing ?? null });
}
/** A failed extraction establishes no row count or invented source coordinates. */
export function createExtractionFailureBatch(input: Identity & { bytes: Uint8Array; filename: string; processing?: VerifiedDocumentBatchV1["processing"]; origin?: SemanticOrigin | null; receipt?: unknown | null }): VerifiedDocumentBatchV1 {
  checkIdentity(input);
  let format: SemanticEvidence["format"] | null = null;
  try { format = detectFormat(input.bytes, input.filename); } catch { /* Unknown is not a claimed format. */ }
  return seal({ version: "verified-document-batch-v1", policyHash, policyVersion: POLICY_VERSION, attemptId: input.attemptId, jobId: input.jobId,
    executionId: input.executionId, tenantId: input.tenantId, publicationEligible: false,
    source: { sha256: createHash("sha256").update(input.bytes).digest("hex"), filename: input.filename.split(/[\\/]/).pop()!.slice(0, 160), format },
    evidence: null, blueprint: null, verification: null, documentFailure: { code: "EXTRACTION_FAILED", rowCountEstablished: false }, documentQuarantine: null, origin: input.origin ?? null, receipt: structuredClone(input.receipt ?? null), processing: input.processing ?? null });
}

export function createV2Persistence(database: TransactionDatabase) {
  return {
    async persist(input: VerifiedDocumentBatchV1): Promise<void> {
      const batch = trusted.get(input);
      if (!batch) throw new Error("UNTRUSTED_BATCH");
      const verification = batch.verification;
      const outcomes = verification ? [
        ...verification.accepted.map(data => ({ outcome: data.status, data })),
        ...verification.rejected.map(data => ({ outcome: "REJECTED", data })),
        ...verification.unresolved.map(data => ({ outcome: "UNRESOLVED", data })),
        ...(batch.documentQuarantine ? [{ outcome: "UNRESOLVED", data: batch.documentQuarantine }] : []),
      ] : [{ outcome: "UNRESOLVED", data: batch.documentFailure }];
      await database.transaction(async connection => {
        await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [batch.attemptId]);
        const inserted = await connection.query("INSERT INTO fingence_v2_local.attempts(id,tenant_id,job_id,execution_id,source_sha256,batch,outcome_count) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT DO NOTHING RETURNING id", [batch.attemptId, batch.tenantId, batch.jobId, batch.executionId, batch.source.sha256, JSON.stringify(batch), outcomes.length]);
        if (inserted.rowCount !== 1) throw new PersistenceError("IDEMPOTENCY_UNSUPPORTED");
        for (const [ordinal, row] of outcomes.entries()) await connection.query("INSERT INTO fingence_v2_local.outcomes(attempt_id,ordinal,outcome,data) VALUES ($1,$2,$3,$4::jsonb)", [batch.attemptId, ordinal, row.outcome, JSON.stringify(row.data)]);
      }, { isolationLevel: "READ COMMITTED" });
    },
    async get(attemptId: string, tenantId: string): Promise<VerifiedDocumentBatchV1 | null> {
      if (!uuid.test(attemptId) || !uuid.test(tenantId)) throw new Error("INVALID_IDENTITY");
      return database.transaction(async connection => {
        const result = await connection.query<{ batch: VerifiedDocumentBatchV1 }>("SELECT batch FROM fingence_v2_local.attempts WHERE id=$1 AND tenant_id=$2", [attemptId, tenantId]);
        return result.rows[0]?.batch ?? null;
      });
    },
    async investigate(attemptId: string, tenantId: string): Promise<"CONFIRMED_COMMITTED" | "CONFIRMED_NOT_COMMITTED" | "UNRESOLVED"> {
      if (!uuid.test(attemptId) || !uuid.test(tenantId)) throw new Error("INVALID_IDENTITY");
      try {
        return await database.transaction(async connection => {
          const primary = await connection.query<{ authoritative: boolean }>("SELECT NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off' AS authoritative");
          if (primary.rows[0]?.authoritative !== true) return "UNRESOLVED";
          const fence = await connection.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked", [attemptId]);
          if (fence.rows[0]?.locked !== true) return "UNRESOLVED";
          const result = await connection.query<{ tenant_id: string; expected: number; actual: number }>("SELECT a.tenant_id,a.outcome_count AS expected,count(o.ordinal)::integer AS actual FROM fingence_v2_local.attempts a LEFT JOIN fingence_v2_local.outcomes o ON o.attempt_id=a.id WHERE a.id=$1 GROUP BY a.id", [attemptId]);
          if (!result.rows.length) return "CONFIRMED_NOT_COMMITTED";
          return result.rows[0].tenant_id === tenantId && result.rows[0].actual === result.rows[0].expected ? "CONFIRMED_COMMITTED" : "UNRESOLVED";
        }, { isolationLevel: "READ COMMITTED" });
      } catch { return "UNRESOLVED"; }
    },
  };
}
