import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { extractSemanticEvidence } from "../../lib/ai-ingestion/increment-02/extract";
import { headingRule, observedDocumentKind } from "../../lib/ai-ingestion/increment-02/registry";
import { materializePlan, policyHash } from "../../lib/ai-ingestion/increment-03/plan";
import { verifySemanticBlueprint } from "../../lib/ai-ingestion/increment-02/verify";
import { createSemanticTemplate, rebindSemanticTemplate } from "../../lib/ai-ingestion/increment-02/reuse";
beforeAll(() => {
  const python = process.platform === "win32" ? ".venv-ai/Scripts/python.exe" : ".venv-ai/bin/python";
  if (existsSync(python)) process.env.FINGENCE_AI_PYTHON ??= python;
});
// This deterministic test plan is deliberately confined to tests, never the runtime provider.
function testPlan(b: Awaited<ReturnType<typeof extractSemanticEvidence>>) {
  const kind = observedDocumentKind(b.items.filter(i => i.table === null).map(i => i.text)) ?? "TRANSACTION_TABLE";
  return { version: "v2-plan-0.3", policyVersion: "experimental-financial-terminology-0.2", policyHash, documentKind: kind, assumptions: [],
    conventions: { dateOrder: kind === "GENERAL_LEDGER" ? "DMY" : "ISO", numberFormat: "plain", dateBasis: "transaction_date", monetaryMode: kind === "GENERAL_LEDGER" ? "debit_credit" : "signed_amount" },
    fields: b.tables.flatMap(t => t.headerIds.map(id => ({ headerId: id, ruleId: headingRule(b.items.find(i => i.id === id)!.text)?.id ?? null, reason: "RECORDED_TEST deterministic test fixture, not LLM output" }))),
    context: b.items.filter(i => i.table === null && i.text.trim()).map(i => ({ evidenceId: i.id, ruleId: "context.document-label", disposition: "SUPPORTING_METADATA" })),
  };
}
describe("Independently specified held-out labels — RECORDED_TEST verifier controls", () => {
  it.skipIf(!existsSync(process.platform === "win32" ? ".venv-ai/Scripts/python.exe" : ".venv-ai/bin/python") && !process.env.FINGENCE_AI_PYTHON)("preserves all eight hashes and exact identities/outcomes across four formats, including scanned PDF/PNG/JPEG", async () => {
    const truth = JSON.parse(readFileSync("tests/fixtures/ai-ingestion-03/ground-truth.json", "utf8")).cases;
    const manifest = JSON.parse(readFileSync("public/samples/ai-ingestion-increment-03/manifest.json", "utf8")).files;
    expect(Object.keys(manifest)).toHaveLength(8); let accepted = 0, unresolved = 0;
    for (const [name, label] of Object.entries(truth) as [string, { accepted: Record<string, string>[]; unresolvedIds: string[] }][]) {
      const bytes = readFileSync(`public/samples/ai-ingestion-increment-03/${name}`);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest[name].sha256);
      const b = await extractSemanticEvidence(bytes, `opaque${name.slice(name.lastIndexOf('.'))}`);
      const r = verifySemanticBlueprint(b, materializePlan(b, testPlan(b)), "RECORDED_TEST");
      expect(r.accepted.length, name).toBe(label.accepted.length); expect(r.rejected, name).toHaveLength(0);
      const seen = new Set();
      for (const expected of label.accepted) { const row = r.accepted.find(a => a.financial.source_transaction_id === expected.source_transaction_id); expect(row?.financial, name).toMatchObject(expected); expect(seen.has(row?.id)).toBe(false); seen.add(row?.id); }
      const held = r.unresolved.map(row => b.items.filter(i => row.evidenceIds.includes(i.id)).find(i => i.column === "Transaction ID")?.text);
      expect(held.sort(), name).toEqual(label.unresolvedIds.slice().sort()); accepted += r.accepted.length; unresolved += r.unresolved.length;
    }
    expect(accepted).toBe(12); expect(unresolved).toBe(3);
  }, 180000);
  it("retains genuine origin on templates but rebinding itself performs no inference", async () => {
    const b = await extractSemanticEvidence(readFileSync("public/samples/ai-ingestion-increment-03/h01.csv"), "opaque.csv");
    const template = createSemanticTemplate(b, materializePlan(b, testPlan(b)), "LIVE_GROQ");
    const r = rebindSemanticTemplate(template, b); expect(r.origin).toBe("LIVE_GROQ"); expect(r.decision).toBe("REUSED"); expect(r.verification?.accepted).toHaveLength(2);
  });
});
