import { describe,expect,it } from "vitest";
import { predictOfficial } from "../../research/reconciliation/ai05/prediction-runner";
import { evaluateOfficial } from "../../research/reconciliation/ai05/heldout-evaluator";
const prediction=process.env.AI05_STAGE==="predictions"?describe:describe.skip;
const evaluation=process.env.AI05_STAGE==="evaluation"?describe:describe.skip;
prediction("AI05 one official offline prediction attempt",()=>{
  it("freezes configuration and predictions before any held-out truth is loaded",async()=>{
    const result=await predictOfficial();
    expect(result.truthLoaded).toBe(false);expect(result.results).toHaveLength(3);
    expect(result.results.find(r=>r.method==="E2b")?.run.inferenceKind).toBe("PRETRAINED_E5");
    expect(result.modelStats.modelCalls).toBeGreaterThan(0);
  },300000);
});
evaluation("AI05 isolated official evaluation after prediction seal",()=>{
  it("loads actual held-out truth only after sealed predictions and computes metrics",()=>{
    const result=evaluateOfficial();
    expect(result.actualHeldout.records).toBe(100);expect(result.actualHeldout.schemas).toBe(4);
    expect(result.results).toHaveLength(3);
  },300000);
});
