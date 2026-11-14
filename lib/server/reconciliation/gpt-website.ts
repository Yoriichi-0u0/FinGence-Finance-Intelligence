import 'server-only';
import type {GPTSavedEvidenceReader} from './gpt-saved-evidence';
import {createTransactionSecurityGuard,TransactionSecurityError,type TransactionSecurityGuardDependencies} from '../security/transaction-guard';
import {runAuditedRead} from '../security/audit-api';
import type {TrustedPrincipal} from '../security/authorization';
import type {GPTEvidenceView} from '../../gpt-evidence-view';
export interface GPTWebsiteDependencies extends TransactionSecurityGuardDependencies {
 backend:GPTSavedEvidenceReader;
 /** Owner-supplied DB lookup, never request claims. Must bind the batch to the job and current approved capability. */
 resolveBatch:(principal:TrustedPrincipal,batchId:string)=>Promise<{organizationId:string;batchId:string;processingId:string;capability:string}|null>;
}
const headers={'Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'};
/** No provisioned owner handoff: deliberately unavailable. No env/credential discovery or synthetic fallback. */
export function gptWebsiteRuntime():GPTWebsiteDependencies|null{return null;}
export function createGPTWebsiteHandler(deps:GPTWebsiteDependencies|null){
 return async(request:Request)=>{
  if(!deps)return Response.json({error:'GPT evidence unavailable'},{status:503,headers});
  const url=new URL(request.url),batchId=url.searchParams.get('batchId');
  if(!batchId||!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(batchId)||[...url.searchParams.keys()].some(k=>k!=='batchId')||url.searchParams.getAll('batchId').length!==1)
   return Response.json({error:'Invalid batch'},{status:400,headers});
  try{
   const auth=await createTransactionSecurityGuard(deps).authorizeRequest(request,'batch.read',batchId);
   const event={actorId:auth.principal.subjectId,organizationId:auth.principal.organizationId,action:'batch.read',targetType:'ingestion_batch',targetId:batchId,requestId:auth.requestId,approvalId:auth.approvalId};
   const data=await runAuditedRead({database:deps.database,event,read:async()=>{
    const scope=await deps.resolveBatch(auth.principal,batchId);
    if(!scope||scope.batchId!==batchId||scope.organizationId!==auth.principal.organizationId||!/^[a-f0-9]{64}$/.test(scope.processingId))throw new TransactionSecurityError(404,'RESOURCE_NOT_FOUND');
    const saved=await deps.backend.listSavedGPTEvidence(scope.capability,scope.processingId,{userId:auth.principal.subjectId,organizationId:auth.principal.organizationId});
    const text=(v:unknown)=>typeof v==='string'?v:null;
    const result:GPTEvidenceView={version:'gpt-evidence-view/1',batchId,processingId:scope.processingId,runs:saved.runs.map(run=>{
     if(run.organization_id!==scope.organizationId||run.processing_id!==scope.processingId||run.outcome!=='UNRESOLVED')throw Error('EVIDENCE_SCOPE_DENIED');
     const items=saved.items.filter(item=>item.evidence_id===run.evidence_id).map(item=>{
      if(item.organization_id!==scope.organizationId||item.processing_id!==scope.processingId||item.outcome!=='UNRESOLVED'||!['SUGGESTION','ABSTENTION'].includes(String(item.item_type)))throw Error('EVIDENCE_SCOPE_DENIED');
      return {type:item.item_type as 'SUGGESTION'|'ABSTENTION',ordinal:Number(item.ordinal),bankId:text(item.bank_claim),ledgerId:text(item.ledger_claim),recordId:text(item.record_claim),bankReference:text(item.bank_reference),ledgerReference:text(item.ledger_reference),explanation:String(item.explanation),reasons:item.reasons as string[],verification:item.verification as Record<string,unknown>,score:null,outcome:'UNRESOLVED' as const};
     });
     if(items.filter(i=>i.type==='SUGGESTION').length!==run.suggestion_count||items.filter(i=>i.type==='ABSTENTION').length!==run.abstention_count)throw Error('INCOMPLETE_EVIDENCE');
     return {evidenceId:String(run.evidence_id),model:String(run.model_version),prompt:String(run.prompt_version),createdAt:String(run.created_at),bankSha256:String(run.bank_sha256),ledgerSha256:String(run.ledger_sha256),outcome:'UNRESOLVED',items};
    })};return result;
   }});
   return Response.json(data,{headers});
  }catch(error){const status=error instanceof TransactionSecurityError?error.status:503;return Response.json({error:status===401?'Authentication required':status===404?'Evidence not found':'GPT evidence unavailable or access denied'},{status,headers});}
 };
}
