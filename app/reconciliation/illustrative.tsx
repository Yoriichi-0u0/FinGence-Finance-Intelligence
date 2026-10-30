"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  Clock3,
  Eye,
  FileText,
  Hash,
  Info,
  Landmark,
  Sparkles,
  X,
} from "lucide-react";
import { ConfidenceRing, EmptyState, PageHeader, Panel, ProgressBar } from "@/components/ui";
import { formatCurrency } from "@/lib/formatters";
import { reconciliationRecords as seededRecords } from "@/lib/mock-data";
import type { ReconciliationRecord } from "@/lib/types";

type ReconciliationTab = "Matched" | "Suggested Matches" | "Unmatched";
const tabs: ReconciliationTab[] = ["Matched", "Suggested Matches", "Unmatched"];

function recordFitsTab(record: ReconciliationRecord, tab: ReconciliationTab) {
  if (tab === "Matched") return record.resolution === "Confirmed" || (record.resolution === "Pending" && record.confidence >= 90);
  if (tab === "Unmatched") return record.resolution === "Rejected" || (record.resolution === "Pending" && record.confidence < 80);
  return record.resolution === "Pending";
}

export default function ReconciliationPage() {
  const [tab, setTab] = useState<ReconciliationTab>("Suggested Matches");
  const [records, setRecords] = useState<ReconciliationRecord[]>(seededRecords);
  const [selectedId, setSelectedId] = useState(seededRecords[0].id);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const visibleRecords = useMemo(() => records.filter((record) => recordFitsTab(record, tab)), [records, tab]);
  const selected = visibleRecords.find((record) => record.id === selectedId) ?? visibleRecords[0] ?? null;
  const confirmed = records.filter((record) => record.resolution === "Confirmed").length;
  const rejected = records.filter((record) => record.resolution === "Rejected").length;
  const counts = {
    Matched: 1_842 + confirmed,
    "Suggested Matches": 41 - confirmed - rejected,
    Unmatched: 19 + rejected,
  };

  function chooseTab(nextTab: ReconciliationTab) {
    setTab(nextTab);
    setDetailsVisible(false);
    const first = records.find((record) => recordFitsTab(record, nextTab));
    if (first) setSelectedId(first.id);
  }

  function resolveRecord(resolution: "Confirmed" | "Rejected") {
    if (!selected) return;
    setRecords((current) => current.map((record) => (record.id === selected.id ? { ...record, resolution } : record)));
    setMessage(
      resolution === "Confirmed"
        ? `${selected.ledger.description} was confirmed as a match.`
        : `${selected.ledger.description} was rejected and moved to Unmatched.`,
    );
  }

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Review AI-assisted matches across ledger and bank records."
        actions={<span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)]"><Sparkles aria-hidden="true" size={15} className="text-[var(--teal)]" /> Hybrid matching prototype</span>}
      />

      {message ? (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-green-200 bg-[var(--green-soft)] px-4 py-3 text-sm text-[var(--green)]" role="status">
          <span className="inline-flex items-center gap-2 font-medium"><Check aria-hidden="true" size={17} /> {message}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message" className="grid size-8 place-items-center rounded-md hover:bg-green-100"><X aria-hidden="true" size={16} /></button>
        </div>
      ) : null}

      <Panel>
        <div className="grid gap-5 p-5 md:grid-cols-[130px_minmax(0,1fr)_auto] md:items-center sm:p-6">
          <div>
            <p className="text-xs font-semibold text-[var(--muted-strong)]">Reconciled</p>
            <p className="mt-1 text-4xl font-semibold tracking-[-0.04em] text-[var(--teal)]">96.8%</p>
          </div>
          <ProgressBar value={96.8} label="96.8% of records reconciled" />
          <dl className="grid grid-cols-3 gap-5 md:pl-5">
            {[
              ["Matched", counts.Matched.toLocaleString(), "var(--teal)"],
              ["Suggested", counts["Suggested Matches"].toString(), "var(--indigo)"],
              ["Unmatched", counts.Unmatched.toString(), "var(--red)"],
            ].map(([label, value, color]) => (
              <div key={label}>
                <dt className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><span className="size-2 rounded-full" style={{ backgroundColor: color }} />{label}</dt>
                <dd className="mt-1 text-xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Panel>

      <div className="mt-4 grid grid-cols-3 rounded-xl border border-[var(--border)] bg-white p-1 panel-shadow" role="tablist" aria-label="Reconciliation status">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => chooseTab(item)}
            className={`min-h-11 rounded-lg px-2 text-xs font-semibold sm:text-sm ${
              tab === item ? "bg-[var(--teal-soft)] text-[var(--teal-dark)]" : "text-[var(--muted-strong)] hover:bg-slate-50"
            }`}
          >
            {item} <span className="ml-1 text-[10px] text-[var(--muted)]">{counts[item]}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title={`${tab} queue`} action={<span className="text-xs text-[var(--muted)]">Prototype subset</span>}>
          {visibleRecords.length ? (
            <div className="divide-y divide-[var(--border)]">
              {visibleRecords.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => { setSelectedId(record.id); setDetailsVisible(false); }}
                  aria-pressed={selected?.id === record.id}
                  className={`flex w-full items-center gap-4 p-4 text-left transition-colors ${selected?.id === record.id ? "bg-[var(--teal-soft)]" : "hover:bg-slate-50"}`}
                >
                  <ConfidenceRing value={record.confidence} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{record.ledger.description}</span>
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">{record.ledger.date} ↔ {record.bank.date}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--muted)]">{record.ledger.reference} ↔ {record.bank.reference}</span>
                    <span className="mt-1 block text-xs font-medium">{formatCurrency(record.ledger.amount, true)}</span>
                    <span className={`mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold ${record.confidence >= 90 ? "text-[var(--teal)]" : record.confidence >= 80 ? "text-[var(--indigo)]" : "text-[var(--amber)]"}`}>
                      <span className="size-1.5 rounded-full bg-current" /> {record.resolution === "Pending" ? record.classification : record.resolution}
                    </span>
                  </span>
                  <ArrowRight aria-hidden="true" size={17} className="shrink-0 text-[var(--muted)]" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title={`No ${tab.toLowerCase()} examples`} description="Decisions made in the prototype will appear in this queue." />
          )}
        </Panel>

        {selected ? (
          <Panel>
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
              <section aria-labelledby="ledger-record-title" className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
                <p id="ledger-record-title" className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Ledger</p>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center gap-2"><CalendarDays aria-hidden="true" size={16} className="text-[var(--muted)]" /> {selected.ledger.date}</div>
                  <div className="flex items-center gap-2 font-semibold"><FileText aria-hidden="true" size={16} className="text-[var(--muted)]" /> {selected.ledger.description}</div>
                  <div className="flex items-center gap-2"><Hash aria-hidden="true" size={16} className="text-[var(--muted)]" /> {selected.ledger.reference}</div>
                  <div className="flex items-center gap-2 text-base font-semibold"><Banknote aria-hidden="true" size={16} className="text-[var(--teal)]" /> {formatCurrency(selected.ledger.amount, true)}</div>
                </dl>
              </section>

              <div className="mx-auto grid size-12 place-items-center rounded-full border border-[var(--border-strong)] bg-white text-xs font-bold text-[var(--muted-strong)]">VS</div>

              <section aria-labelledby="bank-record-title" className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
                <p id="bank-record-title" className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Bank</p>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center gap-2"><CalendarDays aria-hidden="true" size={16} className="text-[var(--muted)]" /> {selected.bank.date}</div>
                  <div className="flex items-center gap-2 font-semibold"><Landmark aria-hidden="true" size={16} className="text-[var(--muted)]" /> {selected.bank.description}</div>
                  <div className="flex items-center gap-2"><Hash aria-hidden="true" size={16} className="text-[var(--muted)]" /> {selected.bank.reference}</div>
                  <div className="flex items-center gap-2 text-base font-semibold"><Banknote aria-hidden="true" size={16} className="text-[var(--teal)]" /> {formatCurrency(selected.bank.amount, true)}</div>
                </dl>
              </section>
            </div>

            <div className="grid border-y border-[var(--border)] lg:grid-cols-[230px_minmax(0,1fr)_260px]">
              <div className="grid place-items-center border-b border-[var(--border)] p-6 lg:border-b-0 lg:border-r">
                <p className="mb-3 text-xs font-semibold text-[var(--muted-strong)]">AI matching score</p>
                <ConfidenceRing value={selected.confidence} size="lg" />
              </div>
              <div className="space-y-4 border-b border-[var(--border)] p-5 lg:border-b-0 lg:border-r">
                {[
                  ["Amount Match", selected.factors.amount],
                  ["Date Similarity", selected.factors.date],
                  ["Description Match", selected.factors.description],
                  ["Reference Match", selected.factors.reference],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-medium text-[var(--muted-strong)]">{label}</span><span className="font-semibold text-[var(--teal)]">{value}%</span></div>
                    <ProgressBar value={Number(value)} label={`${label} ${value}%`} />
                  </div>
                ))}
              </div>
              <div className="p-5">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-900">
                  <Info aria-hidden="true" size={17} className="mb-2 text-blue-700" />
                  {selected.explanation}
                </div>
                {detailsVisible ? (
                  <div className="mt-3 rounded-lg border border-[var(--border)] p-3 text-[11px] leading-5 text-[var(--muted-strong)]">
                    Prototype weights: amount 40%, date 20%, description 20%, reference 20%. This is mock scoring, not a real model output.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
              <p className="inline-flex items-center gap-2 text-[11px] text-[var(--muted)]"><Clock3 aria-hidden="true" size={14} /> Suggested by Hybrid Matching · 1 Sep 2026, 09:42</p>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => resolveRecord("Rejected")} disabled={selected.resolution !== "Pending"} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold hover:bg-slate-50 disabled:opacity-45"><X aria-hidden="true" size={17} /> Reject</button>
                <button type="button" onClick={() => setDetailsVisible((visible) => !visible)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold hover:bg-slate-50"><Eye aria-hidden="true" size={17} /> {detailsVisible ? "Hide Details" : "View Details"}</button>
                <button type="button" onClick={() => resolveRecord("Confirmed")} disabled={selected.resolution !== "Pending"} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--teal)] px-4 text-sm font-semibold text-white hover:bg-[var(--teal-dark)] disabled:opacity-45"><Check aria-hidden="true" size={17} /> Confirm Match</button>
              </div>
            </div>
          </Panel>
        ) : (
          <Panel><EmptyState title="No reconciliation example selected" description="Choose a status tab or record to inspect its matching factors." /></Panel>
        )}
      </div>
    </>
  );
}
