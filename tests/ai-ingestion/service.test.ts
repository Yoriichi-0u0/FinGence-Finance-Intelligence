import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { localAccessAllowed, processDocument } from "../../lib/server/ai-ingestion/service";
import { recordedFixtureProposal } from "./recorded-fixture-proposal";
afterEach(() => vi.unstubAllEnvs());
describe("Observable V2 pipeline and its real trust boundaries", () => {
  it("extracts real CSV but never substitutes fake AI when credentials are missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const stages: string[] = [];
    const r = await processDocument(await readFile("public/samples/ai-ingestion/statement.csv"), "statement.csv", s => stages.push(`${s.name}:${s.state}`));
    expect(r.evidence.items).toHaveLength(30); expect(r.inference).toBeNull(); expect(r.verification).toBeNull();
    expect(stages).toContain("extraction:COMPLETED"); expect(stages).toContain("inference:BLOCKED");
  });
  it("executes test proposals through the real verifier and labels them RECORDED_TEST", async () => {
    const r = await processDocument(await readFile("public/samples/ai-ingestion/statement.csv"), "statement.csv", () => {}, {
      async propose(bundle) { return { blueprint: recordedFixtureProposal(bundle), receipt: { mode: "RECORDED_TEST", model: "NOT_AN_LLM", requestId: null, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, retries: 0 } }; },
    });
    expect(r.verification?.accepted).toHaveLength(4); expect(r.inference?.mode).toBe("RECORDED_TEST");
    expect(r.stages.find(s => s.name === "inference")?.message).toContain("no live inference");
  });
  it("leaves later stages blocked after a provider error", async () => {
    const r = await processDocument(await readFile("public/samples/ai-ingestion/statement.csv"), "statement.csv", () => {}, { async propose() { throw new Error("external failure"); } });
    expect(r.verification).toBeNull(); expect(r.stages.find(s => s.name === "inference")?.state).toBe("FAILED");
  });
  it("keeps the usage receipt when inference returns a malformed blueprint", async () => {
    const r = await processDocument(await readFile("public/samples/ai-ingestion/statement.csv"), "statement.csv", () => {}, { async propose() { return { blueprint: null, receipt: { mode: "RECORDED_TEST", model: "NOT_AN_LLM", requestId: null, inputTokens: 7, outputTokens: 3, estimatedUsd: 0, retries: 0 } }; } });
    expect(r.inference?.inputTokens).toBe(7); expect(r.stages.find(s => s.name === "rule_synthesis")?.state).toBe("FAILED"); expect(r.verification).toBeNull();
  });
  it("blocks production, remote hosts and cross-origin requests", () => {
    vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("NODE_ENV", "development");
    expect(localAccessAllowed(new Request("http://127.0.0.1:3103/api/ai-ingestion"))).toBe(true);
    expect(localAccessAllowed(new Request("http://localhost:3103/api/ai-ingestion", { headers: { host: "127.0.0.1:3103", origin: "http://127.0.0.1:3103" } }))).toBe(true);
    expect(localAccessAllowed(new Request("http://localhost:3103/api/ai-ingestion", { headers: { host: "evil.example:3103", origin: "http://evil.example:3103" } }))).toBe(false);
    expect(localAccessAllowed(new Request("https://example.com/api/ai-ingestion"))).toBe(false);
    expect(localAccessAllowed(new Request("http://127.0.0.1:3103/api/ai-ingestion", { headers: { origin: "https://evil.example" } }))).toBe(false);
    vi.stubEnv("NODE_ENV", "production"); expect(localAccessAllowed(new Request("http://localhost/api/ai-ingestion"))).toBe(false);
  });
});
