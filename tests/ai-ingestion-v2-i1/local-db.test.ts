import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { openLocalDatabase } from "../../lib/server/ai-ingestion/v2-i1/local-db";
import { createExperimentalBatch, createV2Persistence, extractTrustedEvidence } from "../../lib/server/ai-ingestion/v2-i1/persistence";
import { proposedPlan } from "../ai-ingestion-03/helpers";
import { materializePlan } from "../../lib/ai-ingestion/increment-03/plan";
import { readFileSync } from "node:fs";
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
function enable() { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_V2_I1_LOCAL", "1"); vi.stubEnv("VERCEL", ""); }
async function temp() { const root = resolve(".local"); await mkdir(root, { recursive: true }); const dir = await mkdtemp(join(root, "v2-i1-test-")); dirs.push(dir); return dir; }
describe("local file-backed synthetic database", () => {
  it("survives a close and reopen without changing financial records", async () => {
    enable(); const dir = await temp(), evidence = await extractTrustedEvidence(readFileSync("public/samples/ai-ingestion-increment-02/precision.csv"), "synthetic.csv");
    const ids = { attemptId: randomUUID(), jobId: randomUUID(), executionId: randomUUID(), tenantId: randomUUID() };
    const batch = createExperimentalBatch({ ...ids, evidence, sourceBytes: readFileSync("public/samples/ai-ingestion-increment-02/precision.csv"), blueprint: materializePlan(evidence, proposedPlan(evidence)), origin: "RECORDED_TEST", receipt: null });
    const first = await openLocalDatabase(dir); await createV2Persistence(first).persist(batch); await first.close();
    const second = await openLocalDatabase(dir);
    try { expect((await createV2Persistence(second).get(ids.attemptId, ids.tenantId))?.verification).toEqual(batch.verification); }
    finally { await second.close(); }
  }, 30000);
  it("rejects symlink database directories and paths outside the local workspace", async () => {
    enable(); const parent = await temp(), link = join(parent, "symlink"); await symlink(parent, link);
    await expect(openLocalDatabase(link)).rejects.toThrow();
    await expect(openLocalDatabase("/tmp/fingence-not-allowed")).rejects.toThrow();
  });
});
