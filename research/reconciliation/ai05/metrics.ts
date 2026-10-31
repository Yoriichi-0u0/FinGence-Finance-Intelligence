import type { Truth } from "../m2/types";
import type { EvaluationInput, EvaluationRun, EvidenceInput, EvaluationVerification } from "./types";
import { financialChecks, sourceChecks } from "../ai04/financial-verifier";
import { identityChecks } from "../ai04/identity-verifier";
import type { Split as DevelopmentSplit } from "../ai04/types";
export const edge=(p:{bankId:string;ledgerId:string})=>JSON.stringify([p.bankId,p.ledgerId]);
const ratio=(a:number,b:number)=>b?a/b:null;
/** Evaluator-only pure metrics. No runtime matcher imports this module. */
export function metrics(input:EvaluationInput,evidence:EvidenceInput,truth:Truth,run:EvaluationRun,verified:EvaluationVerification){
  if(truth.split!==input.split||truth.version!==input.version||run.split!==input.split||verified.split!==input.split)throw new Error("Evaluation split/version mismatch");
  const positives=new Set(truth.relationships.filter(r=>r.kind==="PAIR").map(r=>edge({bankId:r.bankIds[0],ledgerId:r.ledgerIds[0]})));
  const negatives=new Set(truth.negatives.map(edge));
  if([...positives].some(e=>negatives.has(e)))throw new Error("Contradictory truth");
  const pool=new Set(run.candidates.map(edge)),banks=input.candidates.filter(r=>r.role==="BANK").length;
  const groupIds=new Set(truth.relationships.filter(r=>r.kind!=="PAIR").flatMap(r=>[...r.bankIds,...r.ledgerIds]));
  const abstain=new Set(truth.relationships.filter(r=>r.kind==="PAIR"&&truth.outcomes.some(o=>o.subjectId===r.id&&o.decision!=="SUGGEST_PAIR")).map(r=>edge({bankId:r.bankIds[0],ledgerId:r.ledgerIds[0]})));
  function assess(pairs:{bankId:string;ledgerId:string}[]){
    const selected=new Set(pairs.map(edge)),used=pairs.flatMap(p=>[p.bankId,p.ledgerId]);
    const tp=[...selected].filter(e=>positives.has(e)).length,fp=[...selected].filter(e=>negatives.has(e)).length;
    const precision=ratio(tp,tp+fp),recall=ratio(tp,positives.size);
    const safety={wrongAmount:0,wrongCurrency:0,invalidDirection:0,dateViolation:0,counterpartyConflict:0,missingIdentityEvidence:0,unknownVerificationEvidence:0,duplicateAssignments:used.length-new Set(used).size,unsupportedGroupedMatches:pairs.filter(p=>groupIds.has(p.bankId)||groupIds.has(p.ledgerId)).length,unmatchedRecordsSuggested:truth.unmatched.filter(u=>used.includes(u.recordId)).length,ambiguousCasesForced:truth.ambiguous.filter(a=>a.bankIds.some(id=>used.includes(id))).length,authoredAbstentionContradictions:[...selected].filter(e=>abstain.has(e)).length};
    for(const p of pairs){
      const b=evidence.records.find(r=>r.id===p.bankId),l=evidence.records.find(r=>r.id===p.ledgerId);
      if(!b||!l){safety.unknownVerificationEvidence++;continue;}
      const checks=financialChecks(b,l,verified.policy);
      for(const [n,key] of (["wrongAmount","wrongCurrency","invalidDirection","dateViolation"] as const).entries())if(checks[n].status==="FAIL")safety[key]++;
      const identity=identityChecks(b,l);
      if(identity.some(c=>c.code==="COUNTERPARTY_CONFLICT"))safety.counterpartyConflict++;
      if(identity.some(c=>c.code.endsWith("_MISSING")))safety.missingIdentityEvidence++;
      const source=[...sourceChecks(b,input.split as DevelopmentSplit),...sourceChecks(l,input.split as DevelopmentSplit)];
      if([...checks,...source].some(c=>c.status!=="PASS")||identity.some(c=>c.status!=="PASS"))safety.unknownVerificationEvidence++;
    }
    return {truePositives:tp,explicitFalsePositives:fp,falseNegatives:positives.size-tp,unannotatedSuggestions:selected.size-tp-fp,precision,recall,f1:precision===null||recall===null?null:precision+recall?2*precision*recall/(precision+recall):0,suggestions:selected.size,assessedSuggestions:tp+fp,coverage:ratio(new Set(pairs.map(p=>p.bankId)).size,banks),unresolvedRatio:ratio(banks-new Set(pairs.map(p=>p.bankId)).size,banks),unresolvedBankRecords:banks-new Set(pairs.map(p=>p.bankId)).size,safety};
  }
  const before=assess(run.suggestions),after=assess(verified.decisions.filter(d=>d.disposition==="VERIFIED_SUGGESTION"));
  return {evaluationVersion:"ai05-metrics/1.0.0",denominators:{genuinePairs:positives.size,bankRecords:banks,allRecords:input.candidates.length,explicitNegatives:negatives.size,unsupportedGroups:truth.relationships.filter(r=>r.kind!=="PAIR").length,unmatchedRecords:truth.unmatched.length,ambiguousCases:truth.ambiguous.length},retrieval:{candidateCount:run.candidateCount,survivingGenuinePairs:[...positives].filter(e=>pool.has(e)).length,candidateBlockingRecall:ratio([...positives].filter(e=>pool.has(e)).length,positives.size),recallAt1:ratio(run.candidates.filter(p=>p.rank<=1&&positives.has(edge(p))).length,positives.size),recallAt3:ratio(run.candidates.filter(p=>p.rank<=3&&positives.has(edge(p))).length,positives.size),recallAt5:ratio(run.candidates.filter(p=>p.rank<=5&&positives.has(edge(p))).length,positives.size)},before,after,verification:{correctProposalsRetained:after.truePositives,incorrectProposalsWithheld:before.explicitFalsePositives-after.explicitFalsePositives,correctProposalsWithheld:before.truePositives-after.truePositives,verifiedSuggestions:verified.decisions.filter(d=>d.disposition==="VERIFIED_SUGGESTION").length,blockedProposals:verified.decisions.filter(d=>d.disposition==="BLOCKED_PROPOSAL").length,unresolvedReview:verified.decisions.filter(d=>d.disposition==="UNRESOLVED_REVIEW").length}};
}
