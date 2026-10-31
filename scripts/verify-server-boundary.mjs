// Verify the real package guard without constructing a pool or reading credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

for (const path of ["poc-insights/service.ts", "poc-insights/runtime.ts", "poc-reconciliation/normalize.ts", "poc-reconciliation/match.ts", "poc-reconciliation/service.ts", "poc-reconciliation/runtime.ts", "cli/database-target.ts", "cli/phase2.ts", "db/postgres.ts", "persistence/repository.ts", "persistence/service.ts", "persistence/grouped.ts", "security/authorization.ts", "security/audit.ts",
  "api/transaction-contract.ts", "api/transaction-selection.ts", "api/transaction-query.ts", "api/transaction-detail-query.ts", "api/batch-contract.ts", "api/batch-query.ts",
  "security/audit-api.ts", "security/audit-store.ts", "security/secure-cursor.ts", "security/transaction-access.ts", "security/transaction-guard.ts",
  "integration/query-cursors.ts", "integration/scoped-queries.ts", "ai-ingestion/m2/identity.ts", "ai-ingestion/m2/interpreter.ts", "ai-ingestion/m2/pipeline.ts", "ai-ingestion/m2/runtime.ts", "financial-m3/management.ts", "financial-m3/consumers.ts", "financial-m3/runtime.ts", "ai-ingestion/m4/adapter.ts", "ai-ingestion/m4/authorization.ts", "ai-ingestion/m4/evaluation.ts", "ai-ingestion/m4/runtime.ts",
  "ai-ingestion/m2/session-cookie.ts", "tenant-admin-m5/flags.ts", "tenant-admin-m5/runtime.ts", "tenant-admin-m5/schema.ts", "tenant-admin-m5/service.ts", "poc-anomalies/pdf.ts", "poc-anomalies/runtime.ts", "poc-anomalies/schema.ts", "poc-anomalies/service.ts", "poc-forecast/runtime.ts", "poc-forecast/service.ts"]) {
  assert.match(readFileSync(new URL(`../lib/server/${path}`, import.meta.url), "utf8"), /^import ["']server-only["'];/);
}
const execute = (conditions) => spawnSync(process.execPath,
  [...conditions, "--input-type=module", "-e", 'await import("server-only")'],
  { cwd: new URL("../", import.meta.url), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
const blocked = execute([]);
assert.equal(blocked.status, 1);
assert.match(blocked.stderr, /cannot be imported from a Client Component/);
const trusted = execute(["--conditions=react-server"]);
assert.equal(trusted.status, 0);
console.log("PASS server modules retain guard; default import blocked; trusted Node condition accepted");
