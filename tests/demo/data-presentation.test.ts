import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { processDocuments, STAGE_TITLES } from '../../lib/demo/pipeline';
import type { useDemoProcessing } from '../../components/demo/context';
import { dataStatus, reportedProgress, stagePresentation } from '../../components/demo/data-presentation';
import { DataWorkflow, processingWorkflow } from '../../components/demo/data-workflow';

const state=vi.hoisted(()=>({value:null as unknown as ReturnType<typeof useDemoProcessing>}));
vi.mock('../../components/demo/context',()=>({useDemoProcessing:()=>state.value}));
vi.mock('next/navigation',()=>({usePathname:()=>'/data',useSearchParams:()=>new URLSearchParams(),useRouter:()=>({replace:vi.fn()})}));
const {default:Data}=await import('../../components/demo/data-workspace');
const sample=await processDocuments(['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv','demo-bank-history-2025-04-to-2026-03.csv'].map(name=>({name,bytes:new Uint8Array(readFileSync('public/demo/'+name)),provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const})));
beforeEach(()=>{state.value={enabled:true,status:'empty',context:null,liveStages:[],processedAt:null,persisted:true,error:null,process:vi.fn(),clear:vi.fn(),ai:null};});
const render=()=>renderToStaticMarkup(createElement(Data));
describe('Data display states follow the runner',()=>{
 it('keeps exactly three truthful workflow steps and distinguishes readiness from verification',()=>{
  expect(processingWorkflow('empty',false,0).current).toBe(0);expect(processingWorkflow('empty',false,3).current).toBe(0);
  expect(processingWorkflow('processing',false,3).current).toBe(1);expect(processingWorkflow('failed',false,3)).toMatchObject({current:1,failed:true});
  expect(processingWorkflow('ready',true,3).current).toBe(2);expect(processingWorkflow('ready',false,1,true)).toMatchObject({current:1,failed:true});
  const html=renderToStaticMarkup(createElement(DataWorkflow,{status:'processing',completed:false,selected:3,quarantined:false}));expect(html.match(/<li /g)).toHaveLength(3);expect(html).toContain('aria-current="step"');expect(html).not.toContain('data-state="complete"');expect(html).toContain('Awaiting verified outputs');
 });
 it('keeps four unavailable summary positions and a real zero-document empty state',()=>{
  const html=render();expect(html).toContain('No financial data processed yet.');expect(html).toContain('No documents identified yet.');expect(html).toContain('0 documents');expect(html).not.toContain('data-safety');expect(html).not.toContain('Browser processing</h2>');expect(html).not.toContain('Demo limitations');expect(html).not.toContain('Step 4');
  for(const label of ['Net Signed Bank Movement','Bank and Ledger Difference','Matched Automatically','Next Month Baseline'])expect(html).toContain(label);
 });
 it('does not imply readiness or completion before an actual selection/result',()=>{
  expect(dataStatus('empty',null,0).label).toBe('No documents selected');expect(dataStatus('empty',null,2).label).toBe('Ready to process');
  expect(dataStatus('loading',null,0).label).toBe('Restoring session');expect(dataStatus('empty',null,0,true).label).toBe('Loading sample documents');
  expect(dataStatus('processing',null,2).label).toBe('Processing');expect(dataStatus('failed',null,2).tone).toBe('danger');
  expect(dataStatus('ready',sample,0).label).toBe('Completed with issues');expect(dataStatus('ready',{...sample,status:'COMPLETED'},0).label).toBe('Completed');
 });
 it('counts only distinct reported stage IDs, not elapsed time or verification success',()=>{
  expect(reportedProgress([])).toEqual({reported:0,total:8});expect(reportedProgress(sample.stages.slice(0,3))).toEqual({reported:3,total:8});
  expect(reportedProgress([sample.stages[0],sample.stages[0]])).toEqual({reported:1,total:8});
  expect(stagePresentation(sample.stages[0]).label).toBe('Auto-accepted');
  const verify=sample.stages.find(s=>s.id==='VERIFY')!;expect(stagePresentation(verify).label).toBe('Verified');
  expect(stagePresentation({...verify,checks:[]}).label).toBe('Auto-accepted');expect(stagePresentation({...verify,decision:'QUARANTINED'}).label).toContain('Quarantined');
  expect(stagePresentation(undefined).label).toBe('Waiting');expect(stagePresentation(undefined,true).label).toBe('Not run');
 });
 it('renders accessible selection/CSV-only controls without starting processing',()=>{
  const html=render();expect(html).toContain('Data Processing');expect(html).toContain('Financial Documents');expect(html).toContain('accept=".csv,text/csv"');
  expect(html).toContain('aria-label="Choose CSV files"');expect(html).toContain('No documents selected');expect(html).toContain('value="0"');expect(html).toContain('max="8"');
  expect(html).toContain('View All Processing Stages');expect(html).not.toMatch(/<details class="data-stage-details"[^>]*\bopen/);
  expect(html).toContain('Verified Financial Summary');expect(html).not.toContain('Explore Your Results');expect(html).not.toContain('MYR 0.00');
  expect(state.value.process).not.toHaveBeenCalled();expect(state.value.clear).not.toHaveBeenCalled();
 });
 it('reports partial progress honestly and exposes original ordered evidence',()=>{
  state.value.status='processing';state.value.liveStages=sample.stages.slice(0,3);const html=render();
  expect(html).toContain('value="3"');expect(html).toContain('Verified Financial Summary');
  let position=-1;for(const title of Object.values(STAGE_TITLES)){const next=html.indexOf(title,position+1);expect(next).toBeGreaterThan(position);position=next;}
  for(const stage of state.value.liveStages){expect(html).toContain(stage.method);for(const check of stage.checks)expect(html).toContain(check.label);}
 });
 it('puts unchanged verified figures above identified documents and retains all routes/fingerprints',()=>{
  Object.assign(state.value,{status:'ready',context:sample,liveStages:sample.stages});const html=render();
  expect(html.indexOf('Verified Financial Summary')).toBeLessThan(html.indexOf('>Identified Documents<'));
  for(const value of ['28,232.01','-2,692.92','30,924.93','50 of 59','35,446.45'])expect(html).toContain(value);
  for(const doc of sample.documents){expect(html).toContain(doc.name);expect(html).toContain(doc.sha256);}
  expect(html).not.toContain('Connected results');
  expect(html).toContain('estimate, not a guaranteed');expect(html).toContain('Full fingerprint');expect(html).not.toContain('Explore Your Results');
 });
 it('keeps failures/quarantine visible without stale verified values or success navigation',()=>{
  state.value.status='failed';state.value.error='Processing stopped unexpectedly. No result was kept.';let html=render();expect(html).toContain('role="alert"');expect(html).toContain(state.value.error);
  Object.assign(state.value,{status:'ready',context:{...sample,status:'QUARANTINED'},liveStages:sample.stages});html=render();
  expect(html).toContain('Verified Financial Summary');expect(html).not.toContain('Explore Your Results');expect(html).not.toContain('28,232.01');expect(html).toContain('Financial outputs unavailable');
 });
 it('displays trusted roles for user-supplied bytes rather than misleading filenames',async()=>{
  const own=await processDocuments([
   {name:'ledger_filename_is_not_a_role_long_document_name.csv',bytes:new Uint8Array(readFileSync('public/demo/demo-bank-statement-2026-03.csv')),provenance:'USER_SUPPLIED'},
   {name:'bank_filename_is_not_a_role.csv',bytes:new Uint8Array(readFileSync('public/demo/demo-general-ledger-2026-03.csv')),provenance:'USER_SUPPLIED'},
  ]);
  expect(own.documents[0].role).toBe('BANK_STATEMENT');expect(own.documents[1].role).toBe('GENERAL_LEDGER');
  Object.assign(state.value,{status:'ready',context:own,liveStages:own.stages});const html=render();
  expect(html).toContain('ledger_filename_is_not_a_role');expect(html).toContain('Bank statement');expect(html).toContain('General ledger (cash account)');
  expect(html).toContain('28,232.01');expect(html).toContain('Unavailable');expect(html).not.toContain('35,446.45');
 });
 it('shows quarantined invalid CSV evidence without financial outputs',async()=>{
  const invalid=await processDocuments([{name:'invalid.csv',bytes:new TextEncoder().encode('not_a_supported_schema,untrusted_amount\nhello,not-money\n'),provenance:'USER_SUPPLIED'}]);
  expect(invalid.status).toBe('QUARANTINED');Object.assign(state.value,{status:'ready',context:invalid,liveStages:invalid.stages});
  const html=render();expect(html).toContain('invalid.csv');expect(html).toContain('Financial outputs unavailable');expect(html).toContain('Verified Financial Summary');expect(html).not.toContain('Explore Your Results');
  expect(html).toContain('Quarantined');expect(html).toContain('Not run');
 });
});
