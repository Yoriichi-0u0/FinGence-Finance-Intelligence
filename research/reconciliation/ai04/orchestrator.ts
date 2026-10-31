import { canonicalJSON, sha256 } from "../m2/serialization";
import { check, financialChecks, sourceChecks, text } from "./financial-verifier";
import { identityChecks } from "./identity-verifier";
import { assertPolicy, VERIFIER_VERSION } from "./policy";
import { keys, RECORD_KEYS } from "./projection";
import { TEMPLATES } from "../m2/schemas";
import type { Decision, Policy, Proposal, VerificationInput, VerificationRun } from "./types";
const hash=(value:unknown)=>sha256(canonicalJSON(value));
/** Entire candidate scope is required, not the ranker's shortlist. Never reads labels or scores. */
export function verify(input: VerificationInput, proposals: readonly Proposal[], policy: Policy): VerificationRun {
  assertPolicy(policy);
  if (!keys(input,["version","split","records"])||input.version!=="ai01-m2/1.1.0"||!["train","development"].includes(input.split)||!Array.isArray(input.records)||input.records.some(r=>!keys(r,RECORD_KEYS))) throw new Error("Invalid verification envelope or injected field");
  if (!Array.isArray(proposals)||proposals.some(p=>!keys(p,["bankId","ledgerId","algorithm","topology"])||!text(p.bankId)||!text(p.ledgerId)||!["E0","E1","E2b"].includes(p.algorithm)||!["PAIR","GROUP","PARTIAL"].includes(p.topology))) throw new Error("Invalid proposal or injected upstream evidence");
  const records=input.records;
  const templates=TEMPLATES.filter(t=>t.split===input.split);
  const completeScope=records.length===templates.length*25&&templates.every(t=>records.filter(r=>r.templateId===t.id).length===25)&&records.every(r=>sourceChecks(r,input.split).every(c=>c.status==="PASS"));
  const duplicate=records.some((r,i)=>records.some((s,j)=>i!==j&&(s.id===r.id||s.sourceRowId===r.sourceRowId||(r.sourceTransactionId!==null&&r.sourceTransactionId===s.sourceTransactionId&&r.systemId===s.systemId&&r.accountId===s.accountId))));
  const decisions: Decision[]=proposals.map((p,index)=>{
    const b=records.find(r=>r.id===p.bankId),l=records.find(r=>r.id===p.ledgerId);
    const checks=[check("RECORD_EXISTENCE",b&&l?"PASS":"NOT_VERIFIED",p.bankId,p.ledgerId),check("UNIQUE_SOURCE_IDENTITIES",duplicate?"NOT_VERIFIED":"PASS"),check("PAIR_TOPOLOGY",p.topology==="PAIR"?"PASS":"NOT_VERIFIED"),check("DISTINCT_ROLES",b?.role==="BANK"&&l?.role==="LEDGER"&&p.bankId!==p.ledgerId?"PASS":"NOT_VERIFIED",p.bankId,p.ledgerId)];
    checks.push(check("COMPLETE_SYNTHETIC_SCOPE",completeScope?"PASS":"NOT_VERIFIED"));
    if(b&&l){
      checks.push(...sourceChecks(b,input.split),...sourceChecks(l,input.split),...financialChecks(b,l,policy),...identityChecks(b,l));
      // Unknown financial evidence also remains a possible competitor: fail closed.
      const alternatives=records.filter(r=>(r.role==="LEDGER"&&r.id!==l.id&&!financialChecks(b,r,policy).some(c=>c.status==="FAIL"))||(r.role==="BANK"&&r.id!==b.id&&!financialChecks(r,l,policy).some(c=>c.status==="FAIL")));
      checks.push(check("UNIQUE_FINANCIALLY_PLAUSIBLE_PARTNER",alternatives.length?"NOT_VERIFIED":"PASS",...alternatives.map(r=>r.id).sort()));
    }
    const conflicts=proposals.filter((q,j)=>j!==index&&(q.bankId===p.bankId||q.ledgerId===p.ledgerId));
    checks.push(check("UNIQUE_ASSIGNMENT",conflicts.length?"NOT_VERIFIED":"PASS",...conflicts.flatMap(q=>[q.bankId,q.ledgerId]).sort()));
    return {...p,verifierVersion:VERIFIER_VERSION,policyVersion:policy.version,checks,reasons:[...new Set(checks.filter(c=>c.status!=="PASS").map(c=>c.code))],disposition:checks.some(c=>c.status==="FAIL")?"BLOCKED_PROPOSAL":checks.some(c=>c.status==="NOT_VERIFIED")?"UNRESOLVED_REVIEW":"VERIFIED_SUGGESTION"};
  });
  const result={verifierVersion:VERIFIER_VERSION,policy:structuredClone(policy),datasetVersion:input.version,split:input.split,inputFingerprint:hash(input),proposalFingerprint:hash(proposals),decisions};
  return {...result,fingerprint:hash(result)};
}
