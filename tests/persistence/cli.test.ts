import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runPhase2File, sourceFileFromPath } from "../../lib/server/cli/phase2";
import { transactionDatabase, type QueryResult } from "../../lib/server/db/postgres";

// Only SQL transport is a double. Real file reader, Chia, Phase 2 and transaction driver run unchanged.
function harness(failure?: "INSERT" | "COMMIT" | "OBSERVATION") {
  const batches: unknown[][] = [];
  const batchId = randomUUID(), records: Record<string, unknown>[] = [], issues: unknown[][] = [], commands: string[] = [];
  const database = transactionDatabase({ end: async () => {}, connect: async () => ({ release: () => {},
    async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>> {
      commands.push(sql);
      if (sql === failure || (failure === "INSERT" && sql.startsWith("INSERT INTO public.financial_records"))) throw new Error("private transport failure");
      let rows: Record<string, unknown>[] = [], rowCount = 1;
      if (sql.startsWith("INSERT INTO public.ingestion_batches")) { batches.push(values!); rows = [{ id: batchId }]; }
      if (sql.startsWith("INSERT INTO public.financial_records")) {
        const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map(value => value.trim());
        records.push(Object.fromEntries(columns.map((column, index) => [column, values![index]])));
        rows = [{ id: randomUUID() }];
      }
      if (sql.includes("INSERT INTO public.validation_issues")) issues.push(values!);
      if (sql.includes("AS accepted")) rows = [{ accepted: records.length, valid: records.filter(row => row.ingestion_status === "VALID").length, warning: records.filter(row => row.ingestion_status === "WARNING").length, issues: issues.length }];
      if (sql.startsWith("SELECT b.status")) rows = failure === "OBSERVATION" ? [] : [{ status: "ACTIVE", accepted: records.length, issues: issues.length }];
      if (sql === "ROLLBACK") rowCount = 0;
      return { rows: rows as Row[], rowCount };
    },
  }) });
  return { database, batchId, batches, records, issues, commands };
}
it("reads the physical CSV through real Chia and Phase 2, binds accepted rows and checks committed metadata", async () => {
  const fixture = harness(), output: string[] = [];
  const initialize = vi.fn(() => {
    expect(output.at(-1)).toBe("\nPHASE 2\nValidation: PASSED\nMapping: PASSED");
    expect(fixture.commands).toHaveLength(0);
    return fixture.database;
  });
  const receipt = await runPhase2File("tests/phase2_financial_input.csv", initialize, line => output.push(line));
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(fixture.records.map(row => row.ingestion_status)).toEqual(["VALID", "WARNING"]);
  expect(fixture.records[0].source_amount).toBe("9007199254740993.123456789");
  expect(fixture.records.every(row => row.source_file === "phase2_financial_input.csv")).toBe(true);
  expect(fixture.batches[0].at(-1)).toBe("phase2_financial_input.csv");
  expect(fixture.issues[0].at(-1)).toBe("phase2_financial_input.csv");
  expect(fixture.issues).toHaveLength(1);
  expect(fixture.issues[0][1]).toBe(0);
  expect(receipt.batch_id).toBe(fixture.batchId);
  expect(output.join("\n")).toContain("REJECTED: 1");
  expect(output.join("\n")).toContain("Accepted records inserted: 2");
  expect(output.at(-1)).toBe("\nSUCCESS");
  expect(fixture.commands.filter(sql => sql === "COMMIT")).toHaveLength(2);
  expect(fixture.commands.findIndex(sql => sql === "COMMIT")).toBeLessThan(fixture.commands.findIndex(sql => sql.startsWith("SELECT b.status")));
});
it.each(["INSERT", "COMMIT", "OBSERVATION"] as const)("does not print success after %s failure or uncertainty", async failure => {
  const fixture = harness(failure), output: string[] = [];
  await expect(runPhase2File("tests/phase2_financial_input.csv", () => fixture.database, line => output.push(line))).rejects.toBeDefined();
  expect(output.join("\n")).not.toContain("SUCCESS");
  if (failure !== "OBSERVATION") expect(fixture.commands).toContain("ROLLBACK");
});
it.each(["tests/nonexistent-cli-input.csv", "package.json"])("does not initialize PostgreSQL when input reading/inspection fails: %s", async path => {
  const fixture = harness(), output: string[] = [];
  const initialize = vi.fn(() => fixture.database);
  await expect(runPhase2File(path, initialize, line => output.push(line))).rejects.toBeDefined();
  expect(initialize).not.toHaveBeenCalled();
  expect(fixture.commands).toHaveLength(0);
  expect(output.join("\n")).not.toContain("SUCCESS");
});
it.each([
  { value: undefined, code: "DATABASE_CONFIGURATION" },
  { value: "postgres://synthetic@example.invalid/disallowed", code: "LOCAL_DATABASE_REQUIRED" },
  { value: "postgres://synthetic@127.0.0.1:1/postgres?sslmode=disable", code: "DATABASE_UNAVAILABLE" },
])("runs the ordinary Node CLI and fails safely without a hosted connection %#", ({ value, code }) => {
  // Allowlist only: never inherit developer credentials, hosted consent or Node preload options.
  const env: NodeJS.ProcessEnv = { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", NODE_OPTIONS: "", NODE_ENV: "test", FINSIGHT_PHASE2_TEST_NO_ENV_FILE: "1" };
  if (value) env.SUPABASE_DATABASE_URL = value;
  const result = spawnSync(process.execPath, ["--conditions=react-server", "scripts/phase2.mjs"], { env, encoding: "utf8", timeout: 15000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(code);
  expect(result.stdout).toContain("Reading financial file: tests/phase2_financial_input.csv");
  expect(result.stdout).toContain("Rows received: 3\nVALID: 1\nWARNING: 1\nREJECTED: 1");
  expect(result.stdout).toContain("Validation: PASSED\nMapping: PASSED");
  expect(result.stdout).not.toContain("SUCCESS");
  expect(result.stderr).not.toContain("postgres://");
});

it("never calls the environment-file loader in explicitly isolated test mode", async () => {
  const modulePath = "../../scripts/phase2-environment.mjs";
  const { loadPhase2Environment } = await import(modulePath);
  const loader = vi.fn();
  loadPhase2Environment({ NODE_ENV: "test", FINSIGHT_PHASE2_TEST_NO_ENV_FILE: "1" }, loader);
  expect(loader).not.toHaveBeenCalled();
});

it("fails closed for test mode without isolation and rejects the switch outside test mode", async () => {
  const modulePath = "../../scripts/phase2-environment.mjs";
  const { loadPhase2Environment } = await import(modulePath);
  const loader = vi.fn();
  expect(() => loadPhase2Environment({ NODE_ENV: "test" }, loader)).toThrow();
  expect(() => loadPhase2Environment({ FINSIGHT_PHASE2_TEST_NO_ENV_FILE: "1" }, loader)).toThrow();
  expect(loader).not.toHaveBeenCalled();
});

it("preserves intentional developer loading through the bootstrap boundary without reading real configuration", async () => {
  const modulePath = "../../scripts/phase2-environment.mjs";
  const { loadPhase2Environment } = await import(modulePath);
  const loader = vi.fn();
  loadPhase2Environment({}, loader);
  const localFile = new URL("../../.env.local", import.meta.url);
  expect(loader).toHaveBeenCalledTimes(existsSync(localFile) ? 1 : 0);
  if (existsSync(localFile)) expect(loader.mock.calls[0][0]).toMatch(/\.env\.local$/);
});

it.each(["tests/financial.csv", "C:\\Synthetic\\financial.csv", "financial.csv"])("extracts only a basename from %s", path => {
  expect(sourceFileFromPath(path)).toBe("financial.csv");
});

it("rejects a physical basename that Chia shortens without starting persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase2-filename-"));
  const path = join(directory, `${"a".repeat(161)}.csv`);
  const initialize = vi.fn(), output: string[] = [];
  try {
    await writeFile(path, await readFile("tests/phase2_financial_input.csv"));
    await expect(runPhase2File(path, initialize, line => output.push(line))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(initialize).not.toHaveBeenCalled();
    expect(output.join("\n")).not.toContain("SUCCESS");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
