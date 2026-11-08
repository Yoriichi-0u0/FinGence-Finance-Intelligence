'use client';
import { plotRatios } from '@/lib/financial-m3/selection';
export default function SourceChart({ points, currency }: {
    points: {
        period: string;
        total: string | null;
        recordCount: number;
    }[];
    currency: string;
}) {
    if (!points.length || points.some(p => p.total === null))
        return <p className="text-sm text-slate-600">Chart unavailable — no supported verified dated amount series.</p>;
    let ratios: number[];
    try {
        ratios = plotRatios(points.map(p => p.total!));
    }
    catch {
        return <p>Chart unavailable for this numeric representation. Exact values remain in the table.</p>;
    }
    const x = (i: number) => 40 + (points.length === 1 ? 280 : i * 560 / (points.length - 1)), y = (i: number) => 110 - ratios[i] * 80;
    return <div className="min-w-0"><svg viewBox="0 0 640 240" role="img" aria-label={`Observed source-signed amounts by transaction date in ${currency}`} className="w-full"><desc>Independent currency group; exact values and record counts are in the accompanying table. This is descriptive source arithmetic, not revenue or cash flow.</desc><line x1="30" y1="110" x2="610" y2="110" stroke="#cbd5e1" strokeDasharray="4 4"/><polyline points={ratios.map((_, i) => `${x(i)},${y(i)}`).join(' ')} fill="none" stroke="#0e7c74" strokeWidth="3"/>{points.map((p, i) => <g key={p.period}><circle cx={x(i)} cy={y(i)} r="5" fill="#0e7c74"><title>{`${p.period}: ${p.total} ${currency}; ${p.recordCount} records`}</title></circle><text x={x(i)} y="225" textAnchor="middle" fontSize="11" fill="#475569">{p.period}</text></g>)}</svg><div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Exact plotted values</caption><thead><tr><th>Date</th><th>Source-signed amount</th><th>Records</th></tr></thead><tbody>{points.map(p => <tr className="border-t" key={p.period}><td className="py-2">{p.period}</td><td className="break-all">{p.total} {currency}</td><td>{p.recordCount}</td></tr>)}</tbody></table></div></div>;
}
