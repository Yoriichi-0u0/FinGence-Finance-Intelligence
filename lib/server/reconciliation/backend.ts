import 'server-only';
import type {TransactionDatabase} from '../db/postgres';
import {createHostedAdmission,type HostedAuthority} from './hosted-identity';
import {createTrustedIngestionService} from './trusted-ingestion';
import {createFinancialProcessingService} from './service';
import {financialViews} from './financial-views';
import type {RegisteredPair} from './processing';
import type {Provider} from './ai03/types';
/** Internal composition only. No route, owner connection or identity fallback.
 * Caller owns both pools and supplies the separately approved authority. */
export function createReconciliationBackend(input:{financial:TransactionDatabase;broker:TransactionDatabase;authority:HostedAuthority;registry:RegisteredPair}){
 const admission=createHostedAdmission(input.authority,input.broker);
 const pipeline=createTrustedIngestionService(input.financial,input.registry);
 const processing=createFinancialProcessingService(input.financial,input.registry);
 const read=async(capability:string,id:string)=>{
  const context=await processing.get(capability,id);
  return {version:'db04-backend-read/1' as const,processingId:id,...context,
   financialViews:financialViews({version:'db04-processing-read/1',processingId:id,...context},id)};
 };
 return {
  process:(accessToken:string,documents:unknown,e5?:Provider)=>admission.withFinance(accessToken,async capability=>{
   const result=await pipeline.process(capability,documents,e5);
   if(!result.supported)return result;
   return {supported:true as const,reused:result.reused,...await read(capability,result.processingId)};
  }),
  get:(accessToken:string,processingId:string)=>admission.withFinance(accessToken,capability=>read(capability,processingId)),
 };
}
