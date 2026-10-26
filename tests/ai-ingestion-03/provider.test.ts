import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("server-only", () => ({}));
import { GroqProvider03, OllamaProvider03, UncertainDispatchError } from "../../lib/server/ai-ingestion/increment-03/providers";
import { QuotaLedger } from "../../lib/server/ai-ingestion/increment-03/quota";
import { prepareRequest } from "../../lib/ai-ingestion/increment-03/plan";
import { bankEvidence, proposedPlan } from "./helpers";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function authorize() { vi.stubEnv("GROQ_API_KEY", "synthetic-test-key-not-real"); vi.stubEnv("FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED", "1"); vi.stubEnv("FINGENCE_AI03_FREE_PLAN_CONFIRMED", "1"); }
const ledger = () => new QuotaLedger(mkdtempSync(join(tmpdir(), "fg03-provider-")));
describe("Groq strict provider — mock transport, NOT genuine inference", () => {
  it("does not dispatch without all secure authorization prerequisites", async () => {
    const transport = vi.fn(); vi.stubEnv("GROQ_API_KEY", "");
    await expect(new GroqProvider03(ledger(), transport).propose(prepareRequest(await bankEvidence()))).rejects.toThrow(/LIVE_GROQ_UNAVAILABLE/);
    expect(transport).not.toHaveBeenCalled();
  });
  it("reserves before dispatch, fixes model/strict schema/no tools and preserves usage", async () => {
    authorize(); const q = ledger(), b = await bankEvidence();
    const send = vi.fn(async (body: Record<string, unknown>) => {
      expect(q.summary().inFlight).toBe(true); expect(body).toMatchObject({ model: "openai/gpt-oss-20b", reasoning_effort: "low", response_format: { type: "json_schema", json_schema: { strict: true } } });
      expect(body).not.toHaveProperty("tools");
      return { id: "mock-unit-response", model: "openai/gpt-oss-20b", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(proposedPlan(b)) } }], usage: { prompt_tokens: 200, completion_tokens: 300 } };
    });
    const r = await new GroqProvider03(q, send).propose(prepareRequest(b));
    expect(send).toHaveBeenCalledTimes(1); expect(r.receipt).toMatchObject({ mode: "LIVE_GROQ", inputTokens: 200, outputTokens: 300, retries: 0, estimatedUsd: 0 });
    expect(q.summary()).toMatchObject({ attempts: 1, inFlight: false, actualInputTokens: 200 });
  });
  it("never retries on error, retains reservation, and records missing usage as unknown", async () => {
    authorize(); const q = ledger(), send = vi.fn().mockRejectedValue(new Error("credential and source must not leak"));
    await expect(new GroqProvider03(q, send).propose(prepareRequest(await bankEvidence()))).rejects.toThrow(/^GROQ_REQUEST_FAILED$/);
    expect(send).toHaveBeenCalledTimes(1); expect(q.summary()).toMatchObject({ attempts: 1, inFlight: false });
    expect(q.summary().reservedTokensToday).toBeGreaterThan(0);
  });
  it("retains usage and raw malformed output for evaluation rather than losing the receipt", async () => {
    authorize(); const q = ledger();
    const send = vi.fn().mockResolvedValue({ id: "mock-malformed", model: "openai/gpt-oss-20b", choices: [{ finish_reason: "stop", message: { content: "malformed-json" } }], usage: { prompt_tokens: 50, completion_tokens: 10 } });
    const r = await new GroqProvider03(q, send).propose(prepareRequest(await bankEvidence()));
    expect(r.plan).toBe("malformed-json"); expect(r.receipt.inputTokens).toBe(50); expect(q.summary().attempts).toBe(1);
  });
  it("retains LIVE receipt when a real response has usage but no usable content", async () => {
    authorize(); const q = ledger(); const send = vi.fn().mockResolvedValue({ id: "mock-empty", model: "openai/gpt-oss-20b", choices: [{ finish_reason: "stop", message: { content: null } }], usage: { prompt_tokens: 123, completion_tokens: 10 } });
    const r = await new GroqProvider03(q, send).propose(prepareRequest(await bankEvidence()));
    expect(r.plan).toBeNull(); expect(r.receipt).toMatchObject({ mode: "LIVE_GROQ", inputTokens: 123, outputTokens: 10 });
  });
  it.each([false, true])("keeps dispatch uncertainty when quota settlement itself fails (transport failure=%s)", async fail => {
    authorize(); const q = ledger(); vi.spyOn(q, "finish").mockImplementation(() => { throw new Error("QUOTA_LOCKED"); });
    const send = fail ? vi.fn().mockRejectedValue(new Error("timeout")) : vi.fn().mockResolvedValue({ id: "mock", model: "openai/gpt-oss-20b", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
    await expect(new GroqProvider03(q, send).propose(prepareRequest(await bankEvidence()))).rejects.toBeInstanceOf(UncertainDispatchError);
    expect(send).toHaveBeenCalledTimes(1); expect(q.summary().inFlight).toBe(true);
  });
  it("stops oversized requests proactively without a network call", async () => {
    authorize(); const q = ledger(), send = vi.fn(); const req = prepareRequest(await bankEvidence()); req.inputTokenBound = 9000;
    await expect(new GroqProvider03(q, send).propose(req)).rejects.toThrow(/QUOTA_REQUEST_BOUND/); expect(send).not.toHaveBeenCalled();
  });
  it("rejects incomplete or usage-less provider responses without accepting records", async () => {
    authorize(); const send = vi.fn().mockResolvedValue({ choices: [{ finish_reason: "length", message: { content: "{}" } }] });
    await expect(new GroqProvider03(ledger(), send).propose(prepareRequest(await bankEvidence()))).rejects.toThrow(/GROQ_INCOMPLETE/);
  });
});
describe("Ollama explicit local boundary", () => {
  it("tracks a mocked local dispatch and keeps its provider receipt separate", async () => {
    vi.stubEnv("FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED", "1"); vi.stubEnv("FINGENCE_AI03_OLLAMA_MODEL", "qwen3:4b-instruct");
    const q = ledger();
    const send = vi.fn().mockResolvedValueOnce(Response.json({ models: [{ name: "qwen3:4b-instruct" }] })).mockImplementationOnce(async () => {
      expect(q.summary().inFlight).toBe(true);
      return Response.json({ model: "qwen3:4b-instruct", done: true, done_reason: "stop", message: { content: "{}" }, prompt_eval_count: 100, eval_count: 20 });
    });
    vi.stubGlobal("fetch", send);
    const r = await new OllamaProvider03("http://127.0.0.1:11434", q).propose(prepareRequest(await bankEvidence()));
    expect(r.receipt.mode).toBe("LIVE_OLLAMA"); expect(r.receipt.requestId).toBeNull(); expect(q.summary().attempts).toBe(1); expect(send).toHaveBeenCalledTimes(2);
  });
  it("blocks without authorization and rejects remote endpoints", async () => {
    vi.stubEnv("FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED", "");
    await expect(new OllamaProvider03().propose(prepareRequest(await bankEvidence()))).rejects.toThrow(/LIVE_OLLAMA_UNAVAILABLE/);
    expect(() => new OllamaProvider03("http://10.0.0.2:11434")).toThrow(/LOOPBACK/);
  });
});
