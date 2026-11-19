import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import type {TransactionDatabase} from '../db/postgres';
import {normalizeCashSource} from '../poc-reconciliation/normalize';
import {approvedPoCSourceHashes} from '../poc-reconciliation/service';
import {createFinancialProcessingService} from './service';
import {digest,type RegisteredPair,type SourceInput} from './processing';
import type {CashSource} from '../../poc-reconciliation/contracts';
import type {Provider} from './ai03/types';

export const TRUSTED_INGESTION_VERSION='db04-trusted-ingestion/1';
/** Internal engine-produced input, not an external JSON or HTTP ingestion contract. */
export interface TrustedCashIngestion {
 version:typeof TRUSTED_INGESTION_VERSION;
 contract:'cash-source-v1';
 documents:ReadonlyArray<{document:SourceInput;verified:CashSource}>;
}
export type UnsupportedIngestion={supported:false;reason:'UNSUPPORTED_CONTRACT_OR_CLASSIFICATION'|'INVALID_SOURCE_PROVENANCE'|'CONFLICTING_SOURCE_CLASSIFICATION'};
export function adaptTrustedIngestion(input:unknown,registry:RegisteredPair=approvedPoCSourceHashes):UnsupportedIngestion|{supported:true;version:typeof TRUSTED_INGESTION_VERSION;bank:SourceInput;ledger:SourceInput} {
 if(!input||typeof input!=='object'||(input as TrustedCashIngestion).version!==TRUSTED_INGESTION_VERSION||(input as TrustedCashIngestion).contract!=='cash-source-v1')
  return {supported:false,reason:'UNSUPPORTED_CONTRACT_OR_CLASSIFICATION'};
 const envelope=input as TrustedCashIngestion;
 if(!Array.isArray(envelope.documents)||envelope.documents.length!==2)return {supported:false,reason:'INVALID_SOURCE_PROVENANCE'};
 try {
  const sources:Partial<Record<'bank'|'ledger',SourceInput>>={};
  let scope:string|undefined;
  for(const item of envelope.documents) {
   if(!(item.document?.bytes instanceof Uint8Array)||item.document.bytes.byteLength<1||item.document.bytes.byteLength>512000||typeof item.document.filename!=='string')throw Error();
   const document={bytes:Uint8Array.from(item.document.bytes),filename:item.document.filename};
   const sha=digest(document.bytes),kind=sha===registry.bank?'bank':sha===registry.ledger?'ledger':null;
   if(!kind)return {supported:false,reason:'UNSUPPORTED_CONTRACT_OR_CLASSIFICATION'};
   if(sources[kind]||item.verified?.kind!==kind)return {supported:false,reason:'CONFLICTING_SOURCE_CLASSIFICATION'};
   // Independently recompute from bytes; never trust an accepted label or supplied amount.
   const authoritative=normalizeCashSource(document.bytes,kind,document.filename);
   const currentScope=JSON.stringify([authoritative.businessId,authoritative.period,authoritative.currency]);
   if(scope!==undefined&&scope!==currentScope)return {supported:false,reason:'INVALID_SOURCE_PROVENANCE'};
   scope=currentScope;
   if(!isDeepStrictEqual(item.verified,authoritative))return {supported:false,reason:'INVALID_SOURCE_PROVENANCE'};
   sources[kind]=document;
  }
  if(!sources.bank||!sources.ledger)return {supported:false,reason:'CONFLICTING_SOURCE_CLASSIFICATION'};
  return {supported:true,version:TRUSTED_INGESTION_VERSION,bank:sources.bank,ledger:sources.ledger};
 }catch{return {supported:false,reason:'INVALID_SOURCE_PROVENANCE'};}
}

/** Reuse DB04 transactions/authorization; never invent C1/V2 roles or approvals. */
export function createTrustedIngestionService(db:TransactionDatabase,registered:RegisteredPair=approvedPoCSourceHashes) {
 const registry=Object.freeze({...registered}),processing=createFinancialProcessingService(db,registry);
 return {
  async process(token:string,input:unknown,e5?:Provider) {
   const adapted=adaptTrustedIngestion(input,registry);
   if(!adapted.supported)return adapted;
   const receipt=await processing.persist(token,adapted.bank,adapted.ledger);
   const before=await processing.get(token,receipt.processingId);
   if(!before.rankings.some(r=>r.version==='db04-fuzzy-proposals/1'))await processing.rankFuzzy(token,receipt.processingId);
   if(e5&&!before.rankings.some(r=>r.version==='db04-e5-proposals/1'))await processing.rankE5(token,receipt.processingId,e5);
   await processing.verifyRankings(token,receipt.processingId);
   return {supported:true as const,version:TRUSTED_INGESTION_VERSION,...receipt,context:await processing.get(token,receipt.processingId)};
  }
 };
}
