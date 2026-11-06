import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import type {useDemoProcessing} from '../../components/demo/context';
import {processDocuments} from '../../lib/demo/pipeline';
import {answerQuestion} from '../../lib/poc-finance-qa/answer';
import {qaFacts} from '../../lib/demo/questions';
import {AuthPreview} from '../../components/auth-preview';
import {filterCandidates} from '../../components/demo/anomalies';
import {reportPayload} from '../../components/demo/reports';
import Forecasting from '../../components/demo/forecasting';

const state=vi.hoisted(()=>({value:null as unknown as ReturnType<typeof useDemoProcessing>}));
vi.mock('../../components/demo/context',()=>({useDemoProcessing:()=>state.value}));
vi.mock('next/navigation',()=>({usePathname:()=>'/transactions',useSearchParams:()=>new URLSearchParams(),useRouter:()=>({replace:vi.fn()})}));
const {DemoGate}=await import('../../components/demo/gate');
const c=await processDocuments(['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv','demo-bank-history-2025-04-to-2026-03.csv'].map(name=>({name,bytes:new Uint8Array(readFileSync('public/demo/'+name)),provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const})));
beforeEach(()=>{state.value={enabled:true,status:'empty',context:null,liveStages:[],processedAt:null,persisted:true,error:null,process:vi.fn(),clear:vi.fn(),ai:null,aiWait:null,serverJobs:false,serverState:null};});
const views=['transactions','reconciliation','analytics','forecasting','anomalies','reports','ask'] as const;
describe('final connected frontend integration',()=>{
 it('keeps the Q&A history before suggestions and the question composer',()=>{
  Object.assign(state.value,{status:'ready',context:c,liveStages:c.stages});
  const html=renderToStaticMarkup(createElement(DemoGate,{view:'ask'}));
  const history=html.indexOf('aria-label="Answers"'),suggestions=html.indexOf('aria-label="Suggested questions"'),form=html.indexOf('<form');
  expect(history).toBeGreaterThan(-1);expect(suggestions).toBeGreaterThan(history);expect(form).toBeGreaterThan(suggestions);
  expect(html).toContain('Ask a suggested question');expect(html).toContain('id="demo-question"');
 });
 it.each(views)('%s uses its real layout before processing, after verified processing and after clear',view=>{
  const render=()=>renderToStaticMarkup(createElement(DemoGate,{view,illustrative:'Original illustrative design preview fake values'}));
  const empty=render();expect(empty).toContain('<h1');expect(empty).not.toContain('No documents processed yet');expect(empty).not.toContain('Original illustrative');expect(empty).not.toContain('Open Data and process documents');expect(empty).not.toContain('RM 0.00');expect(empty).not.toContain('MYR 0.00');expect(state.value.process).not.toHaveBeenCalled();
  Object.assign(state.value,{status:'ready',context:c,liveStages:c.stages});const populated=render();expect(populated).not.toBe(empty);expect(populated).toContain(c.processingId);
  Object.assign(state.value,{status:'empty',context:null,liveStages:[]});expect(render()).toBe(empty);
 });
 it('keeps financial values unavailable after failure and quarantine',()=>{
  for(const status of ['failed','ready'] as const){Object.assign(state.value,{status,context:status==='ready'?{...c,status:'QUARANTINED'}:null});for(const view of views){const html=renderToStaticMarkup(createElement(DemoGate,{view}));expect(html).not.toContain('28,232.01');expect(html).not.toContain('35,446.45');if(status==='failed')expect(html).toContain('Processing failed.');}}
 });
 it('combines anomaly filters without duplicating candidates or changing their findings',()=>{
  const before=JSON.stringify(c),rows=c.outputs.anomalies;expect(new Set(rows.map(x=>x.row.rowId)).size).toBe(rows.length);
  for(const x of rows){const filtered=filterCandidates(rows,x.severity,x.findings[0].ruleId,x.row.reference.toUpperCase());expect(filtered.some(y=>y.row.rowId===x.row.rowId)).toBe(true);expect(filtered.every(y=>y.severity===x.severity&&y.findings.some(f=>f.ruleId===x.findings[0].ruleId))).toBe(true);}
  expect(filterCandidates(rows,'','','no-such-reference')).toEqual([]);expect(JSON.stringify(c)).toBe(before);
 });
 it('preserves the complete original Reports JSON schema and evidence projection',()=>{
  expect(reportPayload(c)).toEqual({...c.outputs.report,reconciliationStatement:c.outputs.statement,reconciliation:c.outputs.resolution,anomalies:c.outputs.anomalyResolution,stages:c.stages.map(({id,decision,summary,checks})=>({id,decision,summary,checks})),quarantine:c.quarantine});
  const json=JSON.stringify(reportPayload(c));for(const d of c.documents)expect(json).toContain(d.sha256);expect(c.outputs.totals?.net).toBe('28232.01');
 });
 it('distinguishes observed history from the actual forecast month without relabeling its anchor',()=>{
  const f=c.outputs.forecast!.forecast;expect(f.status).toBe('AVAILABLE');if(f.status!=='AVAILABLE')return;
  const html=renderToStaticMarkup(createElement(Forecasting,{c}));expect(html).toContain(f.period);expect(html).toContain('35,446.45');expect(html.match(/aria-label="2026-03[^\"]*"/)?.[0]).not.toContain('Forecast Baseline');expect(html).toContain('forecast baseline: Forecast Baseline');
  for(const metric of ['credits','debits','net'] as const)for(const method of f.backtest[metric].methods)if(method.wape!==null)expect(html).toContain(`${method.wape}%`);
 });
 it('preserves rule based supported answers, monthly evidence and financial refusals',()=>{
  const facts=qaFacts(c)!;expect(answerQuestion(facts,'How much cash moved?').status).toBe('ANSWERED');const history=answerQuestion(facts,'Show monthly history');expect(history.status).toBe('ANSWERED');expect(history.facts.length).toBeGreaterThan(12);expect(answerQuestion(facts,'What is my profit?').status).toBe('REFUSED');expect(answerQuestion(facts,'Who committed fraud?').status).toBe('REFUSED');
 });
 it.each(['sign-in','sign-up'] as const)('%s is an unavailable credential preview, never a working login',mode=>{
  const html=renderToStaticMarkup(createElement(AuthPreview,{mode}));expect(html).toContain('Coming Soon');expect(html).toContain('Continue as Demo');expect(html).toContain('href="/overview"');expect(html).toContain('<fieldset disabled');expect(html).not.toContain('<form');expect(html).not.toContain('action=');expect(html).toContain('no accounts or sessions are created');
 });
});
