// Run against a local production build, including when local enable flags are set.
// This check never uploads a document, loads credentials or invokes a provider.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3118");
assert.equal(origin.protocol, "http:");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "Local verification only");
assert.equal(origin.pathname, "/");
const results = [];
for (const path of ["/ai-ingestion", "/ai-ingestion/live", "/ai-ingestion/developer", "/api/ai-ingestion", "/api/ai-ingestion/live", "/api/ai-ingestion/developer-replay"]) {
  for (const method of path.startsWith("/api/") ? ["GET", "POST"] : ["GET"]) {
    const response = await fetch(new URL(path, origin), { method, redirect: "error", ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}) });
    await response.arrayBuffer();
    const blocked = path.startsWith("/api/") ? [403, 404].includes(response.status) : response.status === 404;
    results.push({ path, method, status: response.status, blocked });
  }
}
const privateTraceFiles = [];
function inspect(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) inspect(path);
    else if (entry.name.endsWith(".nft.json")) {
      const trace = JSON.parse(readFileSync(path, "utf8"));
      for (const file of trace.files ?? []) {
        const parts = file.replaceAll("\\", "/").split("/");
        if (parts.some(part => [".ai-local", ".venv-ai", ".codegraph", "__pycache__", "tests", "docs"].includes(part) || part.startsWith(".env"))) privateTraceFiles.push({ trace: relative(process.cwd(), path), file });
      }
    }
  }
}
inspect(resolve(".next/server"));
console.log(JSON.stringify({ mode: "LOCAL_PRODUCTION_NO_INFERENCE", results, privateTraceFiles }, null, 2));
assert.ok(results.every(result => result.blocked), "Experimental pages/APIs must be unavailable in production");
assert.equal(privateTraceFiles.length, 0, "Production traces must exclude private AI state, environments and evaluation labels");
