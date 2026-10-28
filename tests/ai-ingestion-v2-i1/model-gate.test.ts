import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../lib/server/ai-ingestion/increment-03/service", () => ({
  liveEnabled03: () => true, providerStatus03: () => ({ ready: true }),
  processLiveDocument03: mocks.dispatch, registeredSynthetic03: async () => true,
}));
import { runAuthorizedModelJob } from "../../lib/server/ai-ingestion/v2-i1/job";
import type { TransactionDatabase } from "../../lib/server/db/postgres";
const db: TransactionDatabase = { close: async () => {}, transaction: async () => { throw new Error("must not be used"); } };
afterEach(() => { vi.unstubAllEnvs(); mocks.dispatch.mockReset(); });
describe("model dispatch authorization", () => {
  it("does not call a provider without the additional explicit authorization", async () => {
    vi.stubEnv("FINGENCE_V2_I1_LIVE_DISPATCH_AUTHORIZED", "");
    await expect(runAuthorizedModelJob({ bytes: Buffer.from("synthetic"), filename: "test.csv", tenantId: "00000000-0000-0000-0000-000000000000", database: db })).rejects.toThrow("LIVE_DISPATCH_NOT_AUTHORIZED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
it("preserves recorded origin through the provider seam and independently re-verifies it", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFileSync } = await import("node:fs");
  const { randomUUID } = await import("node:crypto");
  const { bankEvidence, proposedPlan } = await import("../ai-ingestion-03/helpers");
  const { materializePlan } = await import("../../lib/ai-ingestion/increment-03/plan");
  const local = await PGlite.create();
  try {
    await local.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await local.exec(readFileSync("supabase/sql/v2-verified-document-local.sql", "utf8"));
    const database: TransactionDatabase = { close: async () => {}, transaction: async work => local.transaction(async tx => work({
      query: async (sql, values) => { const r = await tx.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as never; },
    })) };
    const evidence = await bankEvidence(), blueprint = materializePlan(evidence, proposedPlan(evidence));
    mocks.dispatch.mockResolvedValue({ runId: randomUUID(), mode: "RECORDED_TEST", evidence, blueprint,
      receipt: { mode: "RECORDED_TEST", model: "test-only", inputTokens: 0, outputTokens: 0, retries: 0 }, stages: [], dispatch: null });
    vi.stubEnv("FINGENCE_V2_I1_LIVE_DISPATCH_AUTHORIZED", "1");
    const result = await runAuthorizedModelJob({ bytes: readFileSync("public/samples/ai-ingestion-increment-02/precision.csv"), filename: "test.csv", tenantId: randomUUID(), database });
    expect(result.mode).toBe("RECORDED_TEST"); expect(result.batch.origin).toBe("RECORDED_TEST");
    expect(result.batch.verification?.accepted.length).toBeGreaterThan(0);
    expect(result.batch.publicationEligible).toBe(false);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  } finally { await local.close(); }
}, 30000);
