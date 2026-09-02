import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import { formatCurrency } from "@/lib/formatters";

const keyMetrics = [
  { label: "Revenue", value: 248_420, trend: "+12.8%", positive: true },
  { label: "Expenses", value: 181_230, trend: "+4.1%", positive: false },
  { label: "Net Cash Flow", value: 67_190, trend: "+18.2%", positive: true },
];

export function ReportPreview() {
  return (
    <article className="mx-auto w-full max-w-[900px] overflow-hidden rounded-sm border border-slate-300 bg-white shadow-[0_24px_70px_rgb(16_42_67/0.12)]">
      <header className="border-b-4 border-[var(--teal)] px-6 pb-6 pt-7 sm:px-10 sm:pt-10">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-[var(--teal)]">
              <BarChart3 aria-hidden="true" size={24} />
              <span className="text-lg font-semibold tracking-[-0.03em]">FinSight</span>
            </div>
            <h2 className="mt-8 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Monthly Management Report</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">August 2026 · SAIC Finance Workspace</p>
          </div>
          <div className="text-right text-[11px] text-[var(--muted)]">
            <p className="font-semibold text-[var(--muted-strong)]">Generated</p>
            <p className="mt-1">1 September 2026</p>
            <p>09:34 MYT</p>
          </div>
        </div>
      </header>

      <div className="space-y-8 px-6 py-7 sm:px-10 sm:py-9">
        <section aria-labelledby="executive-summary-title">
          <h3 id="executive-summary-title" className="text-[11px] font-bold uppercase tracking-[0.13em] text-[var(--teal)]">Executive Summary</h3>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted-strong)]">
            Revenue increased by 12.8% during August while expenses increased by 4.1%, resulting in stronger operating cash flow. Marketing expenditure exceeded budget by 21.3%, while seven unusual transactions were identified for review.
          </p>
        </section>

        <section className="grid gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4" aria-label="Report key metrics">
          {keyMetrics.map((metric) => (
            <div key={metric.label} className="bg-white p-4">
              <p className="text-[11px] text-[var(--muted)]">{metric.label}</p>
              <p className="mt-1 text-xl font-semibold tracking-[-0.03em]">{formatCurrency(metric.value)}</p>
              <p className={`mt-2 inline-flex items-center gap-1 text-[11px] font-semibold ${metric.positive ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                {metric.positive ? <ArrowUpRight aria-hidden="true" size={13} /> : <ArrowDownRight aria-hidden="true" size={13} />}
                {metric.trend}
              </p>
            </div>
          ))}
          <div className="bg-white p-4">
            <p className="text-[11px] text-[var(--muted)]">Reconciliation</p>
            <p className="mt-1 text-xl font-semibold tracking-[-0.03em]">96.8%</p>
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--green)]"><CheckCircle2 aria-hidden="true" size={13} /> Target passed</p>
          </div>
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.13em] text-[var(--teal)]">Budget Variance</h3>
            <div className="mt-3 divide-y divide-[var(--border)] border-y border-[var(--border)] text-xs">
              {[
                ["Marketing", "+28.0%", "Unfavorable"],
                ["Transport", "+17.5%", "Unfavorable"],
                ["Payroll", "-1.9%", "Favorable"],
              ].map(([label, value, state]) => (
                <div key={label} className="flex items-center justify-between gap-4 py-3">
                  <span className="font-medium">{label}</span>
                  <span className="text-right"><span className={state === "Favorable" ? "font-semibold text-[var(--green)]" : "font-semibold text-[var(--red)]"}>{value}</span><span className="ml-2 text-[10px] text-[var(--muted)]">{state}</span></span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.13em] text-[var(--teal)]">Cash Flow Outlook</h3>
            <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
              <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal)]"><TrendingUp aria-hidden="true" size={17} /></span><div><p className="text-[11px] text-[var(--muted)]">September forecast</p><p className="text-lg font-semibold">RM 72,300</p></div></div>
              <div className="mt-4 h-16 rounded-md bg-[linear-gradient(180deg,transparent_49%,#dfe6ec_50%,transparent_51%)]">
                <svg viewBox="0 0 300 64" className="h-full w-full" role="img" aria-label="Rising cash flow forecast">
                  <path d="M4 51 C45 49, 57 42, 91 44 S145 29, 180 32 S240 18, 296 10" fill="none" stroke="#4f63d8" strokeWidth="3" strokeDasharray="6 5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="mt-2 text-[10px] text-[var(--muted)]">Prototype forecast accuracy: 92.4%</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-red-200 bg-[var(--red-soft)] p-4">
          <div className="flex gap-3">
            <AlertTriangle aria-hidden="true" size={19} className="mt-0.5 shrink-0 text-[var(--red)]" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--red)]">Anomalies requiring attention</h3>
              <p className="mt-1 text-xs leading-5 text-red-900">Seven transactions were flagged, including three high-risk items. ABC Enterprise (RM 18,940) has the highest anomaly score at 0.93.</p>
            </div>
          </div>
        </section>

        <footer className="border-t border-[var(--border)] pt-4 text-[10px] leading-4 text-[var(--muted)]">
          Prototype preview only. Figures and evaluation outcomes are mock data intended for workflow validation and must not be interpreted as audited or experimentally verified results.
        </footer>
      </div>
    </article>
  );
}
