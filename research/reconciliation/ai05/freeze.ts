import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import os from "node:os";
import { canonicalJSON, sha256 } from "../m2/serialization";
import { POLICY } from "../ai04/policy";
import { ADAPTER_VERSION } from "./types";
const read=(path:string)=>JSON.parse(readFileSync(path,"utf8"));
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):[resolve(dir,e.name)]);}
/** Creates a deterministic configuration seal. No dataset label JSON is parsed here. */
export function buildFreeze(){
  const baseline=read("docs/reconciliation/evidence/ai02/configuration.json");
  const semantic=read("docs/reconciliation/evidence/ai03/selected-config.json");
  const model=read("research/reconciliation/ai03/model-config.json");
  const dataset=read("research/reconciliation/m2/fixtures/artifact-manifest.json");
  if(dataset.version!=="ai01-m2/1.1.0"||!baseline.E0||!baseline.E1||!semantic.config||model.revision!=="761b726dd34fb83930e26aab4e9ac3899aa1fa78")throw new Error("Missing or incorrect reviewed configuration");
  for(const config of [baseline.E0,baseline.E1,semantic.config])if(config.date.field!=="canonicalDate"||config.date.maxDays!==2)throw new Error("Inconsistent frozen blocking/date policy");
  const modelRoot=resolve("../ai03-models",model.revision),runtimeRoot=resolve("../ai03-runtime");
  const runtime=read(resolve(runtimeRoot,"node_modules/@huggingface/transformers/package.json"));
  if(runtime.version!==model.libraryVersion)throw new Error("Runtime version mismatch");
  for(const [file,expected] of Object.entries(model.filesSHA256))if(sha256(readFileSync(resolve(modelRoot,file)))!==expected)throw new Error("Model integrity mismatch: "+file);
  const sources=Object.fromEntries(files(resolve("research/reconciliation")).filter(p=>!p.includes("fixtures")&&/\.(ts|mjs|json)$/.test(p)).sort().map(p=>[relative(process.cwd(),p).replace(/\\/g,"/"),sha256(readFileSync(p,"utf8").replace(/\r\n/g,"\n"))]));
  const artifacts=Object.fromEntries(["package.json","pnpm-lock.yaml","scripts/db03/vitest.config.mts","tests/reconciliation/ai05-official.test.ts","docs/reconciliation/ai05-evaluation-protocol.md","docs/reconciliation/evidence/ai02/configuration.json","docs/reconciliation/evidence/ai03/selected-config.json","research/reconciliation/m2/fixtures/artifact-manifest.json","research/reconciliation/m2/fixtures/inputs/heldout.json"].map(p=>[p,sha256(readFileSync(p))]));
  if(artifacts["research/reconciliation/m2/fixtures/inputs/heldout.json"]!==dataset.artifacts["inputs/heldout.json"])throw new Error("Held-out input integrity mismatch");
  const value={protocolVersion:"ai05-official/1.0.0",adapterVersion:ADAPTER_VERSION,dataset,configs:{E0:baseline.E0,E1:baseline.E1,E2b:semantic.config},verificationPolicy:POLICY,model,embeddingOptions:semantic.options,software:{node:process.version,platform:process.platform,architecture:process.arch,transformers:runtime.version,vitest:read("node_modules/vitest/package.json").version,typescript:read("node_modules/typescript/package.json").version},hardware:{cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem()},runtimeRoot,modelRoot,sources,artifacts,measurement:{warmReplays:7,numericalTolerance:1e-5,truthOrder:"Only after prediction seal; separate evaluator process",noTuning:true}};
  return {...value,fingerprint:sha256(canonicalJSON(value))};
}
export type Frozen=ReturnType<typeof buildFreeze>;
export function validateFreeze(frozen:Frozen){if(canonicalJSON(frozen)!==canonicalJSON(buildFreeze()))throw new Error("Frozen configuration/software/artifact drift");}
