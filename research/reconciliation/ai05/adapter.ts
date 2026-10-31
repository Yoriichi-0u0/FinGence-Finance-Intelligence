import { performance } from "node:perf_hooks";
import { developmentCandidates, heldoutCandidates } from "../m2/access";
import type { SplitInput } from "../m2/types";
import { canonicalJSON, sha256 } from "../m2/serialization";
import { blockedReason, epochDay, lex } from "../ai02/candidates";
import { exactScore } from "../ai02/exact";
import { fuzzyScore } from "../ai02/fuzzy";
import { resolve } from "../ai02/abstention";
import type { Config, Input, Pair, ScoredPair } from "../ai02/types";
import { semanticText, cosine } from "../ai03/text-features";
import type { Embeddings } from "../ai03/embedding";
import type { SemanticPair } from "../ai03/types";
import { POLICY, assertPolicy, VERIFIER_VERSION } from "../ai04/policy";
import { check, financialChecks, sourceChecks, text } from "../ai04/financial-verifier";
import { identityChecks } from "../ai04/identity-verifier";
import type { Proposal, Decision, Split as DevelopmentSplit } from "../ai04/types";
import { TEMPLATES } from "../m2/schemas";
import type { EvaluationInput, EvidenceInput, EvaluationRun, EvaluationVerification } from "./types";

