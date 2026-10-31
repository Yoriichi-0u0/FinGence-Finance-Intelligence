import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate, latency } from "../../research/reconciliation/ai02/evaluator";
import { experiment } from "../../research/reconciliation/ai02/experiment";
import { runBaseline } from "../../research/reconciliation/ai02/run";
import { EXACT_CONFIG } from "../../research/reconciliation/ai02/types";
import type { Truth } from "../../research/reconciliation/m2/types";
import { input, row, frozen } from "./ai02-fixtures";
const truth = (): Truth => ({ version: "ai01-m2/1.1.0", seed: "unit", split: "train", relationships: [], negatives: [], unmatched: [], ambiguous: [], outcomes: [], cases: [] });
describe("AI02 evaluator and development protocol", () => {
  it("reports undefined denominators as null", () => {
    const i = input(), metrics = evaluate(i, truth(), runBaseline(i,"E0",EXACT_CONFIG));
    expect(metrics.matching.precision).toBeNull(); expect(metrics.matching.recall).toBeNull(); expect(metrics.matching.f1).toBeNull(); expect(metrics.operational.unresolvedRatio).toBeNull();
  });
  it("separates economic positives, sparse explicit negatives and unannotated suggestions", () => {
    const i = input(row("b","BANK"),row("l","LEDGER")), run = runBaseline(i,"E0",EXACT_CONFIG), t = truth();
    expect(evaluate(i,t,run).matching.unannotatedSuggestions).toBe(1); expect(evaluate(i,t,run).matching.precision).toBeNull();
    t.negatives.push({bankId:"b",ledgerId:"l",reason:"DISTINCT_EVENT"});
    expect(evaluate(i,t,run).matching.explicitFalsePositives).toBe(1); expect(evaluate(i,t,run).matching.precision).toBe(0);
    t.negatives=[];t.relationships.push({id:"rel",economicId:"event",family:"A",kind:"PAIR",bankIds:["b"],ledgerIds:["l"],remainingAmount:null});t.outcomes.push({subjectId:"rel",decision:"ABSTAIN_INSUFFICIENT"});
    const m=evaluate(i,t,run);expect(m.matching.truePositives).toBe(1);expect(m.matching.f1).toBe(1);expect(m.operational.trueSuggestionsAgainstAuthoredAbstention).toBe(1);
  });
  it("does not flatten group truth into one-to-one positives", () => {
    const i=input(row("b","BANK"),row("l","LEDGER")),t=truth();t.relationships.push({id:"group",economicId:"e",family:"T",kind:"GROUP",bankIds:["b"],ledgerIds:["l"],remainingAmount:null});
    const m=evaluate(i,t,runBaseline(i,"E0",EXACT_CONFIG));expect(m.denominators.genuinePairs).toBe(0);expect(m.operational.groupAssociatedSuggestions).toBe(1);
  });
  it("uses pessimistic tie ranks rather than ID-dependent recall at K", () => {
    const i=input(row("b","BANK"),row("a","LEDGER"),row("z","LEDGER")),t=truth();
    t.relationships.push({id:"r",economicId:"e",family:"A",kind:"PAIR",bankIds:["b"],ledgerIds:["a"],remainingAmount:null});
    const m=evaluate(i,t,runBaseline(i,"E0",EXACT_CONFIG));expect(m.retrieval.candidateGenerationRecall).toBe(1);expect(m.retrieval.recallAt1).toBe(0);expect(m.retrieval.recallAt3).toBe(1);expect(m.matching.falseNegatives).toBe(1);
  });
  it("counts duplicate assignments and invalid candidate edges in an external run", () => {
    const i=input(row("b","BANK"),row("l","LEDGER")),r=runBaseline(i,"E0",EXACT_CONFIG);r.suggestions.push({...r.suggestions[0]});r.candidates[0].ledgerId="absent";
    const m=evaluate(i,truth(),r);expect(m.operational.duplicateAssignmentConflicts).toBe(2);expect(m.operational.invalidCandidates).toBe(1);
  });
  it("isolates held-out truth and does not import labels into the matching core", () => {
    const i=input(),t=truth();t.split="heldout";expect(()=>evaluate(i,t,runBaseline(i,"E0",EXACT_CONFIG))).toThrow();
    expect(()=>frozen("heldout" as never)).toThrow();
    for(const file of ["types","scoring","candidates","exact","fuzzy","abstention","run"]){
      const source=readFileSync(new URL(`../../research/reconciliation/ai02/${file}.ts`,import.meta.url),"utf8");
      expect(source).not.toMatch(/from ["'][^"']*(annotations|generator|ground-truth|evaluator|access|fixtures)/);expect(source).not.toContain("readFile");
    }
  });
  it("computes nearest-rank sample latency without inventing results", () => {
    expect(latency([4,1,3,2]).p50Ms).toBe(2);expect(latency([4,1,3,2]).p95Ms).toBe(4);expect(()=>latency([])).toThrow();
  });
  it("selects configuration on development only and replays deterministic training/development runs", () => {
    const train=frozen("train"),dev=frozen("development");const result=experiment(train.input,dev.input,train.truth,dev.truth);
    expect(result.grid).toHaveLength(9);expect(result.heldoutEvaluated).toBe(false);expect(result.results).toHaveLength(4);
    for(const r of result.results){expect(r.metrics.retrieval.candidateGenerationRecall).toBe(1);expect(r.metrics.operational.duplicateAssignmentConflicts).toBe(0);expect(r.metrics.operational.invalidCandidates).toBe(0);expect(r.timing.count).toBe(7);}
    if(process.env.AI02_WRITE_EVIDENCE==="1"){
      const dir="docs/reconciliation/evidence/ai02";mkdirSync(dir,{recursive:true});writeFileSync(dir+"/results.json",JSON.stringify(result,null,2)+"\n");
      writeFileSync(dir+"/configuration.json",JSON.stringify({algorithmVersion:result.version,datasetVersion:result.datasetVersion,E0:EXACT_CONFIG,E1:result.selectedFuzzyConfig,selection:"minimize explicit false + unannotated suggestions, maximize economic F1, higher threshold, higher margin",heldoutEvaluated:false},null,2)+"\n");
    }
  });
});
