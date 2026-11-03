"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { groupDigits } from '@/lib/poc-anomalies/format';
import type { VerifiedMonth } from './chart-model';
export function CashHistory({ months, currency, mode = 'cash' }: { months: VerifiedMonth[]; currency: string; mode?: 'cash' | 'net' }) {
    const ref = useRef<HTMLDivElement>(null), id = useId().replace(/:/g, '');
    const [width, setWidth] = useState(700), [activePeriod, setActive] = useState<string | null>(null);
    useEffect(() => { if (!ref.current) return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(220, entry.contentRect.width))); observer.observe(ref.current); return () => observer.disconnect(); }, []);
    const money = (value: string) => `${currency === 'MYR' ? 'RM' : currency} ${groupDigits(value)}`;
    const lines = mode === 'net' ? [{ label: 'Net Cash Movement', values: months.map(m => Number(m.net)), color: 'var(--net)' }] : [{ label: 'Cash In', values: months.map(m => Number(m.credits)), color: 'var(--cash-in)' }, { label: 'Cash Out', values: months.map(m => Math.abs(Number(m.debits))), color: 'var(--cash-out)' }];
    const values = lines.flatMap(line => line.values), maximum = Math.max(0, ...values), minimum = Math.min(0, ...values);
    const unit = 10 ** Math.floor(Math.log10(Math.max(1, maximum, Math.abs(minimum))));
    const low = Math.floor(minimum / unit) * unit, high = Math.ceil(maximum / unit) * unit || (minimum < 0 ? 0 : 1), range = high - low || 1;
    const left = width < 400 ? 76 : 94, right = width - 27, top = 20, bottom = 246;
    const monthNumber = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7));
    const start = months[0] ? monthNumber(months[0].period) : 0, end = months.at(-1) ? monthNumber(months.at(-1)!.period) : start;
    const x = (index: number) => left + (monthNumber(months[index].period) - start) / Math.max(1, end - start) * (right - left);
    const y = (value: number) => bottom - (value - low) / range * (bottom - top);
    const path = (points: number[]) => points.map((v, i) => i ? `C ${(x(i - 1) + x(i)) / 2} ${y(points[i - 1])}, ${(x(i - 1) + x(i)) / 2} ${y(v)}, ${x(i)} ${y(v)}` : `M ${x(i)} ${y(v)}`).join(' ');
    const ticks = [...new Set([0, ...[0, .25, .5, .75, 1].map(f => low + range * f)])].sort((a, b) => a - b);
    const active = months.find(m => m.period === activePeriod), label = mode === 'net' ? 'Net Cash Movement' : 'Cash In vs Cash Out';
    const exact = (m: VerifiedMonth) => mode === 'net' ? `Net Cash Movement ${money(m.net)}` : `Cash In ${money(m.credits)}, Cash Out ${money(m.debits.replace(/^-/, ''))}`;
    return <div ref={ref} className="ov-history">{months.length < 2 ? <div className="ov-unavailable ov-chart-empty"><h3>Monthly history unavailable</h3><p>Select a period supported by verified bank history. No artificial observations are shown.</p></div> : <>
        <div className="ov-chart-readout" role={active ? 'tooltip' : undefined} aria-live="polite">{active ? <><strong>{active.period}</strong><span>{exact(active)}</span></> : <span>Hover, tap or focus a month for exact values</span>}</div>
        <svg viewBox={`0 0 ${width} 288`} role="group" aria-label={`Verified monthly ${label}`} onPointerLeave={() => setActive(null)}>
            <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor={lines[0].color} stopOpacity=".18" /><stop offset="1" stopColor={lines[0].color} stopOpacity="0" /></linearGradient></defs>
            {ticks.map(tick => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 && low < 0 ? 'var(--muted-strong)' : 'var(--border)'} strokeDasharray={tick === 0 && low < 0 ? undefined : '3 5'} aria-label={tick === 0 && low < 0 ? 'Zero cash movement' : undefined} /><text x={left - 9} y={y(tick) + 4} textAnchor="end" fill="var(--muted)" fontSize="12">{currency === 'MYR' ? 'RM' : currency} {(Math.abs(tick) >= 1000 ? tick / 1000 : tick).toLocaleString('en', { maximumFractionDigits: Math.abs(tick) >= 1000 ? 1 : 2 })}{Math.abs(tick) >= 1000 ? 'k' : ''}</text></g>)}
            <path d={`${path(lines[0].values)} L ${x(months.length - 1)} ${y(0)} L ${left} ${y(0)} Z`} fill={`url(#${id})`} />
            {lines.map((line, j) => <g key={line.label}><path d={path(line.values)} fill="none" stroke={line.color} strokeWidth="2.5" strokeDasharray={j ? '6 6' : undefined} />{line.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={activePeriod === months[i].period ? 5 : 3.5} fill="var(--surface)" stroke={line.color} strokeWidth="2" />)}</g>)}
            {months.map((m, i) => <g key={m.period}><rect x={Math.max(left - 8, x(i) - (right - left) / months.length / 2)} y={top} width={(right - left) / months.length} height={bottom - top + 8} fill="transparent" tabIndex={0} role="button" aria-label={`${m.period}: ${exact(m)}`} onPointerEnter={() => setActive(m.period)} onPointerDown={() => setActive(m.period)} onFocus={() => setActive(m.period)} onBlur={() => setActive(null)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(m.period); } }} />{(width > 650 || i === 0 || i === Math.floor((months.length - 1) / 2) || i === months.length - 1) && <text x={x(i)} y="274" textAnchor="middle" fill="var(--muted)" fontSize="12">{new Date(`${m.period}-01T00:00:00Z`).toLocaleDateString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })}</text>}</g>)}
        </svg>
        <div className="ov-legend">{lines.map((line, i) => <span key={line.label}><i style={{ borderTopColor: line.color, borderTopStyle: i ? 'dashed' : 'solid' }} />{line.label}</span>)}</div>
        <details className="ov-chart-data"><summary>View exact monthly values</summary><table><caption>Verified bank history ({currency})</caption><thead><tr><th>Month</th>{mode === 'net' ? <th>Net Cash Movement</th> : <><th>Cash In</th><th>Cash Out</th></>}</tr></thead><tbody>{months.map(m => <tr key={m.period}><th>{m.period}</th>{mode === 'net' ? <td>{money(m.net)}</td> : <><td>{money(m.credits)}</td><td>{money(m.debits.replace(/^-/, ''))}</td></>}</tr>)}</tbody></table></details>
    </>}</div>;
}
