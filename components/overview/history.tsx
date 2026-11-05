"use client";
import { groupDigits } from '@/lib/poc-anomalies/format';
import type { VerifiedMonth } from './chart-model';
import { TradingLineChart } from '../trading-line-chart';
export function CashHistory({ months, currency, mode = 'cash' }: { months: VerifiedMonth[]; currency: string; mode?: 'cash' | 'net' }) {
 const money=(value:string)=>`${currency==='MYR'?'RM':currency} ${groupDigits(value)}`;
 const lines=mode==='net' ? [{label:'Net Cash Movement',color:'var(--fc-net)',values:months.map(m=>Number(m.net)),exactValues:months.map(m=>money(m.net))}] : [{label:'Cash In',values:months.map(m=>Number(m.credits)),exactValues:months.map(m=>money(m.credits))},{label:'Cash Out',values:months.map(m=>Math.abs(Number(m.debits))),exactValues:months.map(m=>money(m.debits.replace(/^-/ ,''))),dashed:true,fill:false}];
 const label=mode==='net'?'Net Cash Movement':'Cash In vs Cash Out';
 return <div className="ov-history">{months.length<2 ? <div className="ov-unavailable ov-chart-empty"><h3>Monthly history unavailable</h3><p>Select a period supported by verified bank history. No artificial observations are shown.</p></div> : <>
 <TradingLineChart presentation="financial" labels={months.map(m=>new Date(`${m.period}-01T00:00:00Z`).toLocaleDateString('en',{month:'short',year:'2-digit',timeZone:'UTC'}))} pointLabels={months.map(m=>m.period)} series={lines} xValues={months.map(m=>Number(m.period.slice(0,4))*12+Number(m.period.slice(5,7)))} ariaLabel={`Verified monthly ${label}`} formatAxis={v=>`${currency==='MYR'?'RM':currency} ${(Math.abs(v)>=1000?v/1000:v).toLocaleString('en',{maximumFractionDigits:Math.abs(v)>=1000?1:2})}${Math.abs(v)>=1000?'k':''}`} />
        <details className="ov-chart-data"><summary>View exact monthly values</summary><table><caption>Verified bank history ({currency})</caption><thead><tr><th>Month</th>{mode === 'net' ? <th>Net Cash Movement</th> : <><th>Cash In</th><th>Cash Out</th></>}</tr></thead><tbody>{months.map(m => <tr key={m.period}><th>{m.period}</th>{mode === 'net' ? <td>{money(m.net)}</td> : <><td>{money(m.credits)}</td><td>{money(m.debits.replace(/^-/, ''))}</td></>}</tr>)}</tbody></table></details>
 </>}</div>;
}
