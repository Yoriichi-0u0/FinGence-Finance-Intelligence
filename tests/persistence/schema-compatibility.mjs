// Local only. Prints schema fingerprints, never data or connection credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = await PGlite.create();
const clean = await PGlite.create();
try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await db.exec(readFileSync(new URL("../../supabase/tests/fixtures/phase1-original-schema.sql", import.meta.url), "utf8"));
  const sql = readFileSync(new URL("./verify-hosted-compatibility.sql", import.meta.url), "utf8");
  const result = await db.query(sql);
  assert.equal(result.rows[0].columns_md5, "a78b9f65c08ca84ddde4e8c96dce2de1");
  assert.equal(result.rows[0].constraints_md5, "002dbaa7a8d14592a4f655fa879dc3c5");
  assert.equal(result.rows[0].indexes_md5, "4296f4ae5fe679a7f0fdcb17c6fbff0b");
  assert.equal(result.rows[0].triggers_md5, "5ed4a15a48cb0bd0d35ba25bb4abdde9");
  assert.equal(result.rows[0].column_count, 56);
  assert.equal(result.rows[0].trigger_count, 2);
  console.log("PASS original Phase 1 schema compatibility");
  await db.exec(readFileSync(new URL("../../supabase/sql/phase1-source-file-upgrade.sql", import.meta.url), "utf8"));
  const upgraded = (await db.query(sql)).rows[0];
  assert.equal(upgraded.column_count, 58);
  assert.equal(upgraded.source_file_column_count, 3);
  assert.equal(upgraded.trigger_count, 5);
  assert.equal(upgraded.rls_enabled, true);
  assert.equal(upgraded.client_privileges_denied, true);
  assert.equal(upgraded.indexes_md5, result.rows[0].indexes_md5);
  assert.equal(upgraded.warning_function_md5, result.rows[0].warning_function_md5);
  console.log("PASS upgraded Phase 1/2 schema compatibility");
  console.log(JSON.stringify(upgraded, null, 2));
  await clean.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await clean.exec(readFileSync(new URL("../../supabase/sql/phase1-clean-setup.sql", import.meta.url), "utf8"));
  const created = (await clean.query(sql)).rows[0];
  const { columns_md5: cleanOrder, ...cleanSemantics } = created;
  const { columns_md5: upgradeOrder, ...upgradeSemantics } = upgraded;
  assert.notEqual(cleanOrder, upgradeOrder);
  assert.deepEqual(cleanSemantics, upgradeSemantics);
  console.log("PASS clean schema compatibility: identical semantics, intentional physical column ordering");
} finally { await db.close(); await clean.close(); }
