import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET, POST } from "../../app/api/ai-ingestion/developer-replay/route";
beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_AI_DEVELOPER_REPLAY", "1"); vi.stubEnv("VERCEL", ""); });
afterEach(() => vi.unstubAllEnvs());
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost:3105/api/ai-ingestion/developer-replay", { method: "POST", headers: { "Content-Type": "application/json", "X-FinGence-Developer-Replay": "1", ...headers }, body: JSON.stringify(body) });
describe("Actual developer replay HTTP handlers", () => {
  it("does not allow production even with the enable flag", async () => {
    vi.stubEnv("NODE_ENV", "production"); expect((await GET(new Request("http://localhost:3105/api/ai-ingestion/developer-replay"))).status).toBe(404);
    expect((await POST(request({ caseId: "bank-narrative.csv", variant: "recorded" }))).status).toBe(404);
  });
  it("rejects foreign origin, absent flag and non-loopback host", async () => {
    expect((await POST(request({}, { origin: "https://example.com" }))).status).toBe(404);
    vi.stubEnv("FINGENCE_AI_DEVELOPER_REPLAY", "0"); expect((await GET(new Request("http://localhost:3105/api/ai-ingestion/developer-replay"))).status).toBe(404);
    vi.stubEnv("FINGENCE_AI_DEVELOPER_REPLAY", "1"); expect((await GET(new Request("https://example.com/api/ai-ingestion/developer-replay"))).status).toBe(404);
  });
  it("does not accept arbitrary proposals, paths or large request bodies", async () => {
    expect((await POST(request({ caseId: "../../.env.local", variant: "recorded" }))).status).toBe(400);
    expect((await POST(request({ caseId: "bank-narrative.csv", variant: "recorded", blueprint: {} }))).status).toBe(400);
    expect((await POST(request({ text: "x".repeat(3000) }))).status).toBe(413);
    expect((await POST(request({}, { "X-FinGence-Developer-Replay": "0" }))).status).toBe(400);
  });
  it("streams a real recorded run with its origin and no inference receipt", async () => {
    const response = await POST(request({ caseId: "bank-narrative.csv", variant: "recorded" })); expect(response.status).toBe(200);
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    const result = events.find(e => e.result)?.result; expect(result.origin).toBe("RECORDED_TEST"); expect(result.inference).toBe("NOT_EXECUTED"); expect(result.verification.accepted).toHaveLength(3);
  });
});
