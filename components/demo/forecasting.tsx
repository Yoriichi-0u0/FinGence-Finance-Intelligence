'use client';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { PageHeader } from '@/components/ui';
import { TradingLineChart } from '@/components/trading-line-chart';
import { financialMoney } from '@/components/chart-readout';
import { SourceStrip, Stat } from './shared';
import styles from './workspace-final.module.css';

export default function Forecasting({ c }: { c: ProcessingContext | null }) {
    const bf=c?.outputs.forecast, f=bf?.forecast, available=f?.status==='AVAILABLE', currency=c?.scope?.currency??'MYR';
    const money=(v:string)=>financialMoney(currency,v), history=bf?.history??[];
    const labels=[...history.map(m=>m.period),...(available?[f.period]:[])];
    return <div className={styles.page}><PageHeader title="Forecasting" description="A statistical cash baseline supported by verified history and rolling backtests." />{c?<SourceStrip compact context={c}/>:<p className={styles.context}>No verified financial evidence available.</p>}
        <div className={styles.cards}><Stat label={`Cash In${available?` · ${f.period}`:''}`} value={available?money(f.credits):'—'}/><Stat label={`Cash Out${available?` · ${f.period}`:''}`} value={available?money(f.debits.replace(/^-/ ,'')):'—'}/><Stat label={`Derived Net${available?` · ${f.period}`:''}`} value={available?money(f.net):'—'} detail="Net is the least reliable figure"/></div>
        {!available&&<p className={`${styles.note} ${styles.warning}`}>{f?.status==='UNAVAILABLE'?f.detail:'No forecast has been calculated.'} At least seven consecutive verified months for the same business and currency are required.</p>}
        <div className={styles.grid}><section className={styles.panel}><h2>History and Baseline</h2><TradingLineChart key={c?.processingId??'empty'} presentation="financial" labels={labels} pointLabels={labels.map((p,i)=>i===history.length?`${p} · forecast baseline`:`${p} · observed`)} xValues={labels.map(p=>Number(p.slice(0,4))*12+Number(p.slice(5,7)))} ariaLabel="Observed net movement and forecast baseline" formatAxis={v=>`${currency==='MYR'?'RM':currency} ${(v/1000).toFixed(0)}k`} series={[
            {label:'Observed Net',color:'var(--fc-teal)',values:[...history.map(m=>Number(m.net)),...(available?[null]:[])],exactValues:[...history.map(m=>money(m.net)),...(available?[null]:[])],fill:true},
            {label:'Forecast Baseline',tooltipVisible:labels.map((_,i)=>i===history.length),color:'var(--fc-net)',dashed:true,fill:false,values:labels.map((_,i)=>available?(i===history.length?Number(f.net):i===history.length-1?Number(history[i].net):null):null),exactValues:labels.map((_,i)=>available?(i===history.length?money(f.net):i===history.length-1?money(history[i].net):null):null)},
        ]}/><p className={styles.forecastBoundary}>{available?`Observed history ends ${history.at(-1)?.period}. Dashed segment to ${f.period} is a forecast, not an observed transaction.`:'No artificial historical or forecast points are displayed.'}</p></section>
        <section className={styles.panel}><h2>Rolling-Origin Backtests</h2><p className={styles.note}>{available?`${f.tests} test months`:'Backtesting unavailable'}</p><div className={styles.table}><table><caption className="sr-only">Backtest WAPE by method</caption><thead><tr>{['Metric','Last Month','3 Month Mean','6 Month Mean'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{(['credits','debits','net'] as const).map(metric=><tr key={metric}><th scope="row">{metric==='credits'?'Cash In':metric==='debits'?'Cash Out':'Derived Net'}</th>{(['LAST_MONTH','MEAN_3','MEAN_6'] as const).map(method=>{const w=available?f.backtest[metric].methods.find(m=>m.method===method)?.wape:null;return <td key={method}>{w===null||w===undefined?'—':`${w}%`}</td>;})}</tr>)}</tbody></table></div><p className={styles.note}>WAPE is weighted absolute percentage error. Lower historical WAPE indicates lower backtest error, not guaranteed future accuracy.</p></section></div>
        <details className={styles.panel}><summary>How Is This Forecast Calculated?</summary><p className={styles.note}>The existing deterministic model uses the mean of the last six observed months for receipts and payment magnitudes. Derived net is receipts minus payments. Rolling-origin backtests predict held-out months using only earlier observations and compare Last Month, 3 Month Mean and 6 Month Mean. Net is the least reliable figure. No trained model, confidence band or guaranteed outcome is implied.</p>{available&&<p className={styles.note}>Basis: {f.basis.first} to {f.basis.last}. Forecast month: {f.period}.</p>}</details>
    </div>;
}
