import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { TransactionDatabase } from "../../lib/server/db/postgres";
import { proposedPlan } from "../ai-ingestion-03/helpers";
import { materializePlan } from "../../lib/ai-ingestion/increment-03/plan";
import { bindRecordedProposal } from "../../lib/ai-ingestion/increment-02/recorded";
import { createExperimentalBatch, createV2Persistence, extractTrustedEvidence } from "../../lib/server/ai-ingestion/v2-i1/persistence";

let db: PGlite;
let database: TransactionDatabase;
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await db.exec(readFileSync("supabase/sql/v2-verified-document-local.sql", "utf8"));
  database = { close: async () => {}, transaction: async work => db.transaction(async tx => work({
    query: async (sql, values) => {
      const result = await tx.query(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length } as never;
    },
  })) };
}, 30000);
afterAll(async () => { await db.close(); });
const identity = () => ({ attemptId: randomUUID(), jobId: randomUUID(), executionId: randomUUID(), tenantId: randomUUID() });
async function verified() {
  const sourceBytes = readFileSync("public/samples/ai-ingestion-increment-02/precision.csv");
  const evidence = await extractTrustedEvidence(sourceBytes, "synthetic.csv");
  return { evidence, blueprint: materializePlan(evidence, proposedPlan(evidence)), sourceBytes };
}
describe("V2 experimental verification and persistence", () => {
  it("re-verifies and atomically stores exact records and source coordinates, with tenant-scoped retrieval", async () => {
    const source = await verified(), ids = identity();
    const batch = createExperimentalBatch({ ...ids, ...source, origin: "RECORDED_TEST", receipt: null });
    expect(batch.publicationEligible).toBe(false);
    expect(batch.verification!.accepted.length).toBeGreaterThan(0);
    const service = createV2Persistence(database);
    await service.persist(batch);
    const saved = await service.get(ids.attemptId, ids.tenantId);
    expect(saved?.verification!.accepted).toEqual(batch.verification!.accepted);
    expect(saved?.evidence!.items).toEqual(batch.evidence!.items);
    expect(saved?.evidence!.items.some(item => item.address !== null)).toBe(true);
    expect(await service.get(ids.attemptId, randomUUID())).toBeNull();
  });
  it("preserves unresolved rather than publishing on a forged financial binding", async () => {
    const source = await verified();
    source.blueprint.records[0].cells[0].observedText = "fabricated";
    const batch = createExperimentalBatch({ ...identity(), ...source, origin: "RECORDED_TEST", receipt: null });
    expect(batch.verification!.accepted).toHaveLength(0);
    expect(batch.verification!.unresolved.length).toBeGreaterThan(0);
    expect(batch.verification!.checks.some(c => c.code === "SOURCE_BINDING" && !c.passed)).toBe(true);
  });
  it("rejects duplicate attempts and preserves the original transaction", async () => {
    const source = await verified(), ids = identity();
    const batch = createExperimentalBatch({ ...ids, ...source, origin: "RECORDED_TEST", receipt: null });
    const service = createV2Persistence(database);
    await service.persist(batch);
    await expect(service.persist(batch)).rejects.toMatchObject({ code: "IDEMPOTENCY_UNSUPPORTED" });
    expect((await service.get(ids.attemptId, ids.tenantId))?.attemptId).toBe(ids.attemptId);
  });
});

