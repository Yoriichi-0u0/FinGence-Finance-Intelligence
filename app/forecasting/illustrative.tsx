"use client";

import { useMemo, useState } from "react";
import {
  Banknote,
  CalendarRange,
  Check,
  CircleGauge,
  ReceiptText,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { LineChart } from "@/components/charts";
import { MetricCard, PageHeader, Panel, ProgressBar, PrototypeLabel } from "@/components/ui";
import { formatCurrency } from "@/lib/formatters";
import { monthlyFinancials } from "@/lib/mock-data";

const models = [
  { name: "Moving Average", mape: 14.2, next: 244_500, forecasts: [244_500, 247_100, 249_900] },
  { name: "ARIMA", mape: 9.8, next: 255_300, forecasts: [255_300, 260_200, 264_800] },
  { name: "XGBoost", mape: 7.6, next: 261_800, forecasts: [261_800, 267_400, 274_200] },
] as const;

export default function ForecastingPage() {
  const [selectedModel, setSelectedModel] = useState<(typeof models)[number]["name"]>("XGBoost");
  const model = models.find((item) => item.name === selectedModel) ?? models[2];
  const historical = monthlyFinancials.slice(4);
  const labels = [...historical.map((item) => item.month.split(" ")[0]), "Sep", "Oct", "Nov"];
  const forecastValues = useMemo(
    () => [...historical.slice(0, -1).map(() => null), historical.at(-1)?.revenue ?? 0, ...model.forecasts],
    [historical, model.forecasts],
  );
  const accuracy = 100 - model.mape;

  return (
    <>
      <PageHeader
        title="Forecasting"
        description="Compare historical performance with mock revenue, cash flow and expense forecasts."
        actions={<PrototypeLabel />}
      />

      <section className="grid gap-3 lg:grid-cols-3" aria-label="Forecast summary">
        <MetricCard label="Revenue Forecast" value={formatCurrency(model.next)} trend={5.4} comparison="next month" icon={<TrendingUp aria-hidden="true" size={20} />} />
        <MetricCard label="Cash Flow Forecast" value={formatCurrency(72_300)} trend={7.6} comparison="September 2026" icon={<Banknote aria-hidden="true" size={20} />} tone="indigo" />
        <MetricCard label="Expense Forecast" value={formatCurrency(187_900)} trend={3.7} comparison="September 2026" icon={<ReceiptText aria-hidden="true" size={20} />} />
      </section>

      <Panel
        title="Historical vs forecast revenue"
        className="mt-4"
        action={<span className="text-xs font-semibold text-[var(--indigo)]">95% expected range: RM 248,700 – RM 274,900</span>}
      >
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_250px] sm:p-5">
          <div className="min-w-0">
            <LineChart
              labels={labels}
              series={[
                { label: "Historical Revenue", color: "#0e7c74", values: [...historical.map((item) => item.revenue), null, null, null], fill: true },
                { label: `Forecast · ${model.name}`, color: "#4f63d8", values: forecastValues, dashed: true },
              ]}
              height={330}
              ariaLabel={`Historical revenue from January to August 2026 and ${model.name} forecast from September to November 2026`}
            />
          </div>
          <aside className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Selected model</p>
            <div className="mt-2 flex items-center gap-2"><Sparkles aria-hidden="true" size={19} className="text-[var(--teal)]" /><p className="text-xl font-semibold">{model.name}</p></div>
            <dl className="mt-6 space-y-5">
              <div>
                <dt className="text-xs text-[var(--muted)]">Forecast accuracy</dt>
                <dd className="mt-1 text-2xl font-semibold">{accuracy.toFixed(1)}%</dd>
                <div className="mt-2"><ProgressBar value={accuracy} label={`${accuracy.toFixed(1)}% forecast accuracy`} /></div>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">MAPE</dt>
                <dd className="mt-1 text-2xl font-semibold">{model.mape.toFixed(1)}%</dd>
                <p className="mt-1 text-[11px] font-medium text-[var(--green)]">Within ±10% project target</p>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">Next month</dt>
                <dd className="mt-1 text-2xl font-semibold">{formatCurrency(model.next)}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_350px]">
        <Panel title="Model comparison" action={<span className="text-xs text-[var(--muted)]">Select a mock model</span>}>
          <div className="grid divide-y divide-[var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {models.map((item) => {
              const selected = item.name === selectedModel;
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setSelectedModel(item.name)}
                  aria-pressed={selected}
                  className={`p-5 text-left hover:bg-slate-50 ${selected ? "bg-[var(--teal-soft)]" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{item.name}</span>
                    {selected ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--teal)]"><Check aria-hidden="true" size={13} /> SELECTED</span> : null}
                  </div>
                  <p className="mt-4 text-2xl font-semibold tracking-[-0.03em]">{item.mape.toFixed(1)}%</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">MAPE · lower is better</p>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Forecast horizon">
          <div className="space-y-4 p-5">
            {model.forecasts.map((value, index) => (
              <div key={value} className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] p-3">
                <span className="inline-flex items-center gap-2 text-sm text-[var(--muted-strong)]"><CalendarRange aria-hidden="true" size={16} /> {(["September", "October", "November"] as const)[index]}</span>
                <span className="font-semibold">{formatCurrency(value)}</span>
              </div>
            ))}
            <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-4 text-xs leading-5 text-blue-900">
              <CircleGauge aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-blue-700" />
              Mock forecasts demonstrate the interface only. No XGBoost or ARIMA model is trained in this prototype.
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
