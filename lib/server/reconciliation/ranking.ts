import 'server-only';
import {cashCents} from '../../poc-reconciliation/engine';
import {dashboardContext} from '../../reconciliation-dashboard';
import {fuzzyScore} from './ai02/fuzzy';
import {semanticText,cosine} from './ai03/text-features';
import type {Provider} from './ai03/types';
export const RANKING_VERSION='db04-fuzzy-proposals/1';
/** Ranking is separate from financial acceptance; no research cohort/date substitution. */
export function rankPersistedCash(input:unknown,id:string) {
 const context=dashboardContext(input,id);
 if(context.transactions.length>200)throw Error('RANKING_BOUND_EXCEEDED');
 const records=context.transactions.map(r=>{
  if(!['BANK','LEDGER'].includes(String(r.kind))||r.currency!=='MYR'||typeof r.record_id!=='string'||typeof r.canonical_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.canonical_date)||!r.evidence||typeof r.evidence!=='object')throw Error('INCOMPATIBLE_RANKING_INPUT');
  if(r.date_basis!==(r.kind==='BANK'?'VALUE_DATE':'POSTING_DATE')||r.canonical_date!==(r.kind==='BANK'?r.value_date:r.posting_date))throw Error('INCOMPATIBLE_DATE_BASIS');
  const raw=r.evidence as Record<string,string>;
  if(cashCents(raw.SignedCashMovementMYR)!==cashCents(String(r.signed_amount)))throw Error('INCONSISTENT_FINANCIAL_EVIDENCE');
  return {record:r,raw,features:{description:raw.BankDescription??raw.LedgerMemo??null,counterparty:raw.Counterparty??null,reference:raw.BankReference??raw.LedgerReference??null}};
 });
 const seen=new Set<string>();for(const r of records){const key=`${r.record.kind}:${r.record.record_id}`;if(seen.has(key))throw Error('DUPLICATE_RECORD');seen.add(key);}
 const bank=records.filter(r=>r.record.kind==='BANK'),ledger=records.filter(r=>r.record.kind==='LEDGER');
 return bank.flatMap(b=>ledger.filter(l=>l.record.currency===b.record.currency&&l.record.canonical_date===b.record.canonical_date&&cashCents(String(l.record.signed_amount))===cashCents(String(b.record.signed_amount))).map(l=>{
  const score=fuzzyScore(b.features,l.features);
  return {bankRecordId:b.record.record_id,ledgerRecordId:l.record.record_id,bankSha256:b.record.sha256,ledgerSha256:l.record.sha256,
   amount:b.record.signed_amount,currency:b.record.currency,bankDateBasis:b.record.date_basis,ledgerDateBasis:l.record.date_basis,
   version:RANKING_VERSION,score:score.score,scoringEvidence:score.evidence,decision:'UNRESOLVED' as const,
   reasons:['PROPOSAL_ONLY_REQUIRES_INDEPENDENT_VERIFICATION',...score.reasons]};
 }));
}
export const E5_RANKING_VERSION='db04-e5-proposals/1';
export async function rankPersistedE5(input:unknown,id:string,provider:Provider) {
 if(provider.kind!=='PRETRAINED_E5')throw Error('REAL_E5_PROVIDER_REQUIRED');
 const candidates=rankPersistedCash(input,id),context=dashboardContext(input,id);
 const text=(kind:string,key:unknown)=>{
  const r=context.transactions.find(r=>r.kind===kind&&r.record_id===key)!;
  const raw=r.evidence as Record<string,string>;
  return semanticText({description:raw.BankDescription??raw.LedgerMemo??null,counterparty:raw.Counterparty??null,reference:null});
 };
 const texts=[...new Set(candidates.flatMap(c=>[text('BANK',c.bankRecordId),text('LEDGER',c.ledgerRecordId)]))];
 if(texts.length>32)throw Error('E5_BATCH_BOUND_EXCEEDED');
 if(!texts.length)return [];
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const work=async()=>{
   const metadata=await provider.initialize();const result=await provider.embed(texts);
   if(result.vectors.length!==texts.length)throw Error('E5_COVERAGE_MISMATCH');
   return candidates.map(c=>({...c,version:E5_RANKING_VERSION,score:cosine(result.vectors[texts.indexOf(text('BANK',c.bankRecordId))],result.vectors[texts.indexOf(text('LEDGER',c.ledgerRecordId))]),scoringEvidence:{method:'PRETRAINED_E5',metadata},decision:'UNRESOLVED' as const}));
  };
  return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{provider.terminate();reject(Error('E5_DEADLINE'));},120000);})]);
 }finally{clearTimeout(timer);await provider.dispose();}
}
