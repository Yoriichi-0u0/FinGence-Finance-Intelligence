import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SplitInput } from "../../research/reconciliation/m2/types";
import { project } from "../../research/reconciliation/ai04/projection";
import { verify } from "../../research/reconciliation/ai04/orchestrator";
import { POLICY } from "../../research/reconciliation/ai04/policy";
import { financialChecks } from "../../research/reconciliation/ai04/financial-verifier";
import type { Policy, Proposal, RecordEvidence, VerificationInput } from "../../research/reconciliation/ai04/types";
function fixture(){
  const source=JSON.parse(readFileSync("research/reconciliation/m2/fixtures/inputs/train.json","utf8")) as SplitInput;
  const baseline=JSON.parse(readFileSync("docs/reconciliation/evidence/ai02/results.json","utf8"));
  const pair=baseline.results.find((r:{method:string;split:string})=>r.method==="E0"&&r.split==="train").run.suggestions[0];
  const input=structuredClone(project(source)),proposal:Proposal={...pair,algorithm:"E2b",topology:"PAIR"};
  const b=input.records.find(r=>r.id===pair.bankId)! as Mutable,l=input.records.find(r=>r.id===pair.ledgerId)! as Mutable;
  // Unit-only isolation: frozen files are never written. Give this pair unique valid source money.
  amount(b,"123456789.1234567");amount(l,"123456789.1234567");
  return {source,input,proposal,b,l};
}
type Mutable={-readonly [K in keyof RecordEvidence]:RecordEvidence[K]};
const disposition=(f:ReturnType<typeof fixture>)=>verify(f.input,[f.proposal],POLICY).decisions[0];
function amount(r:Mutable,value:string){r.amount=value;if(r.sourceAmount!==null)r.sourceAmount=(r.sourceAmount.startsWith("-")?"-":"")+value;if(r.debit!==null)r.debit=value;if(r.credit!==null)r.credit=value;}
describe("AI04 independent research verification",()=>{
  it("surfaces a fully evidenced unique pair without accounting confirmation",()=>{const f=fixture();expect(disposition(f).disposition).toBe("VERIFIED_SUGGESTION");});
  it("blocks exact amount mismatch",()=>{const f=fixture();amount(f.l,"0.0000000001");expect(disposition(f).disposition).toBe("BLOCKED_PROPOSAL");expect(disposition(f).reasons).toContain("EXACT_AMOUNT");});
  it("preserves large exact money and detects a sub-Number difference",()=>{const f=fixture();amount(f.b,"900719925474099312345.123456789");amount(f.l,"900719925474099312345.1234567890");expect(disposition(f).disposition).toBe("VERIFIED_SUGGESTION");amount(f.l,"900719925474099312345.123456788");expect(disposition(f).disposition).toBe("BLOCKED_PROPOSAL");});
  it("blocks currency mismatch despite matching identity",()=>{const f=fixture();f.l.currency=f.b.currency==="MYR"?"USD":"MYR";expect(disposition(f).reasons).toContain("CURRENCY");expect(disposition(f).disposition).toBe("BLOCKED_PROPOSAL");});
  it("blocks direction mismatch",()=>{const f=fixture();f.l.direction=f.b.direction==="INFLOW"?"OUTFLOW":"INFLOW";expect(disposition(f).reasons).toContain("DIRECTION");});
  it("blocks outside two canonical days",()=>{const f=fixture();f.l.canonicalDate="2024-01-31";expect(disposition(f).reasons).toContain("CANONICAL_DATE_WINDOW");});
  it("keeps posting and transaction dates distinct and verifies basis",()=>{const f=fixture();f.b.canonicalDateBasis="POSTING_DATE";expect(disposition(f).reasons).toContain("DATE_BASIS");expect(disposition(f).disposition).toBe("UNRESOLVED_REVIEW");});
  it("accepts inclusive two-day boundary and not three",()=>{const f=fixture();f.b.canonicalDate="2024-01-01";f.l.canonicalDate="2024-01-03";expect(financialChecks(f.b,f.l,POLICY).every(c=>c.status==="PASS")).toBe(true);f.l.canonicalDate="2024-01-04";expect(financialChecks(f.b,f.l,POLICY).at(-1)?.status).toBe("FAIL");});
  it("withholds missing source identity",()=>{const f=fixture();f.b.systemId="";expect(disposition(f).reasons).toContain("SOURCE_IDENTITY");});
  it("withholds wrong source role",()=>{const f=fixture();f.b.role="LEDGER";expect(disposition(f).reasons).toContain("DISTINCT_ROLES");});
  it("withholds nonexistent record",()=>{const f=fixture();f.proposal.bankId="absent";expect(disposition(f).reasons).toContain("RECORD_EXISTENCE");});
  it("withholds self-match",()=>{const f=fixture();f.proposal.ledgerId=f.proposal.bankId;expect(disposition(f).reasons).toContain("DISTINCT_ROLES");});
  it("withholds missing counterparty",()=>{const f=fixture();f.b.counterparty=null;expect(disposition(f).reasons).toContain("COUNTERPARTY_MISSING");});
  it("treats conflicting spellings as unverified rather than financial falsehood",()=>{const f=fixture();f.l.counterparty="Different spelling Ltd";expect(disposition(f).disposition).toBe("UNRESOLVED_REVIEW");expect(disposition(f).reasons).toContain("COUNTERPARTY_CONFLICT");});
  it("withholds missing reference even for identical descriptions upstream",()=>{const f=fixture();f.b.reference=null;expect(disposition(f).reasons).toContain("REFERENCE_MISSING");});
  it("does not remove punctuation or case from references",()=>{const f=fixture();f.l.reference=f.b.reference!.toLowerCase();expect(disposition(f).reasons).toContain("REFERENCE_CONFLICT");});
  it("allows only NFC and outer whitespace identity normalization",()=>{const f=fixture();f.l.reference=" "+f.b.reference+" ";f.l.counterparty=" "+f.b.counterparty+" ";expect(disposition(f).disposition).toBe("VERIFIED_SUGGESTION");});
  it("withholds duplicate records and repeated same proposal objects",()=>{const f=fixture();(f.input.records as Mutable[]).push(structuredClone(f.b));expect(disposition(f).reasons).toContain("UNIQUE_SOURCE_IDENTITIES");const g=fixture();expect(verify(g.input,[g.proposal,g.proposal],POLICY).decisions.every(d=>d.reasons.includes("UNIQUE_ASSIGNMENT"))).toBe(true);});
  it.each(["bankId","ledgerId"] as const)("withholds reused %s across proposals without picking first",key=>{const f=fixture();const other={...f.proposal,[key==="bankId"?"ledgerId":"bankId"]:"absent"};expect(verify(f.input,[f.proposal,other],POLICY).decisions.every(d=>d.reasons.includes("UNIQUE_ASSIGNMENT"))).toBe(true);});
  it("withholds equal-value recurring partners irrespective of semantic score",()=>{const f=fixture();const other=f.input.records.find(r=>r.role==="LEDGER"&&r.id!==f.l.id)! as Mutable;amount(other,f.l.amount);other.currency=f.l.currency;other.direction=f.l.direction;other.canonicalDate=f.l.canonicalDate;expect(disposition(f).reasons).toContain("UNIQUE_FINANCIALLY_PLAUSIBLE_PARTNER");});
  it.each(["GROUP","PARTIAL"] as const)("withholds unsupported %s topology without aggregation",topology=>{const f=fixture();f.proposal.topology=topology;expect(disposition(f).reasons).toContain("PAIR_TOPOLOGY");expect(disposition(f).disposition).toBe("UNRESOLVED_REVIEW");});
  it("withholds incomplete provenance",()=>{const f=fixture();f.b.provenance={...f.b.provenance,file:""};expect(disposition(f).reasons).toContain("SYNTHETIC_PROVENANCE");});
  it("withholds missing account and unapproved eligibility",()=>{const f=fixture();f.b.accountId="";f.b.eligibility="VALID" as Mutable["eligibility"];expect(disposition(f).reasons).toContain("SYNTHETIC_ELIGIBILITY");});
  it.each(["1e2","NaN","-0","1,000","",null,0])("never repairs malformed or unavailable amount %s",value=>{const f=fixture();f.b.amount=value as string;expect(disposition(f).disposition).toBe("UNRESOLVED_REVIEW");expect(disposition(f).reasons).toContain("EXACT_AMOUNT");});
  it("does not equate null with zero",()=>{const f=fixture();f.b.amount=null as unknown as string;f.l.amount="0";expect(financialChecks(f.b,f.l,POLICY)[0].status).toBe("NOT_VERIFIED");});
  it("checks signed basis and unused null columns",()=>{const f=fixture();f.b.sourceAmount="0";f.b.debit="0";expect(disposition(f).reasons).toContain("MONETARY_BASIS");});
  it.each(["supported","score","confidence","economicId","groundTruth"])("rejects injected proposal %s",key=>{const f=fixture();expect(()=>verify(f.input,[{...f.proposal,[key]:1}],POLICY)).toThrow("injected");});
  it("rejects truth injection at envelope and source boundaries",()=>{const f=fixture();expect(()=>verify({...f.input,truth:[]} as VerificationInput,[f.proposal],POLICY)).toThrow();expect(()=>project({...f.source,truth:[]} as SplitInput)).toThrow();expect(()=>project({...f.source,records:f.source.records.map(r=>({...r,economicId:"secret"}))})).toThrow();});
  it("rejects missing or altered policy rather than defaulting",()=>{const f=fixture();expect(()=>verify(f.input,[f.proposal],undefined as unknown as Policy)).toThrow();expect(()=>verify(f.input,[f.proposal],{...POLICY,maxDays:3} as unknown as Policy)).toThrow();});
  it("denies held-out input without reading it",()=>{const f=fixture();expect(()=>project({...f.source,split:"heldout"})).toThrow();expect(()=>verify({...f.input,split:"heldout"} as unknown as VerificationInput,[f.proposal],POLICY)).toThrow();});
  it("requires the complete cohort, not an upstream candidate shortlist",()=>{const f=fixture();f.input.records=[f.b,f.l];expect(disposition(f).reasons).toContain("COMPLETE_SYNTHETIC_SCOPE");});
  it("produces identical decisions and fingerprints without mutating sources",()=>{const f=fixture(),before=JSON.stringify(f);expect(verify(f.input,[f.proposal],POLICY)).toEqual(verify(f.input,[f.proposal],POLICY));expect(JSON.stringify(f)).toBe(before);expect(Object.isFrozen(project(f.source).records[0].provenance)).toBe(true);});
  it("does not use record ordering to choose a competing partner",()=>{const f=fixture();const a=verify(f.input,[f.proposal],POLICY);f.input.records=[...f.input.records].reverse();expect(verify(f.input,[f.proposal],POLICY).decisions).toEqual(a.decisions);});
});
