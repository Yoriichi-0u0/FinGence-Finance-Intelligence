import {describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('server-only',()=>({}));
import {financeGPTView,pairVerificationResult,type GPTEvidenceView} from '../../lib/gpt-evidence-view';
import {readWebsiteJobSuggestions,type WebsiteGPTStore} from '../../lib/server/reconciliation/website-job-gpt';
import {GPTSuggestionsView,loadGPTEvidence} from '../../components/reconciliation/gpt-suggestions';
import type {Caller} from '../../lib/server/workspace/session';
import type {Role} from '../../lib/server/workspace/store';

const jobId='00000000-0000-4000-8000-000000000001';
const data:GPTEvidenceView={version:'gpt-evidence-view/1',batchId:jobId,processingId:'private-processing',runs:[{
 evidenceId:'private-evidence',model:'private-model',prompt:'private-policy',createdAt:'2026-11-15T00:00:00Z',bankSha256:'private-bank-hash',ledgerSha256:'private-ledger-hash',outcome:'UNRESOLVED',items:[{
 type:'SUGGESTION',ordinal:0,bankId:'bank-1',ledgerId:'ledger-1',recordId:null,bankReference:'BANK REF',ledgerReference:'LEDGER REF',explanation:'Independently checked.',reasons:['PAIR_CHECKS_PASSED'],
 verification:{policy:'website-pair-verifier/1',authoritativeRecordIds:true,equalSignedCents:true,sameCurrency:true,dateWithinSevenDays:true},score:null,outcome:'UNRESOLVED',
 }],
}]};
const request=()=>new Request(`https://example.invalid/api/reconciliation/website-gpt-evidence?jobId=${jobId}`);
const identity=(role:Role,memberId='owner',organizationId='org'):Caller=>({kind:'SIGNED_IN',tokenHash:'synthetic-token-hash',principal:{sessionId:'session',memberId,email:'synthetic@example.invalid',role,organization:{id:organizationId,name:'Synthetic'},ai:{enabled:true,since:null},processing:{paused:false,reason:null,since:null}}});
const store=():WebsiteGPTStore=>({claim:vi.fn(),save:vi.fn(),audit:vi.fn(),read:vi.fn(async owner=>owner.memberId==='owner'&&owner.organizationId==='org'?structuredClone(data):null)});

describe('backend role projections',()=>{
 it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s receives only its own authorized evidence',async role=>{
  const backend=store();
  const response=await readWebsiteJobSuggestions(request(),{store:backend,verify:async()=>identity(role)});
  expect(response.status).toBe(200);
  const body=await response.json();
  expect(body.runs[0].items[0].outcome).toBe('UNRESOLVED');
  if(role==='FINANCE'){
   expect(body.version).toBe('gpt-finance-view/1');expect(body.runs[0].items[0].verificationResult).toBe('PASS');
   expect(JSON.stringify(body)).not.toContain('private-');
   expect(body.runs[0].items[0]).not.toHaveProperty('verification');
  }else expect(body).toEqual(data);
  for(const who of [identity(role,'other'),identity(role,'owner','other')]){
   expect((await readWebsiteJobSuggestions(request(),{store:backend,verify:async()=>who})).status).toBe(404);
  }
 });
 it('never treats absent, partial or failed verification as PASS; abstentions have no pair verdict',()=>{
  const item=structuredClone(data.runs[0].items[0]);
  item.verification={};expect(pairVerificationResult(item)).toBe('UNAVAILABLE');
  item.verification={authoritativeRecordIds:true};expect(pairVerificationResult(item)).toBe('UNAVAILABLE');
  item.verification={policy:'website-pair-verifier/1',equalSignedCents:false};expect(pairVerificationResult(item)).toBe('FAIL');
  item.type='ABSTENTION';expect(pairVerificationResult(item)).toBe('NOT_APPLICABLE');
 });
 it('renders Finance suggestions and PASS without technical details; preserves immutable source',async()=>{
  const before=JSON.stringify(data),view=financeGPTView(data);
  const html=renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'ready',data:view}}));
  expect(html).toContain('PASS');expect(html).toContain('UNRESOLVED');expect(html).toContain('BANK REF');
  for(const technical of ['private-','<pre','SHA256','Processing '])expect(html).not.toContain(technical);
  expect(JSON.stringify(data)).toBe(before);
  const transport=vi.fn(async()=>Response.json(view)) as unknown as typeof fetch;
  expect((await loadGPTEvidence(jobId,new AbortController().signal,transport,true)).status).toBe('ready');
 });
 it('does not release evidence when the audited read fails',async()=>{
  const backend=store();backend.read=vi.fn(async()=>{throw Error('private audit failure');});
  const response=await readWebsiteJobSuggestions(request(),{store:backend,verify:async()=>identity('SUPERADMIN')});
  expect(response.status).toBe(503);expect(await response.text()).not.toContain('private');
 });
});
