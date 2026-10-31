import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { baseline,candidatePool,prepare,semantic,verification } from "../../research/reconciliation/ai05/adapter";
import { runBaseline } from "../../research/reconciliation/ai02/run";
import { rankSemantic } from "../../research/reconciliation/ai03/semantic-ranker";
import { Embeddings } from "../../research/reconciliation/ai03/embedding";
import { verify } from "../../research/reconciliation/ai04/orchestrator";
import { POLICY } from "../../research/reconciliation/ai04/policy";
import type { Input } from "../../research/reconciliation/ai02/types";
import type { VerificationInput } from "../../research/reconciliation/ai04/types";
import type { EvaluationInput } from "../../research/reconciliation/ai05/types";
const read=(p:string)=>JSON.parse(readFileSync(p,"utf8"));
const configs=read("docs/reconciliation/evidence/ai02/configuration.json");
const semanticConfig=read("docs/reconciliation/evidence/ai03/selected-config.json").config;
function unitEmbeddings(){return new Embeddings({kind:"UNIT_TEST_ONLY",initialize:async()=>({unitTest:true}),embed:async texts=>({vectors:texts.map(t=>{const v=Array(384).fill(0);for(let i=0;i<t.length;i++)v[t.charCodeAt(i)%384]++;return v;}),tokenCounts:texts.map(()=>10)}),terminate:()=>{},dispose:async()=>{}});}
describe("AI05 explicitly authorized compatibility adapters",()=>{
  it.each(["train","development"] as const)("preserves exact E0/E1 fingerprints and AI04 decisions for %s",split=>{
    const source=read(`research/reconciliation/m2/fixtures/inputs/${split}.json`),{input,evidence}=prepare(source);
    const history=read("docs/reconciliation/evidence/ai02/results.json").results;
    for(const method of ["E0","E1"] as const){
      const run=baseline(input,method,configs[method]);
      expect(run.fingerprint).toBe(runBaseline(input as Input,method,configs[method]).fingerprint);
      expect(run.fingerprint).toBe(history.find((r:{method:string;split:string})=>r.method===method&&r.split===split).run.fingerprint);
      const proposals=run.suggestions.map(p=>({...p,algorithm:method,topology:"PAIR" as const}));
      expect(verification(evidence,proposals)).toEqual(verify(evidence as VerificationInput,proposals,POLICY));
    }
    const e5=read("docs/reconciliation/evidence/ai03/results.json").results.find((r:{split:string})=>r.split===split).run;
    const proposals=e5.suggestions.map((p:{bankId:string;ledgerId:string})=>({...p,algorithm:"E2b" as const,topology:"PAIR" as const}));
    expect(verification(evidence,proposals)).toEqual(verify(evidence as VerificationInput,proposals,POLICY));
  });
  it.each(["train","development"] as const)("preserves E5 scoring/ranking fingerprints using injected vectors for %s",async split=>{
    const {input}=prepare(read(`research/reconciliation/m2/fixtures/inputs/${split}.json`)),a=unitEmbeddings(),b=unitEmbeddings();
    try{expect((await semantic(input,semanticConfig,a)).fingerprint).toBe((await rankSemantic(input as Input,semanticConfig,b)).fingerprint);}finally{await a.close();await b.close();}
  });
  it("rejects fabricated projections instead of relabeling them as development inputs",()=>{
    expect(()=>candidatePool({version:"ai01-m2/1.1.0",split:"heldout",candidates:[]} as EvaluationInput,configs.E0)).toThrow("AI01-approved");
  });
  it("rejects truth fields at the source-only boundary",()=>{
    const source=read("research/reconciliation/m2/fixtures/inputs/train.json");
    expect(()=>prepare({...source,truth:[]})).toThrow();
  });
  it("keeps financial/date blocking and one-to-one assignments identical",()=>{
    const {input,evidence}=prepare(read("research/reconciliation/m2/fixtures/inputs/development.json"));
    const run=baseline(input,"E0",configs.E0);
    const p=run.suggestions[0];
    const repeated=[0,1].map(()=>({...p,algorithm:"E0" as const,topology:"PAIR" as const}));
    expect(verification(evidence,repeated).decisions.every(d=>d.reasons.includes("UNIQUE_ASSIGNMENT"))).toBe(true);
    expect(candidatePool(input,configs.E0).pairs).toHaveLength(66);
    expect(Object.isFrozen(evidence.records[0].provenance)).toBe(true);
  });
  it("propagates model loading failure without substituting a mock result",async()=>{
    const {input}=prepare(read("research/reconciliation/m2/fixtures/inputs/development.json"));
    const embeddings=new Embeddings({kind:"PRETRAINED_E5",initialize:async()=>{throw new Error("MODEL_UNAVAILABLE");},embed:async()=>{throw new Error("Must not infer");},terminate:()=>{},dispose:async()=>{}});
    try{await expect(semantic(input,semanticConfig,embeddings)).rejects.toThrow("MODEL_UNAVAILABLE");}finally{await embeddings.close();}
  });
});
