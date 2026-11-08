import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { processLiveDocument03, liveRequestAllowed03, registeredSynthetic03 } from "../../lib/server/ai-ingestion/increment-03/service";
import { UncertainDispatchError } from "../../lib/server/ai-ingestion/increment-03/providers";
import { hash } from "../../lib/ai-ingestion/increment-03/plan";
import { proposedPlan, bankEvidence } from "./helpers";
afterEach(() => vi.unstubAllEnvs());
const bytes = () => readFileSync("public/samples/ai-ingestion-increment-02/precision.csv");
describe("Credential-free orchestration — explicitly recorded mock input", () => {
  it("extracts then blocks unavailable inference without calling fetch or accepting data", async () => {
    vi.stubEnv("GROQ_API_KEY", ""); const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Forbidden"));
    try {
      const r = await processLiveDocument03(bytes(), "opaque.csv");
      expect(r.mode).toBe("NOT_EXECUTED"); expect(r.evidence?.items.length).toBeGreaterThan(0); expect(r.verification).toBeNull(); expect(r.stages.find(s => s.name === "inference")?.state).toBe("BLOCKED"); expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
  it("runs materialization and the real verifier, labeling mocked inference honestly", async () => {
    const plan = proposedPlan(await bankEvidence()); const propose = vi.fn().mockResolvedValue({ plan, receipt: { mode: "RECORDED_TEST", model: "MOCK_TEST_ONLY", requestId: null, inputTokens: 0, outputTokens: 0, reasoningTokens: null, estimatedUsd: 0, retries: 0, durationMs: 0, outputHash: hash(plan) } });
    const r = await processLiveDocument03(bytes(), "renamed.csv", () => {}, { propose });
    expect(propose).toHaveBeenCalledTimes(1); expect(r.mode).toBe("RECORDED_TEST"); expect(r.verification?.accepted[0].financial.source_amount).toBe("9007199254740993.01"); expect(r.verification?.proposalOrigin).toBe("RECORDED_TEST");
  });
  it("rejects unregistered bytes before extraction/provider access and rejects canceled requests", async () => {
    const propose = vi.fn(); await expect(processLiveDocument03(new Uint8Array([1, 2, 3]), "source.csv", () => {}, { propose })).rejects.toThrow(/SYNTHETIC/);
    const abort = new AbortController(); abort.abort(); await expect(processLiveDocument03(bytes(), "source.csv", () => {}, { propose }, abort.signal)).rejects.toThrow(/CANCELED/); expect(propose).not.toHaveBeenCalled();
  });
  it("honors cancellation after provider completion while retaining its receipt", async () => {
    const plan = proposedPlan(await bankEvidence()), abort = new AbortController();
    const propose = vi.fn(async () => { abort.abort(); return { plan, receipt: { mode: "RECORDED_TEST" as const, model: "MOCK_TEST_ONLY", requestId: null, inputTokens: 0, outputTokens: 0, reasoningTokens: null, estimatedUsd: 0, retries: 0 as const, durationMs: 0, outputHash: hash(plan) } }; });
    const r = await processLiveDocument03(bytes(), "opaque.csv", () => {}, { propose }, abort.signal);
    expect(r.error).toBe("REQUEST_CANCELED"); expect(r.receipt?.model).toBe("MOCK_TEST_ONLY"); expect(r.verification?.accepted).toHaveLength(0);
  });
  it("never labels an uncertain dispatched request as not executed", async () => {
    const propose = vi.fn().mockRejectedValue(new UncertainDispatchError("GROQ_REQUEST_FAILED", "LIVE_GROQ", "reservation-test"));
    const r = await processLiveDocument03(bytes(), "opaque.csv", () => {}, { propose });
    expect(r.mode).toBe("DISPATCHED_UNKNOWN"); expect(r.dispatch).toMatchObject({ provider: "LIVE_GROQ", reservationId: "reservation-test" }); expect(r.verification).toBeNull();
  });
  it("checks both old and held-out exact-byte manifests, never names or expected labels", async () => {
    expect(await registeredSynthetic03(bytes())).toBe(true); expect(await registeredSynthetic03(readFileSync("public/samples/ai-ingestion-increment-03/h01.csv"))).toBe(true); expect(await registeredSynthetic03(Buffer.from("h01.csv"))).toBe(false);
    for (const file of ["service.ts", "providers.ts"]) expect(readFileSync(`lib/server/ai-ingestion/increment-03/${file}`, "utf8")).not.toMatch(/ground-truth|recorded\.ts|cases\.ts|tests\/fixtures/);
  });
  it("requires local development and rejects production/VERCEL/cross-site access", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_AI03_LOCAL", "1"); vi.stubEnv("VERCEL", "");
    expect(liveRequestAllowed03(new Request("http://127.0.0.1:3107/api/ai-ingestion/live"))).toBe(true);
    expect(liveRequestAllowed03(new Request("http://127.0.0.1:3107/api/ai-ingestion/live", { headers: { origin: "https://evil.example" } }))).toBe(false);
    vi.stubEnv("NODE_ENV", "production"); expect(liveRequestAllowed03(new Request("http://localhost/api/ai-ingestion/live"))).toBe(false);
  });
});
