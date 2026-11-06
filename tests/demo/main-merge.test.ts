import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {processDocuments} from '../../lib/demo/pipeline';
import type {useDemoProcessing} from '../../components/demo/context';
import {analyticsMonths} from '../../components/demo/analytics-model';
import {reconciliationOutcomes,outcomeKey,selectedOutcome,evidenceRecords} from '../../components/demo/reconciliation-presentation';
import {reportPayload} from '../../components/demo/reports';
import {aiSuggestions} from '../../components/demo/finance-questions';
import {restoreStored,toBase64,type Stored} from '../../lib/demo/session';
import {visibleNavigation} from '../../components/navigation/routes';

const state=vi.hoisted(()=>({value:null as unknown as ReturnType<typeof useDemoProcessing>}));
vi.mock('../../components/demo/context',()=>({useDemoProcessing:()=>state.value}));
vi.mock('next/navigation',()=>({usePathname:()=>'/data',useSearchParams:()=>new URLSearchParams(),useRouter:()=>({replace:vi.fn()})}));
const {DemoModule,isReady}=await import('../../components/demo/modules');
const {default:Data}=await import('../../components/demo/data-workspace');
const files=(paths:string[])=>paths.map(name=>({name:name.split('/').at(-1)!,bytes:new Uint8Array(readFileSync('public/demo/'+name)),provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const}));
const pair=files(['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv']);
const march=await processDocuments(pair);
const quarterFiles=files(['quarter/demo-bank-statement-2026-q1-sgd.csv','quarter/demo-general-ledger-2026-q1-sgd.csv']);
const quarter=await processDocuments(quarterFiles);
beforeEach(()=>{state.value={enabled:true,status:'ready',context:march,liveStages:march.stages,processedAt:'now',persisted:true,error:null,process:vi.fn(),clear:vi.fn(),ai:null,aiWait:null,serverJobs:false,serverState:null};});
const html=(view:'overview'|'reconciliation'|'analytics'|'anomalies'|'reports'|'ask',c=quarter)=>{if(!isReady(c))throw Error('Fixture not verified');return renderToStaticMarkup(createElement(DemoModule,{view,context:c}));};

