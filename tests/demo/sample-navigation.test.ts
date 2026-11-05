import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { useDemoProcessing } from '../../components/demo/context';
import { processDocuments } from '../../lib/demo/pipeline';
import { isBuiltInSample } from '../../lib/demo/sample-navigation';

const state=vi.hoisted(()=>({value:null as unknown as ReturnType<typeof useDemoProcessing>,search:''}));
vi.mock('../../components/demo/context',()=>({useDemoProcessing:()=>state.value}));
vi.mock('next/navigation',()=>({usePathname:()=>'/',useSearchParams:()=>new URLSearchParams(state.search),useRouter:()=>({replace:vi.fn()})}));
const {DemoGate}=await import('../../components/demo/gate');
const {default:DemoDataWorkspace}=await import('../../components/demo/data-workspace');
const files=['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv','demo-bank-history-2025-04-to-2026-03.csv'].map(name=>({name,bytes:new Uint8Array(readFileSync('public/demo/'+name)),provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const}));
const sample=await processDocuments(files);
const render=()=>renderToStaticMarkup(createElement(DemoGate,{view:'overview',illustrative:'Protected local workspace'}));
beforeEach(()=>{state.search='';state.value={enabled:true,status:'ready',context:sample,liveStages:sample.stages,processedAt:'now',persisted:true,error:null,process:vi.fn(),clear:vi.fn(),ai:null};});

describe('separate financial workspace',()=>{
 it('shows complete empty panels without fabricated amounts, dates or outcomes',()=>{
  state.value.context=null;state.value.status='empty';const html=render();
  for(const label of ['Financial summary','No data available','No financial data yet','Reconciliation not available','Awaiting financial data','No review items available yet'])expect(html).toContain(label);
  expect(html.match(/No data available/g)).toHaveLength(4);expect(html).not.toContain('RM ');expect(html).not.toContain('<svg role="img"');expect(state.value.process).not.toHaveBeenCalled();
 });
 it('renders original verified results without sample onboarding banner',()=>{
  const html=render();expect(html).toContain('28,232.01');expect(html).toContain('Financial summary');expect(html).not.toContain('Sample dashboard navigation');expect(html).toContain('Demo guest navigation');
 });
 it.each(['failed','quarantined'])('withholds stale verified values for %s',mode=>{
  if(mode==='failed'){state.value.context=null;state.value.status='failed';}else state.value.context={...sample,status:'QUARANTINED'};
  const html=render();expect(html).toContain('did not produce verified results');expect(html).not.toContain('28,232.01');expect(html).toContain('No data available');
 });
 it('clear restores empty workspace and ignores obsolete welcome URL preferences',()=>{
  state.search='sample-view=welcome&sample-context='+sample.processingId;state.value.context=null;state.value.status='empty';
  expect(render()).toContain('No financial data yet');expect(render()).not.toContain('Sign Up');
 });
 it('keeps own copies distinct for Data replacement messaging',async()=>{
  const own=await processDocuments(files.map(f=>({...f,provenance:'USER_SUPPLIED' as const})));expect(own.processingId).toBe(sample.processingId);expect(isBuiltInSample(own)).toBe(false);
  state.value.context=own;expect(renderToStaticMarkup(createElement(DemoDataWorkspace))).not.toContain('Current sample results');
 });
 it('visiting Data preserves sample results and replacement notice',()=>{
  expect(renderToStaticMarkup(createElement(DemoDataWorkspace))).toContain('Processing new documents will replace these results.');expect(state.value.process).not.toHaveBeenCalled();expect(state.value.clear).not.toHaveBeenCalled();
 });
 it('keeps authenticated modes outside the public workspace gate',()=>{state.value.enabled=false;expect(render()).toBe('Protected local workspace');});
});
