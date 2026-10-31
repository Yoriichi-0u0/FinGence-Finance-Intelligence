import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { heldoutAnnotations } from "../m2/access";
import type { Benchmark, SplitInput, Truth } from "../m2/types";
import { canonicalJSON, sha256 } from "../m2/serialization";
import { prepare } from "./adapter";
import { validateFreeze } from "./freeze";
import { metrics } from "./metrics";
import type { predictOfficial } from "./prediction-runner";
const DIR="docs/reconciliation/evidence/ai05/official";
const read=(p:string)=>JSON.parse(readFileSync(p,"utf8"));
export function assertSealBytes(seal:{phase:string;truthLoaded:boolean;freezeSHA256:string;predictionsSHA256:string},freezeBytes:Uint8Array,predictionBytes:Uint8Array){
  if(seal.phase!=="PREDICTIONS_FROZEN_BEFORE_TRUTH"||seal.truthLoaded!==false||sha256(freezeBytes)!==seal.freezeSHA256||sha256(predictionBytes)!==seal.predictionsSHA256)throw new Error("Missing or corrupted pre-truth prediction seal");
}
export function validatePredictionSeal(){
  const seal=read(DIR+"/prediction-seal.json"),frozen=read(DIR+"/freeze.json");
  assertSealBytes(seal,readFileSync(DIR+"/freeze.json"),readFileSync(DIR+"/predictions.json"));
  validateFreeze(frozen);
  const predictions=read(DIR+"/predictions.json") as Awaited<ReturnType<typeof predictOfficial>>;
  if(predictions.truthLoaded!==false||predictions.freezeFingerprint!==frozen.fingerprint||predictions.results.length!==3||predictions.results.some(r=>r.run.inferenceKind==="UNIT_TEST_ONLY"))throw new Error("Invalid official predictions");
  return {seal,frozen,predictions};
}
/** Sole official label reader; invoked in a separate process after a valid immutable prediction seal. */
export function evaluateOfficial(){
  if(existsSync(DIR+"/evaluation.json"))throw new Error("Official evaluation already exists; never overwrite");
  const {seal,frozen,predictions}=validatePredictionSeal();
  const inputs=( ["train","development","heldout"] as const).map(split=>read(`research/reconciliation/m2/fixtures/inputs/${split}.json`) as SplitInput);
  const heldout=inputs.find(i=>i.split==="heldout")!;
  const {input,evidence}=prepare(heldout);
  // All predictions/configurations are sealed before any annotation file is parsed.
  const truthPath="research/reconciliation/m2/fixtures/evaluation-only/heldout-truth.json";
  if(sha256(readFileSync(truthPath))!==frozen.dataset.artifacts["evaluation-only/heldout-truth.json"])throw new Error("Held-out truth integrity mismatch");
  const annotations:Truth[]=[read("research/reconciliation/m2/fixtures/annotations/train.json"),read("research/reconciliation/m2/fixtures/annotations/development.json"),read(truthPath)];
  const benchmark:Benchmark={version:heldout.version,seed:heldout.seed,inputs,annotations};
  const truth=heldoutAnnotations(benchmark);
  const results=predictions.results.map(r=>({method:r.method,metrics:metrics(input,evidence,truth,r.run,r.verification),runFingerprint:r.run.fingerprint,verificationFingerprint:r.verification.fingerprint}));
  const value={protocolVersion:frozen.protocolVersion,freezeFingerprint:frozen.fingerprint,predictionsSHA256:seal.predictionsSHA256,truthSHA256:sha256(readFileSync(truthPath)),actualHeldout:{records:heldout.records.length,schemas:heldout.templates.length,genuinePairs:truth.relationships.filter(r=>r.kind==="PAIR").length,explicitNegatives:truth.negatives.length,groups:truth.relationships.filter(r=>r.kind!=="PAIR").length,unmatchedRecords:truth.unmatched.length},results};
  writeFileSync(DIR+"/evaluation.json",canonicalJSON({...value,fingerprint:sha256(canonicalJSON(value))}),{flag:"wx"});
  return value;
}
