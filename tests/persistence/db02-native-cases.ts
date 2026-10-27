import { expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { SqlConnection, TransactionDatabase } from "../../lib/server/db/postgres";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import { header, syntheticResult, validRow } from "./fixtures";

export function registerDb02NativeCases(getPool: () => Pool,
  adapter: (isolation?: string, transform?: (client: PoolClient) => SqlConnection) => TransactionDatabase) {
  const observations: Record<string, unknown>[] = [];
  function record(value: Record<string, unknown>) {
    observations.push(value);
    if (process.env.DB02_EVIDENCE) writeFileSync(join(process.env.DB02_EVIDENCE, "native-observations.json"), JSON.stringify(observations, null, 2));
  }
  async function warningWithTwoIssues() {
    const pool = getPool();
    const result = await syntheticResult(`${header}\n${validRow.replace("MYR", "MYRR")}`);
    const receipt = await createGroupedPersistenceService(adapter()).persistGroupedAttempt({ attempt_id: randomUUID(), results: [result] });
    const id = (await pool.query("SELECT id FROM public.financial_records WHERE batch_id=$1", [receipt.datasets[0].batch_id])).rows[0].id;
    expect((await pool.query("SELECT count(*)::int n FROM public.validation_issues WHERE financial_record_id=$1", [id])).rows[0].n).toBe(1);
    await pool.query(`INSERT INTO public.validation_issues(financial_record_id,source_file,issue_ordinal,rule,category,severity,field,original_value,message)
      SELECT financial_record_id,source_file,999,rule,category,severity,field,original_value,message FROM public.validation_issues WHERE financial_record_id=$1`, [id]);
    const issues = (await pool.query("SELECT id FROM public.validation_issues WHERE financial_record_id=$1 ORDER BY issue_ordinal", [id])).rows.map(r => r.id);
    return { id, issues };
  }
  async function blocked(waiter: number, holder: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const row = (await getPool().query("SELECT $2::int=ANY(pg_blocking_pids($1::int)) blocked", [waiter, holder])).rows[0];
      if (row.blocked) return true;
      await new Promise(done => setTimeout(done, 10));
    }
    return false;
  }
  async function counts() {
    return (await getPool().query(`SELECT (SELECT count(*)::int FROM public.persistence_attempts) attempts,
      (SELECT count(*)::int FROM public.ingestion_batches) batches,(SELECT count(*)::int FROM public.financial_records) records,
      (SELECT count(*)::int FROM public.validation_issues) issues`)).rows[0];
  }
  const empty = { attempts: 0, batches: 0, records: 0, issues: 0 };
  function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }
  function pausedWriter() {
    const held = gate(), resume = gate();
    const database = adapter("READ COMMITTED", client => ({
      async query(sql, values) {
        const result = await client.query(sql, values);
        if (sql.startsWith("INSERT INTO public.persistence_attempts")) {
          held.resolve();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([resume.promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DB02 gate timeout")), 5000); })]); }
          finally { clearTimeout(timer); }
        }
        return result;
      },
    }));
    return { database, held, resume };
  }
  it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])("DB02 competing warning deletions %s retain evidence", async isolation => {
    const pool = getPool(), { id, issues } = await warningWithTwoIssues();
    const a = await pool.connect(), b = await pool.connect();
    let second: Promise<{ code?: string }> | undefined;
    try {
      const pa = (await a.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      const pb = (await b.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      expect(pa).not.toBe(pb);
      await a.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await b.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      // Establish both snapshots before the first transaction completes.
      await b.query("SELECT count(*) FROM public.validation_issues WHERE financial_record_id=$1", [id]);
      await a.query("DELETE FROM public.validation_issues WHERE id=$1", [issues[0]]);
      if (process.env.DB02_BASELINE === "1") {
        await b.query("DELETE FROM public.validation_issues WHERE id=$1", [issues[1]]);
        await a.query("SET CONSTRAINTS ALL IMMEDIATE");
        await b.query("SET CONSTRAINTS ALL IMMEDIATE");
        await a.query("COMMIT"); await b.query("COMMIT");
      } else {
        second = b.query("DELETE FROM public.validation_issues WHERE id=$1", [issues[1]])
          .then(() => b.query("COMMIT")).then(() => ({}), (error: { code?: string }) => ({ code: error.code }));
        expect(await blocked(pb, pa)).toBe(true);
        await a.query("COMMIT");
        expect((await second).code).toBe(isolation === "READ COMMITTED" ? "23514" : "40001");
        await b.query("ROLLBACK");
      }
      const remaining = (await pool.query("SELECT count(*)::int n FROM public.validation_issues WHERE financial_record_id=$1", [id])).rows[0].n;
      record({ case: "competing-warning-deletions", isolation, baseline: process.env.DB02_BASELINE === "1", remaining });
      expect(remaining).toBeGreaterThan(0);
    } finally {
      await a.query("ROLLBACK"); await b.query("ROLLBACK");
      await second; a.release(); b.release();
    }
  });
  it("DB02 native atomic completion retains accepted counts, warning evidence and exact money", async () => {
    const result = await syntheticResult(`${header}\n${validRow}\n${validRow.replace("MYR", "MYRR")}\n${validRow.replace("2026-09-01", "bad")}`);
    const rejected = await syntheticResult(`${header}\n${validRow.replace("2026-09-01", "bad")}`, {}, { batchId: "synthetic-empty", ingestedAt: "2026-10-03T00:00:00Z" }, "empty.csv");
    const receipt = await createGroupedPersistenceService(adapter()).persistGroupedAttempt({ attempt_id: randomUUID(), results: [result, rejected] });
    expect(await counts()).toEqual({ attempts: 1, batches: 2, records: 2, issues: 1 });
    expect(receipt.datasets.map(r => r.status)).toEqual(["ACTIVE", "COMPLETED_EMPTY"]);
    expect((await getPool().query("SELECT source_amount::text,balance,source_file,source_row_number>0 positive FROM public.financial_records LIMIT 1")).rows[0])
      .toEqual({ source_amount: "9007199254740993.123456789", balance: null, source_file: "synthetic-persistence.csv", positive: true });
    expect((await getPool().query("SELECT bool_and(completed_at>=created_at) complete FROM public.ingestion_batches")).rows[0].complete).toBe(true);
    record({ case: "atomic-mixed-and-empty", counts: await counts() });
  });
  it.each(["records", "issues"])("DB02 real halfway %s failure rolls back the complete group", async target => {
    const pool = getPool();
    const table = target === "records" ? "financial_records" : "validation_issues";
    const condition = target === "records" ? "NEW.source_row_number=3" : "true";
    await pool.query(`CREATE FUNCTION public.db02_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF ${condition} THEN RAISE EXCEPTION 'synthetic DB02 failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER db02_fail BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.db02_fail();`);
    const id = randomUUID(), service = createGroupedPersistenceService(adapter());
    try {
      const result = await syntheticResult(`${header}\n${validRow}\n${validRow.replace("MYR", "MYRR")}`);
      await expect(service.persistGroupedAttempt({ attempt_id: id, results: [result] })).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
      expect(await counts()).toEqual(empty);
      expect(await service.investigateAttempt(id)).toMatchObject({ outcome: "CONFIRMED_NOT_COMMITTED" });
      record({ case: `rollback-${target}`, counts: await counts() });
    } finally { await pool.query(`DROP TRIGGER db02_fail ON public.${table}; DROP FUNCTION public.db02_fail();`); }
  });
  it("DB02 real deferred warning check at COMMIT is a confirmed failure with no partial rows", async () => {
    let commits = 0;
    const database = adapter("READ COMMITTED", client => ({
      async query(sql, values) {
        if (sql === "COMMIT") commits++;
        const result = await client.query(sql, values);
        // Corrupt only the synthetic transaction after the writer has recounted it.
        if (sql.startsWith("UPDATE public.ingestion_batches SET status")) {
          await client.query("UPDATE public.financial_records SET ingestion_status='WARNING' WHERE batch_id=$1", [values![0]]);
        }
        return result;
      },
    }));
    const id = randomUUID();
    await expect(createGroupedPersistenceService(database).persistGroupedAttempt({ attempt_id: id, results: [await syntheticResult()] }))
      .rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(commits).toBe(1); expect(await counts()).toEqual(empty);
    expect(await createGroupedPersistenceService(adapter()).investigateAttempt(id)).toMatchObject({ outcome: "CONFIRMED_NOT_COMMITTED" });
    record({ case: "deferred-commit-rejection", commits, counts: await counts() });
  });
  it("DB02 distinct attempt IDs progress on independent connections while one writer is paused", async () => {
    const paused = pausedWriter(), results = [await syntheticResult()];
    const a = randomUUID(), b = randomUUID();
    const first = createGroupedPersistenceService(paused.database).persistGroupedAttempt({ attempt_id: a, results });
    const settled = first.then(value => ({ value }), error => ({ error }));
    try {
      await paused.held.promise;
      const second = await createGroupedPersistenceService(adapter()).persistGroupedAttempt({ attempt_id: b, results });
      expect(second.attempt_id).toBe(b);
      expect((await counts()).attempts).toBe(1); // first parent is still uncommitted
      expect(await createGroupedPersistenceService(adapter()).investigateAttempt(a)).toMatchObject({ outcome: "UNRESOLVED" });
    } finally { paused.resume.resolve(); }
    expect(await settled).toHaveProperty("value");
    expect((await counts()).attempts).toBe(2);
    record({ case: "independent-attempts", counts: await counts() });
  });
  it("DB02 duplicate grouped dataset identity and repeated committed attempt never add rows", async () => {
    const service = createGroupedPersistenceService(adapter()), result = await syntheticResult(), id = randomUUID();
    await expect(service.persistGroupedAttempt({ attempt_id: id, results: [result, result] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await counts()).toEqual(empty);
    await service.persistGroupedAttempt({ attempt_id: id, results: [result] });
    await expect(service.persistGroupedAttempt({ attempt_id: id, results: [result] })).rejects.toMatchObject({ code: "IDEMPOTENCY_UNSUPPORTED" });
    expect((await counts()).attempts).toBe(1);
  });
  it("DB02 unknown pre-COMMIT transport outcome is investigated rather than automatically retried", async () => {
    let commits = 0;
    const database = adapter("READ COMMITTED", client => ({
      async query(sql, values) {
        if (sql === "COMMIT") { commits++; throw new Error("synthetic transport loss before transmission"); }
        return client.query(sql, values);
      },
    }));
    const id = randomUUID();
    await expect(createGroupedPersistenceService(database).persistGroupedAttempt({ attempt_id: id, results: [await syntheticResult()] }))
      .rejects.toMatchObject({ code: "COMMIT_OUTCOME_UNKNOWN" });
    expect(commits).toBe(1); expect(await counts()).toEqual(empty);
    expect(await createGroupedPersistenceService(adapter()).investigateAttempt(id)).toMatchObject({ outcome: "CONFIRMED_NOT_COMMITTED" });
    record({ case: "unknown-before-commit", commits, investigation: "CONFIRMED_NOT_COMMITTED" });
  });
  it("DB02 terminated native connection yields unconfirmed rollback then safe primary investigation", async () => {
    let terminated = 0;
    const database = adapter("READ COMMITTED", client => {
      // Fault injection deliberately terminates an otherwise idle checked-out backend.
      client.on("error", () => {});
      return {
      async query(sql, values) {
        const result = await client.query(sql, values);
        if (sql.startsWith("INSERT INTO public.persistence_attempts")) {
          const pid = (await client.query("SELECT pg_backend_pid() pid")).rows[0].pid;
          await getPool().query("SELECT pg_terminate_backend($1)", [pid]); terminated++;
          throw new Error("synthetic disconnected transaction");
        }
        return result;
      },
      };
    });
    const id = randomUUID();
    await expect(createGroupedPersistenceService(database).persistGroupedAttempt({ attempt_id: id, results: [await syntheticResult()] }))
      .rejects.toMatchObject({ code: "ROLLBACK_UNCONFIRMED" });
    expect(terminated).toBe(1);
    const healthy = createGroupedPersistenceService(adapter());
    expect(await healthy.investigateAttempt(id)).toMatchObject({ outcome: "CONFIRMED_NOT_COMMITTED" });
    await healthy.persistGroupedAttempt({ attempt_id: randomUUID(), results: [await syntheticResult()] });
    expect((await counts()).attempts).toBe(1);
    record({ case: "backend-termination", investigation: "CONFIRMED_NOT_COMMITTED", healthySubsequentWrite: true });
  });
  it("DB02 competing PROCESSING completion updates use the established compare-and-set predicate", async () => {
    const pool = getPool(), id = randomUUID();
    await pool.query("INSERT INTO public.ingestion_batches(id,ingestion_batch_id,schema_version,ruleset_version) VALUES($1,'synthetic-cas','0.1','0.1')", [id]);
    const a = await pool.connect(), b = await pool.connect();
    let second: Promise<{ rowCount: number | null }> | undefined;
    try {
      await a.query("BEGIN"); await b.query("BEGIN");
      const pa = (await a.query("SELECT pg_backend_pid() pid")).rows[0].pid, pb = (await b.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      const sql = "UPDATE public.ingestion_batches SET status='ACTIVE',completed_at=clock_timestamp() WHERE id=$1 AND status='PROCESSING'";
      expect((await a.query(sql, [id])).rowCount).toBe(1);
      second = b.query(sql, [id]);
      expect(await blocked(pb, pa)).toBe(true);
      await a.query("COMMIT"); expect((await second).rowCount).toBe(0); await b.query("COMMIT");
      record({ case: "completion-CAS", winners: 1, losingRowCount: 0 });
    } finally { await a.query("ROLLBACK"); await b.query("ROLLBACK"); await second; a.release(); b.release(); }
  });
  it("DB02 existing-data and alternate migration path preserve financial values, grants and constraints", async () => {
    // This database is created inside the suite's fresh cluster; never use a supplied database URL.
    const name = "db02_legacy_" + randomUUID().replaceAll("-", "");
    const pool = getPool(); await pool.query(`CREATE DATABASE ${name}`);
    const legacy = new Pool({ ...pool.options, database: name });
    try {
      for (const file of ["../../supabase/tests/fixtures/phase1-original-schema.sql", "../../supabase/sql/phase1-source-file-upgrade.sql", "../../supabase/sql/c3b1-grouped-persistence-upgrade.sql"]) {
        await legacy.query(readFileSync(new URL(file, import.meta.url), "utf8"));
      }
      const service = createGroupedPersistenceService((await import("../../lib/server/db/postgres")).transactionDatabase(legacy));
      const receipt = await service.persistGroupedAttempt({ attempt_id: randomUUID(), results: [await syntheticResult(`${header}\n${validRow.replace("MYR", "MYRR")}`)] });
      const before = (await legacy.query("SELECT row_to_json(r) row FROM public.financial_records r")).rows;
      await legacy.query(readFileSync(new URL("../../supabase/sql/db02-001-warning-mutation-fence.sql", import.meta.url), "utf8"));
      expect((await legacy.query("SELECT row_to_json(r) row FROM public.financial_records r")).rows).toEqual(before);
      await legacy.query("UPDATE public.validation_issues SET message='Synthetic edited warning'");
      expect((await legacy.query("SELECT row_to_json(r) row FROM public.financial_records r")).rows).toEqual(before);
      expect(await service.investigateAttempt(receipt.attempt_id)).toMatchObject({ outcome: "CONFIRMED_COMMITTED" });
      expect((await legacy.query("SELECT has_function_privilege('anon','public.serialize_warning_issue_mutation()','EXECUTE') allowed")).rows[0].allowed).toBe(false);
      expect((await legacy.query("SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('ingestion_batches','financial_records','validation_issues','persistence_attempts') AND relrowsecurity")).rows[0].n).toBe(4);
      record({ case: "alternate-migration-and-existing-data", unchangedRows: before.length, rlsTables: 4, anonFunctionExecute: false });
    } finally { await legacy.end(); await pool.query(`DROP DATABASE ${name}`); }
  });
  it("DB02 focused warning-heavy grouped insertion records fence overhead without regenerating DB01", async () => {
    const pool = getPool(), service = createGroupedPersistenceService(adapter());
    const result = await syntheticResult(`${header}\n` + Array.from({ length: 100 }, (_, n) =>
      validRow.replace("00017", `R${n}`).replace("MYR", n % 5 === 0 ? "MYRR" : "MYR")).join("\n"));
    const measurements: Record<string, unknown>[] = [];
    try {
      for (const enabled of [false, true]) {
        await pool.query(`ALTER TABLE public.validation_issues ${enabled ? "ENABLE" : "DISABLE"} TRIGGER issue_00_warning_mutation_fence`);
        const samples: number[] = [];
        for (let n = 0; n < 23; n++) {
          const start = performance.now();
          await service.persistGroupedAttempt({ attempt_id: randomUUID(), results: [result] });
          const elapsed = performance.now() - start;
          if (n >= 3) samples.push(elapsed);
          await pool.query("TRUNCATE public.validation_issues,public.financial_records,public.ingestion_batches,public.persistence_attempts");
        }
        const sorted = [...samples].sort((a, b) => a - b);
        measurements.push({ fenceEnabled: enabled, records: 100, warnings: 20, medianMs: (sorted[9] + sorted[10]) / 2, p95Ms: sorted[18], samplesMs: samples });
      }
    } finally { await pool.query("ALTER TABLE public.validation_issues ENABLE TRIGGER issue_00_warning_mutation_fence"); }
    record({ case: "focused-warning-write-overhead", measurements, note: "One local fixed-order comparison, not a capacity forecast or causal overhead estimate" });
  }, 30000);
  it("DB02 native lifecycle matrix and count audit distinguish SQL permission from writer guarantees", async () => {
    const pool = getPool(), statuses = ["PROCESSING", "ACTIVE", "SUPERSEDED", "FAILED", "COMPLETED_EMPTY"];
    let permitted = 0;
    for (const from of statuses) for (const to of statuses) {
      const id = randomUUID();
      await pool.query("INSERT INTO public.ingestion_batches(id,ingestion_batch_id,schema_version,ruleset_version,status,completed_at) VALUES($1,'synthetic-matrix','0.1','0.1',$2,clock_timestamp())", [id, from]);
      expect((await pool.query("UPDATE public.ingestion_batches SET status=$2 WHERE id=$1", [id, to])).rowCount).toBe(1);
      permitted++;
    }
    const auditSql = readFileSync(new URL("../../docs/database/db02/integrity-audit.sql", import.meta.url), "utf8");
    expect((await pool.query(auditSql)).rows.every(r => r.violations === 0)).toBe(true);
    const receipt = await createGroupedPersistenceService(adapter()).persistGroupedAttempt({ attempt_id: randomUUID(), results: [await syntheticResult()] });
    await pool.query("UPDATE public.ingestion_batches SET rows_received=2,valid_count=2 WHERE id=$1", [receipt.datasets[0].batch_id]);
    await pool.query("UPDATE public.persistence_attempts SET dataset_count=2 WHERE id=$1", [receipt.attempt_id]);
    const audit = (await pool.query(auditSql)).rows;
    expect(audit.find(r => r.invariant === "batch_child_count_mismatch").violations).toBe(1);
    expect(audit.find(r => r.invariant === "attempt_child_count_mismatch").violations).toBe(1);
    record({ case: "lifecycle-and-count-contract", permittedSqlTransitions: permitted, warning: "SQL permission is not an approved business transition", audit });
  });
  it("DB02 native constraints reject invalid financial values and preserve coherent issue reassignment", async () => {
    const pool = getPool();
    const receipt = await createGroupedPersistenceService(adapter()).persistGroupedAttempt({ attempt_id: randomUUID(), results: [await syntheticResult(`${header}\n${validRow}\n${validRow.replace("MYR", "MYRR")}`)] });
    const rows = (await pool.query("SELECT id,ingestion_status FROM public.financial_records WHERE batch_id=$1", [receipt.datasets[0].batch_id])).rows;
    const valid = rows.find(r => r.ingestion_status === "VALID")!.id, warning = rows.find(r => r.ingestion_status === "WARNING")!.id;
    for (const clause of ["ingestion_status='REJECTED'", "source_amount='NaN'::numeric", "canonical_date=canonical_date+1", "monetary_basis='debit_credit'", "currency_basis=NULL", "source_row_number=0", "file_sha256='bad'"]) {
      await expect(pool.query(`UPDATE public.financial_records SET ${clause} WHERE id=$1`, [valid])).rejects.toMatchObject({ code: "23514" });
    }
    await expect(pool.query("DELETE FROM public.financial_records WHERE id=$1", [warning])).rejects.toMatchObject({ code: "23001" });
    await expect(pool.query("UPDATE public.validation_issues SET financial_record_id=$1", [valid])).rejects.toMatchObject({ code: "23514" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("UPDATE public.financial_records SET ingestion_status='VALID' WHERE id=$1", [warning]);
      await c.query("UPDATE public.financial_records SET ingestion_status='WARNING' WHERE id=$1", [valid]);
      await c.query("UPDATE public.validation_issues SET financial_record_id=$1 WHERE financial_record_id=$2", [valid, warning]);
      await c.query("COMMIT");
      expect((await pool.query("SELECT financial_record_id FROM public.validation_issues")).rows[0].financial_record_id).toBe(valid);
    } finally { await c.query("ROLLBACK"); c.release(); }
    record({ case: "native-financial-checks-and-reassignment", rejectedMutations: 9, coherentReassignment: true });
  });
  it("DB02 record-status update and a competing issue insert cannot commit inconsistent evidence", async () => {
    const pool = getPool(), { id } = await warningWithTwoIssues();
    const issue = (await pool.query("SELECT source_file FROM public.validation_issues WHERE financial_record_id=$1 LIMIT 1", [id])).rows[0];
    const a = await pool.connect(), b = await pool.connect();
    let other: Promise<{ code?: string }> | undefined;
    try {
      await a.query("BEGIN"); await b.query("BEGIN");
      const pa = (await a.query("SELECT pg_backend_pid() pid")).rows[0].pid, pb = (await b.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      await a.query("DELETE FROM public.validation_issues WHERE financial_record_id=$1", [id]);
      await a.query("UPDATE public.financial_records SET ingestion_status='VALID' WHERE id=$1", [id]);
      other = b.query(`INSERT INTO public.validation_issues(financial_record_id,source_file,issue_ordinal,rule,category,severity,field,original_value,message)
        VALUES($1,$2,1000,'SYNTHETIC','technical','WARNING','reference','null','Synthetic warning')`, [id, issue.source_file])
        .then(() => b.query("COMMIT")).then(() => ({}), (error: { code?: string }) => ({ code: error.code }));
      expect(await blocked(pb, pa)).toBe(true);
      await a.query("COMMIT");
      expect((await other).code).toBe("23514");
      await b.query("ROLLBACK");
      expect((await pool.query("SELECT count(*)::int n FROM public.validation_issues WHERE financial_record_id=$1", [id])).rows[0].n).toBe(0);
      expect((await pool.query("SELECT ingestion_status FROM public.financial_records WHERE id=$1", [id])).rows[0].ingestion_status).toBe("VALID");
      record({ case: "record-status-versus-issue-insert", blocked: true, competingCommit: "23514", finalStatus: "VALID", issues: 0 });
    } finally { await a.query("ROLLBACK"); await b.query("ROLLBACK"); await other; a.release(); b.release(); }
  });
}
