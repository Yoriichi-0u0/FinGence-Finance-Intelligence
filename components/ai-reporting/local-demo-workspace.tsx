"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FileBarChart2, FileSpreadsheet, LoaderCircle, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { MappingEditor } from "@/components/ingestion/mapping-editor";
import { ProfileView } from "@/components/ingestion/profile-view";
import { PageHeader, Panel, StatusBadge } from "@/components/ui";
import { analyzeAcceptedDataPayload } from "@/lib/analytics/accepted-data-adapter";
import type { WarningPolicy } from "@/lib/analytics";
import {
  createFinancialExplanationRequest, createLocalManagementReport, createQuarterlyFinancialActivityReport,
  discoverReportBusinesses, formatReportPeriod, listAvailableQuarterPeriods, previousQuarter,
  renderLocalManagementReportHtml, type LocalManagementReport, type LocalReportType,
  type ValidatedFinancialExplanation,
} from "@/lib/ai-reporting";
import {
  LOCAL_REPORT_RETENTION_DAYS, createIndexedDbReportRepository, isRegisteredSyntheticReport,
  isRegisteredSyntheticReportHash, type LocalReportRepository, type SavedLocalReport,
} from "@/lib/ai-reporting/local-report-repository";
import {
  DEFAULT_OPTIONS, IngestionError, READER_LIMITS, approveMapping, createAcceptedDataPayload, createDataset,
  ingestDatasetRun, inspectFile, mappingErrors, overrideMapping, profileDataset, suggestMapping,
  type CanonicalField, type ColumnMapping, type Dataset, type IngestionOptions, type IngestionResult,
  type LoadedFile,
} from "@/lib/ingestion";
import { AiExplanationPanel } from "./ai-explanation-panel";
import { ManagementReportPreview } from "./management-report-preview";
import { SavedReportsLibrary } from "./saved-reports-library";

const SAMPLE_URL = "/samples/ingestion/ledger.csv";
const SAMPLE_NAME = "ledger.csv";
const inputStyle = "mt-1 min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

interface ProviderStatus { provider: "GROQ" | null; model: string | null; ready: boolean; message: string }

