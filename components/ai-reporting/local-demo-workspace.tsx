"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileBarChart2, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { PageHeader, Panel, StatusBadge } from "@/components/ui";
import { analyzeAcceptedDataPayload } from "@/lib/analytics/accepted-data-adapter";
import type { WarningPolicy } from "@/lib/analytics";
import {
  createFinancialExplanationRequest,
  createLocalManagementReport,
  renderLocalManagementReportHtml,
  type LocalManagementReport,
  type ValidatedFinancialExplanation,
} from "@/lib/ai-reporting";
import {
  createIndexedDbReportRepository,
  type LocalReportRepository,
  type SavedLocalReport,
} from "@/lib/ai-reporting/local-report-repository";
import {
  DEFAULT_OPTIONS,
  approveMapping,
  createAcceptedDataPayload,
  createDataset,
  ingestDatasetRun,
  inspectFile,
  mappingErrors,
  suggestMapping,
} from "@/lib/ingestion";
import { AiExplanationPanel } from "./ai-explanation-panel";
import { ManagementReportPreview } from "./management-report-preview";
import { SavedReportsLibrary } from "./saved-reports-library";

const SAMPLE_URL = "/samples/ai-reporting/realistic_company_ledger.csv";
const SAMPLE_NAME = "realistic_company_ledger.csv";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

interface ProviderStatus {
  provider: "GROQ" | null;
  model: string | null;
  ready: boolean;
  message: string;
}

