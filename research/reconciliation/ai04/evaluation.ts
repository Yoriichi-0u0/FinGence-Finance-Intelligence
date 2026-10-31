import type { Truth } from "../m2/types";
import type { Proposal, VerificationInput, VerificationRun } from "./types";
import { financialChecks } from "./financial-verifier";
import { identityChecks } from "./identity-verifier";
export const edge=(p:{bankId:string;ledgerId:string})=>JSON.stringify([p.bankId,p.ledgerId]);
const ratio=(a:number,b:number)=>b?a/b:null;
/** Evaluator only. This module is never imported by verification or projection. */
export function evaluate(input:VerificationInput,truth:Truth,proposals:readonly Proposal[],run:VerificationRun){
  if(!["train","development"].includes(input.split)||truth.split!==input.split||truth.version!==input.version||run.split!==input.split||run.datasetVersion!==input.version)throw new Error("Evaluation split/version mismatch");
  const positives=new Set(truth.relationships.filter(r=>r.kind==="PAIR").map(r=>edge({bankId:r.bankIds[0],ledgerId:r.ledgerIds[0]})));
  const negatives=new Set(truth.negatives.map(edge));
  if([...positives].some(p=>negatives.has(p)))throw new Error("Contradictory evaluation truth");
  const abstain=new Set(truth.relationships.filter(r=>r.kind==="PAIR"&&truth.outcomes.some(o=>o.subjectId===r.id&&o.decision!=="SUGGEST_PAIR")).map(r=>edge({bankId:r.bankIds[0],ledgerId:r.ledgerIds[0]})));
  const banks=input.records.filter(r=>r.role==="BANK").length;
  const groupIds=new Set(truth.relationships.filter(r=>r.kind!=="PAIR").flatMap(r=>[...r.bankIds,...r.ledgerIds]));
  function metrics(pairs:readonly Proposal[]){
    const edges=new Set(pairs.map(edge)),used=pairs.flatMap(p=>[p.bankId,p.ledgerId]),tp=[...edges].filter(e=>positives.has(e)).length,fp=[...edges].filter(e=>negatives.has(e)).length;
    const precision=ratio(tp,tp+fp),recall=ratio(tp,positives.size);
    const violations:Record<string,number>={EXACT_AMOUNT:0,CURRENCY:0,DIRECTION:0,CANONICAL_DATE_WINDOW:0};
    let identityConflicts=0,unverifiedFinancialEvidence=0;
    for(const p of pairs){const b=input.records.find(r=>r.id===p.bankId),l=input.records.find(r=>r.id===p.ledgerId);if(!b||!l){unverifiedFinancialEvidence++;continue;}
      for(const c of financialChecks(b,l,run.policy)){if(c.status==="FAIL")violations[c.code]++;if(c.status==="NOT_VERIFIED")unverifiedFinancialEvidence++;}
      if(identityChecks(b,l).some(c=>c.status!=="PASS"))identityConflicts++;
    }
    return {truePositives:tp,explicitFalsePositives:fp,falseNegatives:positives.size-tp,unannotatedSuggestions:edges.size-tp-fp,precision,recall,f1:precision===null||recall===null?null:precision+recall?2*precision*recall/(precision+recall):0,
      suggestions:edges.size,genuinePairs:positives.size,bankRecords:banks,suggestionCoverage:ratio(new Set(pairs.map(p=>p.bankId)).size,banks),unresolvedBankRecords:banks-new Set(pairs.map(p=>p.bankId)).size,
      authoredAbstentionContradictions:[...edges].filter(e=>abstain.has(e)).length,unmatchedRecordsSuggested:truth.unmatched.filter(u=>used.includes(u.recordId)).length,ambiguousCasesForced:truth.ambiguous.filter(a=>a.bankIds.some(id=>used.includes(id))).length,
      groupAssociatedSuggestions:pairs.filter(p=>groupIds.has(p.bankId)||groupIds.has(p.ledgerId)).length,duplicateAssignments:used.length-new Set(used).size,unsupportedTopology:pairs.filter(p=>p.topology!=="PAIR").length,financialViolations:violations,identityConflicts,unverifiedFinancialEvidence};
  }
  const retained=run.decisions.filter(d=>d.disposition==="VERIFIED_SUGGESTION"),before=metrics(proposals),after=metrics(retained);
  const knownRisks=proposals.filter(p=>truth.negatives.some(n=>edge(n)===edge(p)&&n.reason==="COUNTERPARTY")||abstain.has(edge(p))).map(p=>({bankId:p.bankId,ledgerId:p.ledgerId,category:negatives.has(edge(p))?"INCORRECT_COUNTERPARTY":"AUTHORED_ABSTENTION_CONTRADICTION",decision:run.decisions.find(d=>edge(d)===edge(p))!}));
  return {evaluationVersion:"ai04-evaluation/1.0.0",before,after,correctMatchesWithheld:before.truePositives-after.truePositives,blocked:run.decisions.filter(d=>d.disposition==="BLOCKED_PROPOSAL").length,unresolvedProposals:run.decisions.filter(d=>d.disposition==="UNRESOLVED_REVIEW").length,knownRisks};
}
