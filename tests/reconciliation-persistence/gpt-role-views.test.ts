import {describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('server-only',()=>({}));
import {financeGPTView,pairVerificationResult,type GPTEvidenceView} from '../../lib/gpt-evidence-view';
import {readWebsiteJobSuggestions,type WebsiteGPTStore} from '../../lib/server/reconciliation/website-job-gpt';
import {GPTSuggestionsView,loadGPTEvidence} from '../../components/reconciliation/gpt-suggestions';
import type {Caller} from '../../lib/server/workspace/session';
import type {Role} from '../../lib/server/workspace/store';
import {WorkspaceContext,type WorkspaceRole} from '../../components/workspace/context';

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
  expect(html).toContain('All matching checks passed');expect(html).toContain('Not yet approved');expect(html).toContain('BANK REF');
  for(const technical of ['private-','<pre','SHA256','Processing '])expect(html).not.toContain(technical);
  expect(JSON.stringify(data)).toBe(before);
  const transport=vi.fn(async()=>Response.json(view)) as unknown as typeof fetch;
  expect((await loadGPTEvidence(jobId,new AbortController().signal,transport,true)).status).toBe('ready');
 });
 it.each(['FAIL','UNAVAILABLE','NOT_APPLICABLE'] as const)('returns Finance %s through the API without technical payloads',async verdict=>{
  const saved=structuredClone(data),item=saved.runs[0].items[0];
  if(verdict==='FAIL')item.verification.equalSignedCents=false;
  if(verdict==='UNAVAILABLE')item.verification={};
  if(verdict==='NOT_APPLICABLE')item.type='ABSTENTION';
  const backend=store();backend.read=vi.fn(async()=>saved);
  const response=await readWebsiteJobSuggestions(request(),{store:backend,verify:async()=>identity('FINANCE')});
  expect(response.status).toBe(200);const body=await response.json();
  expect(body.runs[0].items[0].verificationResult).toBe(verdict);
  expect(body.runs[0].items[0].outcome).toBe('UNRESOLVED');
  expect(JSON.stringify(body)).not.toContain('private-');
  expect(body.runs[0].items[0]).not.toHaveProperty('verification');
 });
 it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s receives no evidence when the audited read fails',async role=>{
  const backend=store();backend.read=vi.fn(async()=>{throw Error('private audit failure');});
  const response=await readWebsiteJobSuggestions(request(),{store:backend,verify:async()=>identity(role)});
  expect(response.status).toBe(503);expect(await response.text()).not.toContain('private');
 });
});

describe('AI06 workspace role preview',()=>{
 const render=(role:WorkspaceRole,viewRole:WorkspaceRole,body=role==='FINANCE'?financeGPTView(data):data)=>renderToStaticMarkup(createElement(WorkspaceContext.Provider,{
  value:{enabled:true,loading:false,session:{email:'synthetic@example.invalid',role,organization:{name:'Synthetic'},processing:{paused:false,reason:null,since:null},ai:{enabled:true}},viewRole,
   setViewAs:()=>{},ended:false,refresh:async()=>null,signOut:async()=>{}},
 },createElement(GPTSuggestionsView,{state:{status:'ready',data:body}})));

 it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s viewing Finance sees the same simplified results',role=>{
  const html=render(role,'FINANCE');
  expect(html).toBe(render('FINANCE','FINANCE'));
  expect(html).toContain('All matching checks passed');expect(html).toContain('Not yet approved');expect(html).toContain('BANK REF');
  for(const technical of ['private-','<pre','SHA256','Processing ','Supporting evidence'])expect(html).not.toContain(technical);
 });
 it.each(['ADMIN','SUPERADMIN'] as const)('%s normal view retains technical evidence after returning from Finance preview',role=>{
  const before=JSON.stringify(data),normal=render(role,role);
  expect(normal).toContain('private-model');expect(normal).toContain('private-bank-hash');expect(normal).toContain('private-processing');expect(normal).toContain('<pre');
  expect(render(role,'FINANCE')).not.toContain('private-');
  expect(render(role,role)).toBe(normal);expect(JSON.stringify(data)).toBe(before);
 });
 it('cannot recover server-redacted Finance evidence by changing the client preview role',()=>{
  expect(render('FINANCE','SUPERADMIN')).not.toContain('private-');
  expect(render('FINANCE','SUPERADMIN')).not.toContain('<pre');
 });
 it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s API uses its verified role despite a client preview header',async role=>{
  const response=await readWebsiteJobSuggestions(new Request(request(),{headers:{'X-View-As':role==='FINANCE'?'SUPERADMIN':'FINANCE'}}),{store:store(),verify:async()=>identity(role)});
  expect(response.status).toBe(200);const body=await response.json();
  expect(body.version).toBe(role==='FINANCE'?'gpt-finance-view/1':'gpt-evidence-view/1');
 });
});
