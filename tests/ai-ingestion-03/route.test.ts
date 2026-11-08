import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET, POST } from "../../app/api/ai-ingestion/live/route";
afterEach(() => vi.unstubAllEnvs());
describe("New local route cannot activate recorded inference or production processing", () => {
  it("returns 404 in production even with local flags", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_AI03_LOCAL", "1");
    expect((await GET(new Request("http://localhost/api/ai-ingestion/live"))).status).toBe(404);
    expect((await POST(new Request("http://localhost/api/ai-ingestion/live", { method: "POST" }))).status).toBe(404);
  });
  it("rejects non-file/replay requests and cross-site posts before processing", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_AI03_LOCAL", "1"); vi.stubEnv("VERCEL", "");
    const cross = new Request("http://127.0.0.1:3107/api/ai-ingestion/live", { method: "POST", headers: { origin: "https://bad.example" } }); expect((await POST(cross)).status).toBe(404);
    const replay = new Request("http://127.0.0.1:3107/api/ai-ingestion/live", { method: "POST", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant: "recorded", case: "h01.csv" }) }); expect((await POST(replay)).status).toBe(400);
    const again = new Request("http://127.0.0.1:3107/api/ai-ingestion/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); expect((await POST(again)).status).toBe(400);
  });
});
