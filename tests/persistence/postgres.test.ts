import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { types } from "pg";
import { DATABASE_LIMITS, serverPoolConfig, transactionDatabase, type CheckedOutConnection } from "../../lib/server/db/postgres";

function poolFixture(fail?: (sql: string) => unknown) {
  const query = vi.fn(async (sql: string) => {
    const error = fail?.(sql);
    if (error) throw error;
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const client: CheckedOutConnection = { query, release };
  const pool = { connect: vi.fn(async () => client), end: vi.fn(async () => {}) };
  return { pool, query, release, database: transactionDatabase(pool) };
}
describe("server PostgreSQL adapter", () => {
  it.each([{}, { SUPABASE_DATABASE_URL: "private" }, { SUPABASE_DATABASE_URL: "https://example.com/db" },
    { SUPABASE_DATABASE_URL: "postgres://u:p@example.com/db?sslmode=disable" },
    { SUPABASE_DATABASE_URL: "postgres://u:p@example.com/db?sslmode=no-verify" },
    { SUPABASE_DATABASE_URL: "postgres://u:p@example.com/db?sslrootcert=private" },
    { SUPABASE_DATABASE_URL: "postgres://u:p@example.com/db?sslmode=require&sslmode=disable" }])("rejects unsafe/missing configuration %# with safe errors", environment => {
    expect(() => serverPoolConfig(environment)).toThrow("Server database configuration is missing or invalid.");
  });
  it("enforces certificate-verified TLS, bounded settings and per-pool exact parsers", () => {
    const parser = types.getTypeParser(1700);
    const configuration = serverPoolConfig({ SUPABASE_DATABASE_URL: "postgres://synthetic:synthetic@example.com/db?sslmode=require" });
    expect(configuration.ssl).toEqual({ rejectUnauthorized: true });
    expect(configuration.max).toBe(DATABASE_LIMITS.poolSize);
    expect(configuration.connectionTimeoutMillis).toBe(DATABASE_LIMITS.connectionMs);
    expect(configuration.idleTimeoutMillis).toBe(DATABASE_LIMITS.idleMs);
    expect(configuration.types!.getTypeParser(1700)("9007199254740993.123456789")).toBe("9007199254740993.123456789");
    expect(configuration.types!.getTypeParser(1082)("2026-09-01")).toBe("2026-09-01");
    expect(types.getTypeParser(1700)).toBe(parser);
    expect(configuration).not.toHaveProperty("connectionString");
  });
  it("allows disabled TLS only for loopback development", () => {
    expect(serverPoolConfig({ SUPABASE_DATABASE_URL: "postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable" }).ssl).toBe(false);
  });
  it("uses one connection, commits after work and releases it", async () => {
    const fixture = poolFixture();
    await expect(fixture.database.transaction(async connection => { await connection.query("SELECT $1", ["synthetic"]); return "done"; })).resolves.toBe("done");
    expect(fixture.pool.connect).toHaveBeenCalledTimes(1);
    expect(fixture.query.mock.calls.map(call => call[0])).toEqual(["BEGIN", expect.stringContaining("set_config"), "SELECT $1", "COMMIT"]);
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
    await fixture.database.close();
    expect(fixture.pool.end).toHaveBeenCalledTimes(1);
  });
  it("sanitizes unavailable connection errors", async () => {
    const fixture = poolFixture();
    fixture.pool.connect.mockRejectedValueOnce(new Error("private database URL"));
    await expect(fixture.database.transaction(async () => "none")).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    expect(fixture.release).not.toHaveBeenCalled();
  });
  it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"] as const)("establishes requested %s before the first query", async isolationLevel => {
    const fixture = poolFixture();
    await fixture.database.transaction(async () => {}, { isolationLevel });
    expect(fixture.query.mock.calls.map(call => call[0])).toEqual([
      `BEGIN ISOLATION LEVEL ${isolationLevel}`, expect.stringContaining("set_config"), "COMMIT",
    ]);
  });
  it("rolls back callback errors and never returns partial success", async () => {
    const fixture = poolFixture();
    await expect(fixture.database.transaction(async () => { throw new Error("private financial values"); })).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(fixture.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("treats lost COMMIT acknowledgement as unknown even if rollback succeeds", async () => {
    const fixture = poolFixture(sql => sql === "COMMIT" ? new Error("private socket error") : undefined);
    await expect(fixture.database.transaction(async () => "would-be-success")).rejects.toMatchObject({ code: "COMMIT_OUTCOME_UNKNOWN" });
    expect(fixture.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(fixture.query.mock.calls.filter(call => call[0] === "BEGIN")).toHaveLength(1);
  });
  it("handles server-reported deferred commit failure as a definite failure", async () => {
    const fixture = poolFixture(sql => sql === "COMMIT" ? Object.assign(new Error("private"), { code: "23514" }) : undefined);
    await expect(fixture.database.transaction(async () => "none")).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(fixture.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("destroys the connection if rollback fails", async () => {
    const fixture = poolFixture(sql => sql === "ROLLBACK" ? new Error("private") : undefined);
    await expect(fixture.database.transaction(async () => { throw new Error("private"); })).rejects.toMatchObject({ code: "ROLLBACK_UNCONFIRMED" });
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("destroys the connection on BEGIN failure", async () => {
    const fixture = poolFixture(sql => sql === "BEGIN" ? new Error("private") : undefined);
    await expect(fixture.database.transaction(async () => "none")).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("preserves an acknowledged COMMIT result when releasing the connection throws", async () => {
    const fixture = poolFixture();
    const receipt = { attempt_id: "synthetic-acknowledged-attempt", accepted: 23 };
    const work = vi.fn(async () => receipt);
    fixture.release.mockImplementationOnce(() => { throw new Error("private cleanup failure"); });

    await expect(fixture.database.transaction(work)).resolves.toBe(receipt);

    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(fixture.pool.connect).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "COMMIT")).toHaveLength(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "ROLLBACK")).toHaveLength(0);
  });
  it("preserves an unknown COMMIT outcome when releasing the broken connection throws", async () => {
    const fixture = poolFixture(sql => sql === "COMMIT" ? new Error("private acknowledgement loss") : undefined);
    const work = vi.fn(async () => "unconfirmed-result");
    fixture.release.mockImplementationOnce(() => { throw new Error("private cleanup failure"); });

    await expect(fixture.database.transaction(work)).rejects.toMatchObject({ code: "COMMIT_OUTCOME_UNKNOWN" });

    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(fixture.pool.connect).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "BEGIN")).toHaveLength(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "COMMIT")).toHaveLength(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "ROLLBACK")).toHaveLength(1);
  });
  it("preserves rollback uncertainty when releasing the broken connection also throws", async () => {
    const fixture = poolFixture(sql => sql === "ROLLBACK" ? new Error("private rollback failure") : undefined);
    const work = vi.fn(async () => { throw new Error("private operation failure"); });
    fixture.release.mockImplementationOnce(() => { throw new Error("private cleanup failure"); });

    await expect(fixture.database.transaction(work)).rejects.toMatchObject({ code: "ROLLBACK_UNCONFIRMED" });

    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(fixture.pool.connect).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "BEGIN")).toHaveLength(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "COMMIT")).toHaveLength(0);
    expect(fixture.query.mock.calls.filter(call => call[0] === "ROLLBACK")).toHaveLength(1);
  });
  it("preserves definite server-reported COMMIT failure when connection release throws", async () => {
    const fixture = poolFixture(sql => sql === "COMMIT"
      ? Object.assign(new Error("private constraint failure"), { code: "23514" }) : undefined);
    const work = vi.fn(async () => "rejected-result");
    fixture.release.mockImplementationOnce(() => { throw new Error("private cleanup failure"); });

    await expect(fixture.database.transaction(work)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });

    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(fixture.pool.connect).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "BEGIN")).toHaveLength(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "COMMIT")).toHaveLength(1);
    expect(fixture.query.mock.calls.filter(call => call[0] === "ROLLBACK")).toHaveLength(1);
  });
  it("checks the whole-operation deadline and rolls back rather than committing", async () => {
    const fixture = poolFixture();
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      await expect(fixture.database.transaction(async () => { now.mockReturnValue(DATABASE_LIMITS.transactionMs); return "none"; })).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
      expect(fixture.query).toHaveBeenLastCalledWith("ROLLBACK");
    } finally { now.mockRestore(); }
  });
});
