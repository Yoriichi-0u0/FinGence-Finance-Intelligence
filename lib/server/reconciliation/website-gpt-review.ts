import 'server-only';
import {z} from 'zod';
import {gptReviewView,gptReviewResult} from '../../gpt-review-view';
import {caller,type Caller} from '../workspace/session';
import {boundedJson} from '../ai/request';
import {WebsiteGPTError,gptDiagnosticReason,reportWebsiteGPT} from './website-gpt-diagnostics';
import type {Owner} from './website-job-gpt';
export interface GPTReviewStore{reviewOperation(owner:Owner,action:'READ'|'APPROVE'|'REJECT',payload?:unknown):Promise<unknown>}
const command=z.object({decision:z.enum(['APPROVE','REJECT']),ordinal:z.number().int().min(0).max(99),requestId:z.uuid(),expectedEvidenceId:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** No client identities, roles, amounts or candidate records are accepted. SQL rechecks the session and stored lineage. */
export async function websiteGPTReview(request:Request,deps:{store:(token:string)=>GPTReviewStore|null;verify?:(headers:Headers)=>Promise<Caller>}){
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
 const reply=(body:unknown,status:number)=>Response.json(body,{status,headers});
 const url=new URL(request.url),jobId=url.searchParams.get('jobId');
 if(!jobId||!z.uuid().safeParse(jobId).success||url.searchParams.size!==1)return reply({code:'INVALID_JOB'},400);
 if(!['GET','POST'].includes(request.method))return reply({code:'METHOD_NOT_ALLOWED'},405);
 let action:'READ'|'APPROVE'|'REJECT'='READ',payload:unknown=null;
 if(request.method==='POST'){
  const input=await boundedJson(request,1024);if('refusal'in input)return input.refusal;
  const parsed=command.safeParse(input.body);if(!parsed.success)return reply({code:'INVALID_REVIEW'},400);
  const {decision,...rest}=parsed.data;action=decision;payload=rest;
 }
 try{
  const who=await (deps.verify??caller)(request.headers);
  if(who.kind!=='SIGNED_IN')return reply({code:'SIGN_IN_REQUIRED'},who.kind==='UNAVAILABLE'?503:401);
  if(!['FINANCE','ADMIN','SUPERADMIN'].includes(who.principal.role))return reply({code:'FORBIDDEN'},403);
  const store=deps.store(who.tokenHash);if(!store)return reply({code:'GPT_REVIEW_UNAVAILABLE'},503);
  const owner={organizationId:who.principal.organization.id,memberId:who.principal.memberId,jobId};
  const value=await store.reviewOperation(owner,action,payload);
  const checked=action==='READ'?gptReviewView.safeParse(value):gptReviewResult.safeParse(value);
  if(!checked.success)throw new WebsiteGPTError('GPT_EVIDENCE_INVALID');
  return reply(checked.data,200);
 }catch(error){
  reportWebsiteGPT('READ',gptDiagnosticReason(error,'READ_FAILED'));
  if(error instanceof WebsiteGPTError){
   if(error.reason==='GPT_JOB_DENIED')return reply({code:'NO_SAVED_EVIDENCE'},404);
   if(error.reason==='GPT_SESSION_DENIED')return reply({code:'SIGN_IN_REQUIRED'},401);
   if(error.reason==='GPT_SQL_DUPLICATE')return reply({code:'REVIEW_CONFLICT'},409);
  }
  return reply({code:'GPT_REVIEW_UNAVAILABLE'},503);
 }
}
