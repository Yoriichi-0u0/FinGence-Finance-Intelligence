import Link from "next/link";
import PocSessionStatus from "./poc-session-status";
import PocOverviewTrend from "./poc-overview-trend";
import PocWorkspaceNavigation from "./poc-workspace-navigation";
import {
  ArrowRight, FileCheck2,
  Layers3, LockKeyhole, ShieldCheck,
} from "lucide-react";



/** Static presentation inside the existing server-guarded local PoC homepage. */
export default function LocalPocOverview() {
  return (
    <div className="space-y-5 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">Workspace overview</p>
        <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white px-3 py-1.5 text-xs font-medium text-[var(--teal-dark)]"><LockKeyhole aria-hidden="true" size={13} />Local PoC environment</span><div className="max-w-full rounded-full bg-[var(--navy)]"><PocSessionStatus /></div></div>
      </div>

      <section aria-labelledby="poc-welcome" className="relative isolate overflow-hidden rounded-2xl bg-[var(--navy)] text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-36 size-96 rounded-full border border-teal-300/10 bg-teal-400/5" />
        <div className="relative grid items-center gap-4 p-5 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,1fr)_220px] xl:px-7">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold tracking-[0.13em] text-teal-200 uppercase">Welcome to your financial workspace</p>
            <h1 id="poc-welcome" className="text-3xl font-semibold tracking-[-0.04em] sm:text-[32px]">FinGence 2.0</h1>
            <p className="mt-2 text-sm font-medium text-teal-100 sm:text-base">Synthetic Financial Intelligence Proof of Concept</p>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">Explore records, compare sources and review cash trends in a local demonstration. All financial figures are synthetic, not approved accounting conclusions.</p>
          </div>
          <div className="grid gap-2 border-t border-white/15 pt-5 text-sm lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            {[
              { icon: Layers3, title: "Synthetic sources", detail: "Explicitly selected demonstration files" },
              { icon: ShieldCheck, title: "Independent checks", detail: "Verification before financial use" },
              { icon: FileCheck2, title: "Traceable results", detail: "Source evidence stays available" },
            ].map(({ icon: Icon, title, detail }) => <div key={title} className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/8 text-teal-200"><Icon aria-hidden="true" size={18} /></span><div className="min-w-0"><p className="font-medium text-white">{title}</p><p className="mt-0.5 text-xs leading-relaxed text-slate-300">{detail}</p></div></div>)}
          </div>
        </div>
      </section>

      <PocOverviewTrend />

      <PocWorkspaceNavigation />

      <section aria-labelledby="poc-workflows" className="rounded-xl border border-[var(--border)] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id="poc-workflows" className="text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">How FinGence Works</h2><p className="text-xs text-[var(--muted-strong)]">Separate sources. Clear boundaries.</p></div>
        <div className="grid min-w-0 gap-3 lg:grid-cols-3">
          <article className="min-w-0 p-1">
            <div className="mb-2 flex items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--teal-soft)] text-xs font-semibold text-[var(--teal-dark)]">A</span><h3 className="text-sm font-semibold text-[var(--ink)]">Upload and Check Records</h3></div>
            <p className="text-sm leading-relaxed text-[var(--muted-strong)]">Upload financial files and check which records are ready to use. Records with problems are kept separate for review.</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">V2 · independent verification; recorded or simulated interpretation, not live inference.</p>
            <Link href="/ai-ingestion" className="mt-2 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-[var(--teal-dark)] underline-offset-4 hover:underline">Open V2 ingestion<ArrowRight aria-hidden="true" size={14} /></Link>
          </article>
          <article className="min-w-0 p-1">
            <div className="mb-2 flex items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-[var(--navy)]">B</span><h3 className="text-sm font-semibold text-[var(--ink)]">Compare Bank and Accounting Records</h3></div>
            <p className="text-sm leading-relaxed text-[var(--muted-strong)]">Find matching transactions and differences between bank statements and accounting records. Unclear results remain available for review.</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">Rule-based matching · not live E5 machine learning.</p>
          </article>
          <article className="min-w-0 p-1">
            <div className="mb-2 flex items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--teal-soft)] text-xs font-semibold text-[var(--teal-dark)]">C</span><h3 className="text-sm font-semibold text-[var(--ink)]">Understand Financial Information</h3></div>
            <p className="text-sm leading-relaxed text-[var(--muted-strong)]">Explore financial trends and available forecasts using selected synthetic financial data.</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">Separate from V2; source may differ from March reconciliation. No live AI accuracy claim.</p>
          </article>
        </div>
      </section>


    </div>
  );
}
