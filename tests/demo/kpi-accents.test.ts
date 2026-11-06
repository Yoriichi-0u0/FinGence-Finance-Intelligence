import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KPI_METRICS, DEFAULT_KPIS, type KpiId } from '../../components/overview/kpi-metrics';
import { KPI_ACCENTS } from '../../components/overview/kpi-accents';

const preference=vi.hoisted(()=>({ids:['bank-net','ledger-net','difference','matched'] as KpiId[]}));
vi.mock('../../components/overview/kpi-preference',()=>({useKpiPreference:()=>preference.ids,saveKpiPreference:vi.fn()}));
const {KpiCards}=await import('../../components/overview/kpi-cards');
const render=()=>renderToStaticMarkup(createElement(KpiCards,{source:null}));
beforeEach(()=>{preference.ids=[...DEFAULT_KPIS];});
describe('metric-owned KPI accents',()=>{
 it('covers every selectable metric rather than just the original four',()=>{
  expect(Object.keys(KPI_ACCENTS).sort()).toEqual(KPI_METRICS.map(m=>m.id).sort());
  for(const metric of KPI_METRICS){preference.ids=[metric.id,...DEFAULT_KPIS.filter(id=>id!==metric.id)].slice(0,4);const html=render();expect(html).toContain(`data-kpi="${metric.id}"`);expect(html).toContain(`--kpi-light:${KPI_ACCENTS[metric.id][0]}`);expect(html).toContain(`--kpi-dark:${KPI_ACCENTS[metric.id][1]}`);}
 });
 it('preserves metric colors when customized and reordered without introducing financial values',()=>{
  preference.ids=['cash-out','anomalies','date-shift','match-rate'];const before=render();preference.ids=[...preference.ids].reverse();const after=render();
  for(const id of preference.ids){const attributes=(html:string)=>html.match(new RegExp(`data-kpi="${id}" style="([^"]+)"`))?.[1];expect(attributes(after)).toBe(attributes(before));}
  expect(after).not.toContain('RM ');expect(after.match(/No data available/g)).toHaveLength(4);expect(after).toContain('Customize Cards');
 });
});
