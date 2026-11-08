import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { processLiveDocument03 } from '../../lib/server/ai-ingestion/increment-03/service';
import { GroqProvider03, UncertainDispatchError } from '../../lib/server/ai-ingestion/increment-03/providers';
import { QuotaLedger } from '../../lib/server/ai-ingestion/increment-03/quota';
import { hash, prepareRequest } from '../../lib/ai-ingestion/increment-03/plan';
import { scoreLiveRun, type GoldCase } from '../../lib/server/ai-ingestion/increment-i2/evaluation';
import { RecordedControlI2 } from '../support/i2-recorded-control';
const bytes=readFileSync('synthetic/ai-ingestion-i2/i01.csv');
const manifest=JSON.parse(readFileSync('synthetic/ai-ingestion-i2/manifest.json','utf8'));
const gold=JSON.parse(readFileSync('tests/fixtures/ai-ingestion-i2/gold.json','utf8')).cases['i01.csv'] as GoldCase;
afterEach(()=>vi.unstubAllEnvs());
describe('offline I2 pipeline and provider boundary',()=>{
 it('binds the source and runs the existing materializer and verifier using a clearly labeled recorded control',async()=>{
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files['i01.csv'].sha256);
  const run=await processLiveDocument03(bytes,'source.csv',()=>{},new RecordedControlI2());
  expect(run.mode).toBe('RECORDED_TEST');expect(run.evidence?.sourceId).toBe(manifest.files['i01.csv'].sha256);expect(run.verification?.accepted).toHaveLength(2);
  expect(()=>scoreLiveRun(run,gold)).toThrow('UNVERIFIED_LIVE_RECEIPT');
  const prompt=JSON.stringify(prepareRequest(run.evidence!).messages);expect(prompt).not.toContain('i01.csv');expect(prompt).not.toContain('prohibitedAcceptance');expect(prompt).not.toContain('allowedAssumptions');
 });
 it('fails closed without dispatch credentials and does not substitute a recorded proposal',async()=>{
  vi.stubEnv('FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED','0');vi.stubEnv('FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED','0');
  const run=await processLiveDocument03(bytes,'source.csv');expect(run.mode).toBe('NOT_EXECUTED');expect(run.proposal).toBeNull();expect(run.receipt).toBeNull();
 });
 it('keeps a lost provider response unknown and never retries',async()=>{
  const propose=vi.fn().mockRejectedValue(new UncertainDispatchError('GROQ_REQUEST_FAILED','LIVE_GROQ','synthetic-reservation'));
  const run=await processLiveDocument03(bytes,'source.csv',()=>{},{propose});expect(run.mode).toBe('DISPATCHED_UNKNOWN');expect(run.dispatch?.reservationId).toBe('synthetic-reservation');expect(propose).toHaveBeenCalledTimes(1);expect(run.receipt).toBeNull();
 });
 it('scores a simulated completed response even when financial conventions are unresolved',async()=>{
  const control=new RecordedControlI2();
  const run=await processLiveDocument03(bytes,'source.csv',()=>{},{propose:async request=>{
   const x=await control.propose(request); const plan={...x.plan,conventions:null};
   return {plan,receipt:{...x.receipt,mode:'LIVE_GROQ',model:'openai/gpt-oss-20b',requestId:'simulated-only',finishReason:'stop',outputHash:hash(plan)}};
  }});
  expect(run.error).toBe('UNRESOLVED_CONVENTIONS');
  expect(run.verification?.unresolved.length).toBeGreaterThan(0);
  const score=scoreLiveRun(run,gold);expect(score.modelAccuracy?.mappings?.expected).toBe(5);
  expect(score.acceptance?.accepted).toBe(0);
 });
 it('dispatches at most once with the same local authorization using an injected transport',async()=>{
  vi.stubEnv('GROQ_API_KEY','synthetic-test-only');vi.stubEnv('FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED','1');vi.stubEnv('FINGENCE_AI03_FREE_PLAN_CONFIRMED','1');
  const baseline=await processLiveDocument03(bytes,'source.csv',()=>{},new RecordedControlI2());
  const folder=mkdtempSync(join(tmpdir(),'fg-i2-provider-')), approvals=join(folder,'i2-authorizations'),id=randomUUID();mkdirSync(approvals,{mode:0o700});
  let now=Date.now();writeFileSync(join(approvals,`${id}.json`),JSON.stringify({version:'v2-i2-authorization-0.1',id,sourceSha256:manifest.files['i01.csv'].sha256,provider:'LIVE_GROQ',model:'openai/gpt-oss-20b',expiresAt:now+180000}),{mode:0o600});
  const transport=vi.fn().mockResolvedValue({id:'synthetic',model:'openai/gpt-oss-20b',usage:{prompt_tokens:10,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(baseline.proposal)}}]});
  const provider=new GroqProvider03(new QuotaLedger(folder,()=>now),transport,{authorizationId:id,sourceSha256:manifest.files['i01.csv'].sha256});
  const request=prepareRequest(baseline.evidence!);await provider.propose(request);
  now+=60001;
  await expect(provider.propose(request)).rejects.toThrow('ONE_SHOT_CONSUMED');expect(transport).toHaveBeenCalledTimes(1);
 });
});

it('the one-shot entrypoint refuses dispatch without separate authorization',async()=>{
 const { spawnSync }=await import('node:child_process');
 const out=spawnSync(process.execPath,['--conditions=react-server','scripts/ai-i2-live.mjs','--dispatch-one'],{encoding:'utf8',env:{PATH:process.env.PATH??'',NODE_ENV:'development',FINGENCE_AI_LOCAL:'1',FINGENCE_AI03_LOCAL:'1'}});
 expect(out.status).not.toBe(0);expect(out.stderr).toContain('SEPARATE_LIVE_AUTHORIZATION_REQUIRED');
});
