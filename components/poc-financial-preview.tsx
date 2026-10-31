"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ShieldCheck, TriangleAlert } from "lucide-react";
import type { PocInsights } from "../lib/server/poc-insights/service";
import type { PocAnalysis } from "../lib/server/poc-anomalies/service";

const linkStyle = "group min-w-0 rounded-xl border border-[var(--border)] bg-white p-4 transition-colors hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700";

/** Optional Issue #44 extension: presentation of authorized server results only. */
export default function PocFinancialPreview({ data, analysis, message }: { data: PocInsights | null; analysis: PocAnalysis | null; message: string }) {
  const reconciliation = data?.reconciliation;
  const cards = [
    { title: "Money Received", value: data?.totals.credits, detail: "Bank credits", icon: ArrowDownLeft, href: "/analytics" },
    { title: "Money Paid Out", value: data?.totals.debits.replace(/^-/, ""), detail: "Bank debit magnitude", icon: ArrowUpRight, href: "/analytics" },
    { title: "Net Cash Movement", value: data?.totals.net, detail: "Signed bank movement", icon: ArrowLeftRight, href: "/analytics" },
  ];
  return <div className="space-y-4">
    <section aria-label="Financial activity overview" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold text-[var(--ink)]">Financial activity</h2><span className="text-xs text-[var(--muted-strong)]">Synthetic demonstration only</span></div>
      {data ? <p className="break-words text-xs leading-relaxed text-[var(--muted-strong)]">{data.source.fileName} · {data.selection.businessName} · {data.selection.period} · {data.selection.currency}. Bank movements, not revenue or expenses.</p> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-100 bg-[var(--teal-soft)] p-4"><p role="status" className="max-w-2xl text-sm text-[var(--teal-dark)]">{message}</p><Link href="/anomalies" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--teal-dark)] hover:underline">Open Anomalies →</Link></div>}
      <div className="grid min-w-0 grid-cols-1 gap-3 min-[390px]:grid-cols-2 lg:grid-cols-4">
        {cards.map(({title,value,detail,icon:Icon,href})=><Link key={title} href={href} className={linkStyle}><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium text-[var(--muted-strong)]">{title}</h3><Icon aria-hidden="true" size={18} className="shrink-0 text-[var(--teal)]"/></div>{data && value !== undefined && <p className="mt-3 break-words text-xl font-semibold tracking-tight text-[var(--navy)]"><span className="mr-1 text-xs font-medium">{data.selection.currency}</span>{value}</p>}<p className="mt-2 text-xs text-[var(--muted)]">{data ? detail : "View in Analytics"} <span aria-hidden="true">↗</span></p></Link>)}
        <Link href="/reconciliation" className={linkStyle}><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium text-[var(--muted-strong)]">Reconciliation Results</h3><ShieldCheck aria-hidden="true" size={18} className="shrink-0 text-[var(--teal)]"/></div>{reconciliation?.status === "AVAILABLE" ? <><p className="mt-3 text-sm font-semibold text-[var(--navy)]">{reconciliation.snapshot.counts.MATCH_EXACT ?? 0} exact matches · {reconciliation.snapshot.counts.MATCH_DATE_SHIFT ?? 0} date-shift matches</p><p className="mt-2 text-xs text-[var(--muted)]">Verified source pair · deterministic rules</p></> : <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{data ? "No verified bank and ledger pair matches this source and selection." : "Compare an approved bank and ledger pair."}</p>}<p className="mt-2 text-xs font-medium text-[var(--teal-dark)]">Open Reconciliation ↗</p></Link>
      </div>
    </section>
    <section aria-labelledby="recent-anomalies" className="rounded-xl border border-[var(--border)] bg-white p-4">
      <div className="flex items-center justify-between gap-3"><h2 id="recent-anomalies" className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]"><TriangleAlert aria-hidden="true" size={17} className="text-[var(--teal)]"/>Recent Anomalies</h2><Link href="/anomalies" className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--teal-dark)] hover:underline">Open Anomalies →</Link></div>
      {analysis ? <><p className="mb-3 text-xs text-[var(--muted)]">Most recent transaction dates in the selected month. Rule-based review candidates, not confirmed errors or fraud.</p>{analysis.candidates.length ? <ul className="divide-y divide-[var(--border)]">{[...analysis.candidates].sort((a,b)=>b.date.localeCompare(a.date)||a.rowId.localeCompare(b.rowId)).slice(0,3).map(candidate=><li key={candidate.rowId}><Link href="/anomalies" className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg py-3 text-sm hover:bg-teal-50/50 focus-visible:outline-2 focus-visible:outline-teal-700"><div className="min-w-0 flex-1 basis-48"><p className="break-words font-medium text-[var(--ink)]">{candidate.description}</p><p className="mt-1 break-words text-xs leading-relaxed text-[var(--muted-strong)]">{candidate.findings.map(f=>f.title).join(" · ")}</p><p className="mt-1 text-xs text-[var(--muted)]">{candidate.date} · Review: {candidate.review.state.toLowerCase()}</p></div><span className="break-words font-semibold text-[var(--navy)]">{candidate.currency} {candidate.signedAmount}</span></Link></li>)}</ul> : <p className="text-sm text-[var(--muted-strong)]">No review candidates were returned for this selected month.</p>}<p className="mt-2 text-xs text-[var(--muted)]">Links open the Anomalies workspace; they do not open an individual record.</p></> : <p className="text-sm leading-relaxed text-[var(--muted-strong)]">{data ? "Candidate details could not be verified for this selection. Review the source in Anomalies." : "Source-backed review candidates will appear here after you upload and select an approved synthetic source."}</p>}
    </section>
  </div>;
}
