'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ChartReadout, financialColors } from './chart-readout';
import { smoothObservedSegments } from './chart-smoothing';
import financialStyles from './financial-chart.module.css';

export type TradingSeries = { label:string; values:(number|null)[]; exactValues:(string|null)[]; dashed?:boolean; color?:string; fill?:boolean; tooltipVisible?:boolean[] };
/** Segment only supplied observations. Null/nonfinite values break the line and its area. */
export function observedSegments(values:(number|null)[], x:(index:number)=>number, y:(value:number)=>number) {
 const segments:{path:string;first:number;last:number}[]=[];
 let current:typeof segments[number]|null=null;
 values.forEach((value,index)=>{
  if(value===null||!Number.isFinite(value)){current=null;return;}
  if(!current){current={path:`M ${x(index)} ${y(value)}`,first:index,last:index};segments.push(current);}
  else {current.path+=` L ${x(index)} ${y(value)}`;current.last=index;}
 });
 return segments;
}
export function observationX(index:number, count:number, left:number, right:number, positions?:number[]) {
 if(positions?.length===count&&positions.every(Number.isFinite)&&positions.at(-1)!>positions[0])return left+(positions[index]-positions[0])/(positions.at(-1)!-positions[0])*(right-left);
 return count===1 ? (left+right)/2 : left+index/Math.max(1,count-1)*(right-left);
}
export function TradingLineChart({labels,pointLabels=labels,series,xValues,ariaLabel,formatAxis=(v)=>v.toLocaleString('en',{maximumFractionDigits:1}),legend=true,presentation='trading',timeScale='month'}: {
 labels:string[];pointLabels?:string[];series:TradingSeries[];xValues?:number[];ariaLabel:string;formatAxis?:(value:number)=>string;legend?:boolean;presentation?:'trading'|'financial';timeScale?:'day'|'month';
}) {
 const ref=useRef<HTMLDivElement>(null), id=useId().replace(/:/g,'');
 const [width,setWidth]=useState(700),[active,setActive]=useState<number|null>(null);
 useEffect(()=>{if(!ref.current)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(220,entry.contentRect.width)));observer.observe(ref.current);return()=>observer.disconnect();},[]);
 const available=series.flatMap(s=>s.values.filter((v):v is number=>v!==null&&Number.isFinite(v)));
 const minimum=Math.min(0,...available),maximum=Math.max(0,...available),unit=10**Math.floor(Math.log10(Math.max(1,maximum,Math.abs(minimum))));
 const low=Math.floor(minimum/unit)*unit,high=Math.ceil(maximum/unit)*unit||(minimum<0?0:1),range=high-low||1;
 const left=width<400?70:90,right=Math.max(left+40,width-25),top=20,bottom=245;
 const x=(i:number)=>observationX(i,labels.length,left,right,xValues),y=(v:number)=>bottom-(v-low)/range*(bottom-top);
 const ticks=[...new Set([low,low+range/2,high,...(low<0&&high>0?[0]:[])])].sort((a,b)=>a-b);
 const financial=presentation==='financial';
 const color=(i:number)=>financial?series[i].color??financialColors[i%financialColors.length]:i<2?`url(#${id}-line-${i})`:series[i].color??'var(--trading-purple)';
 const readable=(s:TradingSeries,i:number)=>s.values[i]!==null&&s.values[i]!==undefined&&Number.isFinite(s.values[i])&&s.tooltipVisible?.[i]!==false;
 const exact=(i:number)=>series.filter(s=>readable(s,i)).map(s=>`${s.label} ${s.exactValues[i]??'Unavailable'}`).join(' · ');
 const validPoint=(i:number)=>series.some(s=>readable(s,i));
 const selected=active!==null&&active<labels.length&&validPoint(active) ? active : null;
 return <div ref={ref} className={financial?`trading-chart ${financialStyles.financial}`:'trading-chart'}>{!labels.length||!available.length?<p className="ov-muted">Chart unavailable — no verified observations.</p>:<>
  {financial?<ChartReadout hint={`Hover, tap or focus a ${timeScale} for exact values.`} title={selected===null?undefined:pointLabels[selected]} items={selected===null?[]:series.flatMap((s,i)=>!readable(s,selected)?[]:[{label:s.label,value:s.exactValues[selected]??'Unavailable',color:color(i)}])}/>:<div className="trading-readout" role={selected!==null?'tooltip':undefined} aria-live="polite">{selected===null?'Hover, tap or focus an observed date for exact values':<><strong>{pointLabels[selected]}</strong><span>{exact(selected)}</span></>}</div>}
  <svg viewBox={`0 0 ${width} 286`} role="group" aria-label={ariaLabel} onPointerLeave={e=>{if(financial&&e.pointerType==='touch')return;const focused=e.currentTarget.querySelector(':focus')?.getAttribute('data-observation-index');setActive(focused===null||focused===undefined?null:Number(focused));}}>
   <defs>{[0,1].map(i=><linearGradient key={i} id={`${id}-line-${i}`} x1="0" x2="1" y1="0" y2="0"><stop stopColor={i?'var(--trading-cyan)':'var(--trading-purple)'}/><stop offset="1" stopColor={i?'var(--trading-purple)':'var(--trading-cyan)'}/></linearGradient>)}<linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1"><stop stopColor={financial?'var(--fc-teal)':'var(--trading-purple)'} stopOpacity={financial?'.10':'.16'}/><stop offset="1" stopColor="var(--trading-cyan)" stopOpacity="0"/></linearGradient></defs>
   {ticks.map(v=><g key={v}><line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="var(--border)" opacity={v===0?.8:.45} strokeDasharray={financial?'2 6':v===0?undefined:'2 7'} aria-label={v===0&&low<0?'Zero cash movement':undefined}/><text x={left-10} y={y(v)+4} textAnchor="end" fill="var(--muted)" fontSize="12">{formatAxis(v)}</text></g>)}
   {series.map((s,index)=><g key={s.label}>{(financial?smoothObservedSegments:observedSegments)(s.values,x,y).map((segment,i)=><g key={i}>{(s.fill??index===0)&&segment.last>segment.first&&<path d={`${segment.path} L ${x(segment.last)} ${y(0)} L ${x(segment.first)} ${y(0)} Z`} fill={`url(#${id}-area)`}/>}<path className="trading-stroke" d={segment.path} fill="none" stroke={color(index)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed||(!financial&&index===1)?'6 6':undefined} vectorEffect="non-scaling-stroke"/></g>)}{s.values.map((v,i)=>v===null||!Number.isFinite(v)?null:<circle key={i} cx={x(i)} cy={y(v)} r={selected===i?5:2.5} fill={financial?'var(--fc-surface)':'var(--trading-canvas)'} stroke={color(index)} strokeWidth={selected===i?2.5:1.5}/>)}</g>)}
   {selected!==null&&<g pointerEvents="none" className="trading-crosshair"><line x1={x(selected)} x2={x(selected)} y1={top} y2={bottom} stroke={financial?'var(--fc-blue)':'var(--trading-cyan)'} strokeDasharray="3 5" opacity=".7"/>{series.length===1&&series[0].values[selected]!==null&&<line x1={left} x2={right} y1={y(series[0].values[selected]!)} y2={y(series[0].values[selected]!)} stroke="var(--trading-purple)" strokeDasharray="3 5" opacity=".35"/>}</g>}
   {labels.map((label,i)=>{
    const a=i===0?left-8:(x(i-1)+x(i))/2,b=i===labels.length-1?right+8:(x(i)+x(i+1))/2;
    return <g key={`${label}-${i}`}><rect x={a} y={top} width={Math.max(1,b-a)} height={bottom-top+8} fill="transparent" tabIndex={validPoint(i)?0:-1} aria-disabled={!validPoint(i)} role="button" data-observation-index={i} aria-label={`${pointLabels[i]}: ${exact(i)}`} onPointerEnter={()=>setActive(validPoint(i)?i:null)} onPointerDown={()=>setActive(validPoint(i)?i:null)} onFocus={()=>setActive(validPoint(i)?i:null)} onBlur={()=>setActive(null)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setActive(validPoint(i)?i:null);}if(e.key==='Escape')setActive(null);}}/>{(i===0||i===labels.length-1||i%Math.max(1,Math.ceil(labels.length/(width<500?3:7)))===0)&&<text x={x(i)} y="273" textAnchor="middle" fill="var(--muted)" fontSize="12">{label}</text>}</g>;
   })}
  </svg>
  {legend&&<div className="ov-legend">{series.map((s,i)=><span key={s.label}><i style={{borderTopColor:financial?color(i):i===0?'var(--trading-purple)':i===1?'var(--trading-cyan)':s.color,borderTopStyle:s.dashed||(!financial&&i===1)?'dashed':'solid'}}/>{s.label}</span>)}</div>}
 </>}</div>;
}
