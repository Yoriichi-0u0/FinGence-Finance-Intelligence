import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { experiment } from "../../research/reconciliation/ai04/experiment";
import { project } from "../../research/reconciliation/ai04/projection";
import { evaluate } from "../../research/reconciliation/ai04/evaluation";
import { verify } from "../../research/reconciliation/ai04/orchestrator";
import { POLICY } from "../../research/reconciliation/ai04/policy";
import type { Truth } from "../../research/reconciliation/m2/types";
import type { Proposal } from "../../research/reconciliation/ai04/types";
describe("AI04 recorded train/development evaluation (no model or held-out access)",()=>{
  it("keeps sparse unannotated suggestions separate and empty precision undefined",()=>{
    const input=project(JSON.parse(readFileSync("research/reconciliation/m2/fixtures/inputs/development.json","utf8")));
    const truth=JSON.parse(readFileSync("research/reconciliation/m2/fixtures/annotations/development.json","utf8")) as Truth;
    const proposal:Proposal={bankId:input.records.find(r=>r.role==="BANK")!.id,ledgerId:input.records.find(r=>r.role==="LEDGER")!.id,algorithm:"E0",topology:"PAIR"};
    const sparse={...truth,relationships:[],negatives:[]};
    const result=evaluate(input,sparse,[proposal],verify(input,[proposal],POLICY));
    expect(result.before.explicitFalsePositives).toBe(0);expect(result.before.unannotatedSuggestions).toBe(1);expect(result.before.precision).toBeNull();
    const empty=evaluate(input,truth,[],verify(input,[],POLICY));expect(empty.after.precision).toBeNull();expect(empty.after.suggestionCoverage).toBe(0);
  });
  it("rejects contradictory evaluation labels without changing verification",()=>{
    const input=project(JSON.parse(readFileSync("research/reconciliation/m2/fixtures/inputs/development.json","utf8")));
    const truth=JSON.parse(readFileSync("research/reconciliation/m2/fixtures/annotations/development.json","utf8")) as Truth;
    const rel=truth.relationships.find(r=>r.kind==="PAIR")!;
    truth.negatives.push({bankId:rel.bankIds[0],ledgerId:rel.ledgerIds[0],reason:"DISTINCT_EVENT"});
    expect(()=>evaluate(input,truth,[],verify(input,[],POLICY))).toThrow("Contradictory");
  });
  it("preserves baseline evidence, evaluates all eight risks and reports coverage loss",()=>{
    const evidence=experiment();
    for(const method of ["E0","E1","E2b"]){
      const rows=evidence.results.filter(r=>r.method===method);
      const total=(field:"truePositives"|"explicitFalsePositives"|"authoredAbstentionContradictions")=>rows.reduce((s,r)=>s+r.metrics.before[field],0);
      expect(total("truePositives")).toBe(method==="E0"?28:method==="E1"?32:34);
      expect(total("explicitFalsePositives")).toBe(method==="E2b"?4:0);
      expect(total("authoredAbstentionContradictions")).toBe(method==="E0"?0:4);
      expect(rows.every(r=>r.distinctFingerprints===1)).toBe(true);
    }
    const risks=evidence.results.filter(r=>r.method==="E2b").flatMap(r=>r.metrics.knownRisks);
    expect(risks).toHaveLength(8);
    expect(risks.filter(r=>r.category==="INCORRECT_COUNTERPARTY")).toHaveLength(4);
    expect(risks.filter(r=>r.category==="AUTHORED_ABSTENTION_CONTRADICTION")).toHaveLength(4);
    expect(risks.every(r=>r.decision.disposition==="UNRESOLVED_REVIEW")).toBe(true);
    for(const r of risks)expect(r.decision.reasons).toContain(r.category==="INCORRECT_COUNTERPARTY"?"COUNTERPARTY_CONFLICT":"REFERENCE_MISSING");
    expect(evidence.results.every(r=>r.metrics.after.explicitFalsePositives===0&&r.metrics.after.authoredAbstentionContradictions===0&&r.metrics.after.duplicateAssignments===0&&r.metrics.after.unmatchedRecordsSuggested===0)).toBe(true);
    expect(evidence.results.some(r=>r.metrics.after.suggestions>0)).toBe(true);
    expect(evidence.results.filter(r=>r.method==="E2b").reduce((n,r)=>n+r.metrics.correctMatchesWithheld,0)).toBeGreaterThanOrEqual(6);
    if(process.env.AI04_WRITE_EVIDENCE==="1"){
      mkdirSync("docs/reconciliation/evidence/ai04",{recursive:true});
      writeFileSync("docs/reconciliation/evidence/ai04/results.json",JSON.stringify(evidence,null,2)+"\n");
    }
  });
});
