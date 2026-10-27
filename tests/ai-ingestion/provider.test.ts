import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractDocument } from "../../lib/ai-ingestion/extract";
const fake = vi.hoisted(() => ({ model: vi.fn(), count: vi.fn(), create: vi.fn(), reserve: vi.fn(), settle: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("openai", () => ({ default: class { models = { retrieve: fake.model }; responses = { inputTokens: { count: fake.count }, create: fake.create }; } }));
vi.mock("../../lib/ai-ingestion/budget", () => ({ BudgetLedger: class { reserve = fake.reserve; settle = fake.settle; } }));
import { MODEL, OpenAIRuleProvider } from "../../lib/server/ai-ingestion/provider";

// All SDK operations and pricing fetch are mocked. No API key or network access.
describe("OpenAI dispatch safety, with mocked SDK only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder-never-a-real-key"); vi.stubEnv("OPENAI_PROJECT_ID", "test-project"); vi.stubEnv("FINGENCE_AI_LIVE_APPROVED", "1");
    fake.model.mockResolvedValue({ id: MODEL }); fake.count.mockResolvedValue({ input_tokens: 400 }); fake.reserve.mockReturnValue("test-reservation");
    fake.create.mockResolvedValue({ status: "completed", id: "test-response", model: MODEL, usage: { input_tokens: 400, output_tokens: 20 }, output_text: "{}" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("| gpt-6.1-sol | $2.00 | $0.10 | $2.50 | $10.00 |")));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const source = () => extractDocument(Buffer.from("Date,Amount\n2026-09-01,12.34\n"), "test.csv");
  it("does not dispatch without locally activated project credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); await expect(new OpenAIRuleProvider().propose(await source())).rejects.toThrow(); expect(fake.create).not.toHaveBeenCalled();
  });
  it("does not dispatch if the requested model is unavailable", async () => {
    fake.model.mockRejectedValue(new Error("model unavailable")); await expect(new OpenAIRuleProvider().propose(await source())).rejects.toThrow(); expect(fake.reserve).not.toHaveBeenCalled(); expect(fake.create).not.toHaveBeenCalled();
  });
  it("does not dispatch on changed prices", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("changed prices"))); await expect(new OpenAIRuleProvider().propose(await source())).rejects.toThrow(/pricing/i); expect(fake.create).not.toHaveBeenCalled();
  });
  it("does not dispatch excessive or uncountable inputs", async () => {
    for (const input_tokens of [32001, -1, NaN]) {
      fake.count.mockResolvedValue({ input_tokens }); await expect(new OpenAIRuleProvider().propose(await source())).rejects.toThrow(/token/i);
    }
    expect(fake.create).not.toHaveBeenCalled(); expect(fake.reserve).not.toHaveBeenCalled();
  });
  it("does not dispatch when the shared persistent budget denies reservation", async () => {
    fake.reserve.mockImplementationOnce(() => { throw new Error("US$5 budget exhausted"); }); await expect(new OpenAIRuleProvider().propose(await source())).rejects.toThrow(/budget/); expect(fake.create).not.toHaveBeenCalled();
  });
  it("reserves before dispatch, preserves receipt and sends no tools or stored response", async () => {
    const result = await new OpenAIRuleProvider().propose(await source());
    expect(fake.reserve.mock.invocationCallOrder[0]).toBeLessThan(fake.create.mock.invocationCallOrder[0]);
    expect(fake.create.mock.calls[0][0]).toMatchObject({ store: false, max_output_tokens: 6000, model: MODEL }); expect(fake.create.mock.calls[0][0]).not.toHaveProperty("tools");
    expect(result.receipt).toMatchObject({ inputTokens: 400, outputTokens: 20, estimatedUsd: 0.001, retries: 0 });
    expect(fake.settle).toHaveBeenCalledWith("test-reservation", { inputTokens: 400, outputTokens: 20, requestId: "test-response" });
  });
  it("does not retry an uncertain request and retains its reservation", async () => {
    fake.create.mockRejectedValueOnce(new Error("timeout")); await expect(new OpenAIRuleProvider().propose(await source())).rejects.toThrow(); expect(fake.create).toHaveBeenCalledTimes(1); expect(fake.reserve).toHaveBeenCalledTimes(1); expect(fake.settle).not.toHaveBeenCalled();
  });
  it("retains metering even when the returned output is malformed", async () => {
    fake.create.mockResolvedValueOnce({ status: "completed", id: "test-bad-response", model: MODEL, usage: { input_tokens: 400, output_tokens: 20 }, output_text: "not JSON" });
    const result = await new OpenAIRuleProvider().propose(await source()); expect(result.blueprint).toBeNull(); expect(result.receipt.requestId).toBe("test-bad-response"); expect(fake.settle).toHaveBeenCalled();
  });
});