function replaceSaved(reports: readonly SavedLocalReport[], next: SavedLocalReport) {
  return [next, ...reports.filter(item => item.reportId !== next.reportId)]
    .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

function downloadReport(report: LocalManagementReport, explanation: ValidatedFinancialExplanation | null) {
  const url = URL.createObjectURL(new Blob(
    [renderLocalManagementReportHtml(report, explanation)],
    { type: "text/html;charset=utf-8" },
  ));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "fingence-synthetic-management-data-review.html";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function LocalAiReportingWorkspace() {
  const [warningPolicy, setWarningPolicy] = useState<WarningPolicy>("include");
  const [report, setReport] = useState<LocalManagementReport | null>(null);
  const [explanation, setExplanation] = useState<ValidatedFinancialExplanation | null>(null);
  const [savedReports, setSavedReports] = useState<readonly SavedLocalReport[]>([]);
  const [storageState, setStorageState] = useState<"LOADING" | "READY" | "UNAVAILABLE">("LOADING");
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState<"REPORT" | "AI" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const repository = useRef<LocalReportRepository | null>(null);

  useEffect(() => {
    let active = true;
    const localRepository = createIndexedDbReportRepository();
    repository.current = localRepository;
    void localRepository.listReports()
      .then(result => {
        if (!active) return;
        setSavedReports(result.reports);
        setStorageState("READY");
      })
      .catch(() => {
        if (active) setStorageState("UNAVAILABLE");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ai-reporting/explain", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("unavailable");
        const value = await response.json() as ProviderStatus;
        setProvider(value);
      })
      .catch(value => {
        if ((value as { name?: string }).name !== "AbortError") {
          setProvider({ provider: null, model: null, ready: false, message: "AI explanation is unavailable." });
        }
      });
    return () => controller.abort();
  }, []);

  async function generateReport() {
    setBusy("REPORT");
    setError("");
    setNotice("");
    setExplanation(null);
    try {
      const response = await fetch(SAMPLE_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("The registered synthetic sample could not be loaded.");
      const file = await inspectFile(new Uint8Array(await response.arrayBuffer()), { name: SAMPLE_NAME });
      const dataset = createDataset(file, 0);
      const mapping = approveMapping(suggestMapping(dataset));
      const options = {
        ...DEFAULT_OPTIONS,
        sourceSystem: "Synthetic Company Ledger",
        monetaryMode: "debit_credit" as const,
        dateBasis: "transaction_date" as const,
      };
      const errors = mappingErrors(dataset, mapping, options);
      if (errors.length) throw new Error("The registered synthetic sample no longer matches the reviewed ingestion contract.");
      const result = ingestDatasetRun(dataset, mapping, options);
      const payload = createAcceptedDataPayload([result]);
      const nextReport = await createLocalManagementReport({
        payload,
        analysis: analyzeAcceptedDataPayload(payload, warningPolicy),
        warningPolicy,
        organizationName: "Synthetic Example Sdn Bhd",
      });
      setReport(nextReport);
      if (repository.current) {
        try {
          const saved = await repository.current.saveReport(nextReport);
          setSavedReports(current => replaceSaved(current, saved));
          setNotice("Draft generated and saved in this browser for the registered synthetic sample.");
        } catch {
          setStorageState("UNAVAILABLE");
          setNotice("Draft generated for this session; browser storage was unavailable.");
        }
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "The report could not be generated safely.");
    } finally {
      setBusy(null);
    }
  }

  async function explainReport() {
    if (!report || !provider?.ready) return;
    setBusy("AI");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/ai-reporting/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createFinancialExplanationRequest(report)),
      });
      const value = await response.json() as {
        explanation?: ValidatedFinancialExplanation;
        error?: { message?: string };
      };
      if (!response.ok || !value.explanation) {
        throw new Error(value.error?.message ?? "The AI explanation was withheld.");
      }
      setExplanation(value.explanation);
      const saved = savedReports.find(item => item.reportId === report.reportId);
      if (saved && repository.current) {
        try {
          const updated = await repository.current.saveExplanation(saved.reportId, value.explanation);
          setSavedReports(current => replaceSaved(current, updated));
        } catch {
          setNotice("The explanation is visible for this session but could not be saved locally.");
        }
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "The AI explanation failed safely.");
    } finally {
      setBusy(null);
    }
  }

  function openSaved(entry: SavedLocalReport) {
    setReport(entry.report);
    setExplanation(entry.aiExplanation);
    setError("");
    setNotice("Saved synthetic report reopened from this browser.");
  }

  async function deleteSaved(entry: SavedLocalReport) {
    if (!repository.current || !window.confirm("Delete this local synthetic report snapshot?")) return;
    await repository.current.deleteReport(entry.reportId);
    setSavedReports(current => current.filter(item => item.reportId !== entry.reportId));
    if (report?.reportId === entry.reportId) {
      setReport(null);
      setExplanation(null);
    }
  }

  return (
    <>
      <PageHeader
        title="AI Reporting laboratory"
        description="Local registered-synthetic reporting demonstration, isolated from the current Data and Reports workflows."
      />
      <div className="space-y-5">
        <Panel title="Generate a grounded draft" eyebrow="Local synthetic only">
          <div className="space-y-4 p-5">
            <div className="flex items-start gap-3 rounded-lg border border-teal-200 bg-[var(--teal-soft)] p-4 text-sm leading-6">
              <ShieldCheck aria-hidden="true" className="mt-1 shrink-0 text-[var(--teal)]" size={18} />
              <p>This page processes one repository-owned synthetic ledger through the existing C1 and analytics contracts. It does not change the Data page, current Reports page, production persistence, or accounting interpretation.</p>
            </div>
            <label className="block max-w-xs text-sm font-medium">
              Warning policy
              <select
                value={warningPolicy}
                onChange={event => setWarningPolicy(event.target.value as WarningPolicy)}
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3"
              >
                <option value="include">Include accepted warning records</option>
                <option value="exclude">Exclude warning records</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void generateReport()}
                disabled={busy !== null}
                className={`${button} bg-[var(--teal)] text-white hover:bg-[var(--teal-dark)]`}
              >
                {busy === "REPORT" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <FileBarChart2 aria-hidden="true" size={16} />}
                {busy === "REPORT" ? "Generating…" : "Generate synthetic draft"}
              </button>
              <button
                type="button"
                onClick={() => void explainReport()}
                disabled={!report || !provider?.ready || busy !== null}
                className={`${button} bg-violet-700 text-white hover:bg-violet-800`}
              >
                {busy === "AI" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Sparkles aria-hidden="true" size={16} />}
                {busy === "AI" ? "Explaining…" : "Explain with shared AI gateway"}
              </button>
              {report && (
                <button
                  type="button"
                  onClick={() => downloadReport(report, explanation)}
                  className={`${button} border border-[var(--border-strong)] bg-white`}
                >
                  <Download aria-hidden="true" size={16} />Download HTML
                </button>
              )}
            </div>
            <div className="text-xs leading-5 text-[var(--muted-strong)]">
              <p>{provider?.message ?? "Checking the optional shared AI gateway…"}</p>
              {provider?.provider && <p>Provider: {provider.provider} · Model: {provider.model ?? "Unavailable"}</p>}
            </div>
            {notice && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm">{notice}</p>}
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          </div>
        </Panel>

        <SavedReportsLibrary
          reports={savedReports}
          activeReportId={report?.reportId ?? null}
          storageState={storageState}
          onView={openSaved}
          onDownload={entry => downloadReport(entry.report, entry.aiExplanation)}
          onRequestDelete={entry => void deleteSaved(entry)}
        />

        {report && (
          <section aria-label="Generated report preview" className="space-y-3">
            <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">Report preview</h2><StatusBadge status="Draft" /></div>
            <ManagementReportPreview report={report} />
          </section>
        )}
        {explanation && <AiExplanationPanel explanation={explanation} />}
      </div>
    </>
  );
}
