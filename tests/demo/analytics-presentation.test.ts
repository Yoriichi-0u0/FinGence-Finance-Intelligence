import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments } from '../../lib/demo/pipeline';
import { analyticsCounterparties, analyticsDays, analyticsMonths, exploreCounterparties } from '../../components/demo/analytics-model';
import { cashTotals } from '../../lib/poc-insights/model';
import { toCents } from '../../lib/poc-anomalies/source';
import { smoothObservedSegments } from '../../components/chart-smoothing';
import { TradingLineChart } from '../../components/trading-line-chart';
import { ChartReadout, financialMoney } from '../../components/chart-readout';
import Analytics from '../../components/demo/analytics';
import { CashHistory } from '../../components/overview/history';
import { availablePeriods } from '../../components/overview/chart-model';
import { ReconciliationStatusChart } from '../../components/overview/financial-chart';

const docs=['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv','demo-bank-history-2025-04-to-2026-03.csv'].map(name=>({name,bytes:new Uint8Array(readFileSync('public/demo/'+name)),provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const}));
const c=await processDocuments(docs);
describe('Analytics verified selectors and financial chart presentation',()=>{
 it('preserves summary, observed month ordering and actual monthly values',()=>{
  expect(c.outputs.totals?.net).toBe('28232.01');expect(c.outputs.totals?.credits).toBe('68633.32');expect(c.outputs.totals?.debits).toBe('-40401.31');
  const months=analyticsMonths(c);expect(months).toHaveLength(12);expect(months.map(m=>m.period)).toEqual(c.outputs.history.months);
  for(const month of months)expect(month).toEqual({period:month.period,...cashTotals(c.outputs.history.rows.filter(r=>r.period===month.period))});
  expect(availablePeriods(months)).toEqual([3,6,12]);
 });
 it('retains every cumulative day and exact signed cents without inserting dates',()=>{
  const days=analyticsDays(c),dates=[...new Set(c.outputs.bankRows.map(r=>r.date))].sort();expect(days.map(d=>d.date)).toEqual(dates);
  for(const point of days){const cents=c.outputs.bankRows.filter(r=>r.date<=point.date).reduce((s,r)=>s+toCents(r.signedAmount),0n);expect(toCents(point.exact)).toBe(cents);expect(point.value).toBe(Number(cents)/100);}
  expect(days.at(-1)?.exact).toBe(c.outputs.totals!.net);
 });
 it('keeps the same top-eight names, grouping and gross definition; sorts cash magnitudes exactly',()=>{
  const parties=analyticsCounterparties(c);expect(parties.length).toBeLessThanOrEqual(8);
  for(const p of parties){const rows=c.outputs.bankRows.filter(r=>r.counterparty===p.name);expect(p.records).toBe(rows.length);expect(p.incoming).toBe(rows.reduce((s,r)=>s+(toCents(r.signedAmount)>=0n?toCents(r.signedAmount):0n),0n));expect(p.outgoing).toBe(rows.reduce((s,r)=>s+(toCents(r.signedAmount)<0n?toCents(r.signedAmount):0n),0n));}
  for(const sort of ['gross','in','out'] as const){const sorted=exploreCounterparties(parties,'',sort),values=sorted.map(p=>sort==='in'?p.incoming:sort==='out'?-p.outgoing:p.incoming-p.outgoing);expect(values.every((v,i)=>!i||values[i-1]>=v)).toBe(true);}
  expect(exploreCounterparties(parties,parties[0].name.toUpperCase(),'gross')[0].name).toBe(parties[0].name);expect(exploreCounterparties(parties,'nonexistent-counterparty','gross')).toEqual([]);
 });
 it('does not mutate processing records or manufacture missing history',()=>{
  const before=JSON.stringify(c);analyticsDays(c);analyticsMonths(c);exploreCounterparties(analyticsCounterparties(c),'','out');expect(JSON.stringify(c)).toBe(before);
  const without={...c,outputs:{...c.outputs,history:{accepted:false,months:[],rows:[]}}};expect(analyticsMonths(without)).toEqual([]);
  const html=renderToStaticMarkup(createElement(Analytics,{c:without}));expect(html).toContain('Monthly trend unavailable');expect(html).not.toContain('Monthly cash in, cash out and net');
  expect(renderToStaticMarkup(createElement(CashHistory,{months:[],currency:'MYR'}))).toContain('Monthly history unavailable');
 });
 it('does not turn one verified historical month into a trend or enable unsupported Dashboard periods',()=>{
  const single={...c,outputs:{...c.outputs,history:{accepted:true,months:['2026-03'],rows:c.outputs.history.rows.filter(r=>r.period==='2026-03')}}};
  expect(analyticsMonths(single)).toHaveLength(1);expect(availablePeriods(analyticsMonths(single))).toEqual([]);expect(renderToStaticMarkup(createElement(Analytics,{c:single}))).toContain('Monthly trend unavailable');
 });
 it('uses bounded cubic controls through actual observations, splitting at missing values',()=>{
  const values=[0,30,5,20,null,-10,0],segments=smoothObservedSegments(values,i=>i*10,v=>v);expect(segments.map(s=>[s.first,s.last])).toEqual([[0,3],[5,6]]);
  for(const segment of segments){const parts=segment.path.split(' C ').slice(1);parts.forEach((part,k)=>{const nums=part.split(' ').map(Number),a=values[segment.first+k]!,b=values[segment.first+k+1]!;expect(nums[1]).toBeGreaterThanOrEqual(Math.min(a,b));expect(nums[1]).toBeLessThanOrEqual(Math.max(a,b));expect(nums[3]).toBeGreaterThanOrEqual(Math.min(a,b));expect(nums[3]).toBeLessThanOrEqual(Math.max(a,b));expect(nums[5]).toBe(b);});}
  expect(smoothObservedSegments([null,NaN],i=>i,v=>v)).toEqual([]);expect(values).toEqual([0,30,5,20,null,-10,0]);
 });
 it('keeps exact source text and only real point interactions in the shared financial renderer',()=>{
  const props={presentation:'financial' as const,labels:['Jan','Feb','Apr'],pointLabels:['2026-01','2026-02','2026-04'],series:[{label:'Net',values:[-12.34,null,0],exactValues:['RM -12.34',null,'RM 0.00']}],ariaLabel:'Observed net'};
  const html=renderToStaticMarkup(createElement(TradingLineChart,props));expect(html).toContain('2026-01: Net RM -12.34');expect(html).toContain('2026-04: Net RM 0.00');expect(html).toContain('aria-disabled="true"');expect(html).toContain('Hover, tap or focus a month for exact values.');expect(html).not.toContain('role="tooltip"');
  expect(financialMoney('MYR','-1234.50')).toBe('RM -1,234.50');expect(financialMoney('USD','12.30')).toBe('USD 12.30');
  const readout=renderToStaticMarkup(createElement(ChartReadout,{title:'2026-03',hint:'Month',items:[{label:'Cash In',value:'RM 68,633.32',color:'teal'},{label:'Cash Out',value:'RM 40,401.31',color:'blue'}]}));expect(readout).toContain('role="tooltip"');expect(readout).toContain('RM 68,633.32');expect(readout).toContain('RM 40,401.31');
 });
 it('preserves Dashboard cash/net values with the same financial presentation and signed net',()=>{
  const months=analyticsMonths(c);for(const mode of ['cash','net'] as const){const html=renderToStaticMarkup(createElement(CashHistory,{months,currency:'MYR',mode}));expect(html).toContain('Hover, tap or focus a month');expect(html).toContain(mode==='net'?'RM 28,232.01':'RM 68,633.32');}
  const html=renderToStaticMarkup(createElement(CashHistory,{months:[{...months[0],net:'-12.34'},months[1]],currency:'MYR',mode:'net'}));expect(html).toContain('RM -12.34');
 });
 it('keeps reconciliation categorical with outcome counts and compatible focus/tap readouts',()=>{
  const html=renderToStaticMarkup(createElement(ReconciliationStatusChart,{counts:{exact:46,shifted:4,unresolved:9,total:59}}));expect(html).toContain('focus a category');expect(html).toContain('Exact matches: 46 outcomes');expect(html).toContain('Unresolved exceptions: 9 outcomes');expect(html).not.toContain('<svg');expect(html).not.toContain('RM ');expect(html.match(/role="button"/g)).toHaveLength(3);
 });
});
