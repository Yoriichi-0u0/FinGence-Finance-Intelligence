import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import {dashboardContext, type ProcessingDashboardV1} from '../../reconciliation-dashboard';
import {rankPersistedCash} from './ranking';
import {digest, type RegisteredPair} from './processing';
import {verifyPersistedProposals} from './proposal-verification';
import {parseSuggestion,type SuggestionEnvelopeV1,VERSION as GPT_SCHEMA_VERSION} from './gpt-schema';
import {GPT_PROMPT_VERSION} from './gpt-prompt';
import {messagesFor} from './gpt-prompt';

export const GPT_VERSION='db04-gpt-proposals/1';
export interface GPTProvider {readonly kind:'GROQ';suggest(messages:ReturnType<typeof messagesFor>):Promise<string>}
/** Internal only. The reader must resolve authorization on every call, including after inference.
 * No persistence until a separately approved immutable evidence migration exists. */
export function createGPTProposer(read:(token:string,id:string)=>Promise<ProcessingDashboardV1>,registry:RegisteredPair){
 const registered=Object.freeze({...registry});
 return async(token:string,id:string,provider:GPTProvider)=>{
  if(process.env.NODE_ENV==='production'||process.env.VERCEL)throw Error('GPT_LOCAL_ONLY');
  if(provider.kind!=='GROQ')throw Error('GPT_PROVIDER_REQUIRED');
  const before=structuredClone(dashboardContext(await read(token,id),id));
  if(before.sources.some(s=>s.classification_method!=='REGISTERED_SYNTHETIC_EXACT_SCHEMA'||s.sha256!==(s.kind==='BANK'?registered.bank:registered.ledger)))throw Error('GPT_REGISTERED_SYNTHETIC_REQUIRED');
  const org=before.job.organization_id;
  if(typeof org!=='string'||!org)throw Error('ACCESS_DENIED');
  const eligible=rankPersistedCash(before,id);
  if(eligible.length>100)throw Error('GPT_CANDIDATE_BOUND');
  // Explicit allowlist: no user/session tokens, raw files, oracle labels or prior decisions.
  const records=before.transactions.map(r=>({kind:r.kind,recordId:r.record_id,sha256:r.sha256,
   amount:r.signed_amount,currency:r.currency,date:r.canonical_date,dateBasis:r.date_basis,
   reference:(r.evidence as Record<string,unknown>)[r.kind==='BANK'?'BankReference':'LedgerReference'],
   counterparty:(r.evidence as Record<string,unknown>).Counterparty,
   description:(r.evidence as Record<string,unknown>)[r.kind==='BANK'?'BankDescription':'LedgerMemo']}));
  const messages=messagesFor({scope:'SYNTHETIC_ONLY',organizationId:org,processingId:id,policy:before.job.policy,records,
   eligiblePairs:eligible.map(c=>({bankId:c.bankRecordId,ledgerId:c.ledgerRecordId}))});
  if(Buffer.byteLength(JSON.stringify(messages))>20000)throw Error('GPT_REQUEST_BOUND');
  let raw:string;
  try{raw=await provider.suggest(messages);}catch{throw Error('GPT_PROVIDER_FAILURE');}
  const proposal=parseSuggestion(raw);
  const after=dashboardContext(await read(token,id),id);
  const authority=gptAuthority;
  if(!isDeepStrictEqual(authority(before),authority(after)))throw Error('GPT_CONTEXT_CHANGED');
  const known=new Set(records.map(r=>r.recordId));
  if(proposal.abstentions.some(a=>!known.has(a.recordId)))throw Error('GPT_UNKNOWN_ABSTENTION');
  const verification=verifyGPTProposal(after,proposal);
  return {version:GPT_VERSION,modelVersion:'openai/gpt-oss-120b' as const,promptVersion:GPT_PROMPT_VERSION,schemaVersion:GPT_SCHEMA_VERSION,organizationId:org,processingId:id,sourceFingerprint:digest(JSON.stringify(authority(before))),
   requestFingerprint:digest(JSON.stringify(messages)),proposalFingerprint:digest(raw),proposal,verification,
   outcome:'UNRESOLVED' as const,persistence:'NOT_PERSISTED_MIGRATION_REQUIRED' as const};
 };
}

export const gptAuthority=(c:ProcessingDashboardV1)=>({job:c.job,sources:c.sources,transactions:c.transactions,proposals:c.proposals,rankings:c.rankings});
export type GPTResult=Awaited<ReturnType<ReturnType<typeof createGPTProposer>>>;
/** Shared independent check for inference and persistence; no stored client verification is trusted. */
export function verifyGPTProposal(context:ProcessingDashboardV1,proposal:SuggestionEnvelopeV1){
 const org=String(context.job.organization_id),id=context.processingId,eligible=rankPersistedCash(context,id);
  const candidates=proposal.suggestions.map(s=>{
   const c=eligible.find(c=>c.bankRecordId===s.bankId&&c.ledgerRecordId===s.ledgerId);
   return {...c,version:GPT_VERSION,bankRecordId:s.bankId,ledgerRecordId:s.ledgerId,
    bankReference:s.bankReference,ledgerReference:s.ledgerReference,rationale:s.rationale};
  });
  const persisted=context.transactions.map(r=>({...r,organization_id:org,processing_id:id}));
  const verification=verifyPersistedProposals(org,id,context.job,context.sources,persisted,
   [...context.rankings??[],{version:GPT_VERSION,evidence:candidates}],context.proposals)
   .filter(r=>r.algorithm===GPT_VERSION).map((r,i)=>{
    const s=proposal.suggestions[i], b=context.transactions.find(r=>r.kind==='BANK'&&r.record_id===s.bankId),l=context.transactions.find(r=>r.kind==='LEDGER'&&r.record_id===s.ledgerId);
    const be=b?.evidence as Record<string,unknown>|undefined,le=l?.evidence as Record<string,unknown>|undefined;
    const referenceClaims=!!b&&!!l&&be?.BankReference===s.bankReference&&le?.LedgerReference===s.ledgerReference;
    const uniqueEligiblePartner=eligible.filter(c=>c.bankRecordId===s.bankId||c.ledgerRecordId===s.ledgerId).length===1;
    return {...r,referenceClaims,uniqueEligiblePartner,reasons:[...r.reasons,...(!referenceClaims?['GPT_REFERENCE_CLAIMS']:[]),...(!uniqueEligiblePartner?['GPT_AMBIGUOUS_OR_INELIGIBLE']:[])]};
   });
 return verification;
}