function replaceSaved(reports: readonly SavedLocalReport[], next: SavedLocalReport) {
  return [next, ...reports.filter(item => item.reportId !== next.reportId)]
    .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

function suggestedOptions(mapping: readonly ColumnMapping[], sourceSystem: string): IngestionOptions {
  const targets = new Set(mapping.map(item => item.target));
  const monetaryMode = targets.has("debit") && targets.has("credit")
    ? "debit_credit" : targets.has("entry_side") ? "amount_direction" : "signed_amount";
  return {
    ...DEFAULT_OPTIONS,
    sourceSystem,
    monetaryMode,
    dateBasis: targets.has("transaction_date") ? "transaction_date" : "posting_date",
  };
}

function safeMessage(value: unknown, fallback: string) {
  if (value instanceof IngestionError || value instanceof Error) return value.message;
  return fallback;
}

function downloadReport(report: LocalManagementReport, explanation: ValidatedFinancialExplanation | null) {
  const url = URL.createObjectURL(new Blob([renderLocalManagementReportHtml(report, explanation)], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  const source = report.dataset.sourceFile.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-") || "financial";
  const suffix = report.quarterlyActivity ? `-${report.quarterlyActivity.current.period.key}` : "-management-review";
  anchor.href = url;
  anchor.download = `fingence-${source}${suffix}.html`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function LocalAiReportingWorkspace() {
  const fileInput = useRef<HTMLInputElement>(null);
  const repository = useRef<LocalReportRepository | null>(null);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [sheetIndex, setSheetIndex] = useState<number | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [options, setOptions] = useState<IngestionOptions>({ ...DEFAULT_OPTIONS });
  const [reviewed, setReviewed] = useState(false);
  const [result, setResult] = useState<IngestionResult | null>(null);
  const [warningPolicy, setWarningPolicy] = useState<WarningPolicy>("include");
  const [reportType, setReportType] = useState<LocalReportType>("TRANSACTION_REVIEW");
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [reviewedBusinessNames, setReviewedBusinessNames] = useState<Record<string, string>>({});
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("");
  const [comparisonPeriodKey, setComparisonPeriodKey] = useState("");
  const [report, setReport] = useState<LocalManagementReport | null>(null);
  const [explanation, setExplanation] = useState<ValidatedFinancialExplanation | null>(null);
  const [savedReports, setSavedReports] = useState<readonly SavedLocalReport[]>([]);
  const [storageState, setStorageState] = useState<"LOADING" | "READY" | "UNAVAILABLE">("LOADING");
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState<"SOURCE" | "REPORT" | "AI" | "DELETE" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const localRepository = createIndexedDbReportRepository();
    repository.current = localRepository;
    void localRepository.listReports().then(value => {
      if (!active) return;
      setSavedReports(value.reports);
      setStorageState("READY");
      if (value.issues.length) setNotice(`${value.issues.length} incompatible or expired local report snapshot(s) were discarded safely.`);
    }).catch(() => { if (active) setStorageState("UNAVAILABLE"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ai-reporting/explain", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("unavailable");
      setProvider(await response.json() as ProviderStatus);
    }).catch(value => {
      if ((value as { name?: string }).name !== "AbortError") {
        setProvider({ provider: null, model: null, ready: false, message: "Optional AI explanation is not configured. Deterministic reporting remains available." });
      }
    });
    return () => controller.abort();
  }, []);

  const profile = useMemo(() => dataset ? profileDataset(dataset) : null, [dataset]);
  const mappingProblems = useMemo(() => dataset ? mappingErrors(dataset, approveMapping(mapping), options) : [], [dataset, mapping, options]);
  const prepared = useMemo(() => {
    if (!result) return null;
    try {
      const payload = createAcceptedDataPayload([result]);
      const analysis = analyzeAcceptedDataPayload(payload, warningPolicy);
      const accepted = payload.datasets[0];
      const dates = accepted.normalized.map(row => row.canonical_date).sort();
      return {
        payload, analysis, dataset: accepted, businesses: discoverReportBusinesses(payload),
        period: dates.length ? formatReportPeriod(dates[0], dates[dates.length - 1]) : "Unavailable", error: null,
      };
    } catch {
      return { payload: null, analysis: null, dataset: null, businesses: null, period: "Unavailable", error: "The checked dataset is not compatible with the current accepted-data and analytics contracts." };
    }
  }, [result, warningPolicy]);

  const businessOptions = prepared?.businesses?.options ?? [];
  const activeBusiness = businessOptions.find(item => item.businessId === selectedBusinessId) ?? businessOptions[0] ?? null;
  const availablePeriods = prepared?.payload && activeBusiness ? listAvailableQuarterPeriods(prepared.payload, activeBusiness.businessId) : [];
  const currentPeriod = availablePeriods.find(item => item.key === selectedPeriodKey) ?? availablePeriods[0] ?? null;
  const defaultComparison = currentPeriod ? availablePeriods.find(item => item.key === previousQuarter(currentPeriod).key) ?? null : null;
  const comparisonPeriod = comparisonPeriodKey === "NONE" ? null : availablePeriods.find(item => item.key === comparisonPeriodKey) ?? defaultComparison;
  const businessDisplayName = activeBusiness
    ? activeBusiness.nameBasis === "REGISTERED_SYNTHETIC" ? activeBusiness.displayName : reviewedBusinessNames[activeBusiness.businessId]?.trim() ?? ""
    : "";
  const quarterlyError = reportType !== "QUARTERLY_FINANCIAL_ACTIVITY" ? null
    : !prepared?.businesses?.reliable ? prepared?.businesses?.limitation ?? "Company-specific reporting is unavailable for this dataset."
      : prepared.dataset && prepared.dataset.summary.rejected > 0 ? "Quarterly reports are unavailable because rejected rows cannot be safely attributed to a business. Use Financial Transaction Review instead."
        : prepared.dataset && prepared.dataset.summary.duplicateRows > 0 ? "Quarterly reports are unavailable because duplicate-row counts cannot be safely attributed to a business. Use Financial Transaction Review instead."
          : !activeBusiness ? "No verified business identifier is available."
            : !businessDisplayName ? "Enter and review the business display name before generating this company report."
              : !currentPeriod ? "No supported calendar quarter is available for this business." : null;

  function clearGeneratedReport() { setReport(null); setExplanation(null); }

  function prepareDataset(nextFile: LoadedFile, nextSheet: number, nextHeader = 1): boolean {
    try {
      const nextDataset = createDataset(nextFile, nextSheet, nextHeader);
      const nextMapping = suggestMapping(nextDataset);
      setSheetIndex(nextSheet); setHeaderRow(nextHeader); setDataset(nextDataset); setMapping(nextMapping);
      setOptions(suggestedOptions(nextMapping, nextFile.name === SAMPLE_NAME ? "Ledger" : "AI Reporting Upload"));
      setReviewed(false); setResult(null); setSelectedBusinessId(""); setSelectedPeriodKey(""); setComparisonPeriodKey(""); clearGeneratedReport();
      setError("");
      return true;
    } catch (value) {
      setDataset(null); setResult(null); clearGeneratedReport();
      setError(safeMessage(value, "The selected worksheet or header row could not be prepared."));
      return false;
    }
  }

  async function loadSource(read: () => Promise<Uint8Array>, name: string) {
    setBusy("SOURCE"); setError(""); setNotice("");
    try {
      const nextFile = await inspectFile(await read(), { name });
      setFile(nextFile); setDataset(null); setResult(null); clearGeneratedReport();
      if (nextFile.sheets.length === 1) {
        if (prepareDataset(nextFile, nextFile.sheets[0].index, 1)) {
          setNotice(`${nextFile.name} is ready for column and financial-convention review.`);
        }
      } else {
        setSheetIndex(null); setNotice("File opened. Choose the worksheet containing the financial records.");
      }
    } catch (value) { setError(safeMessage(value, "The financial file could not be opened.")); }
    finally { setBusy(null); }
  }

  function invalidateCheckedResult() { setResult(null); setReviewed(false); clearGeneratedReport(); }

  function runChecks() {
    if (!dataset || !reviewed || mappingProblems.length) return;
    setError("");
    try {
      const approved = approveMapping(mapping);
      const completed = ingestDatasetRun(dataset, approved, options);
      setMapping(approved); setResult(completed); clearGeneratedReport();
      setNotice(`Checks complete: ${completed.summary.accepted} accepted, ${completed.summary.warning} requiring attention, and ${completed.summary.rejected} rejected.`);
    } catch (value) { setError(safeMessage(value, "The source checks could not be completed.")); }
  }

  async function generateReport() {
    if (!prepared?.payload || !prepared.analysis || quarterlyError) return;
    setBusy("REPORT"); setError(""); setNotice(""); setExplanation(null);
    try {
      const nextReport = reportType === "QUARTERLY_FINANCIAL_ACTIVITY"
        ? await createQuarterlyFinancialActivityReport({
            payload: prepared.payload, warningPolicy, supplementaryWorkbook: file ?? undefined,
            selection: { businessId: activeBusiness!.businessId, businessDisplayName, currentPeriod: currentPeriod!, comparisonPeriod },
          })
        : await createLocalManagementReport({ payload: prepared.payload, analysis: prepared.analysis, warningPolicy, organizationName: businessDisplayName || "Finance Workspace" });
      setReport(nextReport);
      if (repository.current && isRegisteredSyntheticReport(nextReport)) {
        try {
          const saved = await repository.current.saveReport(nextReport);
          setSavedReports(current => replaceSaved(current, saved));
          setNotice(`Draft generated and saved locally for ${LOCAL_REPORT_RETENTION_DAYS} days.`);
        } catch {
          setStorageState("UNAVAILABLE"); setNotice("Draft generated for this session; browser storage was unavailable.");
        }
      } else setNotice("Draft generated for this session. Uploaded files are never retained in the local saved-report library.");
    } catch (value) { setError(safeMessage(value, "The report could not be generated safely.")); }
    finally { setBusy(null); }
  }

  async function explainReport() {
    if (!report || !provider?.ready || !isRegisteredSyntheticReport(report)) return;
    setBusy("AI"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai-reporting/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createFinancialExplanationRequest(report)) });
      const value = await response.json() as { explanation?: ValidatedFinancialExplanation; error?: { message?: string } };
      if (!response.ok || !value.explanation) throw new Error(value.error?.message ?? "The AI explanation was withheld.");
      setExplanation(value.explanation);
      if (repository.current) {
        try {
          const updated = await repository.current.saveExplanation(report.reportId, value.explanation);
          setSavedReports(current => replaceSaved(current, updated)); setNotice("AI explanation attached to the saved synthetic report snapshot.");
        } catch { setNotice("The explanation is visible for this session but could not be saved locally."); }
      }
    } catch (value) { setError(safeMessage(value, "The AI explanation failed safely.")); }
    finally { setBusy(null); }
  }

  function openSaved(entry: SavedLocalReport) { setReport(entry.report); setExplanation(entry.aiExplanation); setError(""); setNotice("Saved synthetic report reopened from this browser."); }
  async function deleteSaved(entry: SavedLocalReport) {
    if (!repository.current || !window.confirm("Delete this local synthetic report snapshot?")) return;
    setBusy("DELETE");
    try {
      await repository.current.deleteReport(entry.reportId);
      setSavedReports(current => current.filter(item => item.reportId !== entry.reportId));
      if (report?.reportId === entry.reportId) clearGeneratedReport();
      setNotice("Saved report deleted from this browser.");
    } catch { setError("The saved report could not be deleted. Browser storage may be unavailable."); }
    finally { setBusy(null); }
  }

  const selectedSourceRegistered = Boolean(prepared?.dataset && isRegisteredSyntheticReportHash(prepared.dataset.file_sha256));

  return <>
    <PageHeader title="AI Reporting laboratory" description="Prepare checked financial data, generate grounded management or quarterly drafts, save registered synthetic snapshots, and optionally request a controlled AI explanation." />
    <div className="space-y-5">
      <div className="rounded-xl border border-teal-200 bg-[var(--teal-soft)] p-4 text-sm leading-6 text-[var(--teal-dark)]"><div className="flex items-start gap-3"><ShieldCheck aria-hidden="true" className="mt-1 shrink-0" size={18} /><p>This local workflow uses the current ingestion, C1, analytics, shared AI gateway, and reporting contracts without replacing the team&apos;s Data or Reports pages. Uploaded files stay in this browser session; only registered synthetic report snapshots may enter IndexedDB.</p></div></div>

      <Panel title="1. Add financial data" eyebrow="Local browser session"><div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap gap-3">
          <button data-testid="load-reporting-sample" type="button" disabled={busy !== null} onClick={() => void loadSource(async () => {
            const response = await fetch(SAMPLE_URL, { cache: "no-store" });
            if (!response.ok) throw new Error("The registered synthetic sample could not be loaded.");
            return new Uint8Array(await response.arrayBuffer());
          }, SAMPLE_NAME)} className={`${button} bg-[var(--teal)] text-white hover:bg-[var(--teal-dark)]`}>
            {busy === "SOURCE" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <FileSpreadsheet aria-hidden="true" size={16} />}Use existing synthetic ledger
          </button>
          <button type="button" disabled={busy !== null} onClick={() => fileInput.current?.click()} className={`${button} border border-[var(--border-strong)] bg-[var(--surface)]`}><Upload aria-hidden="true" size={16} />Upload CSV or XLSX</button>
          <input ref={fileInput} className="hidden" type="file" accept=".csv,.xlsx" aria-label="Upload financial CSV or XLSX file" onChange={event => {
            const selected = event.target.files?.[0]; event.target.value = ""; if (!selected) return;
            void loadSource(async () => { if (selected.size > READER_LIMITS.fileBytes) throw new IngestionError("FILE_LIMIT", "The file exceeds the 10 MiB input limit."); return new Uint8Array(await selected.arrayBuffer()); }, selected.name);
          }} />
        </div>
        <p className="text-xs leading-5 text-[var(--muted-strong)]">CSV or values-only XLSX, up to 10 MiB. The included sample is fictional. Uploads can generate session-only reports but cannot be saved or sent to the AI explanation route.</p>
        {file && <div className="grid gap-4 rounded-lg border border-[var(--border)] p-4 sm:grid-cols-2">
          <div><p className="text-xs text-[var(--muted)]">Current file</p><p className="mt-1 break-words text-sm font-semibold">{file.name}</p></div>
          {file.sheets.length > 1 && <label className="text-xs font-semibold">Worksheet<select className={inputStyle} value={sheetIndex ?? ""} onChange={event => { if (event.target.value !== "") prepareDataset(file, Number(event.target.value), 1); }}><option value="">Choose a worksheet</option>{file.sheets.map(sheet => <option key={sheet.index} value={sheet.index}>{sheet.name ?? `Worksheet ${sheet.index + 1}`}</option>)}</select></label>}
          {dataset && <label className="text-xs font-semibold">Header row<input type="number" min={1} max={10_001} className={inputStyle} value={headerRow} onChange={event => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1) prepareDataset(file, dataset.sheet.index, next); }} /></label>}
        </div>}
        {notice && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm">{notice}</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </div></Panel>

      {dataset && profile && <><ProfileView dataset={dataset} profile={profile} /><MappingEditor mapping={mapping} profile={profile} options={options} errors={mappingProblems} reviewed={reviewed} checked={Boolean(result)} disabled={busy !== null}
        onMapping={(index: number, target: CanonicalField | null) => { invalidateCheckedResult(); setMapping(current => overrideMapping(current, index, target)); }}
        onOptions={next => { invalidateCheckedResult(); setOptions(next); }} onReviewed={setReviewed} onRun={runChecks} /></>}

      <Panel title="5. Generate grounded report" eyebrow={result ? "Checked data available" : "Complete steps 1–4 first"}><div className="space-y-5 p-4 sm:p-5">
        {!result || !prepared ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center"><FileBarChart2 aria-hidden="true" className="mx-auto text-slate-400" size={30} /><p className="mt-3 text-sm font-semibold">No checked dataset is available</p><p className="mt-1 text-xs text-[var(--muted)]">Load a source, review the mappings and financial conventions, then run the checks.</p></div> : <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold">Report type<select data-testid="report-type-select" className={inputStyle} value={reportType} onChange={event => { clearGeneratedReport(); setReportType(event.target.value as LocalReportType); }}><option value="QUARTERLY_FINANCIAL_ACTIVITY">Quarterly Financial Activity Report</option><option value="TRANSACTION_REVIEW">Financial Transaction Review</option></select></label>
            <label className="text-xs font-semibold">Warning records<select data-testid="report-warning-policy" className={inputStyle} value={warningPolicy} onChange={event => { clearGeneratedReport(); setWarningPolicy(event.target.value as WarningPolicy); }}><option value="include">Include with visible caveats</option><option value="exclude">Exclude from report figures</option></select></label>
          </div>
          {reportType === "QUARTERLY_FINANCIAL_ACTIVITY" && <div className="rounded-xl border border-[var(--border)] bg-slate-50/70 p-4"><div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold">Business<select data-testid="report-business-select" className={inputStyle} value={activeBusiness?.businessId ?? ""} disabled={!businessOptions.length} onChange={event => { clearGeneratedReport(); setSelectedBusinessId(event.target.value); setSelectedPeriodKey(""); setComparisonPeriodKey(""); }}><option value="">{businessOptions.length ? "Choose a business" : "No verified business identifiers"}</option>{businessOptions.map(item => <option key={item.businessId} value={item.businessId}>{item.displayName} · {item.businessId} · {item.recordCount} records</option>)}</select></label>
            {activeBusiness?.nameBasis === "REGISTERED_SYNTHETIC" ? <label className="text-xs font-semibold">Verified synthetic display name<input className={`${inputStyle} bg-slate-100`} readOnly value={activeBusiness.displayName} /></label> : <label className="text-xs font-semibold">Reviewed business display name<input data-testid="report-business-name" className={inputStyle} value={activeBusiness ? reviewedBusinessNames[activeBusiness.businessId] ?? "" : ""} placeholder="Confirm the company name" onChange={event => { if (!activeBusiness) return; clearGeneratedReport(); setReviewedBusinessNames(current => ({ ...current, [activeBusiness.businessId]: event.target.value })); }} /></label>}
            <label className="text-xs font-semibold">Reporting quarter<select data-testid="report-quarter-select" className={inputStyle} value={currentPeriod?.key ?? ""} disabled={!availablePeriods.length} onChange={event => { clearGeneratedReport(); setSelectedPeriodKey(event.target.value); setComparisonPeriodKey(""); }}><option value="">{availablePeriods.length ? "Choose a quarter" : "No supported quarter"}</option>{availablePeriods.map(item => <option key={item.key} value={item.key}>{item.label} · {formatReportPeriod(item.startDate, item.endDate)}</option>)}</select></label>
            <label className="text-xs font-semibold">Comparison period<select data-testid="report-comparison-select" className={inputStyle} value={comparisonPeriod?.key ?? "NONE"} disabled={!currentPeriod} onChange={event => { clearGeneratedReport(); setComparisonPeriodKey(event.target.value); }}><option value="NONE">No comparison</option>{availablePeriods.filter(item => item.key !== currentPeriod?.key).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          </div>{quarterlyError && <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{quarterlyError}</p>}</div>}
          <dl className="grid gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] sm:grid-cols-5">{[["Source", prepared.dataset?.source_file ?? "Unavailable"], ["Period", prepared.period], ["Accepted", String(result.summary.accepted)], ["Attention", String(result.summary.warning)], ["Rejected", String(result.summary.rejected)]].map(([label, value]) => <div key={label} className="bg-[var(--surface)] p-3"><dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</dt><dd className="mt-1 break-words text-xs font-semibold">{value}</dd></div>)}</dl>
          <div className={`rounded-lg border p-3 text-xs leading-5 ${selectedSourceRegistered ? "border-teal-200 bg-[var(--teal-soft)] text-[var(--teal-dark)]" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{selectedSourceRegistered ? `Registered synthetic source: generated drafts may be saved locally for ${LOCAL_REPORT_RETENTION_DAYS} days.` : "Uploaded source: generated drafts remain in this browser session only and cannot be sent to the AI explanation route."}</div>
          {prepared.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{prepared.error}</p>}
          <button data-testid="generate-draft-report" type="button" onClick={() => void generateReport()} disabled={busy !== null || Boolean(prepared.error) || Boolean(quarterlyError)} className={`${button} bg-[var(--teal)] text-white hover:bg-[var(--teal-dark)]`}>{busy === "REPORT" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <FileBarChart2 aria-hidden="true" size={16} />}{busy === "REPORT" ? "Generating…" : selectedSourceRegistered ? "Generate and save draft" : "Generate session draft"}</button>
        </>}
      </div></Panel>

      <Panel title="Optional AI explanation" eyebrow="Shared gateway only"><div className="space-y-3 p-4 text-sm sm:p-5"><div className="flex items-start gap-3"><Sparkles aria-hidden="true" className="mt-1 shrink-0 text-violet-700" size={17} /><div><p>{provider?.message ?? "Checking the shared AI gateway…"}</p>{provider?.provider && <p className="mt-1 text-xs text-[var(--muted)]">Provider: {provider.provider} · Model: {provider.model ?? "Unavailable"}</p>}</div></div><p className="text-xs leading-5 text-[var(--muted-strong)]">The deterministic report works without AI. Model dispatch is available only for registered synthetic reports and requires the separate local authorization, free-tier confirmation, shared budget, and provider key.</p></div></Panel>

      <SavedReportsLibrary reports={savedReports} activeReportId={report?.reportId ?? null} storageState={storageState} onView={openSaved} onDownload={entry => downloadReport(entry.report, entry.aiExplanation)} onRequestDelete={entry => void deleteSaved(entry)} />

      {report && <section aria-label="Generated report preview" className="space-y-4"><div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold">Report preview</h2><StatusBadge status="Draft" /></div><p className="mt-1 text-xs text-[var(--muted)]">{report.dataset.sourceFile} · {formatReportPeriod(report.reportingPeriod.startDate, report.reportingPeriod.endDate)}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => downloadReport(report, explanation)} className={`${button} border border-[var(--border-strong)] bg-[var(--surface)]`}><Download aria-hidden="true" size={16} />Download HTML</button><button data-testid="explain-with-ai" type="button" onClick={() => void explainReport()} disabled={busy !== null || !provider?.ready || !isRegisteredSyntheticReport(report)} className={`${button} bg-violet-700 text-white hover:bg-violet-800`}>{busy === "AI" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Sparkles aria-hidden="true" size={16} />}{busy === "AI" ? "Explaining…" : explanation ? "Regenerate AI explanation" : "Explain with AI"}</button></div></div>
        {!isRegisteredSyntheticReport(report) && <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={15} />AI explanation is disabled for uploaded data. No uploaded source values are sent to a model.</p>}<ManagementReportPreview report={report} /></section>}
      {explanation && <AiExplanationPanel explanation={explanation} />}
    </div>
  </>;
}
