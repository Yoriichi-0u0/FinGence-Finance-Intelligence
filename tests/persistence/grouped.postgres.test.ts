import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { transactionDatabase, type TransactionDatabase, type SqlConnection, type QueryResult } from "../../lib/server/db/postgres";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import { createPersistenceService } from "../../lib/server/persistence/service";
import { createPersistenceRepository } from "../../lib/server/persistence/repository";
import { syntheticResult, header } from "./fixtures";

// Never uses developer credentials or the running PostgreSQL service/data directory.
const binaries = process.env.FINGENCE_TEST_PG_BIN ?? "C:\\Program Files\\PostgreSQL\\18\\bin";
const available = existsSync(join(binaries, "initdb.exe")) && existsSync(join(binaries, "pg_ctl.exe"));
const suite = available ? describe : describe.skip;
suite("native disposable PostgreSQL: C3-B1 concurrency and production adapter", () => {
  let directory: string, port: number, pool: Pool, started = false;
  const pools: Pool[] = [];
  function makePool() {
    const result = new Pool({ host: "127.0.0.1", port, database: "postgres", user: "postgres",
      max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    result.on("error", () => {}); pools.push(result); return result;
  }
  function adapter(defaultIsolation = "READ COMMITTED", transform?: (client: PoolClient) => SqlConnection): TransactionDatabase {
    const own = makePool();
    return transactionDatabase({ end: () => own.end(), async connect() {
      const client = await own.connect();
      // Establish a real session default before the production adapter begins.
      const defaults: Record<string, string> = {
        "READ COMMITTED": "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED",
        "REPEATABLE READ": "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ",
        "SERIALIZABLE": "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      };
      await client.query(defaults[defaultIsolation]);
      const connection = transform?.(client) ?? client;
      return { query: connection.query.bind(connection), release: (destroy?: boolean) => client.release(destroy) };
    } });
  }
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "fingence-c3b1-pg-"));
    execFileSync(join(binaries, "initdb.exe"), ["-D", directory, "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"], { windowsHide: true, timeout: 30000, stdio: "pipe" });
    const reservation = createServer();
    await new Promise<void>((done, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", done); });
    port = (reservation.address() as { port: number }).port;
    await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
    // Windows server descendants can retain pipe handles after pg_ctl exits.
    // Use the log file plus ignored stdio so startup cannot wait on inherited pipes.
    started = true;
    execFileSync(join(binaries, "pg_ctl.exe"), ["-D", directory, "-l", join(directory, "test-server.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "30", "start"], { windowsHide: true, timeout: 35000, stdio: "ignore" });
    pool = makePool();
    await pool.query("CREATE ROLE anon; CREATE ROLE authenticated;");
    for (const path of ["../../supabase/sql/phase1-clean-setup.sql", "../../supabase/sql/c3b1-grouped-persistence-upgrade.sql"]) {
      await pool.query(readFileSync(new URL(path, import.meta.url), "utf8"));
    }
    expect((await pool.query("SELECT version() version")).rows[0].version).toContain("PostgreSQL");
  }, 60000);
  beforeEach(async () => {
    await pool.query("TRUNCATE public.validation_issues, public.financial_records, public.ingestion_batches, public.persistence_attempts;");
  });
  afterAll(async () => {
    await Promise.all(pools.map(value => value.end()));
    if (started && existsSync(join(directory, "postmaster.pid"))) execFileSync(join(binaries, "pg_ctl.exe"), ["-D", directory, "-m", "fast", "-w", "-t", "20", "stop"], { windowsHide: true, timeout: 25000, stdio: "ignore" });
    // Only remove the exact fresh temporary cluster created by this suite.
    if (directory) {
      const child = relative(resolve(tmpdir()), resolve(directory));
      if (child.startsWith("fingence-c3b1-pg-") && !child.includes("..") && !child.includes("\\") && !child.includes("/")) rmSync(directory, { recursive: true });
    }
  }, 30000);
  async function counts() {
    return (await pool.query("SELECT (SELECT count(*)::int FROM public.persistence_attempts) attempts, (SELECT count(*)::int FROM public.ingestion_batches) batches, (SELECT count(*)::int FROM public.financial_records) records")).rows[0];
  }
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }
  async function bounded(promise: Promise<void>) {
    let timer: ReturnType<typeof setTimeout>;
    try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synchronization timed out")), 5000); })]); }
    finally { clearTimeout(timer!); }
  }
  function pausedWriter() {
    const held = deferred(), release = deferred(); let pid = 0;
    const database = adapter("READ COMMITTED", client => ({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>> {
        const result = await client.query<Row>(sql, values);
        if (sql.startsWith("INSERT INTO public.persistence_attempts")) {
          pid = (await client.query("SELECT pg_backend_pid() pid")).rows[0].pid;
          held.resolve(); await bounded(release.promise);
        }
        return result;
      },
    }));
    return { database, held, release, pid: () => pid };
  }
  it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])("uses production adapter under session default %s", async isolation => {
    const database = adapter(isolation), service = createGroupedPersistenceService(database);
    const original = await database.transaction(async connection => (await connection.query<{ level: string }>("SHOW transaction_isolation")).rows[0]);
    expect(Object.values(original)[0]).toBe(isolation.toLowerCase());
    const id = randomUUID();
    await service.persistGroupedAttempt({ attempt_id: id, results: [await syntheticResult()] });
    expect(await service.investigateAttempt(id)).toMatchObject({ outcome: "CONFIRMED_COMMITTED" });
    expect(await service.investigateAttempt(randomUUID())).toMatchObject({ outcome: "CONFIRMED_NOT_COMMITTED" });
  });
  it("returns unresolved while an independent writer holds the real advisory lock", async () => {
    const writer = pausedWriter(), id = randomUUID();
    const persistence = createGroupedPersistenceService(writer.database).persistGroupedAttempt({ attempt_id: id, results: [await syntheticResult()] });
    const settled = persistence.then(value => ({ value }), error => ({ error }));
    try {
      await bounded(writer.held.promise);
      const observer = await pool.connect();
      try { expect((await observer.query("SELECT pg_backend_pid() pid")).rows[0].pid).not.toBe(writer.pid()); }
      finally { observer.release(); }
      expect(await createGroupedPersistenceService(adapter()).investigateAttempt(id)).toMatchObject({ outcome: "UNRESOLVED" });
    } finally { writer.release.resolve(); }
    expect(await settled).toHaveProperty("value");
    expect(await createGroupedPersistenceService(adapter()).investigateAttempt(id)).toMatchObject({ outcome: "CONFIRMED_COMMITTED" });
  });
  it("serializes two concurrent writers of the same UUID and commits exactly once", async () => {
    const writer = pausedWriter(), id = randomUUID(), results = [await syntheticResult()];
    const first = createGroupedPersistenceService(writer.database).persistGroupedAttempt({ attempt_id: id, results });
    const firstSettled = first.then(value => ({ value }), error => ({ error }));
    await bounded(writer.held.promise);
    const second = createGroupedPersistenceService(adapter()).persistGroupedAttempt({ attempt_id: id, results });
    const secondSettled = second.then(value => ({ value }), error => ({ error }));
    try {
      // Observe the second actual backend waiting for an advisory lock, not a timed guess.
      const deadline = Date.now() + 2000;
      let waiting = false;
      while (Date.now() < deadline) {
        waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND pid <> $1) waiting", [writer.pid()])).rows[0].waiting;
        if (waiting) break;
        await new Promise(done => setTimeout(done, 20));
      }
      expect(waiting).toBe(true);
    } finally { writer.release.resolve(); }
    expect(await firstSettled).toHaveProperty("value");
    expect(await secondSettled).toMatchObject({ error: { code: "IDEMPOTENCY_UNSUPPORTED" } });
    expect(await counts()).toEqual({ attempts: 1, batches: 1, records: 1 });
  });
  it("rolls back every child after a real PostgreSQL error in the second child", async () => {
    await pool.query(`CREATE FUNCTION public.fail_test_child() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.source_file='fail.csv' THEN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_test_child BEFORE INSERT ON public.ingestion_batches FOR EACH ROW EXECUTE FUNCTION public.fail_test_child();`);
    const id = randomUUID(), service = createGroupedPersistenceService(adapter());
    try {
      const second = await syntheticResult(`${header}\n2026-09-02,2026-09-03,2,R,ID,A,B,C,Synthetic,MYR`, {}, undefined, "fail.csv");
      await expect(service.persistGroupedAttempt({ attempt_id: id, results: [await syntheticResult(), second] })).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
      expect(await counts()).toEqual({ attempts: 0, batches: 0, records: 0 });
      expect(await service.investigateAttempt(id)).toMatchObject({ outcome: "CONFIRMED_NOT_COMMITTED" });
    } finally { await pool.query("DROP TRIGGER fail_test_child ON public.ingestion_batches; DROP FUNCTION public.fail_test_child();"); }
  });
  it("investigates an actual COMMIT with a deliberately lost acknowledgement without retry", async () => {
    let commits = 0, parents = 0;
    const database = adapter("SERIALIZABLE", client => ({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>> {
        const result = await client.query<Row>(sql, values);
        if (sql.startsWith("INSERT INTO public.persistence_attempts")) parents++;
        if (sql === "COMMIT") { commits++; throw new Error("lost acknowledgement"); }
        return result;
      },
    }));
    const id = randomUUID();
    await expect(createGroupedPersistenceService(database).persistGroupedAttempt({ attempt_id: id, results: [await syntheticResult()] })).rejects.toMatchObject({ code: "COMMIT_OUTCOME_UNKNOWN" });
    expect(commits).toBe(1); expect(parents).toBe(1);
    const healthy = createGroupedPersistenceService(adapter());
    expect(await healthy.investigateAttempt(id)).toMatchObject({ outcome: "CONFIRMED_COMMITTED" });
    await expect(healthy.persistGroupedAttempt({ attempt_id: id, results: [await syntheticResult()] })).rejects.toMatchObject({ code: "IDEMPOTENCY_UNSUPPORTED" });
    expect(await counts()).toEqual({ attempts: 1, batches: 1, records: 1 });
  });
  it("keeps incomplete evidence unresolved and supports legacy Phase 2 on the upgraded schema", async () => {
    const id = randomUUID();
    await pool.query("INSERT INTO public.persistence_attempts(id,dataset_count) VALUES ($1,1)", [id]);
    const database = adapter();
    expect(await createGroupedPersistenceService(database).investigateAttempt(id)).toMatchObject({ outcome: "UNRESOLVED" });
    const result = await syntheticResult(`${header}\n2026-09-01,2026-09-03,-2,,,,,,,MYRR`);
    const receipt = await createPersistenceService(createPersistenceRepository(database)).persistNewAttempt({ intent: "NEW_ATTEMPT_NO_RETRY", results: [result] });
    const row = (await pool.query("SELECT status, persistence_attempt_id, warning_count FROM public.ingestion_batches WHERE id=$1", [receipt.batch_id])).rows[0];
    expect(row).toEqual({ status: "ACTIVE", persistence_attempt_id: null, warning_count: 1 });
    expect((await pool.query("SELECT count(*)::int count FROM public.validation_issues i JOIN public.financial_records r ON r.id=i.financial_record_id WHERE r.batch_id=$1", [receipt.batch_id])).rows[0].count).toBeGreaterThan(0);
  });
});
