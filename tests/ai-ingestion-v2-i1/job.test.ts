import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { extractSemanticEvidence } from "../../lib/ai-ingestion/increment-02/extract";
import { bindRecordedProposal } from "../../lib/ai-ingestion/increment-02/recorded";
import { createSemanticTemplate } from "../../lib/ai-ingestion/increment-02/reuse";
import { runSyntheticJob } from "../../lib/server/ai-ingestion/v2-i1/job";
import { createV2Persistence } from "../../lib/server/ai-ingestion/v2-i1/persistence";
import type { TransactionDatabase } from "../../lib/server/db/postgres";
import { PersistenceError } from "../../lib/server/persistence/contracts";
import { transactionDatabase } from "../../lib/server/db/postgres";
let db: PGlite; let database: TransactionDatabase;
beforeAll(async () => {
  db = await PGlite.create(); await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await db.exec(readFileSync("supabase/sql/v2-verified-document-local.sql", "utf8"));
  database = { close: async () => {}, transaction: async work => db.transaction(async tx => work({
    query: async (sql, values) => { const r = await tx.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as never; },
  })) };
}, 30000);
afterAll(async () => { await db.close(); });
async function template() {
  const evidence = await extractSemanticEvidence(readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv"), "seed.csv");
  return createSemanticTemplate(evidence, bindRecordedProposal(evidence, "BANK_STATEMENT"), "RECORDED_TEST");
}
describe("synthetic local jobs", () => {
  it("extracts and independently verifies a reused template without a mapping screen or LLM call", async () => {
    const tenantId = randomUUID(), bytes = readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv");
    const result = await runSyntheticJob({ bytes, filename: "uploaded.csv", tenantId, template: await template(), database });
    expect(result.mode).toBe("VERIFIED_BLUEPRINT_REUSE");
    expect(result.origin).toBe("RECORDED_TEST");
    expect(result.batch.verification!.accepted.length).toBeGreaterThan(0);
    expect(result.batch.publicationEligible).toBe(false);
    expect((await createV2Persistence(database).get(result.batch.attemptId, tenantId))?.evidence!.sourceId).toBe(result.batch.evidence!.sourceId);
  });
  it("does not process unregistered bytes", async () => {
    await expect(runSyntheticJob({ bytes: Buffer.from("not registered"), filename: "x.csv", tenantId: randomUUID(), template: await template(), database })).rejects.toThrow("REGISTERED_SYNTHETIC_REQUIRED");
  });
});
it("quarantines registered source rows when no interpretation is available without implying inference", async () => {
  const bytes = readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv");
  const result = await runSyntheticJob({ bytes, filename: "uploaded.csv", tenantId: randomUUID(), template: null, database });
  expect(result.mode).toBe("NOT_EXECUTED");
  expect(result.origin).toBeNull();
  expect(result.batch.verification!.proposalOrigin).toBeNull();
  expect(result.batch.verification!.accepted).toHaveLength(0);
  expect(result.batch.verification!.unresolved.length).toBeGreaterThan(0);
});
it("quarantines an unreadable registered document without inventing a row count", async () => {
  const bytes = readFileSync("public/samples/ai-ingestion-increment-02/corrupt.pdf");
  const result = await runSyntheticJob({ bytes, filename: "corrupt.pdf", tenantId: randomUUID(), template: null, database });
  expect(result.batch.verification).toBeNull();
  expect(result.batch.documentFailure).toEqual({ code: "EXTRACTION_FAILED", rowCountEstablished: false });
  expect(result.batch.evidence).toBeNull();
}, 120000);

it.each([
  [new PersistenceError("PERSISTENCE_FAILED"), "PERSISTENCE_FAILED"],
  [new PersistenceError("DATABASE_UNAVAILABLE"), "DATABASE_UNAVAILABLE"],
  [new PersistenceError("DATABASE_CONFIGURATION"), "DATABASE_CONFIGURATION"],
  [new PersistenceError("INVALID_INPUT"), "INVALID_INPUT"],
  [new PersistenceError("UNSUPPORTED_VERSION"), "UNSUPPORTED_VERSION"],
  [new PersistenceError("MIXED_BATCH_IDS"), "MIXED_BATCH_IDS"],
  [new PersistenceError("EMPTY_ACCEPTED_BATCH_UNSUPPORTED"), "EMPTY_ACCEPTED_BATCH_UNSUPPORTED"],
  [new PersistenceError("IDEMPOTENCY_UNSUPPORTED"), "IDEMPOTENCY_UNSUPPORTED"],
  [new PersistenceError("COMMIT_OUTCOME_UNKNOWN"), "COMMIT_OUTCOME_UNKNOWN"],
  [new PersistenceError("ROLLBACK_UNCONFIRMED"), "ROLLBACK_UNCONFIRMED"],
  [new Error("sensitive internal error"), "UNCLASSIFIED_FAILURE"],
] as const)("classifies a persistence failure without retry or leaking details as %s", async (failure, expected) => {
  let calls = 0;
  const failing: TransactionDatabase = { close: async () => {}, transaction: async () => { calls++; throw failure; } };
  const bytes = readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv");
  try { await runSyntheticJob({ bytes, filename: "uploaded.csv", tenantId: randomUUID(), template: null, database: failing }); throw new Error("Expected failure"); }
  catch (error) {
    expect(error).toMatchObject({ code: expected, message: expected, attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(JSON.stringify(error)).not.toContain("sensitive internal error");
  }
  expect(calls).toBe(1);
});
it("reports a query failure as a known failure after an acknowledged rollback", async () => {
  const statements: string[] = [];
  const database = transactionDatabase({ connect: async () => ({
    query: async (sql: string) => { statements.push(sql); if (sql.startsWith("INSERT")) throw new Error("private SQL detail"); return { rows: [], rowCount: 0 }; },
    release: () => {},
  }), end: async () => {} } as Parameters<typeof transactionDatabase>[0]);
  const bytes = readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv");
  await expect(runSyntheticJob({ bytes, filename: "synthetic.csv", tenantId: randomUUID(), template: null, database }))
    .rejects.toMatchObject({ code: "PERSISTENCE_FAILED", message: "PERSISTENCE_FAILED" });
  expect(statements.filter(sql => sql === "ROLLBACK")).toHaveLength(1);
  expect(statements.filter(sql => sql === "COMMIT")).toHaveLength(0);
});
it.each([["commit", "COMMIT_OUTCOME_UNKNOWN"], ["rollback", "ROLLBACK_UNCONFIRMED"]] as const)(
  "preserves a real transaction adapter's %s uncertainty and attempt identity", async (mode, expected) => {
    const statements: string[] = [];
    const database = transactionDatabase({ connect: async () => ({
      query: async (sql: string) => {
        statements.push(sql);
        if (mode === "commit" && sql === "COMMIT") throw new Error("lost acknowledgement");
        if (mode === "rollback" && (sql.startsWith("INSERT") || sql === "ROLLBACK")) throw new Error("connection failure");
        return { rows: [], rowCount: 1 };
      }, release: () => {},
    }), end: async () => {} } as Parameters<typeof transactionDatabase>[0]);
    const bytes = readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv");
    await expect(runSyntheticJob({ bytes, filename: "synthetic.csv", tenantId: randomUUID(), template: null, database }))
      .rejects.toMatchObject({ code: expected, attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(statements.filter(sql => sql.startsWith("BEGIN"))).toHaveLength(1);
    expect(statements.filter(sql => sql === "ROLLBACK")).toHaveLength(1);
  },
);
