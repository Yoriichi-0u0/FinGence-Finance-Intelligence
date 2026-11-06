import Link from 'next/link';
import { CheckCircle2, ChevronDown } from 'lucide-react';
export function ProcessingDetails({ business, period, currency, processingId, fingerprints, children, local = false }: {
    business: string; period: string; currency: string; processingId?: string;
    fingerprints: { label: string; value: string }[]; children?: React.ReactNode; local?: boolean;
}) {
    return <section className="ov-processing-summary" aria-label="Verified processing information">
        <div className="ov-processing-row"><span className="ov-verified"><CheckCircle2 size={14} aria-hidden="true" />{local ? 'Source verified · local PoC' : 'Processing verified'}</span><span>{business} · {period} · {currency}</span><Link href="/data" className="ov-processing-link">Open processing workspace</Link></div>
        <details className="ov-audit-details"><summary>Source evidence <ChevronDown size={12} aria-hidden="true" /></summary><dl>{processingId ? <div><dt>Full processing ID</dt><dd>{processingId}</dd></div> : <div><dt>Processing ID</dt><dd>Not supplied by this local source reader</dd></div>}{fingerprints.map(({ label, value }) => <div key={`${label}:${value}`}><dt>{label} SHA-256</dt><dd>{value}</dd></div>)}</dl>{children}</details>
    </section>;
}
