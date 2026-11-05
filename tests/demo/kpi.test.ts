import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments } from '../../lib/demo/pipeline';
import { DEFAULT_KPIS, KPI_METRICS, KPI_STORAGE_KEY, moveKpi, readKpiPreference, validKpis, type KpiSource } from '../../components/overview/kpi-metrics';
import { KpiCards } from '../../components/overview/kpi-cards';

let source: KpiSource;
beforeAll(async()=>{
 const c=await processDocuments(['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv','demo-bank-history-2025-04-to-2026-03.csv'].map(name=>({name,bytes:new Uint8Array(readFileSync(`public/demo/${name}`)),provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const})));
 if(!c.scope||!c.outputs.totals||!c.outputs.reconciliation)throw Error('Expected verified public source');
 source={currency:c.scope.currency,bank:c.outputs.totals.net,bankTotals:c.outputs.totals,reconciliation:c.outputs.reconciliation,anomalies:c.outputs.anomalies.length};
});
const read=(id:string,s=source)=>KPI_METRICS.find(m=>m.id===id)!.read(s);
describe('current verified KPI sources and units',()=>{
 it('preserves the four default metrics and exact signed money formatting',()=>{
  expect(DEFAULT_KPIS).toEqual(['bank-net','ledger-net','difference','matched']);
  expect(DEFAULT_KPIS.map(id=>read(id))).toEqual(['RM 28,232.01','RM 30,924.93','RM -2,692.92','50 / 59']);
 });
 it('uses reconciliation outcomes rather than 57 bank rows or 9 unresolved exceptions',()=>{
  expect(source.bankTotals?.rows).toBe(57);expect(source.reconciliation?.results).toHaveLength(59);
  expect(read('exact')).toBe('46');expect(read('date-shift')).toBe('4');expect(read('match-rate')).toBe('84.7%');
  expect(read('unmatched')).toBe('5');expect(read('anomalies')).toBe('6');
 });
 it('uses selected statement receipts and payment magnitude, not history or accounting categories',()=>{
  expect(read('cash-in')).toBe('RM 68,633.32');expect(read('cash-out')).toBe('RM 40,401.31');
  expect(read('cash-in',{...source,bankTotals:undefined})).toBeNull();
  expect(read('cash-out',{...source,bankTotals:{...source.bankTotals!,net:'0.00'}})).toBeNull();
 });
 it('withholds unavailable reconciliation and zero-denominator rates',()=>{
  const missing={...source,reconciliation:null};
  for(const id of ['ledger-net','difference','matched','exact','date-shift','unmatched','match-rate'])expect(read(id,missing)).toBeNull();
  const zero={...source,reconciliation:{...source.reconciliation!,results:[],counts:{MATCH_EXACT:0,MATCH_DATE_SHIFT:0}}};
  expect(read('match-rate',zero)).toBeNull();expect(read('matched',zero)).toBe('0 / 0');
  expect(read('anomalies',{...source,anomalies:0})).toBe('0');expect(read('anomalies',{...source,anomalies:NaN})).toBeNull();
 });
 it('renders exactly four unavailable positions and updates from current source without saving amounts',()=>{
  const render=(s:KpiSource|null)=>renderToStaticMarkup(createElement(KpiCards,{source:s}));
  const summary=(html:string)=>html.split('aria-label="Financial summary">')[1].split('</section>')[0];
  const empty=summary(render(null));expect(empty.match(/<article/g)).toHaveLength(4);expect(empty.match(/—/g)).toHaveLength(4);expect(empty).not.toContain('RM 0');
  expect(summary(render(source))).toContain('RM 28,232.01');
  expect(summary(render({...source,bank:'-1.20',bankTotals:undefined}))).toContain('RM -1.20');
  expect(summary(render(null))).not.toContain('28,232');
 });
 it('renders four labelled selections, explicit duplicate explanations and keyboard ordering',()=>{
  const html=renderToStaticMarkup(createElement(KpiCards,{source:null}));
  expect(html).toContain('<dialog');expect(html).toContain('aria-labelledby');expect(html.match(/<select/g)).toHaveLength(4);
  expect(html).toContain('selected in position 2');expect(html).toContain('Move card 1 right');expect(html).toContain('Cancel');expect(html).toContain('Reset to Default');
 });
});
describe('layout-only preference validation',()=>{
 it.each([null,'broken','{}','[]','["bank-net"]','["bank-net","bank-net","difference","matched"]','["bank-net","ledger-net","difference","obsolete"]'])('falls back safely for %s',raw=>{
  expect(readKpiPreference(raw)).toEqual(DEFAULT_KPIS);
 });
 it('preserves four supported IDs in order, rejects duplicates and reorders without mutating',()=>{
  const ids=readKpiPreference('["cash-in","cash-out","match-rate","anomalies"]');
  expect(validKpis(ids)).toBe(true);expect(moveKpi(ids,1,-1)).toEqual(['cash-out','cash-in','match-rate','anomalies']);
  expect(moveKpi(ids,0,-1)).toEqual(ids);expect(moveKpi(ids,3,1)).toEqual(ids);expect(ids[0]).toBe('cash-in');
 });
 afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
 it('writes only IDs and keeps a tab fallback when storage throws',async()=>{
  const setItem=vi.fn(()=>{throw Error('blocked');});
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem});vi.stubGlobal('window',new EventTarget());
  const {saveKpiPreference,kpiPreferenceSnapshot}=await import('../../components/overview/kpi-preference');
  const ids=['cash-in','cash-out','exact','anomalies'] as const;saveKpiPreference(ids);
  expect(setItem).toHaveBeenCalledWith(KPI_STORAGE_KEY,JSON.stringify(ids));expect(readKpiPreference(kpiPreferenceSnapshot())).toEqual(ids);
  saveKpiPreference(['bank-net','bank-net','exact','anomalies']);expect(setItem).toHaveBeenCalledTimes(1);
 });
});
