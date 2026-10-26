import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractDocument } from "../../ai-ingestion/extract";
import { verifyAndExecute } from "../../ai-ingestion/verify";
import { blueprintSchema, type Stage, type StageName, type V2Result } from "../../ai-ingestion/contracts";
import { OpenAIRuleProvider, type RuleProvider } from "./provider";

const stageNames: StageName[] = ["extraction", "inference", "rule_synthesis", "verification", "financial_records"];
export async function processDocument(bytes: Uint8Array, filename: string, emit: (stage: Stage) => void = () => {}, provider?: RuleProvider): Promise<V2Result> {
  const stages: Stage[] = stageNames.map(name => ({ name, state: "PENDING", message: "Not executed" }));
  function update(name: StageName, state: Stage["state"], message: string) { const stage = { name, state, message }; stages[stageNames.indexOf(name)] = stage; emit(stage); }
  update("extraction", "RUNNING", "Reading the original file and collecting source evidence.");
  const evidence = await extractDocument(bytes, filename, process.env.FINGENCE_EXTRACTOR ?? "docling");
  const result: V2Result = { version: "v2-result-0.1", runId: crypto.randomUUID(), stages, evidence, inference: null, blueprint: null, verification: null };
  update("extraction", "COMPLETED", `${result.evidence.items.length} source evidence items extracted. This does not establish accounting accuracy.`);
  if (!provider && (!process.env.OPENAI_API_KEY || process.env.FINGENCE_AI_LIVE_APPROVED !== "1" || !process.env.OPENAI_PROJECT_ID)) {
    update("inference", "BLOCKED", "Live OpenAI inference has NOT executed. Secure project credentials and local activation are unavailable.");
    for (const name of stageNames.slice(2)) update(name, "BLOCKED", "Requires actual AI interpretation and a verified processing blueprint. No financial records accepted.");
    return result;
  }
  update("inference", "RUNNING", "Requesting a bounded AI interpretation; source content cannot authorize tools or rules.");
  let proposal;
  try { proposal = await (provider ?? new OpenAIRuleProvider()).propose(result.evidence, { bytes, format: result.evidence.format }); }
  catch {
    update("inference", "FAILED", "AI processing failed or a safety prerequisite was not satisfied. No automatic retry; any dispatched reservation remains consumed.");
    for (const name of stageNames.slice(2)) update(name, "BLOCKED", "No completed AI proposal is available.");
    return result;
  }
  result.inference = proposal.receipt;
  const mode = proposal.receipt.mode === "LIVE_OPENAI" ? "Live OpenAI inference completed" : "RECORDED TEST PROPOSAL — no live inference";
  update("inference", "COMPLETED", mode);
  const parsed = blueprintSchema.safeParse(proposal.blueprint);
  if (!parsed.success) {
    update("rule_synthesis", "FAILED", "Inference returned but did not produce a valid declarative blueprint. Usage remains recorded; no financial records are accepted.");
    update("verification", "BLOCKED", "No valid blueprint."); update("financial_records", "BLOCKED", "No verified financial records."); return result;
  }
  result.blueprint = parsed.data;
  update("rule_synthesis", "COMPLETED", `${mode}. A declarative blueprint was produced; it is not yet approved.`);
  update("verification", "RUNNING", "Checking source references, financial conventions, row coverage and permitted operations.");
  result.verification = verifyAndExecute(result.evidence, result.blueprint);
  update("verification", result.verification.decision === "VERIFIED" ? "COMPLETED" : "BLOCKED", `${result.verification.decision}: independent checks under the synthetic experimental policy.`);
  update("financial_records", result.verification.decision === "VERIFIED" ? "COMPLETED" : "BLOCKED", `${result.verification.accepted.length} accepted; ${result.verification.excluded.length} failed financial validation. Unresolved sources remain outside accepted data.`);
  return result;
}
export async function isRegisteredSynthetic(hash: string): Promise<boolean> {
  const manifest = JSON.parse(await readFile(resolve("public/samples/ai-ingestion/manifest.json"), "utf8")) as { files: Record<string, { sha256: string }> };
  return Object.values(manifest.files).some(file => file.sha256 === hash);
}
export function localAccessAllowed(request: Request): boolean {
  if (process.env.NODE_ENV === "production" || process.env.FINGENCE_AI_LOCAL !== "1" || process.env.VERCEL) return false;
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  // Next's internal request URL can be localhost while the browser uses 127.0.0.1.
  // Validate the actual Host as loopback on the same port, then require its exact origin.
  let browserOrigin: URL;
  try { browserOrigin = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`); } catch { return false; }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(browserOrigin.hostname) || browserOrigin.port !== url.port) return false;
  const origin = request.headers.get("origin");
  return (!origin || origin === browserOrigin.origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}
