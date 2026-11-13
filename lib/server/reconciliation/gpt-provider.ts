import 'server-only';
import OpenAI from 'openai';
import type {ChatCompletionCreateParamsNonStreaming} from 'openai/resources/chat/completions';
import {OUTPUT_SCHEMA} from './gpt-schema';
import {SYSTEM_PROMPT} from './gpt-prompt';
type Message={role:'system'|'user';content:string};

export const GROQ_BASE_URL='https://api.groq.com/openai/v1';
export const GROQ_ENDPOINT=GROQ_BASE_URL+'/chat/completions';
export const GROQ_MODEL='openai/gpt-oss-120b';
export const GROQ_LIMITS=Object.freeze({requestBytes:24576,responseBytes:131072,generatedBytes:16384,
  outputTokens:2048,timeoutMs:30000});
// Groq documents on_demand/hidden; these are compatibility extensions to the SDK types.
export type GroqRequest=Omit<ChatCompletionCreateParamsNonStreaming,'service_tier'> & {
  service_tier:'on_demand';reasoning_format:'hidden';
};
export interface GroqUsage {prompt_tokens?:number;completion_tokens?:number;total_tokens?:number;
  prompt_time?:number;completion_time?:number;queue_time?:number;total_time?:number}
export interface GroqEvidence {
  provider:'GROQ';requestedModel:string;returnedModel:string|null;request:GroqRequest|null;
  freePlanBasis:'USER_CONFIRMED_FREE_PLAN_NOT_API_ATTESTED';firstRequestExplicitlyApproved:true;
  attempted:boolean;httpDispatchCount:number;responseReceived:boolean;finishReason:string|null;
  generatedJSON:string|null;usage:GroqUsage|null;latencyMs:number|null;outcome:string;
  error:{status:number|null;code:string|null;reason:string}|null;
}
export function groqConfiguration(env:NodeJS.ProcessEnv=process.env){
  if(env.FINGENCE_LLM_MODE!=='groq')return {ready:false as const,reason:'GROQ_EXPLICIT_MODE_REQUIRED'};
  if(env.FINGENCE_GROQ_FREE_PLAN_CONFIRMED!=='1')return {ready:false as const,reason:'GROQ_FREE_PLAN_NOT_CONFIRMED'};
  if(env.FINGENCE_GROQ_FIRST_REQUEST_APPROVED!=='1')return {ready:false as const,reason:'GROQ_FIRST_REQUEST_APPROVAL_REQUIRED'};
  if(!env.GROQ_API_KEY?.trim())return {ready:false as const,reason:'GROQ_API_KEY_MISSING'};
  return {ready:true as const,model:GROQ_MODEL};
}
export function buildGroqRequest(messages:readonly Message[]):GroqRequest{
  if(messages.length!==2||messages[0]?.role!=='system'||messages[0].content!==SYSTEM_PROMPT
    ||messages[1]?.role!=='user'||typeof messages[1].content!=='string')throw new Error('GROQ_INVALID_MESSAGES');
  if(JSON.parse(messages[1].content).syntheticEvidence?.scope!=='SYNTHETIC_ONLY')throw new Error('GROQ_SYNTHETIC_SCOPE_REQUIRED');
  const request:GroqRequest={model:GROQ_MODEL,messages:messages.map(m=>({...m})),
    response_format:{type:'json_schema',json_schema:{name:'reconciliation_suggestion',strict:true,schema:structuredClone(OUTPUT_SCHEMA)}},
    max_completion_tokens:GROQ_LIMITS.outputTokens,reasoning_effort:'low',reasoning_format:'hidden',
    stream:false,n:1,temperature:0.1,tool_choice:'none',service_tier:'on_demand'};
  // No tools, functions, search, auto/flex/performance tier or unsupported Chat 'store' field.
  if(Buffer.byteLength(JSON.stringify(request))>GROQ_LIMITS.requestBytes)throw new Error('GROQ_REQUEST_BOUNDS');
  return request;
}
function usageOf(value:unknown):GroqUsage|null{
  if(!value||typeof value!=='object')return null;
  const source=value as Record<string,unknown>,result:GroqUsage={};
  for(const field of ['prompt_tokens','completion_tokens','total_tokens','prompt_time','completion_time','queue_time','total_time'] as const){
    const n=source[field];if(typeof n==='number'&&Number.isFinite(n)&&n>=0)result[field]=n;
  }
  return Object.keys(result).length?result:null;
}
/** Free-plan confirmation is owner-supplied: Groq exposes no documented free-only billing switch. */
export class GroqProvider{
  readonly kind='GROQ' as const;
  #client:OpenAI;
  #used=false;
  #evidence:GroqEvidence;
  constructor(env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=globalThis.fetch){
    const config=groqConfiguration(env);if(!config.ready)throw new Error(config.reason);
    this.#evidence={provider:'GROQ',requestedModel:GROQ_MODEL,returnedModel:null,request:null,
      freePlanBasis:'USER_CONFIRMED_FREE_PLAN_NOT_API_ATTESTED',firstRequestExplicitlyApproved:true,
      attempted:false,httpDispatchCount:0,responseReceived:false,finishReason:null,generatedJSON:null,
      usage:null,latencyMs:null,outcome:'NOT_CALLED',error:null};
    const boundedFetch:typeof fetch=async(input,init)=>{
      const url=input instanceof Request?input.url:String(input);
      if(url!==GROQ_ENDPOINT||init?.method!=='POST'||++this.#evidence.httpDispatchCount>1)throw new Error('GROQ_TRANSPORT_BOUNDARY');
      const response=await transport(input,{...init,redirect:'error'});
      const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let count=0;
      if(reader)while(true){
        const chunk=await reader.read();if(chunk.done)break;count+=chunk.value.byteLength;
        if(count>GROQ_LIMITS.responseBytes){await reader.cancel();throw new Error('GROQ_RESPONSE_BOUNDS');}
        chunks.push(chunk.value);
      }
      return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
    };
    this.#client=new OpenAI({apiKey:env.GROQ_API_KEY!,baseURL:GROQ_BASE_URL,organization:null,project:null,
      maxRetries:0,timeout:GROQ_LIMITS.timeoutMs,logLevel:'off',fetch:boundedFetch});
  }
  get evidence():GroqEvidence{return structuredClone(this.#evidence);}
  async suggest(messages:readonly Message[]):Promise<string>{
    if(this.#used)throw new Error('GROQ_SINGLE_REQUEST_LIMIT');
    const request=buildGroqRequest(messages);this.#used=true;
    this.#evidence.request=structuredClone(request);this.#evidence.attempted=true;
    const started=performance.now();
    try{
      const completion=await this.#client.chat.completions.create(request as unknown as ChatCompletionCreateParamsNonStreaming,
        {maxRetries:0,timeout:GROQ_LIMITS.timeoutMs});
      this.#evidence.responseReceived=true;this.#evidence.returnedModel=completion.model;
      this.#evidence.usage=usageOf(completion.usage);
      const choice=completion.choices?.[0],message=choice?.message;
      this.#evidence.finishReason=choice?.finish_reason??null;
      this.#evidence.generatedJSON=typeof message?.content==='string'?message.content:null;
      if(completion.model!==GROQ_MODEL)throw new Error('GROQ_MODEL_ID_MISMATCH');
      if(completion.choices?.length!==1||choice.finish_reason!=='stop'||message?.role!=='assistant'
        ||!message.content||message.tool_calls?.length||message.function_call||message.refusal)
        throw new Error('GROQ_REFUSED_OR_INCOMPLETE');
      if(Buffer.byteLength(message.content)>GROQ_LIMITS.generatedBytes)throw new Error('GROQ_GENERATED_BOUNDS');
      this.#evidence.outcome='COMPLETED_TEXT_REQUIRES_INDEPENDENT_VALIDATION';
      return message.content;
    }catch(error){
      let reason='GROQ_PROVIDER_FAILURE',status:number|null=null,code:string|null=null;
      if(error instanceof OpenAI.APIConnectionTimeoutError)reason='GROQ_REQUEST_TIMEOUT';
      else if(error instanceof OpenAI.APIConnectionError)reason='GROQ_CONNECTION_FAILED';
      else if(error instanceof OpenAI.APIError){
        status=error.status??null;
        const safe=['invalid_api_key','insufficient_quota','rate_limit_exceeded','model_not_found',
          'permission_denied','billing_required','json_validate_failed','model_permission_blocked'];
        if(typeof error.code==='string'&&safe.includes(error.code))code=error.code;
        reason=status===401?'GROQ_AUTHENTICATION_FAILED':status===402||code==='billing_required'?'GROQ_FREE_ACCESS_UNAVAILABLE'
          :status===403?'GROQ_PERMISSION_DENIED':status===404?'GROQ_MODEL_UNAVAILABLE'
          :status===429?'GROQ_FREE_QUOTA_OR_RATE_LIMIT':status===400?'GROQ_REQUEST_REJECTED':'GROQ_HTTP_FAILURE';
      }else if(error instanceof Error&&['GROQ_MODEL_ID_MISMATCH','GROQ_REFUSED_OR_INCOMPLETE','GROQ_GENERATED_BOUNDS'].includes(error.message))reason=error.message;
      this.#evidence.error={status,code,reason};this.#evidence.outcome=reason;
      throw new Error(reason);
    }finally{this.#evidence.latencyMs=Math.round(performance.now()-started);}
  }
}
