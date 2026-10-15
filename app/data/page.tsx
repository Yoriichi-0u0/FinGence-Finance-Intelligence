"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle, RotateCcw, Upload } from "lucide-react";
import { PageHeader, Panel } from "@/components/ui";
import { ProfileView } from "@/components/ingestion/profile-view";
import { MappingEditor } from "@/components/ingestion/mapping-editor";
import { CanonicalView, QualityView, RecordInspector, ResultsView } from "@/components/ingestion/results-view";
import { reviewState } from "@/components/ingestion/presentation";
import { LiveAnalytics } from "@/components/ingestion/live-analytics";
import {
  DEFAULT_OPTIONS, IngestionError, READER_LIMITS, approveMapping, canonicalCSV, consolidate,
  createDataset, evidenceJSON, ingestDatasetRun, inspectFile, isDuplicateFile, mappingErrors,
  overrideMapping, profileDataset, rejectedCSV, suggestMapping,
  type CanonicalField, type ColumnMapping, type Dataset, type IngestionOptions, type IngestionResult, type LoadedFile, type ProcessedRow,
} from "@/lib/ingestion";

const buttonStyle = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const inputStyle = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm";
type FileFailure = { filename: string; code: string; message: string };
const samples = [["Load ledger CSV", "ledger.csv"], ["Load bank XLSX", "bank_statement.xlsx"], ["Load edge cases", "edge_cases.csv"]] as const;

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeError(error: unknown): { code: string; message: string } {
  return error instanceof IngestionError ? { code: error.code, message: error.message }
    : { code: "PROCESSING_ERROR", message: "Unable to process this input. Review the source file and selected settings." };
}

