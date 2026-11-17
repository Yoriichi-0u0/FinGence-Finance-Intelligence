import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {structuredCompletion,type GroqTransport} from '../../lib/server/ai/groq';
import {setAiCallSink,type AiCall} from '../../lib/ai-calls';
import {websiteGPTGatewayEnabled} from '../../lib/server/reconciliation/website-job-gpt';
const ok={status:200,json:{model:'openai/gpt-oss-120b',choices:[{message:{content:'{"suggestions":[],"abstentions":[]}'}}],usage:{prompt_tokens:2,completion_tokens:2}}};
const request=(transport:GroqTransport,feature:'recon-suggest'|'finance-qa'='recon-suggest')=>structuredCompletion({feature,model:'openai/gpt-oss-120b',system:'synthetic',user:'synthetic',schemaName:'synthetic',schema:{},maxCompletionTokens:10,reasoningEffort:'low',transport});
beforeEach(()=>{vi.stubEnv('GROQ_API_KEY','synthetic-one');vi.stubEnv('GROQ_API_KEY2','synthetic-two');vi.stubEnv('GROQ_API_KEY3','synthetic-three');setAiCallSink(async()=>{});});
afterEach(()=>{vi.unstubAllEnvs();setAiCallSink(null);});
it('uses only key 3, logs its label without secrets and never mutates process configuration',async()=>{
 const logs:AiCall[]=[];setAiCallSink(async call=>{logs.push(call);});const before=[process.env.GROQ_API_KEY,process.env.GROQ_API_KEY2,process.env.GROQ_API_KEY3];
 const used:string[]=[];await request(async(_body,_signal,key)=>{used.push(key);return ok;});expect(used).toEqual(['synthetic-three']);expect(logs[0]).toMatchObject({feature:'recon-suggest',keyLabel:'key-3',status:'OK'});
 expect(JSON.stringify(logs)).not.toContain('synthetic-three');expect([process.env.GROQ_API_KEY,process.env.GROQ_API_KEY2,process.env.GROQ_API_KEY3]).toEqual(before);
});
it('fails closed without key 3 even when other keys and a mocked transport exist',async()=>{
 vi.stubEnv('GROQ_API_KEY3','');const transport=vi.fn(async()=>ok);await expect(request(transport)).rejects.toMatchObject({code:'NOT_CONFIGURED'});expect(transport).not.toHaveBeenCalled();
});
it.each([429,500])('does not retry or fall back after HTTP %i',async status=>{
 const keys:string[]=[];await expect(request(async(_b,_s,key)=>{keys.push(key);return {status,json:null,retryAfterSeconds:3};})).rejects.toMatchObject({code:status===429?'RATE_LIMITED':'PROVIDER_HTTP_500'});expect(keys).toEqual(['synthetic-three']);
});
it('does not fall back on a transport failure',async()=>{
 const transport=vi.fn(async()=>{throw Error('synthetic network failure');});await expect(request(transport)).rejects.toMatchObject({code:'PROVIDER_UNREACHABLE'});expect(transport).toHaveBeenCalledTimes(1);
});
it('leaves other features key rotation untouched, including when an AI06 call occurs between them',async()=>{
 const keys:string[]=[];const capture:GroqTransport=async(_b,_s,key)=>{keys.push(key);return ok;};
 await request(capture,'finance-qa');await request(capture);await request(capture,'finance-qa');expect(new Set([keys[0],keys[2]])).toEqual(new Set(['synthetic-one','synthetic-two']));expect(keys[1]).toBe('synthetic-three');
});
it('readiness requires its own key, gateway switch and the existing durable hosted budget',()=>{
 vi.stubEnv('FINGENCE_AI_GATEWAY','1');vi.stubEnv('VERCEL','');expect(websiteGPTGatewayEnabled()).toBe(true);
 vi.stubEnv('GROQ_API_KEY3','');expect(websiteGPTGatewayEnabled()).toBe(false);vi.stubEnv('GROQ_API_KEY3','synthetic-three');
 vi.stubEnv('FINGENCE_AI_GATEWAY','0');expect(websiteGPTGatewayEnabled()).toBe(false);vi.stubEnv('FINGENCE_AI_GATEWAY','1');vi.stubEnv('VERCEL','1');
 for(const key of Object.keys(process.env))if(/FINGENCE_AI_BUDGET_REST_(URL|TOKEN)$|UPSTASH_REDIS_REST_(URL|TOKEN)$|KV_REST_API_(URL|TOKEN)$/.test(key))vi.stubEnv(key,'');
 expect(websiteGPTGatewayEnabled()).toBe(false);
 vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL','https://synthetic-budget.invalid');vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN','synthetic-budget-token');expect(websiteGPTGatewayEnabled()).toBe(true);
});
