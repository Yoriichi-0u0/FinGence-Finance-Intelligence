"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui";
import { createAcceptedDataPayload, type IngestionResult } from "@/lib/ingestion";
import { analyzeAcceptedDataPayload } from "@/lib/analytics/accepted-data-adapter";
import type { WarningPolicy } from "@/lib/analytics";

const basisLabels = {
  debit_credit: "Separate ledger debit / credit",
  source_amount_with_direction: "Source amount + Debit/Credit label",
  source_signed_amount: "Source signed amount",
};

/** Derived from current results only: removing/rechecking a dataset invalidates analysis too. */
export function LiveAnalytics({ results, onInspect }: {
  results: readonly IngestionResult[];
  onInspect: (sourceRowId: string) => void;
}) {
  const [warningPolicy, setWarningPolicy] = useState<WarningPolicy>("include");
  const analysis = useMemo(() => {
    try {
      const payload = createAcceptedDataPayload(results);
      return { payload, run: analyzeAcceptedDataPayload(payload, warningPolicy), error: null };
    } catch {
      return { payload: null, run: null, error: "Analysis could not be completed for the current records. Ingestion evidence remains available; check the source and compatibility before continuing." };
    }
  }, [results, warningPolicy]);
  const run = analysis.run;
  const counts = analysis.payload?.datasets.reduce((total, dataset) => ({
    received: total.received + dataset.summary.rowsReceived,
    accepted: total.accepted + dataset.summary.accepted,
    rejected: total.rejected + dataset.summary.rejected,
  }), { received: 0, accepted: 0, rejected: 0 });
  return <Panel title="7. Live analysis of included records" eyebrow="Actual C1 → analytics computation" className="mt-5">
    <div className="space-y-5 p-4 sm:p-5">
      <p className="text-sm text-[var(--muted-strong)]">Computed from this session&apos;s current checked records, not the illustrative dashboards. Rechecking or removing a dataset recomputes this view. No uploaded records are sent to a server.</p>
      <label className="block text-sm font-semibold">Records needing attention in analysis
        <select className="mt-2 min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 sm:max-w-sm" value={warningPolicy} onChange={event => setWarningPolicy(event.target.value as WarningPolicy)}>
          <option value="include">Include WARNING records and keep their messages</option>
          <option value="exclude">Exclude WARNING records from this analysis only</option>
        </select>
      </label>
      <p className="text-xs text-[var(--muted-strong)]">This analysis choice does not change ingestion acceptance or downloads. Excluded/rejected source rows never enter C1 analytics.</p>
      {analysis.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{analysis.error}</p>}
      {run && counts && <>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-label="Live analysis counts">
          {[["Source rows checked", counts.received], ["Accepted by C1", counts.accepted], ["VALID", run.prepared.counts.valid], ["WARNING available", run.prepared.counts.warning], ["Cannot include", counts.rejected], ["Analyzed now", run.prepared.counts.included]].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-slate-50 p-3"><dt className="text-xs text-[var(--muted-strong)]">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}
        </dl>
        <p role="status" className="text-sm">{run.prepared.counts.included} accepted records analyzed; {run.prepared.counts.excludedWarnings} warning records excluded by the selected analysis policy. {run.ledgerInterpretation.unavailable} ledger rows have no associated reviewed interpretation.</p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          These are source-value summaries, not revenue, expenses, profit or universal cash flow. C1 supplies no dataset-specific ledger interpretation approval, so ledger net is unavailable. Bank Debit/Credit labels do not establish cash direction. Currencies and monetary representations remain separate.
        </div>
        <section aria-label="Actual monthly source-value aggregates">
          <h3 className="text-sm font-semibold">Monthly source values · exact decimal arithmetic</h3>
          <p className="mt-1 text-xs text-[var(--muted-strong)]">Amounts with a Debit/Credit label are added as supplied, without direction-based netting. Missing currency is shown as UNSPECIFIED.</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {run.monthlyAggregates.map(group => <article key={[group.period, group.currency, group.monetary_basis].join(":")} className="min-w-0 rounded-lg border border-[var(--border)] p-4">
              <h4 className="text-sm font-semibold">{group.period} · {group.currency}</h4>
              <p className="mt-1 text-xs">{basisLabels[group.monetary_basis]} · {group.transactionCount} records · {group.warningCount} warnings</p>
              <dl className="mt-3 space-y-2 text-sm">
                {[["Sum of source amounts", group.sourceAmountTotal], ["Sum of source debits", group.debitTotal], ["Sum of source credits", group.creditTotal]].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt>{label}</dt><dd className="break-all font-mono">{value ?? "Not supplied"}</dd></div>)}
                <div className="flex flex-wrap justify-between gap-2"><dt>Interpreted ledger net</dt><dd>Unavailable</dd></div>
              </dl>
            </article>)}
          </div>
          {!run.monthlyAggregates.length && <p className="mt-3 text-sm">No included records are available under this analysis policy.</p>}
        </section>
        <section aria-label="Actual statistical anomaly results">
          <h3 className="text-sm font-semibold">Statistical amount review · {run.anomalies.length} flags</h3>
          <p className="mt-1 text-xs text-[var(--muted-strong)]">Frederick&apos;s median/MAD baseline compares amount magnitudes within currency, account and monetary representation. Groups need at least 5 records; threshold 4.5. A flag requests review and does not establish fraud.</p>
          {!run.anomalies.length ? <p className="mt-3 text-sm">No amount flags under the current settings. Small groups may not be assessed; this is not proof that every transaction is correct.</p> : <ul className="mt-3 space-y-3">{run.anomalies.map(flag => <li key={flag.source_row_id} className="rounded-lg border border-amber-200 p-3 text-sm">
            <p>{flag.source_file} · source row {flag.source_row_number} · {flag.currency} · magnitude <span className="break-all font-mono">{flag.magnitude}</span></p>
            <p className="mt-1">{flag.reason}</p><button type="button" onClick={() => onInspect(flag.source_row_id)} className="mt-2 min-h-11 text-[var(--teal-dark)] underline">Review source row and evidence</button>
          </li>)}</ul>}
        </section>
        <details>
          <summary className="cursor-pointer py-2 text-sm font-semibold">Warning messages and source references</summary>
          <p className="mt-2 text-xs">All accepted WARNING records remain identifiable here, including those excluded from this analysis.</p>
          <ul className="mt-3 space-y-3">{[...run.prepared.records, ...run.prepared.excludedWarningRecords].filter(row => row.ingestion_status === "WARNING").map(row => <li key={row.source_row_id} className="rounded-lg border border-amber-200 p-3 text-sm">
            <p className="break-words font-semibold">{row.source_file} · {row.source_sheet ?? "CSV"} · source row {row.source_row_number}</p>
            <ul className="mt-2 list-inside list-disc">{row.validation_messages.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
            <button type="button" className="mt-2 min-h-11 text-[var(--teal-dark)] underline" onClick={() => onInspect(row.source_row_id)}>Review row, original values and changes</button>
          </li>)}</ul>
        </details>
        <details>
          <summary className="cursor-pointer py-2 text-sm font-semibold">Technical C1 route and current batch references</summary>
          <p className="mt-2 text-xs">createAcceptedDataPayload(currentResults) → analyzeAcceptedDataPayload(payload, warningPolicy). Schema/ruleset 0.1. Persistence and backend supersession are not called by this browser demonstration.</p>
          <ul className="mt-3 space-y-2 text-xs">{analysis.payload!.datasets.map(dataset => <li key={dataset.dataset_id} className="break-all rounded border border-[var(--border)] p-3">{dataset.source_file} · {dataset.source_sheet ?? "CSV"}<br />Producer batch: {dataset.ingestion_batch_id}<br />Checked at: {dataset.ingested_at}</li>)}</ul>
        </details>
      </>}
    </div>
  </Panel>;
}
