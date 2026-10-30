// Run against a local production build, including when local enable flags are set.
// This check never uploads a document, loads credentials or invokes a provider.
// Optional FINGENCE_ISOLATION_SENTINELS is a JSON array of nonsecret build-canary strings.
// --artifacts-only checks the existing build without making HTTP requests.
import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const artifactsOnly = process.argv[2] === "--artifacts-only";
const results = [];
if (!artifactsOnly) {
  const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3118");
  assert.equal(origin.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "Local verification only");
  assert.equal(origin.pathname, "/");
  for (const path of ["/ai-ingestion", "/ai-ingestion/live", "/ai-ingestion/developer", "/ai-ingestion/v2-i1", "/ai-ingestion/synthetic-financial", "/api/ai-ingestion", "/api/ai-ingestion/live", "/api/ai-ingestion/developer-replay", "/api/ai-ingestion/v2-i1", "/api/ai-ingestion/synthetic-financial", "/api/ai-ingestion/m2"]) {
    for (const method of path.startsWith("/api/") ? ["GET", "POST"] : ["GET"]) {
      const response = await fetch(new URL(path, origin), { method, redirect: "error", ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}) });
      await response.arrayBuffer();
      const blocked = path.startsWith("/api/") ? [403, 404].includes(response.status) : response.status === 404;
      results.push({ path, method, status: response.status, blocked });
    }
  }
  for (const [path, method] of [["/api/ai-ingestion/v2-i1?operation=11111111-1111-4111-8111-111111111111", "GET"], ["/api/ai-ingestion/v2-i1?cancel=1", "POST"], ["/api/ai-ingestion/synthetic-financial?action=session", "GET"], ["/api/ai-ingestion/synthetic-financial?action=events", "GET"], ["/api/ai-ingestion/synthetic-financial?action=login", "POST"], ["/api/ai-ingestion/synthetic-financial?action=logout", "POST"], ["/api/ai-ingestion/synthetic-financial?action=retire", "POST"]]) {
    const response = await fetch(new URL(path, origin), { method, redirect: "error", headers: { "X-FinGence-Operation": "11111111-1111-4111-8111-111111111111" } });
    await response.arrayBuffer();
    results.push({ path, method, status: response.status, blocked: [403, 404].includes(response.status) });
  }
}
if (!artifactsOnly) {
  const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3118");
  for (const action of ["session", "reference", "login", "logout", "reserve", "process", "cancel", "investigate", "question"]) {
    const method = ["session", "reference"].includes(action) ? "GET" : "POST";
    const path = `/api/ai-ingestion/m2?action=${action}`;
    const response = await fetch(new URL(path, origin), {method});
    await response.arrayBuffer();
    results.push({path, method, status: response.status, blocked: [403,404].includes(response.status)});
  }
}
const sentinels = JSON.parse(process.env.FINGENCE_ISOLATION_SENTINELS ?? "[]");
assert.ok(Array.isArray(sentinels) && sentinels.every(value => typeof value === "string" && value.length >= 16), "Use only nonsecret canary strings of at least 16 characters");
const privateTraceFiles = [], artifactLeaks = [];
let tracesInspected = 0, additionalRootsInspected = 0, artifactsInspected = 0;
function privatePath(path) {
  return path.replaceAll("\\", "/").split("/").some(part =>
    [".local", ".ai-local", ".venv-ai", ".codegraph", "__pycache__", "tests", "docs"].includes(part) || part.startsWith(".env"));
}
function checkPath(trace, file, base = dirname(trace)) {
  if (privatePath(file) || privatePath(resolve(base, file))) privateTraceFiles.push({ trace: relative(process.cwd(), trace), file });
}
function inspectTrace(path) {
  const trace = JSON.parse(readFileSync(path, "utf8"));
  function inspectRoot(root, base) {
    assert.ok(Array.isArray(root.files), `Missing trace files: ${relative(process.cwd(), path)}`);
    for (const file of root.files) checkPath(path, file, base);
    const targets = Array.isArray(root.symlinks) ? root.symlinks.map(([, target]) => target) : Object.values(root.symlinks ?? {});
    for (const target of targets) checkPath(path, target, base);
  }
  tracesInspected++;
  inspectRoot(trace, dirname(path));
  for (const root of trace.additionalRoots ?? []) {
    additionalRootsInspected++;
    checkPath(path, root.path);
    inspectRoot(root, resolve(dirname(path), root.path));
  }
}
function inspectArtifact(path) {
  artifactsInspected++;
  const bytes = readFileSync(path);
  for (const [index, sentinel] of sentinels.entries()) {
    if (bytes.includes(Buffer.from(sentinel))) artifactLeaks.push({ artifact: relative(process.cwd(), path), sentinelIndex: index });
  }
  if (path.endsWith(".nft.json")) inspectTrace(path);
}
function inspect(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink()) {
      // Inspect the deployment link without following it into private source directories.
      checkPath(path, path);
      assert.ok(!lstatSync(path).isSymbolicLink(), `Unexpected artifact symlink: ${relative(process.cwd(), path)}`);
    } else if (entry.isDirectory()) inspect(path);
    else if (entry.isFile()) inspectArtifact(path);
  }
}
inspect(resolve(".next/server"));
inspect(resolve(".next/static"));
for (const entry of readdirSync(".next", { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".json")) inspectArtifact(join(".next", entry.name));
}
const requiredPath = resolve(".next/required-server-files.json");
for (const file of JSON.parse(readFileSync(requiredPath, "utf8")).files) checkPath(requiredPath, file, process.cwd());
console.log(JSON.stringify({ mode: artifactsOnly ? "PRODUCTION_ARTIFACTS_ONLY" : "LOCAL_PRODUCTION_NO_INFERENCE", results,
  tracesInspected, additionalRootsInspected, artifactsInspected, sentinelsChecked: sentinels.length, privateTraceFiles, artifactLeaks }, null, 2));
assert.ok(artifactsOnly || results.length === 33 && results.every(result => result.blocked), "Experimental pages/APIs must be unavailable in production");
assert.ok(tracesInspected > 0 && artifactsInspected > 0, "A production build is required");
assert.equal(privateTraceFiles.length, 0, "Production traces must exclude private AI state, environments and evaluation labels");
assert.equal(artifactLeaks.length, 0, "Private build canaries must not enter deployable artifacts");
