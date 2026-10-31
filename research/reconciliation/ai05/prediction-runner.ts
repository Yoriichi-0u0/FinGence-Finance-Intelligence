import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { canonicalJSON, sha256 } from "../m2/serialization";
import { LocalE5Provider } from "../ai03/model-loader";
import { Embeddings } from "../ai03/embedding";
import { semanticText } from "../ai03/text-features";
import { latency } from "../ai02/evaluator";
import { buildFreeze, validateFreeze } from "./freeze";
import { baseline, prepare, semantic, verification } from "./adapter";
import type { EvaluationRun } from "./types";
export const OFFICIAL_DIR="docs/reconciliation/evidence/ai05/official";
const write=(path:string,value:unknown)=>writeFileSync(path,canonicalJSON(value),{flag:"wx"});
/** One exclusive official prediction attempt; this module contains no label-loader import. */
export async function predictOfficial(){
  if(existsSync(OFFICIAL_DIR))throw new Error("Official attempt already exists; never overwrite or automatically retry");
  const frozen=buildFreeze();
  mkdirSync(OFFICIAL_DIR);
  write(OFFICIAL_DIR+"/freeze.json",frozen);
  try{
    validateFreeze(frozen);
    const source=JSON.parse(readFileSync("research/reconciliation/m2/fixtures/inputs/heldout.json","utf8"));
    const {input,evidence}=prepare(source);
    if(input.split!=="heldout")throw new Error("Official input must remain heldout");
    const provider=new LocalE5Provider(frozen.runtimeRoot,frozen.modelRoot),service=new Embeddings(provider,frozen.embeddingOptions);
    const results=[];
    try{
      for(const method of ["E0","E1","E2b"] as const){
        const start=performance.now(),config=frozen.configs[method];
        const run=method==="E2b"?await semantic(input,config,service):baseline(input,method,config);
        const verifyStart=performance.now(),decisions=verification(evidence,run.suggestions.map(p=>({...p,algorithm:method,topology:"PAIR" as const}))),verificationMs=performance.now()-verifyStart;
        const firstPipelineMs=performance.now()-start,warm=[];
        for(let n=0;n<frozen.measurement.warmReplays;n++){
          const warmStart=performance.now(),replay:EvaluationRun=method==="E2b"?await semantic(input,config,service):baseline(input,method,config);
          const vs=performance.now(),v=verification(evidence,replay.suggestions.map(p=>({...p,algorithm:method,topology:"PAIR" as const}))),verifyMs=performance.now()-vs;
          warm.push({pipelineMs:performance.now()-warmStart,matchingMs:replay.timings.endToEndMs,verificationMs:verifyMs,runFingerprint:replay.fingerprint,verificationFingerprint:v.fingerprint});
        }
        if(warm.some(w=>w.runFingerprint!==run.fingerprint||w.verificationFingerprint!==decisions.fingerprint))throw new Error("Deterministic replay failed");
        results.push({method,run,verification:decisions,first:{...run.timings,verificationMs,pipelineMs:firstPipelineMs,modelInitializationMs:method==="E2b"?service.stats.initializationMs:0},warm,warmPipelineLatency:latency(warm.map(w=>w.pipelineMs))});
      }
      const sample=input.candidates.slice(0,3).map(r=>semanticText(r.features));
      const cached=await service.encode(sample),uncached=await provider.embed(sample);
      const delta=Math.max(...cached.vectors.flatMap((v,n)=>v.map((x,k)=>Math.abs(x-uncached.vectors[n][k]))));
      if(delta>frozen.measurement.numericalTolerance)throw new Error("Actual uncached numerical tolerance exceeded");
      const value={protocolVersion:frozen.protocolVersion,freezeFingerprint:frozen.fingerprint,inputSHA256:sha256(readFileSync("research/reconciliation/m2/fixtures/inputs/heldout.json")),inputSummary:{records:input.candidates.length,bankRecords:input.candidates.filter(r=>r.role==="BANK").length,ledgerRecords:input.candidates.filter(r=>r.role==="LEDGER").length,schemas:source.templates.length},results,modelStats:{...service.stats},modelMetadata:service.metadata,numericalReplay:{samples:3,additionalDirectModelCalls:1,maxAbsDelta:delta,tolerance:frozen.measurement.numericalTolerance},truthLoaded:false};
      validateFreeze(frozen);
      write(OFFICIAL_DIR+"/predictions.json",value);
      write(OFFICIAL_DIR+"/prediction-seal.json",{freezeSHA256:sha256(readFileSync(OFFICIAL_DIR+"/freeze.json")),predictionsSHA256:sha256(readFileSync(OFFICIAL_DIR+"/predictions.json")),freezeFingerprint:frozen.fingerprint,phase:"PREDICTIONS_FROZEN_BEFORE_TRUTH",truthLoaded:false});
      return value;
    }finally{await service.close();}
  }catch(error){write(OFFICIAL_DIR+"/prediction-failure.json",{status:"FAILED_NO_AUTOMATIC_RETRY",error:error instanceof Error?error.message:String(error),truthLoaded:false});throw error;}
}