export default function DataPage() {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [active, setActive] = useState<LoadedFile | null>(null);
  const [sheetIndex, setSheetIndex] = useState<number | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [delimiter, setDelimiter] = useState<"auto" | "," | ";" | "\t">("auto");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [options, setOptions] = useState<IngestionOptions>({ ...DEFAULT_OPTIONS });
  const [reviewed, setReviewed] = useState(false);
  const [results, setResults] = useState<IngestionResult[]>([]);
  const [failures, setFailures] = useState<FileFailure[]>([]);
  const [lastFailure, setLastFailure] = useState<FileFailure | null>(null);
  const [notice, setNotice] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readingName, setReadingName] = useState("");
  // UI notice only: invalidation/reprocessing still uses the original engine result path.
  const [needsRecheck, setNeedsRecheck] = useState<Set<string>>(new Set());
  const [inspected, setInspected] = useState<{ row: ProcessedRow; result: IngestionResult } | null>(null);
  const working = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const closeInspector = useCallback(() => setInspected(null), []);
  const combined = useMemo(() => consolidate(results), [results]);
  const profile = useMemo(() => dataset ? profileDataset(dataset) : null, [dataset]);
  const result = dataset ? results.find(r => r.dataset.id === dataset.id && r.dataset.headerRow === dataset.headerRow) : undefined;
  const errors = dataset ? mappingErrors(dataset, approveMapping(mapping), options) : [];
  const activeId = active && sheetIndex !== null ? active.fingerprint + ":" + sheetIndex : null;
  const recheck = activeId !== null && needsRecheck.has(activeId);
  const state = dataset ? reviewState(Boolean(result), reviewed, errors.length, recheck)
    : selectionError ? "File contents need correction" : "Choose a worksheet";

  function markForRecheck(ids: string[]) {
    if (ids.length) setNeedsRecheck(current => new Set([...current, ...ids]));
  }
  function prepare(file: LoadedFile, index: number | null, row?: number, reuse = true) {
    row ??= reuse ? results.find(r => r.dataset.id === file.fingerprint + ":" + index)?.dataset.headerRow ?? 1 : 1;
    setActive(file); setSheetIndex(index); setHeaderRow(row); setInspected(null); setReviewed(false); setSelectionError(""); setLastFailure(null);
    setDataset(null); setMapping([]);
    if (index === null) return;
    try {
      const selected = createDataset(file, index, row);
      const previous = reuse ? results.find(r => r.dataset.id === selected.id && r.dataset.headerRow === row) : undefined;
      const proposed = previous?.mapping.map(m => ({ ...m })) ?? suggestMapping(selected);
      setDataset(selected); setMapping(proposed);
      if (previous) { setOptions({ ...previous.options }); setReviewed(true); setNotice("Showing this dataset's checked choices and results."); }
      else {
        const targets = new Set(proposed.map(m => m.target));
        const monetaryMode = targets.has("debit") && targets.has("credit") ? "debit_credit" : targets.has("entry_side") ? "amount_direction" : "signed_amount";
        setOptions({ ...DEFAULT_OPTIONS, monetaryMode,
          sourceSystem: monetaryMode === "debit_credit" ? "Ledger" : monetaryMode === "amount_direction" ? "Bank Statement" : "Other",
          dateBasis: targets.has("posting_date") && !targets.has("transaction_date") ? "posting_date" : "transaction_date",
        });
        setNotice("Review starts with fresh column suggestions. Unchecked choices are not saved when switching files or worksheets.");
      }
    } catch (error) { setSelectionError(safeError(error).message); }
  }
  function invalidate() {
    if (dataset) {
      if (result) markForRecheck([dataset.id]);
      setResults(current => current.filter(r => r.dataset.id !== dataset.id));
    }
    setReviewed(false); setInspected(null); setNotice("");
  }
  async function load(read: () => Promise<Uint8Array>, filename: string) {
    if (working.current) return;
    working.current = true; setBusy(true); setReadingName(filename.split(/[\\/]/).pop() ?? "file"); setNotice(""); setLastFailure(null);
    try {
      const file = await inspectFile(await read(), { name: filename, delimiter: delimiter === "auto" ? undefined : delimiter });
      if (isDuplicateFile(file, files)) {
        const previous = files.find(f => f.fingerprint === file.fingerprint)!;
        if (file.type === "CSV" && file.delimiter !== previous.delimiter) {
          markForRecheck(results.filter(r => r.dataset.file.fingerprint === file.fingerprint).map(r => r.dataset.id));
          setFiles(current => current.map(f => f.fingerprint === file.fingerprint ? file : f));
          setResults(current => current.filter(r => r.dataset.file.fingerprint !== file.fingerprint));
          prepare(file, 0, 1, false);
          setNotice("The same CSV was opened with a different separator. Its previous results were removed; review the new column choices and check it again.");
        } else {
          prepare(previous, previous.sheets.length === 1 ? 0 : null);
          setNotice("This file is already loaded. The existing file is reused; no duplicate rows were added.");
        }
      } else {
        setFiles(current => [...current, file]);
        prepare(file, file.sheets.length === 1 ? 0 : null);
        setNotice(file.sheets.length > 1 ? "File opened. Choose the worksheet containing your financial records; none has been added automatically." : "File opened. Check its contents, then confirm the columns and financial conventions.");
      }
    } catch (error) {
      const failure = { filename: filename.split(/[\\/]/).pop() ?? "file", ...safeError(error) };
      setFailures(current => [...current, failure]); setLastFailure(failure);
    } finally { working.current = false; setBusy(false); setReadingName(""); }
  }
  async function loadSample(filename: string) {
    await load(async () => {
      const response = await fetch("/samples/ingestion/" + filename);
      if (!response.ok) throw new IngestionError("SAMPLE_UNAVAILABLE", "Synthetic sample is unavailable.");
      return new Uint8Array(await response.arrayBuffer());
    }, filename);
  }
  function run() {
    if (working.current || !dataset || !reviewed) return;
    try {
      const approved = approveMapping(mapping);
      const completed = ingestDatasetRun(dataset, approved, options);
      setMapping(approved);
      setResults(current => [...current.filter(r => r.dataset.id !== dataset.id), completed]);
      setNeedsRecheck(current => { const next = new Set(current); next.delete(dataset.id); return next; });
      setNotice("Checks complete for " + dataset.file.name + ": " + completed.summary.valid + " Ready, " + completed.summary.warning
        + " Included — needs attention, " + completed.summary.rejected + " Cannot include. " + completed.summary.accepted + " rows are included from these records.");
    } catch (error) { setNotice(safeError(error).message); }
  }
  function inspect(id: string) {
    for (const completed of results) {
      const row = completed.records.find(r => r.provenance.source_row_id === id);
      if (row) { setInspected({ row, result: completed }); break; }
    }
  }
  function reset() {
    setFiles([]); setActive(null); setDataset(null); setMapping([]); setResults([]); setFailures([]); setLastFailure(null); setNeedsRecheck(new Set());
    setSheetIndex(null); setHeaderRow(1); setOptions({ ...DEFAULT_OPTIONS }); setReviewed(false);
    setNotice("Session cleared."); setSelectionError(""); setInspected(null);
    if (fileInput.current) fileInput.current.value = "";
  }
  return <>
    <PageHeader title="Financial data" description="Add a file, review its meaning, then check and combine its records. · Ingestion PoC v0.1"
      actions={<button type="button" onClick={reset} disabled={busy} className={buttonStyle}><RotateCcw size={16} aria-hidden="true" />Clear this session</button>} />
    <div className="rounded-lg border border-teal-200 bg-[var(--teal-soft)] p-4 text-sm text-[var(--teal-dark)]">
      Files are processed in this browser tab&apos;s memory. Refreshing or clearing the session removes this work; download your records and check report before leaving.
      The data format and accounting conventions are provisional. Other FinGence pages still use example data.
    </div>
    <Panel title="1. Add financial file" className="mt-5" action={<span className="text-xs text-[var(--muted)]">{files.length} files loaded</span>}>
      <div className="space-y-4 p-4 sm:p-5">
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--teal)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--teal-dark)] disabled:cursor-not-allowed disabled:opacity-50"><Upload size={16} aria-hidden="true" />Add CSV or XLSX file</button>
        <input ref={fileInput} type="file" aria-label="Choose financial CSV or XLSX file" accept=".csv,.xlsx" disabled={busy} className="hidden" onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void load(async () => {
            if (file.size > READER_LIMITS.fileBytes) throw new IngestionError("FILE_LIMIT", "The file exceeds the 10 MiB input limit.");
            return new Uint8Array(await file.arrayBuffer());
          }, file.name);
        }} />
        <p className="text-xs text-[var(--muted-strong)]">CSV or values-only XLSX files, up to 10 MiB. Workbook contents and row/column limits are checked when the file is opened.</p>
        <details>
          <summary className="cursor-pointer py-2 text-sm font-semibold">Try an example — synthetic data only</summary>
          <div className="mt-2 flex flex-wrap gap-2">{samples.map(([label, filename]) => <button key={filename} type="button" disabled={busy} onClick={() => void loadSample(filename)} className={buttonStyle}><FileSpreadsheet size={16} aria-hidden="true" />{label}</button>)}</div>
          <p className="mt-2 text-xs text-[var(--muted-strong)]">These examples are not client data. Edge cases deliberately include problems for demonstrating the checks.</p>
        </details>
        <p role="status" aria-live="polite" className={busy || notice ? "rounded-lg bg-slate-50 p-3 text-sm" : "sr-only"}>
          {busy ? <span className="flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />Opening {readingName}…</span> : notice}
        </p>
        {lastFailure && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Could not open <strong>{lastFailure.filename}</strong>. {lastFailure.message} {active ? "You are still viewing " + active.name + "; its contents are shown below." : "No file is selected."}
        </p>}
        {files.length > 0 && <div className="grid gap-4 lg:grid-cols-2">
          <label className="min-w-0 text-xs font-semibold">Current file
            <select className={inputStyle} value={active?.fingerprint ?? ""} disabled={busy} onChange={event => {
              const file = files.find(f => f.fingerprint === event.target.value);
              if (file) { setNotice(""); prepare(file, file.sheets.length === 1 ? 0 : null); }
            }}><option value="">Choose a file</option>{files.map(file => <option key={file.fingerprint} value={file.fingerprint}>{file.name}</option>)}</select>
          </label>
          {active?.type === "XLSX" && <label className="min-w-0 text-xs font-semibold">Worksheet containing financial records
            <select className={inputStyle} disabled={busy} value={sheetIndex ?? ""} onChange={event => {
              setNotice(""); if (active) prepare(active, event.target.value === "" ? null : Number(event.target.value));
            }}><option value="">Choose a worksheet</option>{active.sheets.map(sheet => <option key={sheet.index} value={sheet.index}>{sheet.name ?? "Worksheet"}</option>)}</select>
          </label>}
        </div>}
        {active && <section className="space-y-2 rounded-lg border border-[var(--border)] p-3" aria-label="Current file review state">
          <h3 className="break-words text-sm font-semibold">{active.name} · {active.sheets.find(sheet => sheet.index === sheetIndex)?.name ?? (active.type === "CSV" ? "CSV" : "No worksheet selected")}</h3>
          <p role="status" aria-live="polite" className="text-sm font-semibold text-[var(--teal-dark)]">{state}</p>
          <p className="text-xs text-[var(--muted-strong)]">{selectionError ? "Review the worksheet and file-reading settings below." : !dataset ? "Next: choose the worksheet containing financial records."
            : result ? "Next: review this file's results in step 5, then the combined records in step 6."
            : reviewed && !errors.length ? "Next: run Check and add to this session in step 4."
            : "Next: check the file contents and review the column choices and financial conventions."}</p>
          {recheck && !result && <p role="status" className="rounded bg-amber-50 p-3 text-xs text-amber-900">Settings changed. This worksheet&apos;s previous results have been removed from the combined records. Review and check it again. Other checked datasets remain included.</p>}
          <p className="text-xs text-[var(--muted)]">Unchecked choices are not saved when switching files or worksheets. Checked choices and results are restored when you reopen their dataset.</p>
        </section>}
        <details>
          <summary className="cursor-pointer py-2 text-sm font-semibold">File-reading settings</summary>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {active && <label className="min-w-0 text-xs font-semibold">Row containing column headings
              <input type="number" min={1} max={10001} value={headerRow} disabled={sheetIndex === null || busy} className={inputStyle} onChange={event => {
                const row = Number(event.target.value);
                if (sheetIndex !== null) {
                  const id = active.fingerprint + ":" + sheetIndex;
                  if (results.some(r => r.dataset.id === id)) markForRecheck([id]);
                  setResults(current => current.filter(r => r.dataset.id !== id));
                  prepare(active, sheetIndex, row, false);
                }
              }} />
            </label>}
            <label className="min-w-0 text-xs font-semibold">CSV separator — applies when opening a CSV
              <select className={inputStyle} value={delimiter} disabled={busy} onChange={event => setDelimiter(event.target.value as typeof delimiter)}>
                <option value="auto">Detect comma / semicolon / tab</option><option value=",">Comma</option><option value=";">Semicolon</option><option value={"\t"}>Tab</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-[var(--muted-strong)]">If a CSV looks like one column, choose its separator and add/load the same file again. Changing this selector alone does not change the loaded data. Rereading with a different separator or changing the headings row removes affected results and requires a fresh review.</p>
          <p className="mt-2 text-xs text-[var(--muted)]">Technical limits: 10 MiB input, 50 MiB expanded workbook, 10,000 data rows, 100 columns. Values-only XLSX exports are required.</p>
        </details>
        {selectionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{selectionError}</p>}
        {failures.length > 0 && <details><summary className="cursor-pointer py-2 text-sm font-semibold text-red-800">Files that could not be opened · {failures.length} attempts</summary>
          <ul className="mt-2 space-y-2 text-xs">{failures.map((failure, index) => <li key={index} className="break-words rounded border border-red-200 p-3"><strong>{failure.filename}</strong> · {failure.message}</li>)}</ul>
          <details className="mt-3"><summary className="cursor-pointer py-2 text-xs font-semibold">Technical file error codes</summary><ul className="mt-2 text-xs">{failures.map((failure, index) => <li key={index}>{failure.filename} · {failure.code}</li>)}</ul></details>
        </details>}
      </div>
    </Panel>
    {dataset && profile && <>
      <ProfileView dataset={dataset} profile={profile} />
      <MappingEditor mapping={mapping} profile={profile} options={options} errors={errors} reviewed={reviewed} checked={Boolean(result)} disabled={busy} onReviewed={setReviewed}
        onMapping={(index: number, target: CanonicalField | null) => { invalidate(); setMapping(overrideMapping(mapping, index, target)); }}
        onOptions={changed => { invalidate(); setOptions(changed); }} onRun={run} />
      {result && <ResultsView key={dataset.id + ":" + result.context.batchId} result={result} onInspect={inspect} />}
    </>}
    <section aria-label="Combined records and downloads" className="mt-5">
      <h2 className="text-lg font-semibold">6. Combined records and downloads</h2>
      <p className="mt-1 text-sm text-[var(--muted-strong)]">Only current checked results are combined here. This session does not populate other FinGence pages.</p>
      {results.length ? <>
        <ul className="mt-4 space-y-2" aria-label="Checked datasets">{results.map(completed => <li key={completed.dataset.id} className="rounded-lg border border-[var(--border)] bg-white p-3">
          <button type="button" disabled={busy} onClick={() => prepare(completed.dataset.file, completed.dataset.sheet.index)} className="min-h-11 break-words text-left text-sm font-semibold text-[var(--teal-dark)] underline underline-offset-2">
            Review checked dataset: {completed.dataset.file.name} · {completed.dataset.sheet.name ?? "CSV"}
          </button><p className="text-xs text-[var(--muted-strong)]">Checked · {completed.summary.accepted} included ({completed.summary.warning} need attention) · {completed.summary.rejected} cannot include</p>
        </li>)}</ul>
        <QualityView summary={combined.summary} fileErrors={failures.length} />
        <CanonicalView records={combined.normalized} onInspect={inspect} />
        <div className="mt-5 space-y-3 rounded-lg border border-[var(--border)] bg-white p-4" aria-label="Ingestion downloads">
          <h3 className="text-sm font-semibold">Download this session</h3>
          <p className="text-xs text-[var(--muted-strong)]">Included records: {combined.normalized.length} rows, including {combined.summary.warning} needing attention. Excluded-row problems can contain more than one issue per row. The full JSON report includes original evidence and excluded rows; it is a technical check report.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => download(canonicalCSV(combined.normalized), "canonical-transactions.csv", "text/csv;charset=utf-8")} className={buttonStyle}><Download size={16} aria-hidden="true" />Download included records — CSV · {combined.normalized.length} rows</button>
            <button type="button" onClick={() => download(rejectedCSV(combined.rejected), "rejected-issues.csv", "text/csv;charset=utf-8")} className={buttonStyle}><Download size={16} aria-hidden="true" />Download excluded-row problems — CSV</button>
            <button type="button" onClick={() => download(evidenceJSON(results), "ingestion-evidence.json", "application/json")} className={buttonStyle}><Download size={16} aria-hidden="true" />Download full check report — JSON, technical</button>
          </div>
        </div>
      </> : <p className="mt-4 rounded-lg border border-[var(--border)] bg-white p-5 text-sm text-[var(--muted-strong)]">Combined records will appear after you review and check a file. Only current checked results are included.</p>}
    </section>
    {results.length > 0 && <LiveAnalytics results={results} onInspect={inspect} />}
    {inspected && <RecordInspector row={inspected.row} result={inspected.result} onClose={closeInspector} />}
  </>;
}
