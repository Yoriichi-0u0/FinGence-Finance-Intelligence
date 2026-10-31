import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { sha256 } from "../m2/serialization";
import type { SplitInput, Truth } from "../m2/types";
import { project } from "./projection";
import { POLICY } from "./policy";
import { verify } from "./orchestrator";
import { evaluate } from "./evaluation";
import type { Proposal, Split } from "./types";
interface Recorded { split: Split; run: { method: Proposal["algorithm"]; suggestions: { bankId:string;ledgerId:string }[];fingerprint:string } }
/** Explicit read-only replay of preserved outputs. No model, tuning or held-out loader. */
export function experiment(){
  const paths=["docs/reconciliation/evidence/ai02/results.json","docs/reconciliation/evidence/ai03/results.json"];
  const sources=paths.map(path=>({path,sha256:sha256(readFileSync(path))}));
  const recorded:Recorded[]=paths.flatMap(p=>JSON.parse(readFileSync(p,"utf8")).results);
  const results=recorded.map(r=>{
    if(!["train","development"].includes(r.split))throw new Error("Held-out evaluation prohibited");
    const inputPath=`research/reconciliation/m2/fixtures/inputs/${r.split}.json`,truthPath=`research/reconciliation/m2/fixtures/annotations/${r.split}.json`;
    const source=JSON.parse(readFileSync(inputPath,"utf8")) as SplitInput,truth=JSON.parse(readFileSync(truthPath,"utf8")) as Truth;
    const input=project(source),proposals=r.run.suggestions.map(p=>({...p,algorithm:r.run.method,topology:"PAIR" as const}));
    const timings:number[]=[],runs=[];
    for(let n=0;n<7;n++){const start=performance.now();runs.push(verify(input,proposals,POLICY));timings.push(performance.now()-start);}
    const sorted=[...timings].sort((a,b)=>a-b),run=runs[0];
    return {method:r.run.method,split:r.split,sourceRunFingerprint:r.run.fingerprint,inputSHA256:sha256(readFileSync(inputPath)),truthSHA256:sha256(readFileSync(truthPath)),run,metrics:evaluate(input,truth,proposals,run),distinctFingerprints:new Set(runs.map(v=>v.fingerprint)).size,latency:{samplesMs:timings,p50Ms:sorted[3],p95Ms:sorted[6],scope:"Verification including scope validation, exact checks, competition and fingerprints; excludes file I/O and evaluation"}};
  });
  return {status:"RECORDED_PROPOSALS_REPLAYED",heldoutEvaluated:false,modelRerun:false,policy:POLICY,sources,results};
}
