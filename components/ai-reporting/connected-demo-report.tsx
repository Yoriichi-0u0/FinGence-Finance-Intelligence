"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Eye, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { Panel, StatusBadge } from "@/components/ui";
import type { DocumentInput, ProcessingContext } from "@/lib/demo/pipeline";
import {
  createDemoDocumentReport,
  createFinancialExplanationRequest,
  formatReportPeriod,
  renderLocalManagementReportHtml,
  type DemoDocumentReportVerification,
  type LocalManagementReport,
  type ValidatedFinancialExplanation,
} from "@/lib/ai-reporting";
import {
  createIndexedDbReportRepository,
  isRegisteredSyntheticReport,
  type LocalReportRepository,
  type SavedLocalReport,
} from "@/lib/ai-reporting/local-report-repository";
import { AiExplanationPanel } from "./ai-explanation-panel";
import { ManagementReportPreview } from "./management-report-preview";
import { SavedReportsLibrary } from "./saved-reports-library";

const action = "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:w-60";

interface ProviderStatus {
  provider: "GROQ" | null;
  model: string | null;
  ready: boolean;
  message: string;
}

interface ConnectedDemoReportProps {
  context: ProcessingContext;
  inputs: readonly DocumentInput[];
  processedAt: string | null;
  providerProbeEnabled: boolean;
  activeView: "UPLOADED_REPORTS" | "REPORT_LIBRARY";
  onOpenSavedReport: () => void;
  supportingEvidence: ReactNode;
}