describe("transaction failure and trust boundary", () => {
  it("does not accept a deserialized or altered verification claim", async () => {
    const source = await verified(), ids = identity();
    const batch = createExperimentalBatch({ ...ids, ...source, origin: "RECORDED_TEST", receipt: null });
    await expect(createV2Persistence(database).persist(structuredClone(batch))).rejects.toThrow("UNTRUSTED_BATCH");
    batch.verification!.accepted[0].financial.source_amount = "999999";
    await createV2Persistence(database).persist(batch);
    const stored = await createV2Persistence(database).get(ids.attemptId, ids.tenantId);
    expect(stored?.verification!.accepted[0].financial.source_amount).not.toBe("999999");
  });
  it("rolls back the attempt when an outcome insert fails", async () => {
    const source = await verified(), ids = identity();
    const batch = createExperimentalBatch({ ...ids, ...source, origin: "RECORDED_TEST", receipt: null });
    const failing: TransactionDatabase = { close: async () => {}, transaction: work => database.transaction(connection => work({
      query: (sql, values) => sql.includes("INSERT INTO fingence_v2_local.outcomes") ? Promise.reject(new Error("synthetic failure")) : connection.query(sql, values),
    })) };
    await expect(createV2Persistence(failing).persist(batch)).rejects.toThrow();
    expect(await createV2Persistence(database).get(ids.attemptId, ids.tenantId)).toBeNull();
  });
  it("never retries an uncertain commit and can inspect the committed attempt", async () => {
    const source = await verified(), ids = identity();
    const batch = createExperimentalBatch({ ...ids, ...source, origin: "RECORDED_TEST", receipt: null });
    let transactions = 0;
    const uncertain: TransactionDatabase = { close: async () => {}, async transaction(work) {
      transactions++;
      await database.transaction(work);
      throw new Error("COMMIT_OUTCOME_UNKNOWN");
    } };
    await expect(createV2Persistence(uncertain).persist(batch)).rejects.toThrow("COMMIT_OUTCOME_UNKNOWN");
    expect(transactions).toBe(1);
    expect(await createV2Persistence(database).investigate(ids.attemptId, ids.tenantId)).toBe("CONFIRMED_COMMITTED");
  });
});
it("denies direct schema access to the unauthenticated database role", async () => {
  await db.exec("SET ROLE anon");
  try {
    await expect(db.query("SELECT * FROM fingence_v2_local.attempts")).rejects.toThrow();
    await expect(db.query("SELECT * FROM fingence_v2_local.outcomes")).rejects.toThrow();
  } finally { await db.exec("RESET ROLE"); }
});
it("refuses a database batch that omits its required experimental marker", async () => {
  const ids = identity();
  await expect(db.query("INSERT INTO fingence_v2_local.attempts(id,tenant_id,job_id,execution_id,source_sha256,outcome_count,batch) VALUES ($1,$2,$3,$4,$5,0,$6::jsonb)",
    [ids.attemptId, ids.tenantId, ids.jobId, ids.executionId, "a".repeat(64), "{}"]))
    .rejects.toMatchObject({ code: "23514" });
});
it("rejects evidence whose source hash does not match the uploaded bytes", async () => {
  const source = await verified();
  expect(() => createExperimentalBatch({ ...identity(), ...source, sourceBytes: Buffer.from("different document"), origin: "RECORDED_TEST", receipt: null })).toThrow("SOURCE_HASH_MISMATCH");
});
it("rejects caller-fabricated evidence even if it claims the correct source hash", async () => {
  const source = await verified();
  const fabricated = structuredClone(source.evidence);
  expect(() => createExperimentalBatch({ ...identity(), ...source, evidence: fabricated, origin: "RECORDED_TEST", receipt: null })).toThrow("UNTRUSTED_EVIDENCE");
});
it("uses the extractor snapshot if a caller later changes source values", async () => {
  const source = await verified();
  const target = source.evidence.items.find(item => !item.header && item.text === "9007199254740993.01");
  if (!target) throw new Error("Synthetic control missing");
  target.text = "1"; target.value = "1";
  const batch = createExperimentalBatch({ ...identity(), ...source, origin: "RECORDED_TEST", receipt: null });
  expect(batch.evidence?.items.find(item => item.id === target.id)?.text).toBe("9007199254740993.01");
});
it("retains document-level quarantine when source row coverage is unknown", async () => {
  const sourceBytes = Buffer.from("Document,Note\nUnclassified,Synthetic\n");
  const evidence = await extractTrustedEvidence(sourceBytes, "unknown.csv");
  const ids = identity();
  const batch = createExperimentalBatch({ ...ids, evidence, blueprint: null, sourceBytes, origin: null, receipt: null });
  expect(batch.verification?.coverage.rowCountEstablished).toBe(false);
  expect(batch.verification?.accepted).toHaveLength(0);
  await createV2Persistence(database).persist(batch);
  const outcome = await db.query<{ outcome: string }>("SELECT outcome FROM fingence_v2_local.outcomes WHERE attempt_id=$1", [ids.attemptId]);
  const document = await db.query<{ document_quarantine: { kind: string; reasons: string[] } }>("SELECT document_quarantine FROM fingence_v2_local.attempts WHERE id=$1", [ids.attemptId]);
  expect(batch.verification!.unresolved.length).toBeGreaterThan(0);
  expect(outcome.rows).toHaveLength(batch.verification!.coverage.unresolved);
  expect(outcome.rows.every(row => row.outcome === "UNRESOLVED")).toBe(true);
  expect(document.rows[0].document_quarantine.kind).toBe("DOCUMENT_QUARANTINE");
  expect(document.rows[0].document_quarantine.reasons).toContain("SOURCE_ROW_COUNT_UNESTABLISHED");
  expect(await createV2Persistence(database).investigate(ids.attemptId, ids.tenantId)).toBe("CONFIRMED_COMMITTED");
  await expect(db.query("UPDATE fingence_v2_local.attempts SET outcome_count=outcome_count+1 WHERE id=$1", [ids.attemptId])).rejects.toMatchObject({ code: "23514" });
});
it("stores extraction failure as document quarantine, never as a source record", async () => {
  const { createExtractionFailureBatch } = await import("../../lib/server/ai-ingestion/v2-i1/persistence");
  const ids = identity();
  const batch = createExtractionFailureBatch({ ...ids, bytes: Buffer.from("bad"), filename: "bad.pdf" });
  await createV2Persistence(database).persist(batch);
  const rows = await db.query<{ outcome_count: number; document_quarantine: { kind: string; reasons: string[] } }>("SELECT outcome_count,document_quarantine FROM fingence_v2_local.attempts WHERE id=$1", [ids.attemptId]);
  expect(rows.rows[0].outcome_count).toBe(0);
  expect(rows.rows[0].document_quarantine).toMatchObject({ kind: "DOCUMENT_QUARANTINE", reasons: ["EXTRACTION_FAILED"] });
  expect((await db.query("SELECT * FROM fingence_v2_local.outcomes WHERE attempt_id=$1", [ids.attemptId])).rows).toHaveLength(0);
  expect(await createV2Persistence(database).investigate(ids.attemptId, ids.tenantId)).toBe("CONFIRMED_COMMITTED");
});
it("rejects a malformed or omitted stored document quarantine", async () => {
  const { createExtractionFailureBatch } = await import("../../lib/server/ai-ingestion/v2-i1/persistence");
  const ids = identity(), batch = createExtractionFailureBatch({ ...ids, bytes: Buffer.from("bad"), filename: "bad.pdf" });
  await createV2Persistence(database).persist(batch);
  await expect(db.query("UPDATE fingence_v2_local.attempts SET document_quarantine=$1::jsonb WHERE id=$2", ["{}", ids.attemptId])).rejects.toMatchObject({ code: "23514" });
  await expect(db.query("UPDATE fingence_v2_local.attempts SET document_quarantine=NULL WHERE id=$1", [ids.attemptId])).rejects.toMatchObject({ code: "23514" });
});
it("preserves accepted, rejected and unresolved outcomes separately for a partial document", async () => {
  const sourceBytes = Buffer.from("Transaction Date,Amount,Currency\n2026-10-19,12,MYR\n2026-10-19,wrong,MYR\n2026-10-19,,MYR\n");
  const evidence = await extractTrustedEvidence(sourceBytes, "synthetic.csv"), ids = identity();
  const batch = createExperimentalBatch({ ...ids, evidence, sourceBytes, blueprint: bindRecordedProposal(evidence, "TRANSACTION_TABLE"), origin: "RECORDED_TEST", receipt: null });
  expect(batch.verification).toMatchObject({ decision: "PARTIAL", coverage: { accepted: 1, rejected: 1, unresolved: 1 } });
  await createV2Persistence(database).persist(batch);
  const result = await db.query<{ outcome: string }>("SELECT outcome FROM fingence_v2_local.outcomes WHERE attempt_id=$1 ORDER BY ordinal", [ids.attemptId]);
  expect(result.rows.map(row => row.outcome)).toEqual(["WARNING", "REJECTED", "UNRESOLVED"]);
  expect(batch.verification?.accepted[0].issues.length).toBeGreaterThan(0);
  expect((await createV2Persistence(database).get(ids.attemptId, ids.tenantId))?.verification?.accepted[0].issues).toEqual(batch.verification?.accepted[0].issues);
});
