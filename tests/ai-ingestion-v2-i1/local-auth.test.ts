import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { localTenant } from "../../lib/server/ai-ingestion/v2-i1/local-auth";
const token = "a".repeat(64);
const request = (value = token) => new Request("http://127.0.0.1:3103/api/v2", { headers: { host: "127.0.0.1:3103", origin: "http://127.0.0.1:3103", authorization: `Bearer ${value}` } });
afterEach(() => vi.unstubAllEnvs());
describe("local synthetic capability", () => {
  it("rejects absent, incorrect and production credentials", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_V2_I1_LOCAL", "1"); vi.stubEnv("FINGENCE_V2_I1_TOKEN", token);
    expect(localTenant(request("b".repeat(64)))).toBeNull();
    expect(localTenant(request())).toMatch(/^[0-9a-f-]{36}$/);
    vi.stubEnv("VERCEL", "1"); expect(localTenant(request())).toBeNull();
  });
  it("requires an explicitly provisioned high-entropy capability", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_V2_I1_LOCAL", "1"); vi.stubEnv("FINGENCE_V2_I1_TOKEN", "abc");
    expect(localTenant(request("abc"))).toBeNull();
  });
});
