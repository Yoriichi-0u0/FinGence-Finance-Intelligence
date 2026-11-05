import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { observedSegments, observationX, TradingLineChart } from '../../components/trading-line-chart';
import { LineChart } from '../../components/charts';

describe('observed trading chart geometry and values',()=>{
 it('draws straight segments through real peaks and dips with no interpolated observations',()=>{
  const values=[10,30,5,20];
  expect(observedSegments(values,i=>i*10,v=>v)).toEqual([{path:'M 0 10 L 10 30 L 20 5 L 30 20',first:0,last:3}]);
  expect(values).toEqual([10,30,5,20]);
 });
 it('breaks line and area segments for missing or nonfinite values',()=>{
  const segments=observedSegments([1,2,null,4,NaN,6],i=>i,v=>v);
  expect(segments).toEqual([{path:'M 0 1 L 1 2',first:0,last:1},{path:'M 3 4',first:3,last:3},{path:'M 5 6',first:5,last:5}]);
 });
 it('preserves irregular observed date spacing without inserting missing dates',()=>{
  const positions=[0,1,10];expect(positions.map((_,i)=>observationX(i,3,0,100,positions))).toEqual([0,10,100]);
  expect(observationX(0,1,0,100)).toBe(50);
 });
 it('keeps signed exact values, real zeros, point count and zero reference accessible',()=>{
  const html=renderToStaticMarkup(createElement(TradingLineChart,{labels:['Jan','Mar','Apr'],pointLabels:['2026-01','2026-03','2026-04'],series:[{label:'Net',values:[-12.34,0,23.45],exactValues:['RM -12.34','RM 0.00','RM 23.45']}],ariaLabel:'Verified net'}));
  expect(html).toContain('2026-01: Net RM -12.34');expect(html).toContain('2026-03: Net RM 0.00');expect(html).toContain('2026-04: Net RM 23.45');
  expect(html.match(/role="button"/g)).toHaveLength(3);expect(html).toContain('Zero cash movement');expect(html).not.toContain('2026-02');
  expect(html).toContain('linearGradient');expect(html).toContain('vector-effect="non-scaling-stroke"');expect(html).not.toMatch(/d="[^"]*\bC /);
 });
 it('does not draw artificial data when observations are unavailable',()=>{
  const html=renderToStaticMarkup(createElement(TradingLineChart,{labels:[],series:[],ariaLabel:'Unavailable'}));
  expect(html).toContain('no verified observations');expect(html).not.toContain('<svg');
 });
 it('only opts selected time series into the new visual style',()=>{
  const props={labels:['1','2'],series:[{label:'Observed',color:'teal',values:[1,2]}],ariaLabel:'Existing chart'};
  expect(renderToStaticMarkup(createElement(LineChart,props))).not.toContain('class="trading-chart"');
  const html=renderToStaticMarkup(createElement(LineChart,{...props,appearance:'trading',formatTooltipValue:v=>`MYR ${v.toFixed(2)}`}));
  expect(html).toContain('class="trading-chart"');expect(html).toContain('Observed MYR 1.00');
 });
});
