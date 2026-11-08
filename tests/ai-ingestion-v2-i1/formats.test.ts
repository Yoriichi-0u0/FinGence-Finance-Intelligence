import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { extractSemanticEvidence } from "../../lib/ai-ingestion/increment-02/extract";
import { bindRecordedProposal } from "../../lib/ai-ingestion/increment-02/recorded";
import { createSemanticTemplate, type SemanticTemplate } from "../../lib/ai-ingestion/increment-02/reuse";
import { runSyntheticJob } from "../../lib/server/ai-ingestion/v2-i1/job";
import type { TransactionDatabase } from "../../lib/server/db/postgres";
let db: PGlite; let database: TransactionDatabase; let template: SemanticTemplate;
beforeAll(async () => {
  vi.stubEnv("FINGENCE_AI_PYTHON", process.env.FINGENCE_AI_PYTHON ?? ".venv-ai/bin/python");
  db = await PGlite.create(); await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await db.exec(readFileSync("supabase/sql/v2-verified-document-local.sql", "utf8"));
  database = { close: async () => {}, transaction: async work => db.transaction(async tx => work({
    query: async (sql, values) => { const r = await tx.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as never; },
  })) };
  const seed = await extractSemanticEvidence(readFileSync("public/samples/ai-ingestion/statement.csv"), "seed.csv");
  template = createSemanticTemplate(seed, bindRecordedProposal(seed, "TRANSACTION_TABLE"), "RECORDED_TEST");
}, 30000);
afterAll(async () => { vi.unstubAllEnvs(); await db.close(); });
describe("four-format extraction and persistence", () => {
  const ocrAvailable = existsSync(process.env.FINGENCE_AI_PYTHON ?? ".venv-ai/bin/python");
  const expected: Record<string, [number, number]> = {
    "statement.csv": [4, 0], "statement.xlsx": [4, 0],
    "statement-digital.pdf": [0, 4], "statement-scan.pdf": [0, 4],
    "statement.png": [2, 0], "statement.jpg": [2, 0],
  };
  for (const name of ["statement.csv", "statement.xlsx", "statement-digital.pdf", "statement-scan.pdf", "statement.png", "statement.jpg"]) it.skipIf(!name.endsWith(".csv") && !name.endsWith(".xlsx") && !ocrAvailable)(`processes ${name} without inventing values`, async () => {
    const bytes = readFileSync(`public/samples/ai-ingestion/${name}`);
    const result = await runSyntheticJob({ bytes, filename: name, tenantId: randomUUID(), template, database });
    expect(result.batch.publicationEligible).toBe(false);
    expect(result.batch.source.sha256).toHaveLength(64);
    expect(result.batch.evidence, `extraction failed: ${name}`).not.toBeNull();
    if (!result.batch.evidence) throw new Error("EXTRACTION_FAILED");
    const v = result.batch.verification!;
    console.info(JSON.stringify({ file: name, mode: result.mode, sourceRows: v.coverage.sourceRows, rowCountEstablished: v.coverage.rowCountEstablished, accepted: v.accepted.length, rejected: v.rejected.length, unresolved: v.unresolved.length }));
    expect([v.accepted.length, v.unresolved.length]).toEqual(expected[name]);
    expect(v.coverage.accepted + v.coverage.rejected + v.coverage.unresolved).toBe(v.coverage.sourceRows);
    for (const record of v.accepted) {
      expect(record.evidenceIds.every(id => result.batch.evidence!.items.some(item => item.id === id))).toBe(true);
      expect(["1234.5", "-20.05", "0", "250.25"]).toContain(record.financial.source_amount);
    }
    expect(result.origin === "RECORDED_TEST" || result.origin === null).toBe(true);
  }, 120000);
});
