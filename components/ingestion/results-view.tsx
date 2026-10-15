import { useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/overlay";
import { Panel } from "@/components/ui";
import type { CanonicalField, CanonicalTransaction, IngestionResult, ProcessedRow, QualitySummary, RowStatus } from "@/lib/ingestion/models";
import {
  checkedValue, currencyDescription, dateBasisLabel, defaultResultFilter, filterRows,
  financeValues, issueDetails, moneyDescription, sourceMoneyDescription, sourceValue,
  STATUS_LABELS, transformationDescriptions, type ResultFilter,
} from "./presentation";

export function IngestionBadge({ status }: { status: RowStatus }) {
  const colors = { VALID: "bg-green-50 text-green-800 ring-green-200", WARNING: "bg-amber-50 text-amber-800 ring-amber-200", REJECTED: "bg-red-50 text-red-800 ring-red-200" };
  return <span className={"inline-flex rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset " + colors[status]}>{STATUS_LABELS[status]}</span>;
}
function Counts({ summary }: { summary: QualitySummary }) {
  return <dl className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-5 sm:p-5">
    {[["Rows checked", summary.rowsReceived], ["Ready", summary.valid], ["Included — needs attention", summary.warning],
      ["Cannot include", summary.rejected], ["Included total", summary.accepted]].map(([label, value]) =>
      <div key={label}><dt className="text-xs text-[var(--muted-strong)]">{label}</dt><dd className="mt-1 text-2xl font-semibold">{value}</dd></div>)}
  </dl>;
}
export function QualityView({ summary, fileErrors }: { summary: QualitySummary; fileErrors: number }) {
  const rate = (value: number | null) => value === null ? "Not available" : value.toFixed(2) + "%";
  return <Panel title="Session totals" className="mt-5" eyebrow="Checked files only">
    <div className="flex flex-wrap gap-x-6 gap-y-2 px-4 pt-4 text-sm sm:px-5">
      <p><strong>{summary.filesProcessed}</strong> files checked</p><p><strong>{summary.datasetsProcessed}</strong> worksheets / datasets checked</p>
    </div>
    <Counts summary={summary} />
    <p className="px-4 pb-4 text-xs text-[var(--muted-strong)] sm:px-5">Included total = Ready + Included — needs attention. Cannot include rows stay outside the combined records and included-records download.</p>
    <details className="border-t border-[var(--border)] p-4 sm:p-5">
      <summary className="cursor-pointer text-sm font-semibold">Quality measures and definitions</summary>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-xs lg:grid-cols-3">
        {[["Ingestion success rate", rate(summary.successRate)], ["Clean validity rate", rate(summary.cleanValidityRate)],
          ["Required-value completeness", rate(summary.requiredCompleteness)], ["Repeated source rows", summary.duplicateRows],
          ["Missing selected dates", summary.missingDates], ["Missing monetary input", summary.missingMoney],
          ["Missing references", summary.missingReferences], ["Columns not used", summary.unmappedColumns],
          ["File error attempts", fileErrors]].map(([label, value]) => <div key={label}><dt className="text-[var(--muted)]">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
      </dl>
      <p className="mt-4 text-xs text-[var(--muted-strong)]">Ingestion success = included / received. Clean validity = Ready / received. Required-value completeness measures populated date and monetary inputs, including malformed values; it is not accuracy. Unreadable files have unknown row counts and stay outside row-rate denominators. Repeated rows are retained and flagged.</p>
    </details>
  </Panel>;
}
function Pager({ count, page, onPage }: { count: number; page: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / 20));
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs sm:px-5">
    <span>{count ? (page * 20 + 1) + "–" + Math.min((page + 1) * 20, count) + " of " + count : "0 records"} · page {page + 1}/{pages}</span>
    <div className="flex gap-2">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0} className="min-h-11 rounded border border-[var(--border)] px-3 disabled:opacity-40">Previous</button>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page + 1 >= pages} className="min-h-11 rounded border border-[var(--border)] px-3 disabled:opacity-40">Next</button>
    </div>
  </div>;
}
function Problem({ row }: { row: ProcessedRow }) {
  const first = row.issues[0] ? issueDetails(row.issues[0], row.candidate) : null;
  return <div className="space-y-2"><IngestionBadge status={row.status} />
    <p className="text-sm">{first?.problem ?? "No active issues found by these ingestion checks."}</p>
    {row.issues.length > 1 && <p className="text-xs text-[var(--muted-strong)]">{row.issues.length - 1} more issue(s) — review the row to see every issue.</p>}
  </div>;
}
function Comparison({ row }: { row: ProcessedRow }) {
  const first = row.issues[0] ? issueDetails(row.issues[0], row.candidate) : null;
  return <dl className="space-y-2 text-xs">
    {first && <div><dt className="text-[var(--muted)]">Field being checked</dt><dd className="mt-1 font-semibold">{first.field}</dd></div>}
    <div><dt className="text-[var(--muted)]">Original source value</dt><dd className="mt-1 break-words whitespace-pre-wrap">{first?.original ?? sourceMoneyDescription(row)}</dd></div>
    <div><dt className="text-[var(--muted)]">Standardized result{row.status === "REJECTED" ? " — preview only" : ""}</dt><dd className="mt-1 break-words">{first?.checked ?? moneyDescription(row.candidate)}</dd></div>
  </dl>;
}
function TransactionSummary({ row }: { row: CanonicalTransaction | ProcessedRow["candidate"] }) {
  return <div className="space-y-1 text-xs">
    <p className="break-words"><strong>{checkedValue(row.canonical_date)}</strong> · using {dateBasisLabel(row.canonical_date_basis)}</p>
    <p className="break-words">Reference: {checkedValue(row.reference)}</p>
    {row.description && <p className="break-words" title={row.description.slice(0, 1000)}>{row.description.slice(0, 160)}</p>}
    <p className="break-words">{moneyDescription(row)}</p>
    <p className="break-words text-[var(--muted-strong)]">{currencyDescription(row)}</p>
  </div>;
}
export function ResultsView({ result, onInspect }: { result: IngestionResult; onInspect: (id: string) => void }) {
  const [filter, setFilter] = useState<ResultFilter>(() => defaultResultFilter(result.records));
  const [page, setPage] = useState(0);
  const records = filterRows(result.records, filter);
  const activePage = Math.min(page, Math.max(0, Math.ceil(records.length / 20) - 1));
  const visible = records.slice(activePage * 20, activePage * 20 + 20);
  const filters: { value: ResultFilter; label: string }[] = [
    { value: "NEEDS_REVIEW", label: "Needs review" }, { value: "ALL", label: "All rows" },
    ...(["VALID", "WARNING", "REJECTED"] as const).map(value => ({ value, label: STATUS_LABELS[value] })),
  ];
  const reviewButton = (row: ProcessedRow) => <button type="button" aria-label={"Review source row " + row.provenance.source_row_number}
    onClick={() => onInspect(row.provenance.source_row_id)} className="min-h-11 rounded border border-[var(--border)] px-3 text-xs font-semibold text-[var(--teal-dark)]">Review row</button>;
  return <Panel title="5. Review this file's results" className="mt-5" eyebrow={result.dataset.file.name + " · " + (result.dataset.sheet.name ?? "CSV")}>
    <Counts summary={result.summary} />
    <p className="px-4 pb-4 text-xs text-[var(--muted-strong)] sm:px-5">{result.summary.accepted} rows from this file are included. Ready means these checks found no active issues; accounting correctness has not been verified. Warning rows are included and still need attention.</p>
    <div className="flex flex-wrap gap-2 border-t border-[var(--border)] p-4 sm:px-5" role="group" aria-label="Record status filters">
      {filters.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => { setFilter(item.value); setPage(0); }}
        className={"min-h-11 rounded-lg border px-3 text-xs font-semibold " + (filter === item.value ? "border-[var(--teal)] bg-[var(--teal-soft)] text-[var(--teal-dark)]" : "border-[var(--border)]")}>
        {item.label} · {filterRows(result.records, item.value).length}
      </button>)}
    </div>
    <div className="hidden overflow-auto lg:block">
      <table className="w-full table-fixed text-left text-xs">
        <thead className="bg-slate-50"><tr>{["Status / problem", "Original → standardized", "Transaction details", "Source row / review"].map(label => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody>{visible.map(row => <tr key={row.provenance.source_row_id} className="border-t border-[var(--border)] align-top">
          <td className="px-4 py-3"><Problem row={row} /></td><td className="px-4 py-3"><Comparison row={row} /></td>
          <td className="px-4 py-3"><TransactionSummary row={row.candidate} /></td>
          <td className="space-y-3 px-4 py-3"><p>Source row {row.provenance.source_row_number}</p>{reviewButton(row)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="space-y-3 px-4 pb-4 lg:hidden">{visible.map(row => <article key={row.provenance.source_row_id} className="min-w-0 space-y-4 rounded-lg border border-[var(--border)] p-3">
      <h3 className="text-sm font-semibold">Source row {row.provenance.source_row_number}</h3><Problem row={row} /><Comparison row={row} /><TransactionSummary row={row.candidate} />{reviewButton(row)}
    </article>)}</div>
    {!records.length && <p className="p-5 text-sm text-[var(--muted)]">No rows in this category.</p>}
    <Pager count={records.length} page={activePage} onPage={setPage} />
  </Panel>;
}
export function CanonicalView({ records, onInspect }: { records: CanonicalTransaction[]; onInspect: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const activePage = Math.min(page, Math.max(0, Math.ceil(records.length / 20) - 1));
  const visible = records.slice(activePage * 20, activePage * 20 + 20);
  const source = (row: CanonicalTransaction) => row.source_file + " · " + (row.source_sheet ?? "CSV") + " · row " + row.source_row_number;
  const reviewButton = (row: CanonicalTransaction) => <button type="button" onClick={() => onInspect(row.source_row_id)} aria-label={"Review " + source(row)}
    className="min-h-11 rounded border border-[var(--border)] px-3 text-xs font-semibold text-[var(--teal-dark)]">Review row</button>;
  return <Panel title="Included records in this session" className="mt-5">
    <p className="px-4 py-4 text-xs text-[var(--muted-strong)] sm:px-5">Ready and Included — needs attention rows are included here and in the included-records CSV. Cannot include rows are excluded. Source dates remain separate in row details. Different amount conventions are preserved; no mixed-source financial total is calculated.</p>
    <div className="hidden overflow-auto lg:block"><table className="w-full table-fixed text-left text-xs">
      <thead className="bg-slate-50"><tr>{["Transaction details", "Status", "Source file / worksheet / row", "Review"].map(label => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
      <tbody>{visible.map(row => <tr key={row.source_row_id} className="border-t border-[var(--border)] align-top">
        <td className="px-4 py-3"><TransactionSummary row={row} /></td><td className="px-4 py-3"><IngestionBadge status={row.ingestion_status} /></td>
        <td className="break-words px-4 py-3">{source(row)}</td><td className="px-4 py-3">{reviewButton(row)}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="space-y-3 px-4 pb-4 lg:hidden">{visible.map(row => <article key={row.source_row_id} className="min-w-0 space-y-3 rounded-lg border border-[var(--border)] p-3">
      <IngestionBadge status={row.ingestion_status} /><TransactionSummary row={row} /><p className="break-words text-xs">{source(row)}</p>{reviewButton(row)}
    </article>)}</div>
    {!records.length && <p className="p-5 text-sm text-[var(--muted)]">No rows can be included from the current checked datasets. Review the excluded rows and their problems.</p>}
    <Pager count={records.length} page={activePage} onPage={setPage} />
  </Panel>;
}
export function RecordInspector({ row, result, onClose }: { row: ProcessedRow; result: IngestionResult; onClose: () => void }) {
  const focus = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focus.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const dialog = focus.current?.closest('[role="dialog"]');
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])') ?? [])
          .filter(element => !element.matches(":disabled") && element.getClientRects().length > 0);
        if (!controls.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === focus.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  const preview = (value: unknown) => {
    const text = JSON.stringify(value, null, 2) ?? "null";
    return text.length > 12000 ? text.slice(0, 12000) + "\n… Preview capped; full values are in the full check report download." : text;
  };
  const values = financeValues(row.candidate).filter(value =>
    ["canonical_date", "transaction_date", "posting_date", "currency"].includes(value.field) || value.value !== "Not available" || Object.hasOwn(row.staging, value.field));
  return <Drawer title={"Source row " + row.provenance.source_row_number} description={row.provenance.source_file + " · " + (row.provenance.source_sheet ?? "CSV")} onClose={onClose}>
    <div className="space-y-5 p-5">
      <h3 ref={focus} tabIndex={-1} className="flex flex-wrap items-center gap-3 text-sm font-semibold">Row review <IngestionBadge status={row.status} /></h3>
      <p className="text-sm text-[var(--muted-strong)]">{row.status === "REJECTED" ? "This row cannot be included. Standardized values below are a preview only and are excluded from the combined records."
        : row.status === "WARNING" ? "This row is included and needs attention. Review every problem below before using it downstream."
        : "This row is included. No active issues were found by these ingestion checks; accounting correctness has not been verified."}</p>
      <section aria-label="Problems and suggested actions" className="space-y-3">
        {row.issues.map((issue, index) => {
          const detail = issueDetails(issue, row.candidate);
          return <article key={index} className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <h4 className="font-semibold">{detail.field}</h4><p className="mt-2">{detail.problem}</p>
            <dl className="mt-3 space-y-2 text-xs"><div><dt className="text-[var(--muted)]">Original source value{issue.sourceColumn ? " · " + issue.sourceColumn : ""}</dt><dd className="mt-1 break-words whitespace-pre-wrap">{detail.original}</dd></div>
              <div><dt className="text-[var(--muted)]">Standardized result{row.status === "REJECTED" ? " — preview only" : ""}</dt><dd className="mt-1 break-words">{detail.checked}</dd></div></dl>
            <p className="mt-3 text-xs"><strong>Suggested action:</strong> {detail.action}</p>
          </article>;
        })}
        {!row.issues.length && <p className="text-sm text-green-800">No active issues.</p>}
      </section>
      <section aria-label="Financial values" className="space-y-3">
        <h4 className="text-sm font-semibold">Financial values — original and standardized</h4>
        <p className="text-xs text-[var(--muted-strong)]">{moneyDescription(row.candidate)}. {currencyDescription(row.candidate)}</p>
        {values.map(value => <div key={value.field} className="rounded-lg bg-slate-50 p-3 text-xs">
          <p className="font-semibold">{value.label}</p>
          <dl className="mt-2 grid gap-3 sm:grid-cols-2"><div><dt className="text-[var(--muted)]">Original</dt><dd className="mt-1 break-words whitespace-pre-wrap">{sourceValue(row.staging[(value.field === "canonical_date" ? result.options.dateBasis : value.field) as CanonicalField])}</dd></div>
            <div><dt className="text-[var(--muted)]">Standardized{row.status === "REJECTED" ? " — preview only" : ""}</dt><dd className="mt-1 break-words">{value.value}</dd></div></dl>
        </div>)}
      </section>
      <section aria-label="Source and changes made" className="space-y-2 text-xs">
        <h4 className="text-sm font-semibold">Source and changes made</h4>
        <p className="break-words">{row.provenance.source_file} · {row.provenance.source_sheet ?? "CSV"} · source row {row.provenance.source_row_number}</p>
        <p>Source name: {row.provenance.source_system}</p>
        {transformationDescriptions(row.candidate).map((description, index) => <p key={index}>{description}</p>)}
        {!row.candidate.transformations.length && <p>No approved blank-side-to-zero changes were applied.</p>}
      </section>
      <details>
        <summary className="cursor-pointer py-2 text-sm font-semibold">Technical row evidence</summary>
        <div className="mt-3 space-y-4 text-xs">
          <p>Internal status: {row.status}. Full audit evidence remains available in the JSON check report. A rejected candidate is never an accepted record.</p>
          {[["Original row and column names", { columns: result.dataset.columns, ...row.raw }],
            ["Mapped staging values", row.staging], ["Normalized candidate and provenance", row.candidate],
            ["All validation messages and rule codes", row.issues],
            ["Approved mapping and parsing decisions", { schema_version: result.schema_version, ruleset_version: result.ruleset_version, mapping: result.mapping, options: result.options, context: result.context }],
          ].map(([title, value]) => <details key={String(title)}><summary className="cursor-pointer py-2 font-semibold">{String(title)}</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[11px]">{preview(value)}</pre>
          </details>)}
        </div>
      </details>
    </div>
  </Drawer>;
}
