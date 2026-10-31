import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
import { Embeddings } from "../../research/reconciliation/ai03/embedding";
import { LocalE5Provider } from "../../research/reconciliation/ai03/model-loader";
import { semanticExperiment } from "../../research/reconciliation/ai03/experiment";
import { rankSemantic } from "../../research/reconciliation/ai03/semantic-ranker";
import { RESEARCH_GRID } from "../../research/reconciliation/ai03/types";
import { runBaseline } from "../../research/reconciliation/ai02/run";
import { latency } from "../../research/reconciliation/ai02/evaluator";
import { frozen } from "./ai02-fixtures";
const real = process.env.AI03_REAL === "1" ? describe : describe.skip;
real("AI03 actual local pretrained E5 — explicit opt-in, never mocked",()=>{
 it("runs offline smoke, fresh repeated inference and train/development experiment",async()=>{
  const provider=new LocalE5Provider(resolve("../ai03-runtime"),resolve("../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78"));
  const service=new Embeddings(provider),dir="docs/reconciliation/evidence/ai03";
  try{
   const texts=["query: Equipment repair | Example Supplier","query: Baik pulih peralatan | Example Supplier","query: Payment / bayaran bekalan | Example Supplier"];
   const first=await service.encode(texts);expect(first.vectors.every(v=>v.length===384&&v.every(Number.isFinite))).toBe(true);
   for(const v of first.vectors)expect(Math.hypot(...v)).toBeCloseTo(1,5);
   // Actual provider calls bypass the embedding cache to measure numerical reproducibility.
   const repeated=await provider.embed(texts),duplicate=await provider.embed([texts[0],texts[0]]);
   const maxDelta=Math.max(...first.vectors.flatMap((v,n)=>v.map((x,k)=>Math.abs(x-repeated.vectors[n][k]))));
   expect(maxDelta).toBeLessThan(1e-5);
   expect(Math.max(...duplicate.vectors[0].map((v,k)=>Math.abs(v-duplicate.vectors[1][k])))).toBeLessThan(1e-5);
   const longText=await provider.embed(["query: "+"a ".repeat(900)]);expect(longText.tokenCounts[0]).toBeGreaterThan(512);expect(longText.vectors[0]).toHaveLength(384);
   const train=frozen("train"),development=frozen("development");
   const beforeCold={...service.stats};const coldTrain=await rankSemantic(train.input,RESEARCH_GRID[0],service);const afterCold={...service.stats};
   const experiment=await semanticExperiment(train.input,development.input,train.truth,development.truth,service);
   expect(experiment.results.every(r=>r.metrics.retrieval.candidateGenerationRecall===1&&r.metrics.operational.invalidCandidates===0&&r.metrics.operational.duplicateAssignmentConflicts===0)).toBe(true);
   expect(experiment.results.every(r=>r.distinctFingerprints===1)).toBe(true);
   const baseline=JSON.parse(readFileSync("docs/reconciliation/evidence/ai02/results.json","utf8"));
   const baselineReplay=baseline.results.map((r: {method:"E0"|"E1";split:"train"|"development";config:typeof RESEARCH_GRID[number];run:{fingerprint:string}})=>{
    const input=r.split==="train"?train.input:development.input;runBaseline(input,r.method,r.config);
    const runs=Array.from({length:7},()=>runBaseline(input,r.method,r.config));expect(runs.every(run=>run.fingerprint===r.run.fingerprint)).toBe(true);
    return {method:r.method,split:r.split,fingerprint:runs[0].fingerprint,timing:latency(runs.map(run=>run.processingMs))};
   });
   await service.close();
   const coldService=new Embeddings(new LocalE5Provider(resolve("../ai03-runtime"),resolve("../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78")));
   let coldFinal;
   try{const run=await rankSemantic(train.input,experiment.selectedConfig,coldService);expect(run.fingerprint).toBe(experiment.results[0].run.fingerprint);coldFinal={timings:run.timings,stats:{...coldService.stats},fingerprint:run.fingerprint,note:"Fresh worker, model initialization and uncached train embedding generation included"};}finally{await coldService.close();}
   mkdirSync(dir,{recursive:true});
   writeFileSync(dir+"/real-smoke.json",JSON.stringify({status:"PASSED_REAL_PRETRAINED_INFERENCE",modelMetadata:service.metadata,dimensions:384,texts:3,duplicateTextDelta:Math.max(...duplicate.vectors[0].map((v,k)=>Math.abs(v-duplicate.vectors[1][k]))),uncachedRepeatMaxAbsDelta:maxDelta,tolerance:1e-5,tokenCounts:first.tokenCounts,initializationMs:service.stats.initializationMs,additionalDirectSmokeCalls:3,realTruncation:{originalTokens:longText.tokenCounts[0],maximumTokens:512,validOutput:true}},null,2)+"\n");
   writeFileSync(dir+"/results.json",JSON.stringify({...experiment,coldTrain:{note:"Model already initialized by smoke; first train embedding cache fill at predeclared grid entry, not final tuned metrics",timings:coldTrain.timings,before:beforeCold,after:afterCold},baselineReplay,coldFinal},null,2)+"\n");
   writeFileSync(dir+"/selected-config.json",JSON.stringify({algorithmVersion:experiment.algorithmVersion,modelMetadata:service.metadata,config:experiment.selectedConfig,text:"NFKC, whitespace collapse; query: description | counterparty; no lowercasing",score:"raw cosine rounded to 1e-6, not a probability",assignment:"unchanged AI02 mutual unique support",options:service.options,heldoutEvaluated:false},null,2)+"\n");
  }finally{await service.close();}
 },300000);
});
