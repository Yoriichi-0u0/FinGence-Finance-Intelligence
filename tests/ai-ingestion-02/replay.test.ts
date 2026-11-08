import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { developerReplayEnabled, developerRequestAllowed, readSyntheticCase, runRecordedReplay } from "../../lib/server/ai-ingestion/increment-02/replay";
import { prepareSemanticInference } from "../../lib/server/ai-ingestion/increment-02/request";
afterEach(() => vi.unstubAllEnvs());
describe("Separate local developer replay boundary", () => {
  it("requires development, explicit flag and safe local origin", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_AI_DEVELOPER_REPLAY", "1"); vi.stubEnv("VERCEL", "");
    expect(developerRequestAllowed(new Request("http://localhost:3103/api/ai-ingestion/developer-replay"))).toBe(true);
    expect(developerRequestAllowed(new Request("http://localhost:3103/api/ai-ingestion/developer-replay", { headers: { origin: "https://bad.example" } }))).toBe(false);
    vi.stubEnv("NODE_ENV", "production"); expect(developerReplayEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "1"); expect(developerReplayEnabled()).toBe(false);
    vi.stubEnv("VERCEL", ""); vi.stubEnv("FINGENCE_AI_DEVELOPER_REPLAY", "0"); expect(developerReplayEnabled()).toBe(false);
  });
  it("accepts only registered source identities, not user paths", async () => {
    await expect(readSyntheticCase("../../.env.local")).rejects.toThrow();
    expect((await readSyntheticCase("bank-narrative.csv")).bytes.length).toBeGreaterThan(0);
  });
  it("replays real extraction and normalization without fetch, SDK calls or token use", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden during replay"));
    try {
      const r = await runRecordedReplay("bank-narrative.csv");
      expect(r.origin).toBe("RECORDED_TEST"); expect(r.inference).toBe("NOT_EXECUTED"); expect(r.verification?.accepted).toHaveLength(3);
      expect(r.inputTokens + r.outputTokens + r.estimatedUsd).toBe(0); expect(network).not.toHaveBeenCalled();
      const request = prepareSemanticInference(r.evidence!); expect(request.dispatch).toBe("DISABLED_FOR_INCREMENT_02");
      expect(JSON.stringify(request)).not.toContain('"families"'); expect(JSON.stringify(request)).not.toContain('"normalAmounts"');
    } finally { network.mockRestore(); }
  });
  it("makes deliberate wrong proposals inspectable with zero accepted records", async () => {
    for (const variant of ["swap", "omit"] as const) {
      const r = await runRecordedReplay("bank-narrative.csv", variant); expect(r.verification?.accepted).toHaveLength(0); expect(r.verification?.checks.some(c => !c.passed)).toBe(true);
    }
  });
  it("records template reuse using fresh precision-source evidence", async () => {
    const r = await runRecordedReplay("precision.csv", "reuse"); expect(r.reuse?.decision).toBe("REUSED");
    expect(r.verification?.accepted[0].financial.source_amount).toBe("9007199254740993.01");
  });
  it("does not couple runtime interpretation to evaluation labels", () => {
    for (const path of ["lib/server/ai-ingestion/increment-02/replay.ts", "lib/ai-ingestion/increment-02/recorded.ts", "lib/ai-ingestion/increment-02/verify.ts"]) expect(readFileSync(path, "utf8")).not.toMatch(/ground-truth|tests\/fixtures/);
  });
});
