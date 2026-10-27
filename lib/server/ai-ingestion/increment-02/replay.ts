import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { localAccessAllowed } from "../service";
import { extractSemanticEvidence } from "../../../ai-ingestion/increment-02/extract";
import { bindRecordedProposal } from "../../../ai-ingestion/increment-02/recorded";
import { verifySemanticBlueprint } from "../../../ai-ingestion/increment-02/verify";
import { createSemanticTemplate, rebindSemanticTemplate, type RebindingResult } from "../../../ai-ingestion/increment-02/reuse";
import type { SemanticBlueprint, SemanticEvidence, SemanticVerification } from "../../../ai-ingestion/increment-02/contracts";
import { replayCases, type ReplayCase } from "./cases";
export type ReplayVariant = "recorded" | "swap" | "omit" | "reuse";
export interface ReplayResult {
  version: "v2-replay-0.2"; origin: "RECORDED_TEST"; inference: "NOT_EXECUTED"; synthesis: "RECORDED_PROPOSAL_LOADED";
  case: ReplayCase; variant: ReplayVariant; evidence: SemanticEvidence | null; blueprint: SemanticBlueprint | null; verification: SemanticVerification | null;
  reuse: RebindingResult | null; error: string | null; runtimeMs: number; inputTokens: 0; outputTokens: 0; estimatedUsd: 0;
}
export function developerReplayEnabled(): boolean { return process.env.NODE_ENV === "development" && process.env.FINGENCE_AI_DEVELOPER_REPLAY === "1" && !process.env.VERCEL; }
export function developerRequestAllowed(request: Request): boolean { return developerReplayEnabled() && localAccessAllowed(request); }
export async function readSyntheticCase(id: string) {
  const test = replayCases.find(c => c.id === id); if (!test) throw new Error("Unknown recorded case.");
  const manifest = JSON.parse(await readFile(resolve("public/samples/ai-ingestion-increment-02/manifest.json"), "utf8")) as { files: Record<string, { sha256: string }> };
  const bytes = await readFile(resolve("public/samples/ai-ingestion-increment-02", test.file));
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.files[test.file]?.sha256) throw new Error("Synthetic source integrity check failed.");
  return { test, bytes };
}
export async function runRecordedReplay(id: string, variant: ReplayVariant = "recorded", templateId = "bank-narrative.csv", emit: (message: string) => void = () => {}): Promise<ReplayResult> {
  const start = performance.now(); const { test, bytes } = await readSyntheticCase(id);
  const result: ReplayResult = { version: "v2-replay-0.2", origin: "RECORDED_TEST", inference: "NOT_EXECUTED", synthesis: "RECORDED_PROPOSAL_LOADED", case: test, variant, evidence: null, blueprint: null, verification: null, reuse: null, error: null, runtimeMs: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 };
  try {
    emit("Extracting the real synthetic document. No live inference.");
    const bundle = await extractSemanticEvidence(bytes, test.file); result.evidence = bundle;
    emit("Loading hand-authored RECORDED_TEST proposal settings; this is not LLM synthesis.");
    let proposal = bindRecordedProposal(bundle, test.documentKind, test);
    if (variant === "swap") {
      const first = proposal.fields.find(f => f.role === "debit") ?? proposal.fields.find(f => f.role === "transaction_id");
      const second = proposal.fields.find(f => f.role === "credit") ?? proposal.fields.find(f => f.role === "amount");
      if (!first || !second) throw new Error("This case does not contain a valid pair for the swap test.");
      [first.target, second.target] = [second.target, first.target];
    }
    if (variant === "omit") for (const row of proposal.records) row.cells.pop();
    emit("Independently checking semantics, dispositions, source fidelity and financial conventions.");
    if (variant === "reuse") {
      const base = await readSyntheticCase(templateId); const source = await extractSemanticEvidence(base.bytes, base.test.file);
      const template = createSemanticTemplate(source, bindRecordedProposal(source, base.test.documentKind, base.test), "RECORDED_TEST");
      result.reuse = rebindSemanticTemplate(template, bundle); proposal = result.reuse.blueprint!; result.verification = result.reuse.verification;
    } else result.verification = verifySemanticBlueprint(bundle, proposal, "RECORDED_TEST");
    result.blueprint = proposal;
    emit("Recorded replay complete. Inspect accepted, rejected and unresolved outcomes separately.");
  } catch (error) { result.error = error instanceof Error && /pair|verified|template/i.test(error.message) ? error.message : "Extraction or replay prerequisites failed; no financial records accepted."; }
  result.runtimeMs = Math.round(performance.now() - start); return result;
}
