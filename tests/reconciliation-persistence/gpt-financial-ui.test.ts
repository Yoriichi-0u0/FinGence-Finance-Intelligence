import {afterAll,describe,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('server-only',()=>({}));
import {GPTSuggestionsView,type GPTEvidenceState} from '../../components/reconciliation/gpt-suggestions';
import {summarizeGPTSuggestions} from '../../components/reconciliation/gpt-financial-summary';
import {financeGPTView,type GPTEvidenceView} from '../../lib/gpt-evidence-view';
import {WorkspaceContext,type WorkspaceRole} from '../../components/workspace/context';

const suggestion:GPTEvidenceView['runs'][number]['items'][number]={type:'SUGGESTION',ordinal:0,bankId:'TECHNICAL_BANK_ID',ledgerId:'TECHNICAL_LEDGER_ID',recordId:null,
 bankReference:'Bank receipt / April sales',ledgerReference:'Ledger entry / April sales',explanation:'Model-proposed pair checked independently against the committed job sources.',reasons:['PAIR_CHECKS_PASSED'],
 verification:{policy:'website-pair-verifier/1',authoritativeRecordIds:true,equalSignedCents:true,sameCurrency:true,dateWithinSevenDays:true},score:null,outcome:'UNRESOLVED'};
function fixture():GPTEvidenceView{
 const fail=structuredClone(suggestion);fail.ordinal=1;fail.bankId='TECHNICAL_BANK_ID_2';fail.ledgerId='TECHNICAL_LEDGER_ID_2';fail.verification.equalSignedCents=false;
 const unknown=structuredClone(suggestion);unknown.ordinal=2;unknown.bankId='TECHNICAL_BANK_ID_3';unknown.ledgerId='TECHNICAL_LEDGER_ID_3';unknown.verification={};
 const abstention={...structuredClone(suggestion),type:'ABSTENTION' as const,ordinal:3,bankId:null,ledgerId:null,recordId:'TECHNICAL_UNMATCHED_ID',bankReference:null,ledgerReference:null,
  explanation:'The model abstained for this record.',reasons:['MODEL_ABSTAINED'],verification:{}};
 return {version:'gpt-evidence-view/1',batchId:'synthetic-job',processingId:'TECHNICAL_PROCESSING_ID',runs:[{evidenceId:'TECHNICAL_EVIDENCE_ID',model:'TECHNICAL_MODEL',prompt:'TECHNICAL_PROMPT',createdAt:'2026-11-16T00:00:00Z',bankSha256:'a'.repeat(64),ledgerSha256:'b'.repeat(64),outcome:'UNRESOLVED',items:[structuredClone(suggestion),fail,unknown,abstention]}]};
}
function render(data=fixture(),role:WorkspaceRole='FINANCE',viewRole:WorkspaceRole=role,state?:GPTEvidenceState){
 return renderToStaticMarkup(createElement(WorkspaceContext.Provider,{value:{enabled:true,loading:false,session:{email:'synthetic@example.invalid',role,organization:{name:'Synthetic'},processing:{paused:false,reason:null,since:null},ai:{enabled:true}},viewRole,setViewAs:()=>{},ended:false,refresh:async()=>null,signOut:async()=>{}}},
  createElement(GPTSuggestionsView,{state:state??{status:'ready',data:role==='FINANCE'?financeGPTView(data):data}})));
}
describe('financial GPT results presentation',()=>{
 it('counts only the saved proposals, passed checks and no-match entries',()=>{
  const data=fixture(),before=JSON.stringify(data);
  expect(summarizeGPTSuggestions(data)).toEqual({suggestions:3,verified:1,needsReview:2,withoutSuggestions:1});
  expect(summarizeGPTSuggestions(financeGPTView(data))).toEqual(summarizeGPTSuggestions(data));
  expect(JSON.stringify(data)).toBe(before);
 });
 it('counts multiple saved runs without claiming unique transactions or approval',()=>{
  const data=fixture();data.runs.push(structuredClone(data.runs[0]));
  expect(summarizeGPTSuggestions(data)).toEqual({suggestions:6,verified:2,needsReview:4,withoutSuggestions:2});
  expect(render(data)).toContain('Counts cover the saved suggestions and no-match entries shown below');
 });
 it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s Finance view has readable cards and no technical fields',role=>{
  const html=render(fixture(),role,'FINANCE');
  for(const label of ['Verified suggested matches','Suggestions needing review','Transactions without suggestions','All matching checks passed','Matching checks failed','Matching checks unavailable','No match suggested','Not yet approved','Bank receipt / April sales','Ledger entry / April sales'])expect(html).toContain(label);
  expect(html.match(/aria-label="Suggested match /g)).toHaveLength(3);
  for(const hidden of ['TECHNICAL_','<pre','<details','SHA256','PAIR_CHECKS_PASSED','MODEL_ABSTAINED','UNRESOLVED','confidence','Score:'])expect(html).not.toContain(hidden);
  expect(html).toBe(render());
 });
 it.each(['ADMIN','SUPERADMIN'] as const)('%s sees technical fields only within collapsed technical evidence',role=>{
  const html=render(fixture(),role),[financial,technical]=html.split('<details');
  expect(financial).toContain('All matching checks passed');expect(financial).not.toContain('TECHNICAL_');
  expect(technical).toContain('Technical evidence');expect(technical).toContain('TECHNICAL_MODEL');expect(technical).toContain('TECHNICAL_BANK_ID');expect(technical).toContain('UNRESOLVED');
  expect(html).not.toMatch(/<details[^>]*\bopen/);
 });
 it('does not turn unknown verification policies into a passed check',()=>{
  const data=fixture();data.runs[0].items=[{...structuredClone(suggestion),verification:{...suggestion.verification,policy:'unknown'}}];
  expect(summarizeGPTSuggestions(data).verified).toBe(0);expect(render(data)).not.toContain('All matching checks passed');
 });
 it('does not invent a readable reference, amount, score or confidence for missing data',()=>{
  const data=fixture();data.runs[0].items[0].bankReference=null;data.runs[0].items[0].ledgerReference=null;
  const html=render(data);expect(html.match(/Reference not saved/g)).toHaveLength(2);expect(html).toContain('A readable transaction reference was not saved');
  expect(html).not.toMatch(/TECHNICAL_|confidence|score|\d+%|MYR|USD/i);
 });
 it.each(['no runs','no items'] as const)('handles saved evidence with %s without implying every transaction is unmatched',mode=>{
  const data=fixture();if(mode==='no runs')data.runs=[];else data.runs[0].items=[];
  expect(summarizeGPTSuggestions(data)).toEqual({suggestions:0,verified:0,needsReview:0,withoutSuggestions:0});
  const html=render(data);expect(html).toContain('No suggestions or transactions without suggestions were saved');expect(html).not.toContain('aria-label="Suggested match ');
 });
 it.each(['loading','generating','empty','unavailable','error'] as const)('handles %s without displaying stale cards or counts',status=>{
  const html=render(fixture(),'FINANCE','FINANCE',{status});expect(html).not.toContain('Saved matching summary');expect(html).not.toContain('Bank receipt');
  expect(html).toContain(status==='error'?'role="alert"':'role="status"');
 });
 it('escapes saved explanations and references rather than executing markup',()=>{
  const data=fixture();data.runs[0].items[0].explanation='<script>unsafe()</script>';data.runs[0].items[0].bankReference='<img src=x onerror=unsafe()>';
  const html=render(data);expect(html).toContain('&lt;script&gt;');expect(html).toContain('&lt;img');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');
 });
 it('wraps long saved references on a single-column mobile layout',()=>{
  const data=fixture();data.runs[0].items[0].bankReference='LONG_REFERENCE_'.repeat(80);
  const html=render(data);expect(html).toContain('grid-cols-1');expect(html).toContain('sm:grid-cols-3');expect(html).toContain('[overflow-wrap:anywhere]');expect(html).not.toMatch(/min-w-\[\d/);
 });
});

// Opt-in local, synthetic-only fixtures for headless viewport QA; never shipped to the website.
afterAll(()=>{
 if(process.env.AI06_UI_REVIEW!=='1')return;
 const dir='.local/reviews/ai06-financial-ui';mkdirSync(dir,{recursive:true});
 const data=fixture();data.runs[0].items[0].bankReference='LONG_BANK_REFERENCE_'.repeat(35);data.runs[0].items[0].ledgerReference='LONG_LEDGER_REFERENCE_'.repeat(35);
 for(const role of ['FINANCE','ADMIN'] as const)writeFileSync(`${dir}/${role.toLowerCase()}-fragment.html`,render(data,role));
});
