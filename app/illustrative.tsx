"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  Landmark,
  TrendingDown,
  WalletCards,
} from "lucide-react";
import { DonutChart, LineChart } from "@/components/charts";
import {
  MetricCard,
  PageHeader,
  Panel,
  PassBadge,
  ProgressBar,
  PrototypeLabel,
  RiskBadge,
} from "@/components/ui";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import {
  anomalies,
  budgetVariances,
  cashFlowForecast,
  expenseBreakdown,
  monthlyFinancials,
  periodSummaries,
  successMetrics,
  type PeriodLabel,
} from "@/lib/mock-data";

const periods: PeriodLabel[] = ["This Month", "Last Month", "Quarter", "Year"];

export default function OverviewPage() {
  const [period, setPeriod] = useState<PeriodLabel>("This Month");
  const summary = periodSummaries[period];

  return (
    <>
      <PageHeader
        title="Financial overview"
        description={`August 2026 · Consolidated financial performance · ${period}`}
        actions={
          <div
            className="thin-scrollbar flex w-full max-w-full overflow-x-auto rounded-lg border border-[var(--border)] bg-white p-1 sm:w-auto"
            role="group"
            aria-label="Financial period"
          >
            {periods.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setPeriod(item)}
                aria-pressed={period === item}
                className={`min-h-9 shrink-0 rounded-md px-3 text-xs font-medium transition-colors sm:px-4 ${
                  period === item
                    ? "bg-[var(--teal)] text-white shadow-sm"
                    : "text-[var(--muted-strong)] hover:bg-slate-50 hover:text-[var(--ink)]"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        }
      />

      <section className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4" aria-label="Key financial metrics">
        <MetricCard
          label="Revenue"
          value={formatCurrency(summary.revenue)}
          trend={summary.revenueTrend}
          comparison={summary.comparison}
          icon={<CircleDollarSign aria-hidden="true" size={20} />}
        />
        <MetricCard
          label="Expenses"
          value={formatCurrency(summary.expenses)}
          trend={summary.expenseTrend}
          comparison={summary.comparison}
          icon={<WalletCards aria-hidden="true" size={20} />}
        />
        <MetricCard
          label="Net Cash Flow"
          value={formatCurrency(summary.cashFlow)}
          trend={summary.cashFlowTrend}
          comparison={summary.comparison}
          icon={<Banknote aria-hidden="true" size={20} />}
        />
        <MetricCard
          label="Reconciliation Rate"
          value={`${summary.reconciliation.toFixed(1)}%`}
          trend={summary.reconciliationTrend}
          comparison={summary.comparison}
          icon={<CheckCircle2 aria-hidden="true" size={20} />}
          tone="indigo"
        />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <Panel
          title="Revenue vs Expenses"
          className="xl:col-span-8"
          action={<span className="text-xs text-[var(--muted)]">12 months · RM</span>}
        >
          <div className="p-3 sm:p-4">
            <LineChart
              labels={monthlyFinancials.map((item) => item.month)}
              series={[
                {
                  label: "Revenue",
                  color: "#0e7c74",
                  values: monthlyFinancials.map((item) => item.revenue),
                  fill: true,
                },
                {
                  label: "Expenses",
                  color: "#4f63d8",
                  values: monthlyFinancials.map((item) => item.expenses),
                  dashed: true,
                },
              ]}
              height={245}
              ariaLabel="Revenue and expenses from September 2025 to August 2026"
            />
          </div>
        </Panel>

        <Panel title="Reconciliation summary" className="xl:col-span-4">
          <div className="p-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-4xl font-semibold tracking-[-0.04em] text-[var(--teal)]">96.8%</p>
                <p className="mt-1 text-xs text-[var(--muted)]">1,842 of 1,902 records matched</p>
              </div>
              <Link
                href="/reconciliation"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--teal)] hover:text-[var(--teal-dark)]"
              >
                Review <ArrowRight aria-hidden="true" size={14} />
              </Link>
            </div>
            <div className="mt-5">
              <ProgressBar value={96.8} label="96.8% reconciled" />
            </div>
            <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {[
                ["Matched", "1,842", "var(--teal)"],
                ["Suggested", "41", "var(--indigo)"],
                ["Unmatched", "19", "var(--red)"],
                ["Total", "1,902", "var(--ink)"],
              ].map(([label, value, color]) => (
                <div key={label} className="flex items-center justify-between py-2.5 text-sm">
                  <dt className="flex items-center gap-2 text-[var(--muted-strong)]">
                    <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                    {label}
                  </dt>
                  <dd className="font-semibold text-[var(--ink)]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <Panel
          title="Cash flow forecast"
          className="xl:col-span-5"
          action={<span className="text-xs font-semibold text-[var(--indigo)]">Accuracy 92.4%</span>}
        >
          <div className="p-3 sm:p-4">
            <LineChart
              labels={cashFlowForecast.map((item) => item.month)}
              series={[
                {
                  label: "Historical",
                  color: "#0e7c74",
                  values: cashFlowForecast.map((item, index) => (index <= 5 ? item.value : null)),
                },
                {
                  label: "Forecast",
                  color: "#4f63d8",
                  values: cashFlowForecast.map((item, index) => (index >= 5 ? item.value : null)),
                  dashed: true,
                },
              ]}
              height={230}
              ariaLabel="Historical and forecast cash flow from March to November 2026"
            />
          </div>
        </Panel>

        <Panel title="Expense breakdown" className="xl:col-span-3">
          <div className="flex flex-col items-center gap-5 p-5 sm:flex-row xl:flex-col 2xl:flex-row">
            <DonutChart segments={expenseBreakdown} center={<span>100%</span>} />
            <dl className="w-full min-w-0 space-y-2">
              {expenseBreakdown.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 text-xs">
                  <dt className="flex items-center gap-2 text-[var(--muted-strong)]">
                    <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                    {item.label}
                  </dt>
                  <dd className="font-semibold">{item.value}%</dd>
                </div>
              ))}
            </dl>
          </div>
        </Panel>

        <Panel title="Budget variance" className="xl:col-span-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead className="bg-[var(--surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Category</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Budget</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Actual</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {budgetVariances.slice(0, 3).map((item) => {
                  const unfavorable = item.variance > 0;
                  return (
                    <tr key={item.category}>
                      <td className="px-4 py-3 font-medium">{item.category}</td>
                      <td className="px-3 py-3 text-right text-[var(--muted)]">{formatCurrency(item.budget)}</td>
                      <td className="px-3 py-3 text-right text-[var(--muted)]">{formatCurrency(item.actual)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${unfavorable ? "text-[var(--red)]" : "text-[var(--green)]"}`}>
                        <span className="inline-flex items-center gap-1">
                          {unfavorable ? <TrendingDown aria-hidden="true" size={13} /> : <CheckCircle2 aria-hidden="true" size={13} />}
                          {formatPercent(item.variance, true)}
                        </span>
                        <span className="block text-[10px] font-medium">{unfavorable ? "Unfavorable" : "Favorable"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel
        title="Recent anomalies"
        className="mt-4"
        action={
          <Link href="/anomalies" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--teal)]">
            View all <ArrowRight aria-hidden="true" size={14} />
          </Link>
        }
      >
        <div className="grid divide-y divide-[var(--border)] md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
          {anomalies.slice(0, 4).map((anomaly) => (
            <Link key={anomaly.id} href="/anomalies" className="group flex min-w-0 items-center gap-3 p-4 hover:bg-slate-50">
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-full ${
                  anomaly.risk === "High" ? "bg-[var(--red-soft)] text-[var(--red)]" : "bg-[var(--amber-soft)] text-[var(--amber)]"
                }`}
              >
                <Landmark aria-hidden="true" size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold group-hover:text-[var(--teal)]">{anomaly.transaction}</span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">{anomaly.reasons[0]}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold">{formatCurrency(anomaly.amount)}</span>
                <span className="mt-1 block"><RiskBadge risk={anomaly.risk} /></span>
              </span>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel
        title="Project success metrics"
        eyebrow="Prototype evaluation"
        className="mt-4"
        action={<PrototypeLabel />}
      >
        <div className="grid divide-y divide-[var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {successMetrics.map((metric) => (
            <div key={metric.label} className="p-4 sm:p-5">
              <p className="text-xs text-[var(--muted)]">{metric.label}</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-2xl font-semibold tracking-[-0.03em]">{metric.value}</p>
                <PassBadge />
              </div>
              <p className="mt-1 text-[11px] font-medium text-[var(--muted-strong)]">{metric.target}</p>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
