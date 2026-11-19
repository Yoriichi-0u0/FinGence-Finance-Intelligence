import 'server-only';
import type {ProcessingContext} from '../../demo/pipeline';
import type {CashSourceRow} from '../../poc-reconciliation/contracts';
export const UNEXPLAINED_POLICY='website-unexplained/1';
export type CandidateScope={banks:CashSourceRow[];ledgers:CashSourceRow[];bankAll:CashSourceRow[];ledgerAll:CashSourceRow[];blocked:Set<string>;topology:Set<string>};
const canonicalDay=(value:string)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const time=Date.parse(value+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time/86400000:null;
};
const cents=(value:string)=>/^-?(0|[1-9]\d{0,18})$/.test(value)&&BigInt(value)!==0n&&BigInt(value)>=-9223372036854775808n&&BigInt(value)<=9223372036854775807n;
const identity=(value:unknown)=>typeof value==='string'&&value.length<=200&&!value.includes('\0')?value.normalize('NFC').trim():null;
const unique=(rows:CashSourceRow[])=>new Set(rows.map(r=>r.recordId)).size===rows.length&&new Set(rows.map(r=>r.row)).size===rows.length
 &&new Set(rows.filter(r=>r.sourceTransactionId!==null).map(r=>r.sourceTransactionId)).size===rows.filter(r=>r.sourceTransactionId!==null).length;
