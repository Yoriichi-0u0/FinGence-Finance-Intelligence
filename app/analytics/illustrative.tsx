import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CircleGauge,
  Gauge,
  Percent,
  Scale,
} from "lucide-react";
import { ComparisonBars, DonutChart, LineChart } from "@/components/charts";
import { InsightIcon, PageHeader, Panel, PrototypeLabel } from "@/components/ui";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import {
  budgetVariances,
  expenseBreakdown,
  financialInsights,
  monthlyFinancials,
} from "@/lib/mock-data";

const ratios = [
  { label: "Operating Margin", value: "27.0%", trend: 3.2, icon: Percent },
  { label: "Expense-to-Revenue", value: "72.9%", trend: -5.8, icon: Scale },
  { label: "Current Ratio", value: "1.84", trend: 0.12, icon: Gauge },
  { label: "Cash Conversion", value: "32 days", trend: -4, icon: CalendarClock },
];

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader
        title="Financial analytics"
        description="Understand financial performance, ratios, trends and budget variance."
        actions={<PrototypeLabel />}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Financial ratios">
        {ratios.map((ratio) => {
          const Icon = ratio.icon;
          const positive = ratio.label === "Expense-to-Revenue" || ratio.label === "Cash Conversion" ? ratio.trend < 0 : ratio.trend > 0;
          const TrendIcon = ratio.trend >= 0 ? ArrowUpRight : ArrowDownRight;
          return (
            <article key={ratio.label} className="panel-shadow rounded-xl border border-[var(--border)] bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-[var(--muted)]">{ratio.label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{ratio.value}</p>
                </div>
                <span className="grid size-10 place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal)]"><Icon aria-hidden="true" size={19} /></span>
              </div>
              <p className={`mt-4 inline-flex items-center gap-1 text-xs font-semibold ${positive ? "text-[var(--green)]" : "text-[var(--red)]"}`}><TrendIcon aria-hidden="true" size={14} /> {Math.abs(ratio.trend)} {ratio.label === "Current Ratio" ? "points" : ratio.label === "Cash Conversion" ? "days" : "%"} vs. July</p>
            </article>
          );
        })}
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <Panel title="Revenue and expense trend" className="xl:col-span-8" action={<span className="text-xs text-[var(--muted)]">September 2025 – August 2026</span>}>
          <div className="p-4">
            <LineChart
              labels={monthlyFinancials.map((item) => item.month)}
              series={[
                { label: "Revenue", color: "#0e7c74", values: monthlyFinancials.map((item) => item.revenue), fill: true },
                { label: "Expenses", color: "#4f63d8", values: monthlyFinancials.map((item) => item.expenses) },
                { label: "Net Cash Flow", color: "#d98700", values: monthlyFinancials.map((item) => item.revenue - item.expenses), dashed: true },
              ]}
              height={280}
              ariaLabel="Revenue, expenses and net cash flow trend"
            />
          </div>
        </Panel>

        <Panel title="Expense categories" className="xl:col-span-4">
          <div className="flex flex-col items-center gap-6 p-6 sm:flex-row xl:flex-col 2xl:flex-row">
            <DonutChart segments={expenseBreakdown} center={<span>RM 181K</span>} />
            <dl className="w-full space-y-2.5">
              {expenseBreakdown.map((item) => (
                <div key={item.label} className="flex items-center justify-between text-xs">
                  <dt className="flex items-center gap-2 text-[var(--muted-strong)]"><span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</dt>
                  <dd className="font-semibold">{item.value}%</dd>
                </div>
              ))}
            </dl>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Budget vs actual" action={<span className="flex items-center gap-4 text-[10px] text-[var(--muted)]"><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--teal)]" /> Budget</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--indigo)]" /> Actual</span></span>}>
          <div className="p-5">
            <ComparisonBars rows={budgetVariances.map((item) => ({ label: item.category, primary: item.budget, secondary: item.actual }))} />
          </div>
        </Panel>

        <Panel title="Variance analysis">
          <div className="divide-y divide-[var(--border)]">
            {budgetVariances.map((item) => {
              const amount = item.actual - item.budget;
              return (
                <div key={item.category} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3.5 text-sm">
                  <span className="font-medium">{item.category}</span>
                  <span className="text-right text-xs text-[var(--muted)]">{formatCurrency(amount)}</span>
                  <span className={`min-w-16 text-right text-xs font-semibold ${item.variance > 0 ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{formatPercent(item.variance, true)}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel title="AI financial insights" className="mt-4" action={<span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--teal)]"><CircleGauge aria-hidden="true" size={14} /> Structured insight cards</span>}>
        <div className="grid divide-y divide-[var(--border)] md:grid-cols-2 md:divide-x md:divide-y-0">
          {financialInsights.map((insight, index) => (
            <article key={insight} className="flex gap-3 p-5">
              <InsightIcon />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--muted)]">Insight {index + 1}</p>
                <p className="mt-1.5 text-sm leading-6 text-[var(--muted-strong)]">{insight}</p>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </>
  );
}
