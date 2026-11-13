import 'server-only';
import {cashCents} from '../../poc-reconciliation/engine';
import {supportedPolicy} from './processing';
export const PROPOSAL_POLICY='db04-independent-proposals/1';
type Row=Record<string,unknown>;
const text=(x:unknown)=>typeof x==='string'&&x.trim()?x.normalize('NFC').trim():null;
const date=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
function cents(x:unknown):bigint|null {try{return typeof x==='string'?cashCents(x):null;}catch{return null;}}
/** No candidate-supplied financial value is used as authority. Scores never approve identity. */
export function verifyPersistedProposals(org:string,id:string,job:Row,sources:Row[],records:Row[],rankings:Row[],deterministic:Row[]) {
 const policy=supportedPolicy(job.policy as {version:string;maxDays:number});
 const candidates=rankings.flatMap(r=>Array.isArray(r.evidence)?r.evidence.map((e:unknown)=>({algorithm:r.version,candidate:e&&typeof e==='object'?e as Row:{}})):[{algorithm:r.version,candidate:{}}]);
 if(candidates.length>10000)throw Error('VERIFICATION_BOUND_EXCEEDED');
 const pair=(c:Row)=>JSON.stringify([c.bankRecordId,c.ledgerRecordId]);
 return candidates.map(({algorithm,candidate:c},ordinal)=>{
  const b=records.find(r=>r.kind==='BANK'&&r.record_id===c.bankRecordId),l=records.find(r=>r.kind==='LEDGER'&&r.record_id===c.ledgerRecordId);
  const bs=sources.find(s=>s.kind==='BANK'),ls=sources.find(s=>s.kind==='LEDGER');
  const be=b?.evidence&&typeof b.evidence==='object'?b.evidence as Row:{},le=l?.evidence&&typeof l.evidence==='object'?l.evidence as Row:{};
  const ba=cents(b?.signed_amount),la=cents(l?.signed_amount);
  const checks={
   RECORDS_EXIST:!!b&&!!l,
   CONTEXT:job.organization_id===org&&job.processing_id===id&&b?.organization_id===org&&l?.organization_id===org&&b?.processing_id===id&&l?.processing_id===id,
   ACCEPTED:!!b&&!!l&&['VALID','WARNING'].includes(String(b.status))&&['VALID','WARNING'].includes(String(l.status)),
   SOURCE_IDENTITY:typeof bs?.sha256==='string'&&typeof ls?.sha256==='string'&&/^[a-f0-9]{64}$/.test(bs.sha256)&&/^[a-f0-9]{64}$/.test(ls.sha256)&&bs.sha256!==ls.sha256&&b?.sha256===bs.sha256&&l?.sha256===ls.sha256,
   EXACT_AMOUNT:ba!==null&&la!==null&&ba===la,
   CURRENCY:b?.currency==='MYR'&&l?.currency===b.currency,
   DIRECTION:ba!==null&&la!==null&&((ba>0n&&la>0n)||(ba<0n&&la<0n)),
   DATE_BASIS:b?.date_basis==='VALUE_DATE'&&l?.date_basis==='POSTING_DATE'&&b?.canonical_date===b?.value_date&&l?.canonical_date===l?.posting_date&&b?.transaction_date===null&&l?.transaction_date===null,
   DATE_POLICY:date(b?.canonical_date)&&date(l?.canonical_date)&&Math.abs(Date.parse(String(b?.canonical_date))-Date.parse(String(l?.canonical_date)))/86400000<=policy.maxDays,
   RAW_FINANCIAL_EVIDENCE:ba!==null&&la!==null&&cents(be.SignedCashMovementMYR)===ba&&cents(le.SignedCashMovementMYR)===la,
   RAW_ACCOUNTING:ba!==null&&la!==null&&cents(be.BankAmountMYR)!==null&&cents(be.BankAmountMYR)!>=0n&&['Credit','Debit'].includes(String(be.BankDirection))&&ba===(be.BankDirection==='Credit'?cents(be.BankAmountMYR)!:-cents(be.BankAmountMYR)!)&&le.CashAccount==='1000-BANK'&&cents(le.CashAccountDebitMYR)!==null&&cents(le.CashAccountCreditMYR)!==null&&cents(le.CashAccountDebitMYR)!>=0n&&cents(le.CashAccountCreditMYR)!>=0n&&(cents(le.CashAccountDebitMYR)===0n||cents(le.CashAccountCreditMYR)===0n)&&la===cents(le.CashAccountDebitMYR)!-cents(le.CashAccountCreditMYR)!,
   RAW_DATES:be.ValueDate===b?.value_date&&le.PostingDate===l?.posting_date&&date(be.ValueDate)&&date(le.PostingDate),
   DISTINCT_RECORDS:!!b&&!!l&&b!==l,
  };
  const known=['db04-fuzzy-proposals/1','db04-e5-proposals/1','db04-gpt-proposals/1'].includes(String(algorithm));
  const lineage=known&&c.version===algorithm&&c.bankSha256===b?.sha256&&c.ledgerSha256===l?.sha256&&c.amount===b?.signed_amount&&c.currency===b?.currency&&c.bankDateBasis===b?.date_basis&&c.ledgerDateBasis===l?.date_basis&&typeof c.score==='number'&&Number.isFinite(c.score)&&c.scoringEvidence!==null&&typeof c.scoringEvidence==='object';
  const identity={REFERENCE:!!text(be.BankReference)&&text(be.BankReference)===text(le.LedgerReference),COUNTERPARTY:!!text(be.Counterparty)&&text(be.Counterparty)===text(le.Counterparty)};
  const bankPartners=[...new Set(candidates.filter(x=>x.candidate.bankRecordId===c.bankRecordId).map(x=>x.candidate.ledgerRecordId))];
  const ledgerPartners=[...new Set(candidates.filter(x=>x.candidate.ledgerRecordId===c.ledgerRecordId).map(x=>x.candidate.bankRecordId))];
  const conflicts={
   competingBank:bankPartners.length>1,competingLedger:ledgerPartners.length>1,
   duplicatePair:candidates.filter(x=>x.algorithm===algorithm&&pair(x.candidate)===pair(c)).length>1,
   deterministic:deterministic.some(d=>d.decision==='VERIFIED_SUGGESTION'&&((d.bank_record_id===c.bankRecordId&&d.ledger_record_id!==c.ledgerRecordId)||(d.ledger_record_id===c.ledgerRecordId&&d.bank_record_id!==c.bankRecordId))),
   alreadyDeterministic:deterministic.some(d=>d.decision==='VERIFIED_SUGGESTION'&&d.bank_record_id===c.bankRecordId&&d.ledger_record_id===c.ledgerRecordId),
  };
  const reasons=[...Object.entries(checks).filter(([,v])=>!v).map(([k])=>k),...Object.entries(conflicts).filter(([,v])=>v).map(([k])=>'CONFLICT_'+k),...(!lineage?['RANKING_LINEAGE_OR_VERSION']:[]),...(!Object.values(identity).every(Boolean)?['IDENTITY_NOT_ESTABLISHED']:[]),...(c.ledgerRecordIds||c.bankRecordIds||c.proposalType&&c.proposalType!=='ONE_TO_ONE'?['GROUP_PARTIAL_UNSUPPORTED']:[]),'ASSIGNMENT_POLICY_NOT_APPROVED'];
  return {version:PROPOSAL_POLICY,ordinal,organizationId:org,processingId:id,algorithm,bankRecordId:c.bankRecordId??null,ledgerRecordId:c.ledgerRecordId??null,bankSha256:b?.sha256??null,ledgerSha256:l?.sha256??null,financialPolicy:policy.version,checks,identity,rankingLineage:lineage,financialEligible:Object.values(checks).every(Boolean),conflicts,bankPartners,ledgerPartners,outcome:'UNRESOLVED' as const,reasons};
 });
}
