// Entirely local: no pg client, environment loading, network target or credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const original = read("./fixtures/phase1-original-schema.sql");
const upgrade = read("../sql/phase1-source-file-upgrade.sql");
const clean = read("../sql/phase1-clean-setup.sql");
const metadata = read("../../tests/persistence/verify-hosted-compatibility.sql");
const db = await PGlite.create();
const fresh = await PGlite.create();
async function rejects(sql) {
  await db.exec("BEGIN");
  try { await assert.rejects(db.exec(sql), error => error.code === "23514"); }
  finally { await db.exec("ROLLBACK"); }
}
try {
  for (const local of [db, fresh]) await local.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await db.exec(original);
  await db.exec(read("../seed.sql"));
  const before = (await db.query("SELECT source_file FROM public.financial_records ORDER BY id")).rows;
  await db.exec(upgrade);
  assert.deepEqual((await db.query("SELECT source_file FROM public.financial_records ORDER BY id")).rows, before);
  assert.deepEqual((await db.query("SELECT source_file FROM public.ingestion_batches")).rows, [{ source_file: null }]);
  assert.deepEqual((await db.query("SELECT source_file FROM public.validation_issues")).rows, [{ source_file: null }]);
  await db.exec(read("../seed.sql")); // Existing seed remains repeatable after upgrade.
  console.log("PASS historical rows preserved; new provenance NULL; original seed repeatable");
  for (const sql of [
    "UPDATE public.ingestion_batches SET source_file='invented.csv'",
    "UPDATE public.validation_issues SET source_file='disagrees.csv'",
    "UPDATE public.financial_records SET source_file='directory/file.csv'",
  ]) await rejects(sql);
  for (const value of ["", " ", ".", "..", "a/b.csv", "a\\b.csv", "a\n.csv", "a\u0085.csv", "a".repeat(256)]) {
    assert.equal((await db.query("SELECT public.is_safe_source_file($1) AS safe", [value])).rows[0].safe, false);
  }
  console.log("PASS historical mismatch and unsafe filename rejection");
  await fresh.exec(clean);
  const upgraded = (await db.query(metadata)).rows[0], created = (await fresh.query(metadata)).rows[0];
  // Physical column order differs intentionally; every other catalog fingerprint must agree.
  const { columns_md5: upgradedOrder, ...upgradedSemantics } = upgraded;
  const { columns_md5: cleanOrder, ...cleanSemantics } = created;
  assert.notEqual(cleanOrder, upgradedOrder);
  assert.deepEqual(cleanSemantics, upgradedSemantics);
  for (const table of ["ingestion_batches", "financial_records", "validation_issues"]) {
    const columns = (await fresh.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table])).rows;
    assert.equal(columns[0].column_name, "id");
    assert.equal(columns[1].column_name, "source_file");
  }
  // Preserve function bodies, constraint validation state and function privileges too.
  const details = `SELECT p.proname, regexp_replace(pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g') AS definition,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('check_record_warning_consistency','is_safe_source_file','enforce_source_file_consistency') ORDER BY p.proname`;
  assert.deepEqual((await fresh.query(details)).rows, (await db.query(details)).rows);
  assert.equal((await fresh.query("SELECT convalidated FROM pg_constraint WHERE conname='financial_records_source_file_safe'")).rows[0].convalidated, false);
  for (const value of ["", " ", ".", "..", "a/b.csv", "a\\b.csv", "a\n.csv", "a".repeat(256)]) {
    assert.equal((await fresh.query("SELECT public.is_safe_source_file($1) AS safe", [value])).rows[0].safe, false);
  }
  console.log("PASS clean physical order: id, source_file in all three tables; function bodies/grants and filename checks preserved");
  assert.equal(upgraded.column_count, 58);
  assert.equal(upgraded.index_count, 11);
  assert.equal(upgraded.trigger_count, 5);
  assert.equal(upgraded.rls_enabled, true);
  assert.equal(upgraded.client_privileges_denied, true);
  assert.equal(upgraded.policy_count, 0);
  assert.equal((await db.query("SELECT convalidated FROM pg_constraint WHERE conname='financial_records_source_file_safe'")).rows[0].convalidated, false);
  console.log("PASS clean/upgrade behavioral equivalence (physical order intentionally differs); 58 columns, 11 indexes, 5 triggers; RLS/client denial preserved");
  console.log("PASS upgraded schema verification (local only)");
} finally { await db.close(); await fresh.close(); }
