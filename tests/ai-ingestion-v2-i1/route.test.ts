import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { GET, POST } from "../../app/api/ai-ingestion/v2-i1/route";
import * as localDb from "../../lib/server/ai-ingestion/v2-i1/local-db";
import * as jobs from "../../lib/server/ai-ingestion/v2-i1/job";
import * as persistence from "../../lib/server/ai-ingestion/v2-i1/persistence";
import * as operationModule from "../../lib/server/ai-ingestion/v2-i1/operations";
const a = "a".repeat(64), b = "b".repeat(64);
function request(method: string, token: string, path = "", body?: FormData, operationId = randomUUID()) {
  return new Request(`http://127.0.0.1:3103/api/ai-ingestion/v2-i1${path}`, { method, body, headers: { host: "127.0.0.1:3103", origin: "http://127.0.0.1:3103", authorization: `Bearer ${token}`, "x-fingence-operation": operationId } });
}
function enable(token = a) { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FINGENCE_AI_LOCAL", "1"); vi.stubEnv("FINGENCE_V2_I1_LOCAL", "1"); vi.stubEnv("FINGENCE_V2_I1_TOKEN", token); vi.stubEnv("VERCEL", ""); }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await localDb.closeLocalDatabase(); });
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

it.each([
  ["PERSISTENCE_FAILED", false], ["DATABASE_UNAVAILABLE", false], ["DATABASE_CONFIGURATION", false], ["IDEMPOTENCY_UNSUPPORTED", false],
  ["INVALID_INPUT", false], ["UNSUPPORTED_VERSION", false], ["MIXED_BATCH_IDS", false], ["EMPTY_ACCEPTED_BATCH_UNSUPPORTED", false],
  ["COMMIT_OUTCOME_UNKNOWN", true], ["ROLLBACK_UNCONFIRMED", true], ["UNCLASSIFIED_FAILURE", true],
] as const)("only makes %s eligible for investigation when its outcome needs it", async (code, eligible) => {
  enable(); const id = randomUUID();
  vi.spyOn(localDb, "localDatabase").mockResolvedValue({ close: async () => {}, transaction: async () => { throw new Error("unused"); } });
  vi.spyOn(operationModule, "operations").mockReturnValue({ claim: vi.fn().mockResolvedValue(true), fail: vi.fn().mockResolvedValue(undefined) } as unknown as ReturnType<typeof operationModule.operations>);
  vi.spyOn(jobs, "runSyntheticJob").mockRejectedValue(new jobs.JobPersistenceError(id, code));
  const investigate = vi.fn().mockResolvedValue("UNRESOLVED");
  vi.spyOn(persistence, "createV2Persistence").mockReturnValue({ investigate } as unknown as ReturnType<typeof persistence.createV2Persistence>);
  const form = new FormData(); form.set("file", new File(["synthetic"], "synthetic.csv"));
  const response = await POST(request("POST", a, "", form));
  const body = await response.json();
  expect(body.code).toBe(code);
  expect(body.attemptId === id).toBe(eligible);
  expect(JSON.stringify(body)).not.toContain("sensitive internal error");
  const result = await GET(request("GET", a, `?attempt=${id}&investigate=1`));
  expect(result.status).toBe(eligible ? 200 : 404);
  expect(investigate).toHaveBeenCalledTimes(eligible ? 1 : 0);
});

it("recovers a committed operation after the POST response is lost without processing it twice", async () => {
  enable(); const id = randomUUID();
  const makeForm = () => { const form = new FormData(); form.set("file", new File([readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv")], "uploaded.csv")); return form; };
  expect((await POST(request("POST", a, "", makeForm(), id))).status).toBe(200);
  const lookup = await GET(request("GET", a, `?operation=${id}`));
  expect((await lookup.json()).outcome).toBe("CONFIRMED_COMMITTED");
  expect((await POST(request("POST", a, "", makeForm(), id))).status).toBe(409);
}, 30000);

it("survives a database restart and never processes a duplicate operation", async () => {
  enable(); const id = randomUUID();
  const form = () => { const f = new FormData(); f.set("file", new File([readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv")], "uploaded.csv")); return f; };
  expect((await POST(request("POST", a, "", form(), id))).status).toBe(200);
  await localDb.closeLocalDatabase();
  const recovered = await (await GET(request("GET", a, `?operation=${id}`))).json();
  expect(recovered.outcome).toBe("CONFIRMED_COMMITTED"); expect(recovered.batch.attemptId).toBe(id);
  expect((await POST(request("POST", a, "", form(), id))).status).toBe(409);
  const counts = await (await localDb.localDatabase()).transaction(async tx => tx.query<{ n: number }>("SELECT count(*)::integer AS n FROM fingence_v2_local.attempts WHERE id=$1", [id]));
  expect(counts.rows[0].n).toBe(1);
}, 30000);
it("fences a never-received operation and rejects a delayed submission", async () => {
  enable(); const id = randomUUID();
  expect((await (await GET(request("GET", a, `?operation=${id}`))).json()).outcome).toBe("UNRESOLVED");
  expect((await (await POST(request("POST", a, "?cancel=1", undefined, id))).json()).outcome).toBe("CONFIRMED_NOT_COMMITTED");
  const form = new FormData(); form.set("file", new File(["synthetic"], "test.csv"));
  expect((await POST(request("POST", a, "", form, id))).status).toBe(409);
});
it("does not reveal another tenant's operation or allow cancellation", async () => {
  enable(); const id = randomUUID();
  await POST(request("POST", a, "?cancel=1", undefined, id));
  vi.stubEnv("FINGENCE_V2_I1_TOKEN", b);
  expect((await (await GET(request("GET", b, `?operation=${id}`))).json()).outcome).toBe("UNRESOLVED");
  expect((await (await POST(request("POST", b, "?cancel=1", undefined, id))).json()).outcome).toBe("UNRESOLVED");
  expect((await GET(request("GET", a, `?operation=${id}`))).status).toBe(404);
});

it.each([
  ["PERSISTENCE_FAILED", false, "KNOWN_FAILURE"],
  ["COMMIT_OUTCOME_UNKNOWN", true, "CONFIRMED_NOT_COMMITTED"],
  ["ROLLBACK_UNCONFIRMED", true, "CONFIRMED_NOT_COMMITTED"],
  ["UNCLASSIFIED_FAILURE", true, "CONFIRMED_NOT_COMMITTED"],
] as const)("retains the %s classification in durable operation status", async (code, uncertain, expected) => {
  enable(); const id = randomUUID(); const tenant = randomUUID();
  const service = operationModule.operations(await localDb.localDatabase());
  expect(await service.claim(id, tenant)).toBe(true);
  await service.fail(id, tenant, code, uncertain);
  await localDb.closeLocalDatabase();
  const recovered = await operationModule.operations(await localDb.localDatabase()).lookup(id, tenant);
  expect(recovered).toMatchObject({ outcome: expected, code });
  expect(await operationModule.operations(await localDb.localDatabase()).claim(id, tenant)).toBe(false);
}, 30000);

it.each(["lost response", "truncated response"])("recovers the actual committed result after a %s without another execution", async scenario => {
  enable(); const id = randomUUID(); const form = new FormData();
  form.set("file", new File([readFileSync("public/samples/ai-ingestion-increment-02/bank-narrative.csv")], "synthetic.csv"));
  const result = await POST(request("POST", a, "", form, id)); expect(result.status).toBe(200);
  if (scenario === "truncated response") await expect(new Response("{", { status: 200 }).json()).rejects.toThrow();
  const recovered = await (await GET(request("GET", a, `?operation=${id}`))).json();
  expect(recovered.outcome).toBe("CONFIRMED_COMMITTED"); expect(recovered.batch.attemptId).toBe(id);
  const count = await (await localDb.localDatabase()).transaction(async tx => tx.query<{ n: number }>("SELECT count(*)::integer AS n FROM fingence_v2_local.attempts WHERE id=$1", [id]));
  expect(count.rows[0].n).toBe(1);
}, 30000);
it("keeps an interrupted claimed operation unresolved after database restart", async () => {
  enable(); const id = randomUUID(); const tenant = randomUUID();
  expect(await operationModule.operations(await localDb.localDatabase()).claim(id, tenant)).toBe(true);
  await localDb.closeLocalDatabase();
  const service = operationModule.operations(await localDb.localDatabase());
  expect(await service.lookup(id, tenant)).toEqual({ outcome: "UNRESOLVED" });
  expect(await service.cancelUnclaimed(id, tenant)).toEqual({ outcome: "UNRESOLVED" });
  expect(await service.claim(id, tenant)).toBe(false);
}, 30000);

it("classifies a rejected non-synthetic upload as a known pre-commit failure", async () => {
  enable(); const id = randomUUID(); const form = new FormData(); form.set("file", new File(["unregistered data"], "input.csv"));
  expect((await POST(request("POST", a, "", form, id))).status).toBe(422);
  expect(await (await GET(request("GET", a, `?operation=${id}`))).json()).toMatchObject({ outcome: "KNOWN_FAILURE", code: "PRECOMMIT_FAILURE" });
}, 30000);

it("leaves an unknown commit unresolved when the database fence is unavailable", async () => {
  const id = randomUUID(), tenant = randomUUID(); let transactions = 0;
  const database = { close: async () => {}, transaction: async (work: (tx: { query: (sql: string) => Promise<unknown> }) => Promise<unknown>) => {
    transactions++;
    return work({ query: async (sql: string) => {
      if (sql.includes("SELECT state,failure_code")) return { rows: [{ state: "UNCERTAIN", failure_code: "COMMIT_OUTCOME_UNKNOWN" }], rowCount: 1 };
      if (sql.includes("SELECT batch")) return { rows: [], rowCount: 0 };
      if (sql.includes("pg_is_in_recovery")) return { rows: [{ authoritative: true }], rowCount: 1 };
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: false }], rowCount: 1 };
      throw new Error("Unexpected operation");
    } });
  } } as unknown as Parameters<typeof operationModule.operations>[0];
  expect(await operationModule.operations(database).lookup(id, tenant)).toEqual({ outcome: "UNRESOLVED", code: "COMMIT_OUTCOME_UNKNOWN" });
  expect(transactions).toBe(3);
});