/** Trusted post-rule output only. Matcher exceptions alone are never GPT eligibility. */
export function finalUnexplainedScope(context:ProcessingContext):CandidateScope|null{
 const {bank,ledger,resolution,reconciliation}=context.outputs;
 if(!bank||!ledger||!resolution||!reconciliation||!context.scope||resolution.origin!=='DETERMINISTIC_RULES'
  ||resolution.status==='CHECKS_FAILED'||!resolution.checks.length||resolution.checks.some(c=>!c.passed)
  ||resolution.periods.some(p=>p.checks.some(c=>!c.passed))||resolution.sources.bank.sha256!==bank.sha256||resolution.sources.ledger.sha256!==ledger.sha256
  ||bank.kind!=='bank'||ledger.kind!=='ledger'||bank.businessId!==ledger.businessId||bank.currency!==ledger.currency
  ||resolution.scope.businessId!==bank.businessId||resolution.scope.currency!==bank.currency
  ||!unique(bank.rows)||!unique(ledger.rows)||bank.rows.some(b=>ledger.rows.some(l=>l.recordId===b.recordId)))return null;
 const all=resolution.periods.flatMap(p=>p.items),unexplained=all.filter(i=>i.resolution==='UNEXPLAINED');
 if(new Set(unexplained.map(i=>i.id)).size!==unexplained.length||resolution.attention.length!==unexplained.length
  ||resolution.attention.some(i=>i.resolution!=='UNEXPLAINED'||!unexplained.some(u=>u.id===i.id&&u.bankRecordId===i.bankRecordId&&JSON.stringify(u.ledgerRecordIds)===JSON.stringify(i.ledgerRecordIds)))
  ||unexplained.some(i=>i.link!==null||i.entryIds.length>0))return null;
 const ids=(i:typeof all[number])=>[...(i.bankRecordId?[i.bankRecordId]:[]),...i.ledgerRecordIds];
 const blocked=new Set([...all.filter(i=>i.resolution!=='UNEXPLAINED').flatMap(i=>[...ids(i),...(i.link?[i.link.recordId]:[])]),
  ...resolution.entries.flatMap(e=>e.sourceRecordIds),...reconciliation.results.filter(r=>r.status==='MATCH_EXACT'||r.status==='MATCH_DATE_SHIFT').flatMap(r=>[...(r.bankRecordId?[r.bankRecordId]:[]),...r.ledgerRecordIds])]);
 const bankIds=unexplained.flatMap(i=>i.bankRecordId?[i.bankRecordId]:[]),ledgerIds=unexplained.flatMap(i=>i.ledgerRecordIds);
 if(new Set(bankIds).size!==bankIds.length||new Set(ledgerIds).size!==ledgerIds.length||[...bankIds,...ledgerIds].some(id=>blocked.has(id))
  ||bankIds.some(id=>!bank.rows.some(r=>r.recordId===id))||ledgerIds.some(id=>!ledger.rows.some(r=>r.recordId===id)))return null;
 const topology=new Set(unexplained.filter(i=>i.ledgerRecordIds.length>1).flatMap(ids));
 return {banks:bank.rows.filter(r=>bankIds.includes(r.recordId)),ledgers:ledger.rows.filter(r=>ledgerIds.includes(r.recordId)),bankAll:bank.rows,ledgerAll:ledger.rows,blocked,topology};
}
/** Independent source/identity checks adapted from the old 26-check synthetic verifier, not its research schema. */
export function verifyUnexplainedPair(context:ProcessingContext,scope:CandidateScope,b:CashSourceRow,l:CashSourceRow,proposals:ReadonlyArray<{bankId:string;ledgerId:string}>=[{bankId:b.recordId,ledgerId:l.recordId}]){
 const bank=context.outputs.bank!,ledger=context.outputs.ledger!,bd=canonicalDay(b.date),ld=canonicalDay(l.date);
 const plausible=(x:CashSourceRow,y:CashSourceRow)=>cents(x.signedCents)&&cents(y.signedCents)&&x.signedCents===y.signedCents&&x.currency===y.currency
  &&canonicalDay(x.date)!==null&&canonicalDay(y.date)!==null&&Math.abs(canonicalDay(x.date)!-canonicalDay(y.date)!)<=2;
 const checks={policy:'website-pair-verifier/1',proposalPolicy:UNEXPLAINED_POLICY,
  authoritativeRecordIds:scope.banks.includes(b)&&scope.ledgers.includes(l),pairTopology:!scope.topology.has(b.recordId)&&!scope.topology.has(l.recordId),
  uniqueSourceIdentities:unique(bank.rows)&&unique(ledger.rows),finalUnexplained:!scope.blocked.has(b.recordId)&&!scope.blocked.has(l.recordId),
  distinctRoles:b.recordId!==l.recordId&&bank.kind==='bank'&&ledger.kind==='ledger',
  bankSourceIdentity:b.sourceId===bank.sourceId,bankSourceFingerprint:/^[a-f0-9]{64}$/.test(bank.sha256),bankEligibility:scope.banks.includes(b),
  bankTransactionIdentity:b.sourceTransactionId===null||b.sourceTransactionId.length>0,bankMonetaryBasis:cents(b.signedCents),bankDateBasis:bd!==null,
  ledgerSourceIdentity:l.sourceId===ledger.sourceId,ledgerSourceFingerprint:/^[a-f0-9]{64}$/.test(ledger.sha256),ledgerEligibility:scope.ledgers.includes(l),
  ledgerTransactionIdentity:l.sourceTransactionId===null||l.sourceTransactionId.length>0,ledgerMonetaryBasis:cents(l.signedCents),ledgerDateBasis:ld!==null,
  equalSignedCents:cents(b.signedCents)&&cents(l.signedCents)&&BigInt(b.signedCents)===BigInt(l.signedCents),sameCurrency:b.currency===l.currency&&b.currency===bank.currency,
  sameDirection:cents(b.signedCents)&&cents(l.signedCents)&&b.signedCents.startsWith('-')===l.signedCents.startsWith('-'),dateWithinSevenDays:bd!==null&&ld!==null&&Math.abs(bd-ld)<=2,
  referenceAgreement:!!identity(b.reference)&&identity(b.reference)===identity(l.reference),businessScope:b.businessId===bank.businessId&&l.businessId===ledger.businessId,
  authoritativeReferences:identity(b.reference)!==null&&identity(l.reference)!==null,uniqueFinancialPartner:!scope.ledgerAll.some(r=>r!==l&&plausible(b,r))&&!scope.bankAll.some(r=>r!==b&&plausible(r,l)),uniqueAssignment:proposals.filter(p=>p.bankId===b.recordId||p.ledgerId===l.recordId).length===1};
 return {checks,passed:Object.values(checks).every(value=>value!==false)};
}
