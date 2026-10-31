import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { extractSemanticEvidence } from "../../../ai-ingestion/increment-02/extract";
import { verifySemanticBlueprint } from "../../../ai-ingestion/increment-02/verify";
import type { SemanticBlueprint, SemanticEvidence, SemanticVerification } from "../../../ai-ingestion/increment-02/contracts";
import type { Stage } from "../../../ai-ingestion/contracts";
import { materializePlan, prepareRequest, policyHash, hash, promptRevision } from "../../../ai-ingestion/increment-03/plan";
import { localAccessAllowed } from "../service";
import { GroqProvider03, OllamaProvider03, UncertainDispatchError, type Provider03, type Receipt03 } from "./providers";
import { QuotaLedger } from "./quota";
export interface Run03 {
  version: "v2-run-0.3"; runId: string; mode: "NOT_EXECUTED" | "DISPATCHED_UNKNOWN" | Receipt03["mode"]; policyHash: string; promptRevision: string;
  dispatch: { provider: "LIVE_GROQ" | "LIVE_OLLAMA"; reservationId: string } | null;
  evidence: SemanticEvidence | null; proposal: unknown; blueprint: SemanticBlueprint | null; verification: SemanticVerification | null;
  receipt: Receipt03 | null; requestTokenBound: number | null; stages: Stage[]; promptHash: string | null; error: string | null; runtimeMs: number;
}
const folders = ["public/samples/ai-ingestion", "public/samples/ai-ingestion-increment-02", "public/samples/ai-ingestion-increment-03", "synthetic/ai-ingestion-i2"];
export async function registeredSynthetic03(bytes: Uint8Array) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  for (const folder of folders) {
    const manifest = JSON.parse(await readFile(resolve(folder, "manifest.json"), "utf8")) as { files: Record<string, { sha256: string }> };
    if (Object.values(manifest.files).some(f => f.sha256 === digest)) return true;
  }
  return false;
}
export function liveEnabled03() { return process.env.NODE_ENV === "development" && process.env.FINGENCE_AI_LOCAL === "1" && process.env.FINGENCE_AI03_LOCAL === "1" && !process.env.VERCEL; }
export function liveRequestAllowed03(request: Request) { return liveEnabled03() && localAccessAllowed(request); }
export function providerStatus03() {
  const local = process.env.FINGENCE_AI03_PROVIDER === "ollama";
  return { provider: local ? "ollama" : "groq", model: local ? process.env.FINGENCE_AI03_OLLAMA_MODEL ?? null : "openai/gpt-oss-20b",
    ready: local ? process.env.FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED === "1" : Boolean(process.env.GROQ_API_KEY && process.env.FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED === "1" && process.env.FINGENCE_AI03_FREE_PLAN_CONFIRMED === "1"),
    paidUsageAuthorized: false, message: "Live inference requires separately authorized secure setup. Recorded replay never substitutes for it." };
}
export async function processLiveDocument03(bytes: Uint8Array, filename: string, emit: (stage: Stage) => void = () => {}, provider?: Provider03, signal?: AbortSignal, guided = true): Promise<Run03> {
  if (signal?.aborted) throw new Error("REQUEST_CANCELED");
  if (bytes.length > 10 * 1024 * 1024 || !(await registeredSynthetic03(bytes))) throw new Error("REGISTERED_SYNTHETIC_REQUIRED");
  const start = performance.now(); const stages: Stage[] = ["extraction", "inference", "rule_synthesis", "verification", "financial_records"].map(name => ({ name: name as Stage["name"], state: "PENDING", message: "Not executed" }));
  const r: Run03 = { version: "v2-run-0.3", runId: randomUUID(), mode: "NOT_EXECUTED", policyHash, promptRevision, dispatch: null, evidence: null, proposal: null, blueprint: null, verification: null, receipt: null, requestTokenBound: null, stages, promptHash: null, error: null, runtimeMs: 0 };
  const stage = (name: Stage["name"], state: Stage["state"], message: string) => { const s = stages.find(x => x.name === name)!; Object.assign(s, { state, message }); emit({ ...s }); };
  try {
    stage("extraction", "RUNNING", "Reading source text, tables and traceable references.");
    r.evidence = await extractSemanticEvidence(bytes, filename);
    stage("extraction", "COMPLETED", `${r.evidence.items.length} source evidence items; extraction is not accounting verification.`);
    if (signal?.aborted) throw new Error("REQUEST_CANCELED");
    const request = prepareRequest(r.evidence, guided); r.promptHash = request.promptHash; r.requestTokenBound = request.inputTokenBound + 1600;
    if (!provider && !providerStatus03().ready) {
      stage("inference", "BLOCKED", "Genuine inference has NOT executed. Secure free-plan setup/authorization is required.");
      for (const n of ["rule_synthesis", "verification", "financial_records"] as const) stage(n, "BLOCKED", "No actual model proposal. No records accepted.");
      return r;
    }
    const selected = provider ?? (providerStatus03().provider === "ollama" ? new OllamaProvider03() : new GroqProvider03(new QuotaLedger(resolve(".ai-local/increment-03"))));
    stage("inference", "RUNNING", "Requesting a rule-guided mapping plan; source values cannot be generated.");
    const output = await selected.propose(request, signal); r.receipt = output.receipt; r.mode = output.receipt.mode; r.proposal = output.plan;
    if (signal?.aborted) throw new Error("REQUEST_CANCELED");
    if (r.receipt.finishReason && r.receipt.finishReason !== "stop") throw new Error("PROVIDER_OUTPUT_INCOMPLETE");
    if (r.receipt.outputHash !== hash(output.plan)) throw new Error("OUTPUT_IDENTITY_MISMATCH");
    stage("inference", "COMPLETED", r.mode === "RECORDED_TEST" ? "RECORDED_TEST — mocked test proposal; no model accuracy measured." : `${r.mode} provider response received; not yet financially verified.`);
    stage("rule_synthesis", "RUNNING", "Binding exact fresh source cells to the proposed rules.");
    r.blueprint = materializePlan(r.evidence, r.proposal);
    stage("rule_synthesis", "COMPLETED", "Evidence-linked blueprint materialized. No financial values authored by the model.");
    stage("verification", "RUNNING", "Independent policy, evidence, coverage and financial checks.");
    r.verification = verifySemanticBlueprint(r.evidence, r.blueprint, r.receipt.mode);
    stage("verification", r.verification.decision === "VERIFIED" || r.verification.decision === "PARTIAL" ? "COMPLETED" : "BLOCKED", `${r.verification.decision}; model confidence does not authorize records.`);
    stage("financial_records", r.verification.accepted.length ? "COMPLETED" : "BLOCKED", `${r.verification.accepted.length} accepted, ${r.verification.rejected.length} rejected, ${r.verification.unresolved.length} unresolved observed rows.`);
  } catch (error) {
    if (error instanceof UncertainDispatchError) { r.mode = "DISPATCHED_UNKNOWN"; r.dispatch = { provider: error.provider, reservationId: error.reservationId }; }
    const code = error instanceof Error && /^[A-Z_]{3,70}$/.test(error.message) ? error.message : "PROCESSING_FAILED"; r.error = code;
    const running = stages.find(s => s.state === "RUNNING");
    if (running) stage(running.name, "FAILED", `${code}. No automatic retry or recorded fallback.`);
    if (r.evidence && r.receipt && !r.verification) r.verification = verifySemanticBlueprint(r.evidence, null, r.receipt.mode);
    for (const s of stages.filter(s => s.state === "PENDING")) stage(s.name, "BLOCKED", "Prerequisite not satisfied; inspect evidence and retry only after review.");
  } finally { r.runtimeMs = Math.round(performance.now() - start); }
  return r;
}
