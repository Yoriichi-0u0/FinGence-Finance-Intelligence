import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { GET, POST } from "../../app/api/ai-ingestion/v2-i1/route";
import { closeLocalDatabase } from "../../lib/server/ai-ingestion/v2-i1/local-db";
const a = "a".repeat(64), b = "b".repeat(64);
function request(method: string, token: string, path = "", body?: FormData) {
  return new Request(`http://127.0.0.1:3103/api/ai-ingestion/v2-i1${path}`, { method, body, headers: { host: "127.0.0.1:3103", origin: "http://127.0.0.1:3103", authorization: `Bearer ${token}` } });
}
function enable(token = a) { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_V2_I1_LOCAL", "1"); vi.stubEnv("FINGENCE_V2_I1_TOKEN", token); vi.stubEnv("VERCEL", ""); }
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await closeLocalDatabase(); });
describe("local V2 HTTP boundary", () => {
  it("blocks processing and retrieval on Vercel or without a valid capability", async () => {
    enable(); expect((await GET(request("GET", b))).status).toBe(404); expect((await POST(request("POST", b))).status).toBe(404);
    vi.stubEnv("VERCEL", "1"); expect((await GET(request("GET", a))).status).toBe(404); expect((await POST(request("POST", a))).status).toBe(404);
  });
  it("runs a registered synthetic source, then prevents another capability from retrieving it", async () => {
    enable(); const form = new FormData();
    form.set("file", new File([readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv")], "uploaded.csv", { type: "text/csv" }));
    const response = await POST(request("POST", a, "", form)); expect(response.status).toBe(200);
    const data = await response.json(); expect(data.mode).toBe("VERIFIED_BLUEPRINT_REUSE");
    expect(data.batch.publicationEligible).toBe(false);
    const id = data.batch.attemptId;
    expect((await GET(request("GET", a, `?attempt=${id}`))).status).toBe(200);
    vi.stubEnv("FINGENCE_V2_I1_TOKEN", b);
    expect((await GET(request("GET", b, `?attempt=${id}`))).status).toBe(404);
  }, 30000);
});
