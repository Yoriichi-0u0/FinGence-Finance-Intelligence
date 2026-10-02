import { useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/overlay";
import { Panel } from "@/components/ui";
import type { CanonicalTransaction, IngestionResult, ProcessedRow, QualitySummary, RowStatus } from "@/lib/ingestion/models";
import { rawText } from "@/lib/ingestion/normalizer";

export function IngestionBadge({ status }: { status: RowStatus }) {
  const colors = { VALID: "bg-green-50 text-green-800 ring-green-200", WARNING: "bg-amber-50 text-amber-800 ring-amber-200", REJECTED: "bg-red-50 text-red-800 ring-red-200" };
  return <span className={"inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset " + colors[status]}>{status}</span>;
}
export function QualityView({ summary, fileErrors }: { summary: QualitySummary; fileErrors: number }) {
  const rate = (value: number | null) => value === null ? "N/A" : value.toFixed(2) + "%";
  return <Panel title="Consolidated ingestion summary" className="mt-5" eyebrow="Actual processed records">
    <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 xl:grid-cols-6 sm:p-5">
      {[
        ["Files processed", summary.filesProcessed], ["Rows received", summary.rowsReceived],
        ["Accepted · valid + warning", summary.accepted], ["Valid", summary.valid], ["Warning", summary.warning], ["Rejected", summary.rejected],
      ].map(([label, value]) => <div key={label}><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}
    </div>
    <dl className="grid grid-cols-2 gap-4 border-t border-[var(--border)] p-4 text-xs sm:grid-cols-3 xl:grid-cols-5 sm:p-5">
      {[
        ["Ingestion success", rate(summary.successRate)], ["Clean validity", rate(summary.cleanValidityRate)],
        ["Required-value completeness", rate(summary.requiredCompleteness)], ["Duplicate raw rows", summary.duplicateRows],
        ["Missing dates", summary.missingDates], ["Missing monetary input", summary.missingMoney],
        ["Missing references", summary.missingReferences], ["Unmapped / ignored columns", summary.unmappedColumns],
        ["Datasets processed", summary.datasetsProcessed], ["File error attempts", fileErrors],
      ].map(([label, value]) => <div key={label}><dt className="text-[var(--muted)]">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
    </dl>
    <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted-strong)] sm:px-5">Success = accepted / received. Clean validity = valid / received. Completeness measures populated date and monetary inputs, including malformed values. Unreadable files have unknown row counts and stay outside row-rate denominators.</p>
  </Panel>;
}

function Pager({ count, page, onPage }: { count: number; page: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / 20));
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs sm:px-5">
    <span>{count ? (page * 20 + 1) + "–" + Math.min((page + 1) * 20, count) + " of " + count : "0 records"} · page {page + 1}/{pages}</span>
    <div className="flex gap-2">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0} className="min-h-8 rounded border border-[var(--border)] px-3 disabled:opacity-40">Previous</button>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page + 1 >= pages} className="min-h-8 rounded border border-[var(--border)] px-3 disabled:opacity-40">Next</button>
    </div>
  </div>;
}
export function ResultsView({ result, onInspect }: { result: IngestionResult; onInspect: (id: string) => void }) {
  const [filter, setFilter] = useState<"ALL" | RowStatus>("ALL");
  const [page, setPage] = useState(0);
  const records = result.records.filter(row => filter === "ALL" || row.status === filter);
  const activePage = Math.min(page, Math.max(0, Math.ceil(records.length / 20) - 1));
  return <Panel title="3. Validation records and quarantine" className="mt-5" eyebrow={result.dataset.file.name}>
    <div className="flex flex-wrap gap-2 p-4 sm:px-5" aria-label="Record status filters">
      {(["ALL", "VALID", "WARNING", "REJECTED"] as const).map(status => <button key={status} type="button" aria-pressed={filter === status} onClick={() => { setFilter(status); setPage(0); }}
        className={"min-h-9 rounded-lg border px-3 text-xs font-semibold " + (filter === status ? "border-[var(--teal)] bg-[var(--teal-soft)] text-[var(--teal-dark)]" : "border-[var(--border)]")}>
        {status} · {status === "ALL" ? result.records.length : result.records.filter(row => row.status === status).length}
      </button>)}
    </div>
    <div className="overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50"><tr>{["Source row", "Canonical date", "Selected monetary representation", "Status", "Reason", "Evidence"].map(label => <th key={label} className="whitespace-nowrap px-4 py-2">{label}</th>)}</tr></thead>
        <tbody>{records.slice(activePage * 20, activePage * 20 + 20).map(row => <tr key={row.provenance.source_row_id} className="border-t border-[var(--border)] align-top">
          <td className="px-4 py-3 font-semibold">{row.provenance.source_row_number}</td>
          <td className="whitespace-nowrap px-4 py-3"><p>{row.candidate.canonical_date ?? "∅"}</p>
            <p className="mt-1 text-[10px] text-[var(--muted)]">{row.candidate.canonical_date_basis}</p>
            {row.candidate.canonical_date === null && <p className="mt-1">Input: {rawText(row.staging[result.options.dateBasis]) || "∅"}</p>}</td>
          <td className="px-4 py-3"><p className="whitespace-nowrap font-mono">{row.candidate.monetary_basis === "debit_credit"
            ? "D " + (row.candidate.debit ?? "∅") + " / C " + (row.candidate.credit ?? "∅")
            : row.candidate.source_amount ?? (rawText(row.staging.source_amount) || "∅")}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{row.candidate.monetary_basis}</p></td>
          <td className="px-4 py-3"><IngestionBadge status={row.status} /></td>
          <td className="min-w-60 max-w-md px-4 py-3 text-[var(--muted-strong)]">{row.issues.length ? row.issues.map(issue => issue.message).join(" ").slice(0, 260) : "Required values parsed; no active validation issues."}</td>
          <td className="px-4 py-3"><button type="button" aria-label={"Inspect source row " + row.provenance.source_row_number} onClick={() => onInspect(row.provenance.source_row_id)} className="min-h-8 rounded border border-[var(--border)] px-3 font-semibold text-[var(--teal-dark)]">Inspect</button></td>
        </tr>)}</tbody>
      </table>
      {!records.length && <p className="p-5 text-sm text-[var(--muted)]">No records in this classification.</p>}
    </div>
    <Pager count={records.length} page={activePage} onPage={setPage} />
  </Panel>;
}
export function CanonicalView({ records, onInspect }: { records: CanonicalTransaction[]; onInspect: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const activePage = Math.min(page, Math.max(0, Math.ceil(records.length / 20) - 1));
  return <Panel title="4. Consolidated canonical output" className="mt-5" eyebrow="Provisional schema v0.1">
    <p className="px-4 py-3 text-xs text-[var(--muted-strong)] sm:px-5">Valid and warning records are included. Canonical date and its selected basis are explicit; source transaction and posting dates remain separate. Inspect any row for transformation provenance. No financial total is calculated across incompatible monetary representations.</p>
    <div className="overflow-auto">
      <table className="w-full whitespace-nowrap text-left text-xs">
        <thead className="bg-slate-50"><tr>{["Canonical date / basis", "Transaction date", "Posting date", "Reference", "Account", "Source amount", "Debit", "Credit", "Ledger net", "Side", "Currency", "Monetary basis", "Source / row", "Status"].map(label => <th key={label} className="px-4 py-2">{label}</th>)}</tr></thead>
        <tbody>{records.slice(activePage * 20, activePage * 20 + 20).map(row => <tr key={row.source_row_id} className="border-t border-[var(--border)]">
          <td className="px-4 py-3"><p>{row.canonical_date}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{row.canonical_date_basis}</p></td>
          <td className="px-4 py-3">{row.transaction_date ?? "∅"}</td><td className="px-4 py-3">{row.posting_date ?? "∅"}</td>
          <td className="px-4 py-3">{row.reference ?? "∅"}</td><td className="px-4 py-3">{row.account_code ?? row.account_id ?? "∅"}</td>
          <td className="px-4 py-3 font-mono">{row.source_amount ?? "∅"}</td><td className="px-4 py-3 font-mono">{row.debit ?? "∅"}</td><td className="px-4 py-3 font-mono">{row.credit ?? "∅"}</td><td className="px-4 py-3 font-mono">{row.derived_ledger_net ?? "∅"}</td>
          <td className="px-4 py-3">{row.entry_side ?? "—"}</td><td className="px-4 py-3">{row.currency ?? "∅"}</td><td className="px-4 py-3 text-[var(--muted)]">{row.monetary_basis}</td>
          <td className="px-4 py-3"><button type="button" onClick={() => onInspect(row.source_row_id)} className="min-h-8 text-[var(--teal-dark)] underline underline-offset-2">{row.source_file} / {row.source_row_number}</button></td>
          <td className="px-4 py-3"><IngestionBadge status={row.ingestion_status} /></td>
        </tr>)}</tbody>
      </table>
      {!records.length && <p className="p-5 text-sm text-[var(--muted)]">Approve and validate a dataset to produce canonical records.</p>}
    </div>
    <Pager count={records.length} page={activePage} onPage={setPage} />
  </Panel>;
}

export function RecordInspector({ row, result, onClose }: { row: ProcessedRow; result: IngestionResult; onClose: () => void }) {
  const focus = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focus.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const dialog = focus.current?.closest('[role="dialog"]');
        const buttons = dialog?.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]');
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === focus.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  const preview = (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    return text.length > 12000 ? text.slice(0, 12000) + "\n… Preview capped; full values are in the JSON evidence download." : text;
  };
  return <Drawer title={"Source row " + row.provenance.source_row_number} description={row.provenance.source_file + " · " + (row.provenance.source_sheet ?? "CSV record")} onClose={onClose}>
    <div className="space-y-5 p-5">
      <h3 ref={focus} tabIndex={-1} className="flex items-center gap-3 text-sm font-semibold outline-none">Record evidence <IngestionBadge status={row.status} /></h3>
      <p className="text-xs text-[var(--muted-strong)]">Parsed raw cells, staging values, source fingerprint and coordinates are retained. Rejected candidates are excluded from canonical output.</p>
      <div className="space-y-3">
        {row.issues.map((issue, index) => <article key={index} className="rounded-lg border border-[var(--border)] p-3 text-xs">
          <p className="font-semibold">{issue.field} · {issue.severity} · {issue.category}</p><p className="mt-2">{issue.message}</p>
          <p className="mt-2 break-all text-[var(--muted)]">Original: {JSON.stringify(issue.originalValue).slice(0, 2000)}</p>
          <p className="mt-1 text-[var(--muted)]">Rule: {issue.rule} · Source column: {issue.sourceColumn ?? "record"}</p>
        </article>)}
        {!row.issues.length && <p className="text-sm text-green-800">No active issues.</p>}
      </div>
      <details open><summary className="cursor-pointer text-sm font-semibold">Original row and column names</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[11px]">{preview({ columns: result.dataset.columns, cells: row.raw.cells })}</pre></details>
      <details><summary className="cursor-pointer text-sm font-semibold">Mapped staging values</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[11px]">{preview(row.staging)}</pre></details>
      <details open><summary className="cursor-pointer text-sm font-semibold">Normalized candidate and provenance</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[11px]">{preview(row.candidate)}</pre></details>
      <details><summary className="cursor-pointer text-sm font-semibold">Approved mapping and parsing decisions</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[11px]">{preview({ schema_version: result.schema_version, ruleset_version: result.ruleset_version, mapping: result.mapping, options: result.options, context: result.context })}</pre></details>
    </div>
  </Drawer>;
}
