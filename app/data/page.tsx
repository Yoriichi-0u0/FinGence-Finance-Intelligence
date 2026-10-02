"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle, RotateCcw, Upload } from "lucide-react";
import { PageHeader, Panel } from "@/components/ui";
import { ProfileView } from "@/components/ingestion/profile-view";
import { MappingEditor } from "@/components/ingestion/mapping-editor";
import { CanonicalView, QualityView, RecordInspector, ResultsView } from "@/components/ingestion/results-view";
import {
  DEFAULT_OPTIONS, IngestionError, READER_LIMITS, approveMapping, canonicalCSV, consolidate,
  createDataset, evidenceJSON, ingestDataset, inspectFile, isDuplicateFile, mappingErrors,
  overrideMapping, profileDataset, rejectedCSV, suggestMapping,
  type CanonicalField, type ColumnMapping, type Dataset, type IngestionOptions, type IngestionResult, type LoadedFile, type ProcessedRow,
} from "@/lib/ingestion";

const buttonStyle = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const inputStyle = "mt-1 min-h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm";
type FileFailure = { filename: string; code: string; message: string };
const samples = [
  ["Load ledger CSV", "ledger.csv"],
  ["Load bank XLSX", "bank_statement.xlsx"],
  ["Load edge cases", "edge_cases.csv"],
] as const;

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
  const [notice, setNotice] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inspected, setInspected] = useState<{ row: ProcessedRow; result: IngestionResult } | null>(null);
  const working = useRef(false);
  const batchId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const combined = useMemo(() => consolidate(results), [results]);
  const profile = useMemo(() => dataset ? profileDataset(dataset) : null, [dataset]);
  const result = dataset ? results.find(r => r.dataset.id === dataset.id && r.dataset.headerRow === dataset.headerRow) : undefined;
  const errors = dataset ? mappingErrors(dataset, approveMapping(mapping), options) : [];

  function prepare(file: LoadedFile, index: number | null, row?: number, reuse = true) {
    row ??= reuse ? results.find(r => r.dataset.id === file.fingerprint + ":" + index)?.dataset.headerRow ?? 1 : 1;
    setActive(file); setSheetIndex(index); setHeaderRow(row); setInspected(null); setReviewed(false); setSelectionError("");
    setDataset(null); setMapping([]);
    if (index === null) return;
    try {
      const selected = createDataset(file, index, row);
      const previous = reuse ? results.find(r => r.dataset.id === selected.id && r.dataset.headerRow === row) : undefined;
      const proposed = previous?.mapping.map(m => ({ ...m })) ?? suggestMapping(selected);
      setDataset(selected); setMapping(proposed);
      if (previous) { setOptions({ ...previous.options }); setReviewed(true); }
      else {
        const targets = new Set(proposed.map(m => m.target));
        const monetaryMode = targets.has("debit") && targets.has("credit") ? "debit_credit" : targets.has("entry_side") ? "amount_direction" : "signed_amount";
        setOptions({ ...DEFAULT_OPTIONS, monetaryMode,
          sourceSystem: monetaryMode === "debit_credit" ? "Ledger" : monetaryMode === "amount_direction" ? "Bank Statement" : "Other",
          dateBasis: targets.has("posting_date") && !targets.has("transaction_date") ? "posting_date" : "transaction_date",
        });
      }
    } catch (error) { setSelectionError(safeError(error).message); }
  }
  function invalidate() {
    if (dataset) setResults(current => current.filter(r => r.dataset.id !== dataset.id));
    setReviewed(false); setInspected(null); setNotice("");
  }
  async function load(read: () => Promise<Uint8Array>, filename: string) {
    if (working.current) return;
    working.current = true; setBusy(true); setNotice("");
    try {
      const file = await inspectFile(await read(), { name: filename, delimiter: delimiter === "auto" ? undefined : delimiter });
      if (isDuplicateFile(file, files)) {
        const previous = files.find(f => f.fingerprint === file.fingerprint)!;
        if (file.type === "CSV" && file.delimiter !== previous.delimiter) {
          setFiles(current => current.map(f => f.fingerprint === file.fingerprint ? file : f));
          setResults(current => current.filter(r => r.dataset.file.fingerprint !== file.fingerprint));
          prepare(file, 0, 1, false);
          setNotice("Same CSV re-read with a different delimiter. Previous output was invalidated; review the updated mapping.");
        } else {
          setNotice("This file appears to have already been ingested or loaded. No duplicate rows were added; reuse the existing file.");
          prepare(previous, previous.sheets.length === 1 ? 0 : null);
        }
      } else {
        setFiles(current => [...current, file]);
        prepare(file, file.sheets.length === 1 ? 0 : null);
        setNotice(file.sheets.length > 1 ? "File inspected. Choose a worksheet to profile; no worksheet has been ingested automatically." : "File inspected. Review the profile and mapping before validation.");
      }
    } catch (error) {
      const failure = safeError(error);
      setFailures(current => [...current, { filename: filename.split(/[\\/]/).pop() ?? "file", ...failure }]);
      setNotice(failure.message);
    } finally { working.current = false; setBusy(false); }
  }
  async function loadSample(filename: string) {
    await load(async () => {
      const response = await fetch("/samples/ingestion/" + filename);
      if (!response.ok) throw new IngestionError("SAMPLE_UNAVAILABLE", "Synthetic sample is unavailable.");
      return new Uint8Array(await response.arrayBuffer());
    }, filename);
  }
  function run() {
    if (!dataset || !reviewed) return;
    try {
      const approved = approveMapping(mapping);
      batchId.current ??= crypto.randomUUID();
      const completed = ingestDataset(dataset, approved, options, { batchId: batchId.current, ingestedAt: new Date().toISOString() });
      setMapping(approved);
      setResults(current => [...current.filter(r => r.dataset.id !== dataset.id), completed]);
      setNotice("Validation complete: " + completed.summary.valid + " valid, " + completed.summary.warning + " warning, " + completed.summary.rejected + " rejected. Source evidence is retained.");
    } catch (error) { setNotice(safeError(error).message); }
  }
  function inspect(id: string) {
    for (const completed of results) {
      const row = completed.records.find(r => r.provenance.source_row_id === id);
      if (row) { setInspected({ row, result: completed }); break; }
    }
  }
  function reset() {
    setFiles([]); setActive(null); setDataset(null); setMapping([]); setResults([]); setFailures([]);
    setSheetIndex(null); setHeaderRow(1); setOptions({ ...DEFAULT_OPTIONS }); setReviewed(false);
    setNotice("Session cleared."); setSelectionError(""); setInspected(null); batchId.current = null;
    if (fileInput.current) fileInput.current.value = "";
  }
  return <>
    <PageHeader title="Financial data" description="Data Ingestion PoC v0.1 · inspect, map, validate and consolidate CSV/XLSX sources."
      actions={<button type="button" onClick={reset} disabled={busy} className={buttonStyle}><RotateCcw size={16} aria-hidden="true" />Reset session</button>} />
    <div className="rounded-lg border border-teal-200 bg-[var(--teal-soft)] p-4 text-sm text-[var(--teal-dark)]">
      This page processes files locally in memory. Refresh/reset clears the work; download evidence before leaving. The schema and accounting conventions are provisional. Other pages still use mock prototype data.
    </div>
    <Panel title="Financial sources" className="mt-5" action={<span className="text-xs text-[var(--muted)]">{files.length} files loaded</span>}>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          <label className={buttonStyle + " cursor-pointer"}>
            <Upload size={16} aria-hidden="true" />Upload CSV or XLSX
            <input ref={fileInput} type="file" accept=".csv,.xlsx" disabled={busy} className="sr-only" onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void load(async () => {
                if (file.size > READER_LIMITS.fileBytes) throw new IngestionError("FILE_LIMIT", "The file exceeds the 10 MiB input limit.");
                return new Uint8Array(await file.arrayBuffer());
              }, file.name);
            }} />
          </label>
          {samples.map(([label, filename]) => <button key={filename} type="button" disabled={busy} onClick={() => void loadSample(filename)} className={buttonStyle}><FileSpreadsheet size={16} aria-hidden="true" />{label}</button>)}
        </div>
        <p className="text-xs text-[var(--muted)]">Synthetic samples only. Limits: 10 MiB input, 50 MiB expanded workbook, 10,000 data rows, 100 columns. Use values-only XLSX exports. To change a CSV delimiter, select it below and upload/load the same file again.</p>
        {busy && <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />Reading and inspecting content…</p>}
        {notice && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm">{notice}</p>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-semibold">Loaded file
            <select className={inputStyle} value={active?.fingerprint ?? ""} disabled={busy || !files.length} onChange={event => {
              const file = files.find(f => f.fingerprint === event.target.value);
              if (file) { prepare(file, file.sheets.length === 1 ? 0 : null); setNotice(""); }
            }}><option value="">Choose a file</option>{files.map(file => <option key={file.fingerprint} value={file.fingerprint}>{file.name}</option>)}</select>
          </label>
          <label className="text-xs font-semibold">Worksheet
            <select className={inputStyle} disabled={!active || busy} value={sheetIndex ?? ""} onChange={event => {
              if (active) prepare(active, event.target.value === "" ? null : Number(event.target.value));
            }}><option value="">Choose a worksheet</option>{active?.sheets.map(sheet => <option key={sheet.index} value={sheet.index}>{sheet.name ?? "CSV · single dataset"}</option>)}</select>
          </label>
          <label className="text-xs font-semibold">Header source row
            <input type="number" min={1} max={10001} value={headerRow} disabled={!active || sheetIndex === null || busy} className={inputStyle} onChange={event => {
              const row = Number(event.target.value);
              if (active && sheetIndex !== null) {
                setResults(current => current.filter(r => r.dataset.id !== active.fingerprint + ":" + sheetIndex));
                prepare(active, sheetIndex, row, false);
              }
            }} />
          </label>
          <label className="text-xs font-semibold">CSV delimiter · for next read
            <select className={inputStyle} value={delimiter} disabled={busy} onChange={event => setDelimiter(event.target.value as typeof delimiter)}>
              <option value="auto">Auto · comma / semicolon / tab</option><option value=",">Comma</option><option value=";">Semicolon</option><option value={"\t"}>Tab</option>
            </select>
          </label>
        </div>
        {selectionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{selectionError}</p>}
        {failures.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold text-red-800">File error attempts · {failures.length}</summary><ul className="mt-2 space-y-2 text-xs">{failures.map((failure, index) => <li key={index} className="rounded border border-red-200 p-3"><strong>{failure.filename}</strong> · {failure.message} <span className="text-[var(--muted)]">({failure.code})</span></li>)}</ul></details>}
      </div>
    </Panel>
    <QualityView summary={combined.summary} fileErrors={failures.length} />
    {dataset && profile && <>
      <ProfileView dataset={dataset} profile={profile} />
      <MappingEditor mapping={mapping} options={options} errors={errors} reviewed={reviewed} onReviewed={setReviewed}
        onMapping={(index: number, target: CanonicalField | null) => { invalidate(); setMapping(overrideMapping(mapping, index, target)); }}
        onOptions={changed => { invalidate(); setOptions(changed); }}
        onRun={run} />
      {result && <ResultsView key={dataset.id} result={result} onInspect={inspect} />}
    </>}
    <CanonicalView records={combined.normalized} onInspect={inspect} />
    {results.length > 0 && <div className="mt-5 flex flex-wrap gap-2" aria-label="Ingestion downloads">
      <button type="button" onClick={() => download(canonicalCSV(combined.normalized), "canonical-transactions.csv", "text/csv;charset=utf-8")} className={buttonStyle}><Download size={16} aria-hidden="true" />Canonical CSV · {combined.normalized.length} rows</button>
      <button type="button" onClick={() => download(rejectedCSV(combined.rejected), "rejected-issues.csv", "text/csv;charset=utf-8")} className={buttonStyle}><Download size={16} aria-hidden="true" />Rejected issues CSV</button>
      <button type="button" onClick={() => download(evidenceJSON(results), "ingestion-evidence.json", "application/json")} className={buttonStyle}><Download size={16} aria-hidden="true" />JSON evidence bundle</button>
    </div>}
    {inspected && <RecordInspector row={inspected.row} result={inspected.result} onClose={() => setInspected(null)} />}
  </>;
}
