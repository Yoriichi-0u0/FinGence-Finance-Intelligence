"use client";

import { useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  ChevronRight,
  CircleGauge,
  Eye,
  Flag,
  ShieldCheck,
  X,
} from "lucide-react";
import { PageHeader, Panel, RiskBadge, StatusBadge } from "@/components/ui";
import { formatCurrency } from "@/lib/formatters";
import { anomalies as seededAnomalies } from "@/lib/mock-data";
import type { Anomaly, AnomalyStatus } from "@/lib/types";

export default function AnomaliesPage() {
  const [items, setItems] = useState<Anomaly[]>(seededAnomalies);
  const [selectedId, setSelectedId] = useState(seededAnomalies[0].id);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  function updateStatus(status: AnomalyStatus) {
    setItems((current) => current.map((item) => (item.id === selected.id ? { ...item, status } : item)));
  }

  const deviation = Math.round(((selected.amount - selected.historicalAverage) / selected.historicalAverage) * 100);

  return (
    <>
      <PageHeader
        title="Anomaly detection"
        description="Investigate unusual financial activity and record review outcomes."
        actions={<span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)]"><CircleGauge aria-hidden="true" size={15} className="text-[var(--teal)]" /> Explainable hybrid prototype</span>}
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Anomaly detection metrics">
        {[
          ["Anomalies detected", "7", AlertTriangle, "var(--amber)"],
          ["High risk", "3", AlertOctagon, "var(--red)"],
          ["Medium risk", "4", Eye, "var(--amber)"],
          ["Model precision", "89%", ShieldCheck, "var(--teal)"],
        ].map(([label, value, Icon, color]) => (
          <article key={String(label)} className="panel-shadow rounded-xl border border-[var(--border)] bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs text-[var(--muted)]">{String(label)}</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{String(value)}</p></div>
              <span className="grid size-10 place-items-center rounded-full bg-slate-50" style={{ color: String(color) }}><Icon aria-hidden="true" size={20} /></span>
            </div>
            <p className="mt-3 text-[11px] text-[var(--muted)]">Mock prototype result</p>
          </article>
        ))}
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Detected anomalies" action={<span className="text-xs text-[var(--muted)]">Sorted by risk score</span>}>
          <div className="thin-scrollbar overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="bg-[var(--surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr>
                  {[
                    "Risk",
                    "Date",
                    "Transaction",
                    "Category",
                    "Amount",
                    "Score",
                    "Status",
                    "",
                  ].map((heading, index) => <th key={`${heading}-${index}`} className={`px-4 py-3 font-semibold ${heading === "Amount" || heading === "Score" ? "text-right" : ""}`}>{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {items.map((item) => (
                  <tr key={item.id} className={selected.id === item.id ? "bg-[var(--teal-soft)]/60" : "hover:bg-slate-50"}>
                    <td className="px-4 py-3.5"><RiskBadge risk={item.risk} /></td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-[var(--muted-strong)]">{item.date}</td>
                    <td className="px-4 py-3.5"><button type="button" onClick={() => setSelectedId(item.id)} className="text-left font-semibold hover:text-[var(--teal)] hover:underline">{item.transaction}<span className="mt-0.5 block text-[10px] font-normal text-[var(--muted)]">{item.id}</span></button></td>
                    <td className="px-4 py-3.5">{item.category}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold">{formatCurrency(item.amount)}</td>
                    <td className="px-4 py-3.5 text-right font-semibold">{item.score.toFixed(2)}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={item.status} /></td>
                    <td className="px-4 py-3.5"><button type="button" onClick={() => setSelectedId(item.id)} aria-label={`Inspect ${item.transaction}`} className="grid size-8 place-items-center rounded-md text-[var(--muted)] hover:bg-white hover:text-[var(--teal)]"><ChevronRight aria-hidden="true" size={17} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Investigation details" action={<RiskBadge risk={selected.risk} />}>
          <div className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-lg font-semibold tracking-[-0.02em]">{selected.transaction}</p><p className="mt-1 text-xs text-[var(--muted)]">{selected.date} · {selected.category}</p></div>
              <StatusBadge status={selected.status} />
            </div>

            <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
              <div className="flex items-end justify-between gap-4"><div><p className="text-xs text-[var(--muted)]">Current amount</p><p className="mt-1 text-3xl font-semibold tracking-[-0.04em]">{formatCurrency(selected.amount)}</p></div><div className="text-right"><p className="text-xs text-[var(--muted)]">Anomaly score</p><p className="mt-1 text-2xl font-semibold text-[var(--red)]">{selected.score.toFixed(2)}</p></div></div>
            </div>

            <section className="mt-6">
              <h3 className="text-sm font-semibold">Why this was flagged</h3>
              <ul className="mt-3 space-y-2.5">
                {selected.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2.5 text-xs leading-5 text-[var(--muted-strong)]"><AlertTriangle aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-[var(--amber)]" />{reason}</li>
                ))}
              </ul>
            </section>

            <dl className="mt-6 divide-y divide-[var(--border)] border-y border-[var(--border)] text-sm">
              <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[var(--muted)]">Historical average</dt><dd className="font-semibold">{formatCurrency(selected.historicalAverage)}</dd></div>
              <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[var(--muted)]">Current amount</dt><dd className="font-semibold">{formatCurrency(selected.amount)}</dd></div>
              <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[var(--muted)]">Deviation</dt><dd className="font-semibold text-[var(--red)]">+{deviation}%</dd></div>
            </dl>

            <div className="mt-6 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <button type="button" onClick={() => updateStatus("Reviewed")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-slate-50"><Check aria-hidden="true" size={15} /> Reviewed</button>
              <button type="button" onClick={() => updateStatus("Investigating")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--teal)] px-3 text-xs font-semibold text-white hover:bg-[var(--teal-dark)]"><Flag aria-hidden="true" size={15} /> Investigate</button>
              <button type="button" onClick={() => updateStatus("Dismissed")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-slate-50"><X aria-hidden="true" size={15} /> Dismiss</button>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
