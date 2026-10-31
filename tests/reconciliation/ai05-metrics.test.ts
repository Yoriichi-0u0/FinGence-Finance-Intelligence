import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { baseline,prepare,verification } from "../../research/reconciliation/ai05/adapter";
import { metrics } from "../../research/reconciliation/ai05/metrics";
import { buildFreeze,validateFreeze } from "../../research/reconciliation/ai05/freeze";
import { assertSealBytes } from "../../research/reconciliation/ai05/heldout-evaluator";
import { sha256 } from "../../research/reconciliation/m2/serialization";
import type { Truth } from "../../research/reconciliation/m2/types";
const read=(p:string)=>JSON.parse(readFileSync(p,"utf8"));
function fixture(){
  const {input,evidence}=prepare(read("research/reconciliation/m2/fixtures/inputs/development.json"));
  const config=read("docs/reconciliation/evidence/ai02/configuration.json").E0,run=baseline(input,"E0",config);
  const truth=read("research/reconciliation/m2/fixtures/annotations/development.json") as Truth;
  const verified=verification(evidence,run.suggestions.map(p=>({...p,algorithm:"E0" as const,topology:"PAIR" as const})));
  return {input,evidence,run,truth,verified};
}
describe("AI05 frozen protocol and pure evaluation metrics — development/injected truth only",()=>{
  it("builds a stable seal from actual reviewed configuration and current software",()=>{
    const frozen=buildFreeze();expect(frozen.fingerprint).toBe(buildFreeze().fingerprint);validateFreeze(frozen);
    expect(frozen.configs.E0.threshold).toBe(1);expect(frozen.configs.E1.threshold).toBe(.95);expect(frozen.configs.E2b.threshold).toBe(.9);
    expect(frozen.verificationPolicy.version).toBe("ai04-policy/1.0.0");expect(frozen.measurement.noTuning).toBe(true);
  },30000);
  it("rejects configuration drift rather than selecting a threshold from labels",()=>{
    const frozen=buildFreeze();frozen.configs.E2b.threshold=.1;expect(()=>validateFreeze(frozen)).toThrow("drift");
  },30000);
  it("matches historical economic counts while reporting verification coverage loss",()=>{
    const f=fixture(),m=metrics(f.input,f.evidence,f.truth,f.run,f.verified);
    expect(m.denominators.genuinePairs).toBe(16);expect(m.before.truePositives).toBe(7);expect(m.after.truePositives).toBe(6);
    expect(m.verification.correctProposalsWithheld).toBe(1);expect(m.retrieval.candidateBlockingRecall).toBe(1);
    expect(m.after.coverage).toBe(6/25);
  });
  it("classifies explicit negatives separately from unknown sparse labels",()=>{
    const f=fixture(),p=f.run.suggestions[0];
    const injected={...f.truth,relationships:[],negatives:[{...p,reason:"DISTINCT_EVENT" as const}]};
    const negative=metrics(f.input,f.evidence,injected,f.run,f.verified);
    expect(negative.before.explicitFalsePositives).toBe(1);expect(negative.before.unannotatedSuggestions).toBe(6);
    const sparse=metrics(f.input,f.evidence,{...injected,negatives:[]},f.run,f.verified);
    expect(sparse.before.explicitFalsePositives).toBe(0);expect(sparse.before.unannotatedSuggestions).toBe(7);expect(sparse.before.precision).toBeNull();
  });
  it("reports undefined zero-population metrics without perfect-score fabrication",()=>{
    const f=fixture(),m=metrics(f.input,f.evidence,{...f.truth,relationships:[],negatives:[]},{...f.run,suggestions:[]},{...f.verified,decisions:[]});
    expect(m.before.precision).toBeNull();expect(m.before.recall).toBeNull();expect(m.before.f1).toBeNull();expect(m.before.coverage).toBe(0);
  });
  it("detects duplicate assignments and forged financial suggestions",()=>{
    const f=fixture(),p=f.run.suggestions[0],other=f.input.candidates.find(r=>r.role==="LEDGER"&&r.features.amount!==f.input.candidates.find(r=>r.candidateId===p.bankId)!.features.amount)!;
    const m=metrics(f.input,f.evidence,f.truth,{...f.run,suggestions:[p,p,{bankId:p.bankId,ledgerId:other.candidateId}]},f.verified);
    expect(m.before.safety.duplicateAssignments).toBeGreaterThan(0);expect(m.before.safety.wrongAmount).toBeGreaterThan(0);
  });
  it("keeps economic correctness separate from authored abstention",()=>{
    const f=fixture(),rel=f.truth.relationships.find(r=>r.kind==="PAIR")!;
    const changed={...f.truth,outcomes:f.truth.outcomes.map(o=>o.subjectId===rel.id?{...o,decision:"ABSTAIN_INSUFFICIENT" as const}:o)};
    const m=metrics(f.input,f.evidence,changed,{...f.run,suggestions:[{bankId:rel.bankIds[0],ledgerId:rel.ledgerIds[0]}]},f.verified);
    expect(m.before.truePositives).toBe(1);expect(m.before.safety.authoredAbstentionContradictions).toBe(1);
  });
  it("rejects contradictory labels",()=>{
    const f=fixture(),rel=f.truth.relationships.find(r=>r.kind==="PAIR")!;
    expect(()=>metrics(f.input,f.evidence,{...f.truth,negatives:[...f.truth.negatives,{bankId:rel.bankIds[0],ledgerId:rel.ledgerIds[0],reason:"DISTINCT_EVENT"}]},f.run,f.verified)).toThrow("Contradictory");
  });
  it("checks prediction artifact bytes and phase before permitting any truth read",()=>{
    const config=Buffer.from("frozen"),pred=Buffer.from("predictions");
    const seal={phase:"PREDICTIONS_FROZEN_BEFORE_TRUTH",truthLoaded:false,freezeSHA256:sha256(config),predictionsSHA256:sha256(pred)};
    expect(()=>assertSealBytes(seal,config,pred)).not.toThrow();
    expect(()=>assertSealBytes(seal,config,Buffer.from("corrupt"))).toThrow();
    expect(()=>assertSealBytes({...seal,truthLoaded:true},config,pred)).toThrow();
    expect(()=>assertSealBytes({...seal,phase:"NOT_SEALED"},config,pred)).toThrow();
  });
  it("keeps truth file paths out of prediction and adapter modules",()=>{
    for(const file of ["adapter.ts","prediction-runner.ts"]){const source=readFileSync("research/reconciliation/ai05/"+file,"utf8");expect(source).not.toContain("evaluation-only/");expect(source).not.toContain("heldoutAnnotations");expect(source).not.toContain("./metrics");}
  });
});
