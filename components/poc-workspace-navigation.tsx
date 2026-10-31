"use client";
import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, ReceiptText, RefreshCw, ChartNoAxesCombined, TriangleAlert, TrendingUp, FileBarChart, ShieldCheck } from "lucide-react";
const destinations = [
  { href: "/transactions", title: "Transactions", description: "Explore records behind your selected source.", icon: ReceiptText, detail: "Source records" },
  { href: "/reconciliation", title: "Reconciliation", description: "Compare supplied March bank and ledger records.", icon: RefreshCw, detail: "Rule-based matching" },
  { href: "/analytics", title: "Analytics", description: "View cash-movement trends and source history.", icon: ChartNoAxesCombined, detail: "Observed trends" },
  { href: "/anomalies", title: "Anomalies", description: "Investigate source-backed review candidates.", icon: TriangleAlert, detail: "Explainable rules" },
  { href: "/forecasting", title: "Forecasting", description: "Review a deterministic historical cash baseline.", icon: TrendingUp, detail: "History-based baseline" },
  { href: "/reports", title: "Reports", description: "Build a sourced report for a business and period.", icon: FileBarChart, detail: "Evidence-led reporting" },
];
export default function PocWorkspaceNavigation() {
 const track=useRef<HTMLDivElement>(null);
 const move=(direction:number)=>track.current?.scrollBy({left:direction*track.current.clientWidth*0.75,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
 return (      <nav aria-label="PoC workspaces">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">Explore your workspace</h2>
          <div className="flex gap-2"><button type="button" aria-label="Previous workspaces" onClick={() => move(-1)} className="grid size-9 place-items-center rounded-full border border-[var(--border)] bg-white hover:bg-teal-50"><ChevronLeft aria-hidden="true" size={16}/></button><button type="button" aria-label="Next workspaces" onClick={() => move(1)} className="grid size-9 place-items-center rounded-full border border-[var(--border)] bg-white hover:bg-teal-50"><ChevronRight aria-hidden="true" size={16}/></button></div>
        </div>
        <div ref={track} tabIndex={0} aria-label="Scrollable workspace cards" onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); } }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 pt-1 focus-visible:outline-2 focus-visible:outline-teal-700">
          {destinations.map(({ href, title, description, icon: Icon, detail }) => (
            <Link key={href} href={href} className="group panel-shadow flex w-[82%] shrink-0 snap-start flex-col sm:w-[43%] lg:w-[23%] rounded-xl border border-[var(--border)] bg-white p-3.5 transition duration-200 hover:border-teal-400 hover:shadow-md motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
              <div className="mb-2 flex items-center justify-between gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--teal-soft)] text-[var(--teal-dark)] transition-colors group-hover:bg-teal-100"><Icon aria-hidden="true" size={18} strokeWidth={1.8} /></span><ArrowRight aria-hidden="true" size={17} className="text-slate-400 transition-colors group-hover:text-[var(--teal)]" /></div>
              <h3 className="text-sm font-semibold tracking-[-0.015em] text-[var(--ink)]">{title}</h3>
              <p className="mb-2 mt-1.5 text-xs leading-relaxed text-[var(--muted-strong)]">{description}</p>
              <span className="mt-auto pt-2 text-[11px] font-medium tracking-wide text-[var(--teal-dark)]">{detail}</span>
            </Link>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3"><ShieldCheck aria-hidden="true" size={18} className="shrink-0 text-[var(--muted)]" /><p className="text-xs leading-relaxed text-[var(--muted-strong)]">Admin access required. Finance does not inherit administration permissions.</p></div>
          <Link href="/admin" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-semibold text-[var(--teal-dark)] underline-offset-4 hover:underline">Administration<ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
      </nav>);
}