function replaceSaved(reports: readonly SavedLocalReport[], next: SavedLocalReport) {
  return [next, ...reports.filter(item => item.reportId !== next.reportId)]
    .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

function mergeSaved(reports: readonly SavedLocalReport[], restored: readonly SavedLocalReport[]) {
  const byReportId = new Map<string, SavedLocalReport>();
  for (const entry of [...reports, ...restored]) {
    const current = byReportId.get(entry.reportId);
    if (!current || Date.parse(entry.updatedAt) >= Date.parse(current.updatedAt)) byReportId.set(entry.reportId, entry);
  }
  return [...byReportId.values()].sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

function safeMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "AI Reporting could not safely use these Data documents.";
}

function downloadReport(report: LocalManagementReport, explanation: ValidatedFinancialExplanation | null) {
  const url = URL.createObjectURL(new Blob(
    [renderLocalManagementReportHtml(report, explanation)],
    { type: "text/html;charset=utf-8" },
  ));
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

export function ConnectedDemoAiReport({
  context,
  inputs,
  processedAt,
  providerProbeEnabled,
  activeView,
  onOpenSavedReport,
  supportingEvidence,
}: ConnectedDemoReportProps) {
  const repository = useRef<LocalReportRepository | null>(null);
  const reportPreview = useRef<HTMLElement | null>(null);
  const explanationSummary = useRef<HTMLDivElement | null>(null);
  const [report, setReport] = useState<LocalManagementReport | null>(null);
  const [verification, setVerification] = useState<DemoDocumentReportVerification | null>(null);
  const [explanation, setExplanation] = useState<ValidatedFinancialExplanation | null>(null);
  const [savedReports, setSavedReports] = useState<readonly SavedLocalReport[]>([]);
  const [storageState, setStorageState] = useState<"LOADING" | "READY" | "UNAVAILABLE">("LOADING");
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState<"REPORT" | "AI" | "DELETE" | null>("REPORT");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const localRepository = createIndexedDbReportRepository();
    repository.current = localRepository;
    void localRepository.listReports().then(value => {
      if (!active) return;
      setSavedReports(current => mergeSaved(current, value.reports));
      setStorageState("READY");
      if (value.issues.length) setNotice(`${value.issues.length} incompatible or expired local report snapshot(s) were discarded safely.`);
    }).catch(() => {
      if (active) setStorageState("UNAVAILABLE");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!providerProbeEnabled) return;
    const controller = new AbortController();
    void fetch("/api/ai-reporting/explain", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("unavailable");
        setProvider(await response.json() as ProviderStatus);
      })
      .catch(value => {
        if ((value as { name?: string }).name !== "AbortError") {
          setProvider({
            provider: null,
            model: null,
            ready: false,
            message: "Optional AI explanation is not enabled. The independently checked report still works without it.",
          });
        }
      });
    return () => controller.abort();
  }, [providerProbeEnabled]);

  useEffect(() => {
    let active = true;
    void createDemoDocumentReport({
      context,
      inputs,
      warningPolicy: "include",
      generatedAt: processedAt ?? undefined,
    }).then(async generated => {
      if (!active) return;
      setReport(generated.report);
      setVerification(generated.verification);
      if (!isRegisteredSyntheticReport(generated.report) || !repository.current) {
        setNotice("Report generated for this session. Non-registered documents are not retained or sent for AI explanation.");
        return;
      }
      try {
        const saved = await repository.current.saveReport(generated.report);
        if (active) {
          setSavedReports(current => replaceSaved(current, saved));
          setStorageState("READY");
          setNotice("Report generated and saved in this browser as a registered synthetic draft.");
        }
      } catch {
        if (active) {
          setStorageState("UNAVAILABLE");
          setNotice("Report generated for this session; browser storage was unavailable.");
        }
      }
    }).catch(value => {
      if (active) setError(safeMessage(value));
    }).finally(() => {
      if (active) setBusy(null);
    });
    return () => { active = false; };
  }, [context, inputs, processedAt]);

  async function explainReport() {
    if (!report || !provider?.ready || !isRegisteredSyntheticReport(report)) return;
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
      if (!response.ok || !value.explanation) throw new Error(value.error?.message ?? "The AI explanation was withheld.");
      setExplanation(value.explanation);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        explanationSummary.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }));
      if (repository.current) {
        try {
          const updated = await repository.current.saveExplanation(report.reportId, value.explanation);
          setSavedReports(current => replaceSaved(current, updated));
          setNotice("AI explanation attached to the saved synthetic report snapshot.");
        } catch {
          setNotice("The AI explanation is visible for this session but could not be saved locally.");
        }
      }
    } catch (value) {
      setError(safeMessage(value));
    } finally {
      setBusy(null);
    }
  }

  function openSaved(entry: SavedLocalReport) {
    setReport(entry.report);
    setExplanation(entry.aiExplanation);
    setVerification(null);
    setError("");
    setNotice("Saved synthetic report reopened from this browser.");
    onOpenSavedReport();
  }

  async function deleteSaved(entry: SavedLocalReport) {
    if (!repository.current || busy !== null || !window.confirm("Delete this local synthetic report snapshot?")) return;
    setBusy("DELETE");
    setError("");
    try {
      await repository.current.deleteReport(entry.reportId);
      setSavedReports(current => current.filter(item => item.reportId !== entry.reportId));
      setNotice(report?.reportId === entry.reportId
        ? "Saved record deleted from this browser. The current preview remains available for this session."
        : "Saved report deleted from this browser.");
    } catch {
      setError("The saved report could not be deleted. Browser storage may be unavailable.");
    } finally {
      setBusy(null);
    }
  }

  function viewReport() {
    reportPreview.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <section
        id="uploaded-reports-panel"
        role="tabpanel"
        aria-labelledby="uploaded-reports-tab"
        aria-hidden={activeView !== "UPLOADED_REPORTS"}
        className={`${activeView === "UPLOADED_REPORTS" ? "mt-6" : "hidden"} space-y-5 print:block print:break-before-page`}
      >
        <Panel className="print:hidden">
          <div className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--brand-ink)]">Management reporting</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-[-0.02em]">Generated management report</h2>
                  {report ? <StatusBadge status="Draft" /> : null}
                </div>
              </div>
              {report ? <div className="grid gap-2 print:hidden sm:flex">
                <button type="button" className={`${action} border border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)]`} onClick={viewReport}>
                  <Eye aria-hidden="true" size={16} />View Report
                </button>
                <button data-testid="connected-explain-with-ai" type="button" className={`${action} bg-violet-700 text-white hover:bg-violet-800`} disabled={busy !== null || !provider?.ready || !isRegisteredSyntheticReport(report)} onClick={() => void explainReport()}>
                  {busy === "AI" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Sparkles aria-hidden="true" size={16} />}
                  {busy === "AI" ? "Explaining…" : explanation ? "Regenerate AI explanation" : "Explain with AI"}
                </button>
              </div> : null}
            </div>

            {busy === "REPORT" ? <p role="status" className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm">
              <LoaderCircle aria-hidden="true" className="animate-spin text-[var(--brand)]" size={17} />Preparing report…
            </p> : null}
            {verification ? <div className="flex items-start gap-3 rounded-xl border border-[var(--good-line)] bg-[var(--good-soft)] p-4 text-sm text-[var(--good-ink)]">
              <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
              <div>
                <p className="font-semibold">C1 verification passed</p>
                <p className="mt-1 text-xs leading-5">{verification.acceptedRows} verified rows</p>
                <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold underline underline-offset-2">Verification details</summary><p className="mt-1 break-all text-xs">{verification.sourceFile} · SHA-256 {verification.sourceSha256} · {verification.checks.join(" · ")}</p></details>
              </div>
            </div> : null}
            {notice ? <p role="status" className="sr-only">{notice}</p> : null}
            {error ? <div role="alert" className="rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] p-4 text-sm text-[var(--warn-ink)]"><p className="font-semibold">Saved report records remain available</p><p className="mt-1 leading-6">{error}</p></div> : null}
          </div>
        </Panel>

        {report ? <section ref={reportPreview} aria-label="AI Reporting generated report" className="scroll-mt-6 space-y-4">
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-ink)]">Generated document</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{report.reportType === "QUARTERLY_FINANCIAL_ACTIVITY" ? "Quarterly Financial Activity Report" : "Financial Transaction Review"}</p>
              <p className="mt-0.5 text-xs text-[var(--muted-strong)]">{report.dataset.sourceFile} · {formatReportPeriod(report.reportingPeriod.startDate, report.reportingPeriod.endDate)}</p>
            </div>
            <button type="button" className={`${action} shrink-0 border border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] print:hidden`} onClick={() => downloadReport(report, explanation)}>
              <Download aria-hidden="true" size={16} />Download Report
            </button>
          </div>
          <ManagementReportPreview report={report} />
          {explanation ? <div ref={explanationSummary} id="ai-explanation-summary" className="scroll-mt-6"><AiExplanationPanel explanation={explanation} /></div> : null}
        </section> : null}
        {supportingEvidence}
      </section>

      <section
        id="report-library-panel"
        role="tabpanel"
        aria-labelledby="report-library-tab"
        aria-hidden={activeView !== "REPORT_LIBRARY"}
        className={`${activeView === "REPORT_LIBRARY" ? "mt-6" : "hidden"} print:hidden`}
      >
        <SavedReportsLibrary
          reports={savedReports}
          activeReportId={report?.reportId ?? null}
          storageState={storageState}
          onView={openSaved}
          onDownload={entry => downloadReport(entry.report, entry.aiExplanation)}
          onRequestDelete={entry => void deleteSaved(entry)}
        />
      </section>
    </>
  );
}
