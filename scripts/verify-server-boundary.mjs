// Verify the real package guard without constructing a pool or reading credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

for (const path of ["cli/database-target.ts", "cli/phase2.ts", "db/postgres.ts", "persistence/repository.ts", "persistence/service.ts", "persistence/grouped.ts", "security/authorization.ts", "security/audit.ts"]) {
  assert.match(readFileSync(new URL(`../lib/server/${path}`, import.meta.url), "utf8"), /^import "server-only";/);
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