const approved = new WeakSet<object>();
const approvedEvidence = new WeakSet<object>();
const hash = (x: unknown) => sha256(canonicalJSON(x));
function freeze<T>(value:T):T {
  if(value!==null&&typeof value==="object"){for(const v of Object.values(value))freeze(v);Object.freeze(value);}
  return value;
}
/** Explicit held-out entry point; input keeps its actual split. No annotation or truth loader. */
export function prepare(source: SplitInput): { input: EvaluationInput; evidence: EvidenceInput } {
  const input = source.split === "heldout" ? heldoutCandidates(source) : developmentCandidates(source);
  const records = source.records.map(r => {
    const { description, ...record } = structuredClone(r);
    void description;
    return record;
  });
  const evidence = freeze({ version: source.version as "ai01-m2/1.1.0", split: source.split, records });
  approved.add(input); approvedEvidence.add(evidence);
  return { input, evidence };
}
function assertConfig(config: Config) {
  if (!config || config.date?.field !== "canonicalDate" || config.date.maxDays !== 2 || ![config.threshold, config.margin].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error("Invalid frozen matching configuration");
}
export function candidatePool(input: EvaluationInput, config: Config) {
  if (!approved.has(input)) throw new Error("AI01-approved projection required");
  assertConfig(config);
  const start = performance.now(), pairs: Pair[] = [], blocked: Record<string, number> = {};
  const banks = input.candidates.filter(r => r.role === "BANK").sort((a,b) => lex(a.candidateId,b.candidateId));
  const ledgers = input.candidates.filter(r => r.role === "LEDGER").sort((a,b) => lex(a.candidateId,b.candidateId));
  for (const b of banks) for (const l of ledgers) {
    const why = blockedReason(b.features,l.features,config);
    if (why) blocked[why] = (blocked[why] ?? 0) + 1;
    else pairs.push({ bankId:b.candidateId, ledgerId:l.candidateId, dateGapDays:Math.abs(epochDay(b.features.canonicalDate)!-epochDay(l.features.canonicalDate)!) });
  }
  return { pairs, blocked, blockedCount:banks.length*ledgers.length-pairs.length, candidateMs:performance.now()-start };
}
function assignments(input: EvaluationInput, pairs: ScoredPair[], config: Config) {
  // Static type bridge only. resolve reads candidates/features and has no split authorization logic.
  return resolve(input as Input,pairs,config);
}
export function baseline(input: EvaluationInput, method: "E0" | "E1", config: Config): EvaluationRun {
  if (!["E0","E1"].includes(method)) throw new Error("Unknown baseline");
  const start=performance.now(),pool=candidatePool(input,config),rankStart=performance.now();
  const records=new Map(input.candidates.map(r=>[r.candidateId,r.features]));
  const candidates:ScoredPair[]=pool.pairs.map(p=>{
    const score=(method==="E0"?exactScore:fuzzyScore)(records.get(p.bankId)!,records.get(p.ledgerId)!);
    return {...p,method,rank:0,...score,reasons:["EXACT_AMOUNT","SAME_CURRENCY","SAME_DIRECTION","DATE_POLICY_PASS",...score.reasons]};
  });
  for(const p of candidates)p.rank=candidates.filter(q=>q.bankId===p.bankId&&q.score>=p.score-1e-12).length;
  candidates.sort((a,b)=>lex(a.bankId,b.bankId)||b.score-a.score||lex(a.ledgerId,b.ledgerId));
  const result={method,algorithmVersion:"ai02/1.0.0",datasetVersion:input.version,split:input.split,config:structuredClone(config),candidateCount:candidates.length,blockedCount:pool.blockedCount,blockingReasons:pool.blocked,candidates,...assignments(input,candidates,config)};
  const inputCanonical={...input,candidates:[...input.candidates].sort((a,b)=>lex(a.candidateId,b.candidateId))};
  const fingerprint=hash({input:inputCanonical,result});
  return {...result,fingerprint,processingMs:performance.now()-start,timings:{candidateMs:pool.candidateMs,rankingMs:performance.now()-rankStart,embeddingWallMs:0,endToEndMs:performance.now()-start}};
}
export async function semantic(input: EvaluationInput,config:Config,embeddings:Embeddings):Promise<EvaluationRun>{
  const start=performance.now(),pool=candidatePool(input,config),ids=new Set(pool.pairs.flatMap(p=>[p.bankId,p.ledgerId]));
  const rows=input.candidates.filter(r=>ids.has(r.candidateId)).sort((a,b)=>lex(a.candidateId,b.candidateId));
  const embedStart=performance.now(),encoded=await embeddings.encode(rows.map(r=>semanticText(r.features))),embeddingWallMs=performance.now()-embedStart;
  const vectors=new Map(rows.map((r,i)=>[r.candidateId,encoded.vectors[i]])),rankingStart=performance.now();
  const candidates:SemanticPair[]=pool.pairs.map(p=>{
    const raw=cosine(vectors.get(p.bankId)!,vectors.get(p.ledgerId)!);
    return {...p,method:"E2b",cosine:raw,score:Math.round(raw*1e6)/1e6,supported:raw>=0,rank:0,reasons:["EXACT_AMOUNT","SAME_CURRENCY","SAME_DIRECTION","DATE_POLICY_PASS","E5_COSINE_NOT_APPROVAL"],evidence:{reference:null,description:raw,counterparty:null}};
  });
  for(const p of candidates)p.rank=candidates.filter(q=>q.bankId===p.bankId&&q.score>=p.score-1e-12).length;
  candidates.sort((a,b)=>lex(a.bankId,b.bankId)||b.score-a.score||lex(a.ledgerId,b.ledgerId));
  const result={method:"E2b" as const,algorithmVersion:"ai03/0.1.0",datasetVersion:input.version,split:input.split,config:structuredClone(config),candidateCount:candidates.length,blockedCount:pool.blockedCount,blockingReasons:pool.blocked,candidates,...assignments(input,candidates.map(p=>({...p,method:"E1" as const})),config),inferenceKind:embeddings.provider.kind,modelMetadata:embeddings.metadata};
  const fingerprint=hash({...result,candidates:candidates.map(p=>({...p,cosine:p.score,evidence:{...p.evidence,description:p.score}})),input:[...input.candidates].sort((a,b)=>lex(a.candidateId,b.candidateId))});
  return {...result,fingerprint,processingMs:performance.now()-start,timings:{candidateMs:pool.candidateMs,embeddingWallMs,rankingMs:performance.now()-rankingStart,endToEndMs:performance.now()-start}};
}
/** Same AI04 orchestration and imported checks, with a separately authorized split boundary. */
export function verification(input:EvidenceInput,proposals:readonly Proposal[]):EvaluationVerification{
  if(!approvedEvidence.has(input))throw new Error("AI01-approved verification evidence required");
  assertPolicy(POLICY);
  if(proposals.some(p=>Object.keys(p).sort().join("|")!==["algorithm","bankId","ledgerId","topology"].join("|")||!text(p.bankId)||!text(p.ledgerId)||!["E0","E1","E2b"].includes(p.algorithm)||!["PAIR","GROUP","PARTIAL"].includes(p.topology)))throw new Error("Invalid or injected proposal");
  const records=input.records,templates=TEMPLATES.filter(t=>t.split===input.split);
  // sourceChecks indexes existing TEMPLATES/PERIODS, both of which already declare heldout.
  // No runtime split relabeling: this narrows only the older static parameter annotation.
  const split=input.split as DevelopmentSplit;
  const completeScope=records.length===templates.length*25&&templates.every(t=>records.filter(r=>r.templateId===t.id).length===25)&&records.every(r=>sourceChecks(r,split).every(c=>c.status==="PASS"));
  const duplicate=records.some((r,i)=>records.some((s,j)=>i!==j&&(s.id===r.id||s.sourceRowId===r.sourceRowId||(r.sourceTransactionId!==null&&r.sourceTransactionId===s.sourceTransactionId&&r.systemId===s.systemId&&r.accountId===s.accountId))));
  const decisions:Decision[]=proposals.map((p,index)=>{
    const b=records.find(r=>r.id===p.bankId),l=records.find(r=>r.id===p.ledgerId);
    const checks=[check("RECORD_EXISTENCE",b&&l?"PASS":"NOT_VERIFIED",p.bankId,p.ledgerId),check("UNIQUE_SOURCE_IDENTITIES",duplicate?"NOT_VERIFIED":"PASS"),check("PAIR_TOPOLOGY",p.topology==="PAIR"?"PASS":"NOT_VERIFIED"),check("DISTINCT_ROLES",b?.role==="BANK"&&l?.role==="LEDGER"&&p.bankId!==p.ledgerId?"PASS":"NOT_VERIFIED",p.bankId,p.ledgerId)];
    checks.push(check("COMPLETE_SYNTHETIC_SCOPE",completeScope?"PASS":"NOT_VERIFIED"));
    if(b&&l){
      checks.push(...sourceChecks(b,split),...sourceChecks(l,split),...financialChecks(b,l,POLICY),...identityChecks(b,l));
      const alternatives=records.filter(r=>(r.role==="LEDGER"&&r.id!==l.id&&!financialChecks(b,r,POLICY).some(c=>c.status==="FAIL"))||(r.role==="BANK"&&r.id!==b.id&&!financialChecks(r,l,POLICY).some(c=>c.status==="FAIL")));
      checks.push(check("UNIQUE_FINANCIALLY_PLAUSIBLE_PARTNER",alternatives.length?"NOT_VERIFIED":"PASS",...alternatives.map(r=>r.id).sort()));
    }
    const conflicts=proposals.filter((q,j)=>j!==index&&(q.bankId===p.bankId||q.ledgerId===p.ledgerId));
    checks.push(check("UNIQUE_ASSIGNMENT",conflicts.length?"NOT_VERIFIED":"PASS",...conflicts.flatMap(q=>[q.bankId,q.ledgerId]).sort()));
    return {...p,verifierVersion:VERIFIER_VERSION,policyVersion:POLICY.version,checks,reasons:[...new Set(checks.filter(c=>c.status!=="PASS").map(c=>c.code))],disposition:checks.some(c=>c.status==="FAIL")?"BLOCKED_PROPOSAL":checks.some(c=>c.status==="NOT_VERIFIED")?"UNRESOLVED_REVIEW":"VERIFIED_SUGGESTION"};
  });
  const result={verifierVersion:VERIFIER_VERSION,policy:structuredClone(POLICY),datasetVersion:input.version,split:input.split,inputFingerprint:hash(input),proposalFingerprint:hash(proposals),decisions};
  return {...result,fingerprint:hash(result)};
}
