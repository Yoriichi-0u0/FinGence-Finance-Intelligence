import { z } from "zod";
import { POLICY_VERSION, fieldSchema, semanticBlueprintSchema, documentKinds, type SemanticBlueprint, type SemanticEvidence, type SemanticVerification, type SemanticOrigin } from "./contracts";
import { bindRecordedProposal } from "./recorded";
import { verifySemanticBlueprint } from "./verify";
const templateSchema = z.strictObject({ version: z.literal("v2-template-0.2"), policyVersion: z.literal(POLICY_VERSION), origin: z.enum(["RECORDED_TEST", "LIVE_OPENAI", "LIVE_GROQ", "LIVE_OLLAMA"]), documentKind: z.enum(documentKinds), conventions: semanticBlueprintSchema.shape.conventions,
  selectors: z.array(fieldSchema.pick({ role: true, target: true, disposition: true, ruleId: true })).min(1).max(64) });
export type SemanticTemplate = z.infer<typeof templateSchema>;
export function createSemanticTemplate(bundle: SemanticEvidence, proposal: SemanticBlueprint, origin: SemanticOrigin): SemanticTemplate {
  const r = verifySemanticBlueprint(bundle, proposal, origin);
  if (r.decision !== "VERIFIED" || !r.accepted.length) throw new Error("Only fully verified proposals can become templates.");
  const selectors = proposal.fields.map(({ role, target, disposition, ruleId }) => ({ role, target, disposition, ruleId }));
  if (new Set(selectors.map(s => s.ruleId)).size !== selectors.length) throw new Error("Ambiguous repeated semantic selectors require interpretation.");
  return templateSchema.parse({ version: "v2-template-0.2", policyVersion: POLICY_VERSION, origin, documentKind: proposal.documentKind, conventions: proposal.conventions, selectors });
}
export interface RebindingResult { decision: "REUSED" | "REINTERPRETATION_REQUIRED"; origin: SemanticOrigin; reasons: string[]; blueprint: SemanticBlueprint | null; verification: SemanticVerification | null }
export function rebindSemanticTemplate(input: unknown, bundle: SemanticEvidence): RebindingResult {
  const template = templateSchema.parse(input);
  // Deterministic selector binding shares the explicit recorded-test binder; it
  // generates no inference and carries the ORIGINAL template origin separately.
  const p = bindRecordedProposal(bundle, template.documentKind, template.conventions);
  for (const f of p.fields) f.reason = "Rebound semantic selector; full independent verification required.";
  const same = (a: typeof template.selectors[number], b: typeof p.fields[number]) => a.ruleId === b.ruleId && a.role === b.role && a.target === b.target && a.disposition === b.disposition;
  const structural = template.selectors.every(s => p.fields.filter(f => same(s, f)).length === 1) && p.fields.every(f => template.selectors.some(s => same(s, f)) || ["SUPPORTING_METADATA", "NONFINANCIAL_NARRATIVE"].includes(f.disposition));
  const verification = verifySemanticBlueprint(bundle, p, template.origin);
  return { decision: structural && verification.decision === "VERIFIED" ? "REUSED" : "REINTERPRETATION_REQUIRED", origin: template.origin, reasons: structural ? verification.checks.filter(c => !c.passed).map(c => c.code).concat(verification.unresolved.flatMap(r => r.reasons)) : ["SOURCE_STRUCTURE_CHANGED"], blueprint: p, verification: structural ? verification : { ...verification, accepted: [], decision: "NEEDS_REVIEW", unresolved: [...verification.unresolved, ...verification.accepted.map(r => ({ id: r.id, evidenceIds: r.evidenceIds, reasons: ["SOURCE_STRUCTURE_CHANGED"] }))], coverage: { ...verification.coverage, accepted: 0, unresolved: verification.unresolved.length + verification.accepted.length } } };
}
