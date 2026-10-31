import type { Input, Config } from "../ai02/types";
import type { Truth } from "../m2/types";
import { latency } from "../ai02/evaluator";
import { rankSemantic } from "./semantic-ranker";
import { evaluateSemantic } from "./evaluation";
import { RESEARCH_GRID } from "./types";
import type { Embeddings } from "./embedding";
/** Real-inference-only experiment; no held-out loader and no fabricated metrics fallback. */
export async function semanticExperiment(train:Input,development:Input,trainTruth:Truth,devTruth:Truth,embeddings:Embeddings){
 if(embeddings.provider.kind!=="PRETRAINED_E5")throw new Error("Real pretrained inference is required for experiment evidence");
 if(train.split!=="train"||development.split!=="development")throw new Error("Training/development only");
 const grid: {config:Config;metrics:ReturnType<typeof evaluateSemantic>}[]=[];
 for(const config of RESEARCH_GRID){const run=await rankSemantic(development,config,embeddings);grid.push({config,metrics:evaluateSemantic(development,devTruth,run)});}
 // Predeclared AI02 selection objective, with identical metric denominators. Operational risk remains separately reported.
 const risk=(x:typeof grid[number])=>x.metrics.matching.explicitFalsePositives+x.metrics.matching.unannotatedSuggestions;
 const selected=[...grid].sort((a,b)=>risk(a)-risk(b)||(b.metrics.matching.f1??0)-(a.metrics.matching.f1??0)||b.config.threshold-a.config.threshold||b.config.margin-a.config.margin)[0].config;
 const results=[];
 for(const input of [train,development]){
  const runs=[];for(let n=0;n<7;n++)runs.push(await rankSemantic(input,selected,embeddings));
  results.push({split:input.split,metrics:evaluateSemantic(input,input.split==="train"?trainTruth:devTruth,runs[0]),run:runs[0],warmCacheTiming:latency(runs.map(r=>r.timings.endToEndMs)),distinctFingerprints:new Set(runs.map(r=>r.fingerprint)).size});
 }
 return {status:"REAL_INFERENCE_EXECUTED",method:"E2b",algorithmVersion:"ai03/0.1.0",selectedConfig:selected,grid,results,modelMetadata:embeddings.metadata,serviceStats:{...embeddings.stats},heldoutEvaluated:false};
}