describe('PR82 combines frontend presentation with main contracts',()=>{
 it('keeps matcher evidence without mislabelling resolved March findings as outstanding work',()=>{
  expect(march.status).toBe('COMPLETED');expect(march.outputs.reconciliation!.counts).toMatchObject({MATCH_EXACT:46,MATCH_DATE_SHIFT:4});
  expect(march.outputs.resolution!.attention).toHaveLength(0);expect(march.outputs.resolution!.entries).toHaveLength(6);
  const page=html('overview',march);expect(page).toContain('Flagged Items');expect(page).toContain('No items flagged');expect(page).not.toContain('9 exceptions need review');
  const recon=html('reconciliation',march);expect(recon).not.toContain('What FinGence did');expect(recon).toContain('Source Evidence');expect(recon).toContain('All Matcher Exceptions (9)');
 });
 it('retains every quarter outcome and source-bound drawer identity without rendering the proposed statement',()=>{
  expect(quarter.scope!.months).toEqual(['2026-01','2026-02','2026-03']);expect(quarter.scope!.currency).toBe('SGD');
  const before=JSON.stringify(quarter),rows=reconciliationOutcomes(quarter);
  expect(rows).toHaveLength(quarter.outputs.reconciliation!.results.length);expect(new Set(rows.map(x=>outcomeKey(quarter,x))).size).toBe(rows.length);
  for(const row of rows){const key=outcomeKey(quarter,row),chosen=selectedOutcome(quarter,key)!;expect(chosen).toEqual(row);expect(quarter.outputs.periods.find(p=>p.period===row.period)!.snapshot.results).toContainEqual(Object.fromEntries(Object.entries(row).filter(([k])=>k!=='period')));expect(evidenceRecords(quarter.outputs.reconciliation!,row,'bank').unavailable).toEqual([]);}
  expect(selectedOutcome(march,outcomeKey(quarter,rows[0]))).toBeNull();
  const page=html('reconciliation');for(const p of quarter.outputs.periods)expect(page).toContain(p.period);expect(page).not.toContain('Statement month');expect(page).not.toContain('Bank reconciliation statement (proposed)');expect(page).not.toContain('EVERY EXCEPTION CLASSIFIED BY A STATED RULE');expect(page).not.toContain('What FinGence did');expect(page).toContain('Source Evidence');expect(JSON.stringify(quarter)).toBe(before);
 });
 it('uses actual statement months for analytics when no separate history is supplied',()=>{
  expect(quarter.outputs.history.accepted).toBe(false);expect(analyticsMonths(quarter).map(m=>m.period)).toEqual(quarter.scope!.months);
  const page=html('analytics');expect(page).toContain('January 2026 to March 2026');expect(page).toContain('Monthly cash in, cash out and net');expect(page).not.toContain('Invalid Date');
 });
 it('preserves main result exports and book corroboration without rewriting financial outputs',()=>{
  const before=JSON.stringify(quarter),payload=reportPayload(quarter);
  expect(payload.reconciliation).toEqual(quarter.outputs.resolution);expect(payload.anomalies).toEqual(quarter.outputs.anomalyResolution);expect(payload.reconciliationStatements).toEqual(quarter.outputs.periods.map(p=>({period:p.period,statement:p.statement})));
  expect(payload.cash).toEqual(quarter.outputs.report!.cash);expect(payload.quarantine).toEqual(quarter.quarantine);
  const anomaly=html('anomalies');expect(anomaly).not.toContain('What FinGence found and did');expect(anomaly).toContain('Anomaly resolution');expect(anomaly).toContain('Confirmed by books');
  const reports=html('reports');expect(reports).toContain('Print or Save PDF');expect(reports).not.toContain('What FinGence did');expect(reports).not.toContain('Report Identity and Reporting Period');expect(reports).not.toContain('Bank reconciliation statement (proposed)');expect(reports).toContain(quarter.scope!.period);expect(JSON.stringify(quarter)).toBe(before);
 });
 it('keeps pause reasons, format choices, server-job identity and accurate upload disclosures',()=>{
  Object.assign(state.value,{serverJobs:true,serverState:{paused:true,reason:'Maintenance test'},context:{...march,job:{id:'test-server-job'}},ai:{available:true,model:'test-model'}});
  const page=renderToStaticMarkup(createElement(Data));for(const text of ['Processing is paused','Maintenance test','Quarter sample','Excel workbook','PDF statements','Scanned (OCR)','Files are sent to the FinGence server','test-server-job'])expect(page).toContain(text);
  for(const ext of ['.csv','.xlsx','.pdf','.png','.jpeg'])expect(page).toContain(ext);expect(state.value.process).not.toHaveBeenCalled();
 });
 it('replays stored server-job context through the same gates and preserves the job processing ID',async()=>{
  const c=await processDocuments(pair,undefined,undefined,{job:{id:'test-server-job',runner:'BACKEND_JOB_RUNNER'}});
  const stored:Stored={processedAt:'now',documents:pair.map(d=>({name:d.name,provenance:d.provenance,base64:toBase64(d.bytes)})),job:{id:'test-server-job',processingId:c.processingId},extractions:{},interpretations:{}};
  const replay=await restoreStored(stored);expect(replay.processingId).toBe(c.processingId);expect(replay.job).toEqual({id:'test-server-job'});expect(replay.outputs.reconciliation).toEqual(c.outputs.reconciliation);
 });
 it('uses the current source for suggestions and preserves conditional Management discoverability',()=>{
  const questions=aiSuggestions(quarter);expect(questions[0]).toContain('over these months');expect(questions.join(' ')).not.toContain('GrabFood Marketplace Payout');
  expect(visibleNavigation({syntheticDemo:true}).some(x=>x.href==='/management')).toBe(false);expect(visibleNavigation({syntheticDemo:true,management:true}).some(x=>x.href==='/management')).toBe(true);
  const qa=html('ask');expect(qa.indexOf('aria-label="Answers"')).toBeLessThan(qa.indexOf('aria-label="Suggested questions"'));
 });
});
