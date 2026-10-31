"use client";

import { useState } from "react";
import {
  CalendarDays,
  Check,
  Eye,
  FileDown,
  FileText,
  LoaderCircle,
  Play,
} from "lucide-react";
import { ReportPreview } from "@/components/report-preview";
import { PageHeader, Panel, ProgressBar, PrototypeLabel, StatusBadge } from "@/components/ui";
import { reportSections } from "@/lib/mock-data";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export default function ReportsPage() {
  const [generationState, setGenerationState] = useState<"Idle" | "Generating" | "Complete">("Idle");
  const [progress, setProgress] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(true);

  async function generateReport() {
    setGenerationState("Generating");
    setProgress(18);
    await wait(550);
    setProgress(46);
    await wait(600);
    setProgress(74);
    await wait(650);
    setProgress(100);
    setGenerationState("Complete");
    setPreviewVisible(true);
  }

  function showPreview() {
    setPreviewVisible(true);
    window.requestAnimationFrame(() => document.getElementById("report-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <>
      <PageHeader
        title="Management reports"
        description="Generate and review structured monthly financial reporting."
        actions={<PrototypeLabel />}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
        <Panel>
          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]"><FileText aria-hidden="true" size={23} /></span>
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.03em]">Monthly Management Report</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">August 2026 · SAIC Finance Workspace</p>
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--muted-strong)]"><CalendarDays aria-hidden="true" size={14} /> Generated 1 September 2026</p>
                </div>
              </div>
              <StatusBadge status={generationState === "Complete" ? "Complete" : generationState === "Generating" ? "Review" : "Processed"} />
            </div>

            {generationState === "Generating" || generationState === "Complete" ? (
              <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4" aria-live="polite">
                <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold">{generationState === "Generating" ? <LoaderCircle aria-hidden="true" className="animate-spin text-[var(--teal)]" size={17} /> : <Check aria-hidden="true" className="text-[var(--green)]" size={17} />}{generationState === "Generating" ? "Generating report" : "Report generation complete"}</span>
                  <span className="text-xs text-[var(--muted)]">{progress}%</span>
                </div>
                <ProgressBar value={progress} label={`Report generation ${progress}% complete`} />
                <p className="mt-3 text-xs text-[var(--muted)]">{generationState === "Generating" ? "Aggregating KPIs, variance, forecasts, anomalies and reconciliation data..." : "Mock report assembled in 8 minutes equivalent, an 81% reduction against the prototype baseline."}</p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={generateReport} disabled={generationState === "Generating"} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--teal)] px-4 text-sm font-semibold text-white hover:bg-[var(--teal-dark)] disabled:cursor-wait disabled:opacity-55"><Play aria-hidden="true" size={16} /> Generate report</button>
              <button type="button" onClick={showPreview} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-semibold hover:bg-slate-50"><Eye aria-hidden="true" size={16} /> Preview</button>
              <button type="button" disabled title="Available in full implementation" className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-lg border border-[var(--border)] bg-slate-100 px-4 text-sm font-semibold text-slate-400"><FileDown aria-hidden="true" size={16} /> Export PDF</button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--muted)]">PDF export is available in the full implementation.</p>
          </div>
        </Panel>

        <Panel title="Sections included" action={<span className="text-xs text-[var(--muted)]">8 sections</span>}>
          <ol className="divide-y divide-[var(--border)]">
            {reportSections.map((section, index) => (
              <li key={section} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--teal-soft)] text-[10px] font-bold text-[var(--teal)]">{index + 1}</span><span className="font-medium text-[var(--muted-strong)]">{section}</span></li>
            ))}
          </ol>
        </Panel>
      </div>

      {previewVisible ? (
        <section id="report-preview" className="scroll-mt-20 pt-5" aria-labelledby="report-preview-heading">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div><h2 id="report-preview-heading" className="text-lg font-semibold tracking-[-0.02em]">Report preview</h2><p className="mt-1 text-xs text-[var(--muted)]">Professional management-report layout · prototype content</p></div>
            <button type="button" onClick={() => setPreviewVisible(false)} className="text-xs font-semibold text-[var(--teal)] hover:text-[var(--teal-dark)]">Hide preview</button>
          </div>
          <ReportPreview />
        </section>
      ) : null}
    </>
  );
}
