import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadPhase2Environment } from "./phase2-environment.mjs";
// Node 24: compile existing TypeScript imports without emitting or changing source files.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return next(candidate.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText };
    return next(url, context);
  },
});
let database;
try {
  loadPhase2Environment();
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error();
  const { createPostgresDatabase, serverPoolConfig } = await import("../lib/server/db/postgres.ts");
  const { runPhase2File } = await import("../lib/server/cli/phase2.ts");
  const { assertPhase2DatabaseTarget } = await import("../lib/server/cli/database-target.ts");
  await runPhase2File(args[0] ?? "tests/phase2_financial_input.csv", () => {
    const config = serverPoolConfig();
    assertPhase2DatabaseTarget(config, process.env);
    database = createPostgresDatabase();
    return database;
  }, line => console.log(line));
} catch (error) {
  const { PersistenceError } = await import("../lib/server/persistence/contracts.ts");
  if (error instanceof PersistenceError && error.code === "DATABASE_CONFIGURATION") {
    console.error("FAILED: DATABASE_CONFIGURATION. PostgreSQL is not configured correctly; supply SUPABASE_DATABASE_URL securely. Persistence was not started.");
  } else if (error?.code === "LOCAL_DATABASE_REQUIRED") {
    console.error("FAILED: LOCAL_DATABASE_REQUIRED. Explicit FYP A authorization and a matching verified-TLS Direct target are required. Persistence was not started.");
  } else {
    console.error(`FAILED: ${error instanceof PersistenceError ? error.code : "INPUT_OR_RUNTIME_FAILURE"}. No automatic retry. If persistence began, confirm its outcome before running again.`);
  }
  process.exitCode = 1;
} finally {
  try { await database?.close(); } catch { console.error("Database disposal failed; do not infer that committed work was rolled back."); process.exitCode = 1; }
}
