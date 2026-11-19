import 'server-only';
import type {TransactionDatabase} from '../db/postgres';
import type {FinanceAdmission} from './team-contracts';
import {createTrustedIngestionService} from './trusted-ingestion';
import {createFinancialProcessingService} from './service';
import {financialViews} from './financial-views';
import type {RegisteredPair} from './processing';
import type {Provider} from './ai03/types';
/** Internal composition only. No route, owner connection or identity fallback.
 * Caller owns the database lifecycle and supplies Jason's trusted admission.
 * No group issuer, identity schema, password system or synthetic fallback. */
export function createReconciliationBackend<IdentityContext>(input:{financial:TransactionDatabase;admission:FinanceAdmission<IdentityContext>;registry:RegisteredPair}){
 const {admission}=input;
 if(!admission||typeof admission.withFinance!=='function')throw Error('FINANCE_ADMISSION_REQUIRED');
 if(!input.registry||!['bank','ledger'].every(k=>typeof input.registry[k as keyof RegisteredPair]==='string'&&/^[a-f0-9]{64}$/.test(input.registry[k as keyof RegisteredPair]))||input.registry.bank===input.registry.ledger)throw Error('REGISTERED_SOURCES_REQUIRED');
 const registry=Object.freeze({...input.registry});
 const pipeline=createTrustedIngestionService(input.financial,registry);
 const processing=createFinancialProcessingService(input.financial,registry);
 const read=async(capability:string,id:string)=>{
  const context=await processing.get(capability,id);
  return {version:'db04-backend-read/1' as const,processingId:id,...context,
   financialViews:financialViews({version:'db04-processing-read/1',processingId:id,...context},id)};
 };
 return {
  process:(identity:IdentityContext,documents:unknown,e5?:Provider)=>admission.withFinance(identity,async capability=>{
   const result=await pipeline.process(capability,documents,e5);
   if(!result.supported)return result;
   return {supported:true as const,reused:result.reused,...await read(capability,result.processingId)};
  }),
  get:(identity:IdentityContext,processingId:string)=>admission.withFinance(identity,capability=>read(capability,processingId)),
 };
}
