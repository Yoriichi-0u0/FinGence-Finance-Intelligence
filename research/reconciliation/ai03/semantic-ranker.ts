import { performance } from "node:perf_hooks";
import { generateCandidates, lex } from "../ai02/candidates";
import { resolve } from "../ai02/abstention";
import type { Input, Config, Run } from "../ai02/types";
import { canonicalJSON, sha256 } from "../m2/serialization";
import { semanticText, cosine } from "./text-features";
import type { Embeddings } from "./embedding";
import type { SemanticPair, SemanticRun } from "./types";
/** Structural bridge only: existing resolver/evaluator ignore method tags. Never runs E1. */
export function baselineView(run: SemanticRun): Run {
  return {...run,method:"E1",candidates:run.candidates.map(p=>({...p,method:"E1"}))};
}
export async function rankSemantic(input: Input, config: Config, embeddings: Embeddings): Promise<SemanticRun> {
  const start=performance.now(),pool=generateCandidates(input,config);
  const ids=new Set(pool.pairs.flatMap(p=>[p.bankId,p.ledgerId]));
  const rows=input.candidates.filter(r=>ids.has(r.candidateId)).sort((a,b)=>lex(a.candidateId,b.candidateId));
  const embedStart=performance.now(),encoded=await embeddings.encode(rows.map(r=>semanticText(r.features))),embeddingWallMs=performance.now()-embedStart;
  const vectors=new Map(rows.map((r,i)=>[r.candidateId,encoded.vectors[i]])),rankingStart=performance.now();
  const candidates: SemanticPair[]=pool.pairs.map(p=>{const raw=cosine(vectors.get(p.bankId)!,vectors.get(p.ledgerId)!);return {...p,method:"E2b",cosine:raw,score:Math.round(raw*1e6)/1e6,supported:raw>=0,rank:0,reasons:["EXACT_AMOUNT","SAME_CURRENCY","SAME_DIRECTION","DATE_POLICY_PASS","E5_COSINE_NOT_APPROVAL"],evidence:{reference:null,description:raw,counterparty:null}};});
  for(const p of candidates)p.rank=candidates.filter(q=>q.bankId===p.bankId&&q.score>=p.score-1e-12).length;
  candidates.sort((a,b)=>lex(a.bankId,b.bankId)||b.score-a.score||lex(a.ledgerId,b.ledgerId));
  const assignments=resolve(input,candidates.map(p=>({...p,method:"E1" as const})),config);
  const result={method:"E2b" as const,algorithmVersion:"ai03/0.1.0",datasetVersion:input.version,split:input.split,config:structuredClone(config),candidateCount:candidates.length,blockedCount:pool.blockedCount,blockingReasons:pool.blocked,candidates,...assignments,inferenceKind:embeddings.provider.kind,modelMetadata:embeddings.metadata};
  // Raw cosine values are evidence; the replay fingerprint binds rounded scores/ranks instead.
  const fingerprint=sha256(canonicalJSON({...result,candidates:candidates.map(p=>({...p,cosine:p.score,evidence:{...p.evidence,description:p.score}})),input:[...input.candidates].sort((a,b)=>lex(a.candidateId,b.candidateId))}));
  return {...result,processingMs:performance.now()-start,timings:{embeddingWallMs,rankingMs:performance.now()-rankingStart,endToEndMs:performance.now()-start},fingerprint};
}
