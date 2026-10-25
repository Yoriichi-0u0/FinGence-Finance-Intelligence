import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import ts from "typescript";
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
  const localEnvironment = new URL("../.env.local", import.meta.url);
  if (existsSync(localEnvironment)) loadEnvFile(fileURLToPath(localEnvironment));
  const { parseAuditLimit, assertLocalAuditTarget, readSecurityAuditLog } = await import("../lib/server/cli/security-audit.ts");
  const { createPostgresDatabase, serverPoolConfig } = await import("../lib/server/db/postgres.ts");
  const limit = parseAuditLimit(process.argv.slice(2));
  const config = serverPoolConfig();
  assertLocalAuditTarget(config);
  database = createPostgresDatabase();
  const events = await readSecurityAuditLog(database, limit, line => console.log(line));
  console.log(`Loaded ${events.length} security audit event(s) from the local database.`);
} catch (error) {
  const code = error?.code === "LOCAL_DATABASE_REQUIRED" ? "LOCAL_DATABASE_REQUIRED"
    : error?.message === "INVALID_ARGUMENTS" ? "INVALID_ARGUMENTS"
    : error?.code === "DATABASE_CONFIGURATION" ? "DATABASE_CONFIGURATION"
    : "AUDIT_LOG_UNAVAILABLE";
  const messages = {
    LOCAL_DATABASE_REQUIRED: "The audit reader is restricted to localhost. Hosted audit access needs a reviewed authenticated API.",
    INVALID_ARGUMENTS: "Use --limit=1 through --limit=200.",
    DATABASE_CONFIGURATION: "Set SUPABASE_DATABASE_URL securely for a local PostgreSQL database.",
    AUDIT_LOG_UNAVAILABLE: "The audit table is unavailable or the read failed. Apply the local audit migration and check the database status.",
  };
  console.error(`FAILED: ${code}. ${messages[code]}`);
  process.exitCode = 1;
} finally {
  try { await database?.close(); } catch {
    console.error("Database connection cleanup failed.");
    process.exitCode = 1;
  }
}