import { registerHooks } from "node:module";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
// Node's built-in loader reads the ignored local file without printing credentials.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.FINGENCE_AI_PYTHON ??= resolve(".venv-ai/bin/python");
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
const { extractPath } = await import("../lib/ai-ingestion/extract.ts");
const { BudgetLedger } = await import("../lib/ai-ingestion/budget.ts");
const { isRegisteredSynthetic, processDocument } = await import("../lib/server/ai-ingestion/service.ts");
const { createHash } = await import("node:crypto");
async function checkedBytes(path) { const bytes = readFileSync(path); if (!await isRegisteredSynthetic(createHash("sha256").update(bytes).digest("hex"))) throw new Error("Only registered synthetic fixtures are permitted."); return bytes; }
try {
  const [command = "doctor", file, mode] = process.argv.slice(2);
  if (command === "doctor") {
    console.log(JSON.stringify({ node: process.version, extractionPythonPresent: existsSync(".venv-ai/bin/python"), credentialConfigured: Boolean(process.env.OPENAI_API_KEY), liveActivated: process.env.FINGENCE_AI_LIVE_APPROVED === "1", liveInferenceExecuted: false, budget: new BudgetLedger(resolve(".ai-local")).summary() }, null, 2));
  } else if (command === "extract") {
    if (!file) throw new Error("Provide a synthetic fixture path."); await checkedBytes(file); console.log(JSON.stringify(await extractPath(file, process.env.FINGENCE_EXTRACTOR ?? "docling"), null, 2));
  } else if (command === "evaluate") {
    const files = ["statement.csv", "statement.xlsx", "statement-digital.pdf", "statement-scan.pdf", "statement-mixed.pdf", "statement.png", "statement.jpg", "ambiguous.csv", "injection.csv", "unreadable.png"];
    const results = [];
    const recorded = file === "--recorded-test";
    if (file && !recorded) throw new Error("Use evaluate or evaluate --recorded-test; test proposals are never a default.");
    if (mode) throw new Error("Unexpected option.");
    const helper = recorded ? await import("../tests/ai-ingestion/recorded-fixture-proposal.ts") : null;
    for (const name of files) {
      const bytes = await checkedBytes(`public/samples/ai-ingestion/${name}`);
      const result = await processDocument(bytes, name, () => {}, helper ? { async propose(bundle) { return { blueprint: helper.recordedFixtureProposal(bundle), receipt: { mode: "RECORDED_TEST", model: "NOT_AN_LLM", requestId: null, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, retries: 0 } }; } } : undefined);
      results.push(result);
      console.log(JSON.stringify({ file: name, format: result.evidence.format, evidence: result.evidence.items.length, inference: result.inference?.mode ?? "NOT_EXECUTED", decision: result.verification?.decision ?? "AI_UNAVAILABLE", accepted: result.verification?.accepted.length ?? 0 }));
    }
    mkdirSync(".ai-local", { recursive: true });
    writeFileSync(`.ai-local/${recorded ? "recorded-test" : "evaluation"}.json`, JSON.stringify({ notice: recorded ? "RECORDED TEST PROPOSALS - NOT LIVE AI RESULTS" : "Actual extraction; inspect each inference receipt to determine whether AI ran.", results }, null, 2));
  } else throw new Error("Use doctor, extract <file>, evaluate, or evaluate --recorded-test.");
} catch (error) { console.error(error instanceof Error ? error.message : "Local evaluation failed."); process.exitCode = 1; }
