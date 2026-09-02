"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleGauge,
  Database,
  FileCheck2,
  FileSpreadsheet,
  Landmark,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { Modal } from "@/components/overlay";
import { PageHeader, Panel, ProgressBar, StatusBadge } from "@/components/ui";
import { uploadedSources } from "@/lib/mock-data";
import type { UploadSource, UploadStage } from "@/lib/types";

const pipeline = [
  { label: "File", icon: FileSpreadsheet },
  { label: "Validation", icon: ShieldCheck },
  { label: "Cleaning", icon: Sparkles },
  { label: "Normalization", icon: CircleGauge },
  { label: "Ready", icon: FileCheck2 },
];

const stageProgress: Record<UploadStage, number> = {
  Uploading: 20,
  Validating: 48,
  Normalizing: 76,
  Complete: 100,
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export default function DataPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [source, setSource] = useState<UploadSource>("Ledger");
  const [stage, setStage] = useState<UploadStage | null>(null);

  async function simulateUpload() {
    setStage("Uploading");
    await wait(650);
    setStage("Validating");
    await wait(750);
    setStage("Normalizing");
    await wait(850);
    setStage("Complete");
  }

  function closeDialog() {
    setDialogOpen(false);
    setStage(null);
  }

  return (
    <>
      <PageHeader
        title="Financial data"
        description="Upload and normalize financial records from multiple sources."
        actions={
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--teal)] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[var(--teal-dark)]"
          >
            <Upload aria-hidden="true" size={17} />
            Upload financial file
          </button>
        }
      />

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Connected financial sources">
        {uploadedSources.map((item) => {
          const Icon = item.source === "Bank Statement" ? Landmark : item.source === "Budget" ? FileSpreadsheet : Database;
          return (
            <article key={item.source} className="panel-shadow rounded-xl border border-[var(--border)] bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <span className="grid size-11 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
                  <Icon aria-hidden="true" size={21} />
                </span>
                <StatusBadge status="Processed" />
              </div>
              <h2 className="mt-5 text-sm font-semibold text-[var(--ink)]">{item.source}</h2>
              <p className="mt-1 truncate text-sm font-medium text-[var(--muted-strong)]" title={item.filename}>{item.filename}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-4 text-xs">
                <div>
                  <dt className="text-[var(--muted)]">File type</dt>
                  <dd className="mt-1 font-semibold">{item.fileType}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Records</dt>
                  <dd className="mt-1 font-semibold">{item.records.toLocaleString()}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[var(--muted)]">Uploaded</dt>
                  <dd className="mt-1 font-medium text-[var(--muted-strong)]">{item.uploaded}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </section>

      <Panel title="Ingestion pipeline" className="mt-4" action={<span className="text-xs font-medium text-[var(--green)]">All sources ready</span>}>
        <div className="overflow-x-auto p-5 sm:p-7">
          <ol className="mx-auto flex min-w-[680px] max-w-5xl items-center" aria-label="Data ingestion pipeline">
            {pipeline.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.label} className="flex flex-1 items-center last:flex-none">
                  <div className="flex min-w-[94px] flex-col items-center text-center">
                    <span className="grid size-12 place-items-center rounded-full border border-teal-200 bg-[var(--teal-soft)] text-[var(--teal)]">
                      <Icon aria-hidden="true" size={21} />
                    </span>
                    <span className="mt-2 text-xs font-semibold">{step.label}</span>
                    <span className="mt-0.5 text-[10px] text-[var(--muted)]">Complete</span>
                  </div>
                  {index < pipeline.length - 1 ? (
                    <div className="mx-2 flex flex-1 items-center">
                      <div className="h-px flex-1 bg-teal-200" />
                      <ArrowRight aria-hidden="true" className="-ml-1 text-[var(--teal)]" size={16} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      </Panel>

      <Panel title="Normalized data summary" className="mt-4">
        <div className="grid divide-y divide-[var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {[
            ["Unified records", "1,986", "Across all imported sources"],
            ["Validation rate", "99.4%", "12 records need review"],
            ["Categories mapped", "24", "To the standard schema"],
            ["Last refresh", "09:18", "1 September 2026"],
          ].map(([label, value, note]) => (
            <div key={label} className="p-5">
              <p className="text-xs text-[var(--muted)]">{label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{value}</p>
              <p className="mt-1 text-[11px] text-[var(--muted-strong)]">{note}</p>
            </div>
          ))}
        </div>
      </Panel>

      {dialogOpen ? (
        <Modal
          title="Upload financial file"
          description="Simulate ingestion using a realistic prototype workflow. No file is transmitted or parsed."
          onClose={closeDialog}
        >
          <div className="p-5">
            <fieldset disabled={stage !== null && stage !== "Complete"}>
              <legend className="text-sm font-semibold">Choose a financial source</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {(["Ledger", "Bank Statement", "Budget"] as UploadSource[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setSource(item)}
                    aria-pressed={source === item}
                    className={`min-h-20 rounded-lg border p-3 text-left text-sm font-semibold transition-colors ${
                      source === item
                        ? "border-[var(--teal)] bg-[var(--teal-soft)] text-[var(--teal-dark)]"
                        : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-slate-50"
                    }`}
                  >
                    <FileSpreadsheet aria-hidden="true" className="mb-2" size={18} />
                    {item}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-5 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-subtle)] p-5 text-center">
              <Plus aria-hidden="true" className="mx-auto text-[var(--teal)]" size={24} />
              <p className="mt-2 text-sm font-semibold">{source.toLowerCase().replace(" ", "-")}-sep-2026.xlsx</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Mock selection · 1.8 MB</p>
            </div>

            {stage ? (
              <div className="mt-5 rounded-lg border border-[var(--border)] p-4" aria-live="polite">
                <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    {stage === "Complete" ? (
                      <Check aria-hidden="true" size={17} className="text-[var(--green)]" />
                    ) : (
                      <LoaderCircle aria-hidden="true" size={17} className="animate-spin text-[var(--teal)]" />
                    )}
                    {stage}
                  </span>
                  <span className="text-xs text-[var(--muted)]">{stageProgress[stage]}%</span>
                </div>
                <ProgressBar value={stageProgress[stage]} label={`Upload ${stageProgress[stage]}% complete`} />
                <p className="mt-3 text-xs text-[var(--muted)]">
                  {stage === "Uploading" && "Receiving the selected financial source..."}
                  {stage === "Validating" && "Checking schema, dates, amounts and required fields..."}
                  {stage === "Normalizing" && "Mapping records to the unified transaction model..."}
                  {stage === "Complete" && "1,108 mock records are normalized and ready for reconciliation."}
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-3 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-5 py-4">
            <button type="button" onClick={closeDialog} className="min-h-10 rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-semibold hover:bg-slate-50">
              {stage === "Complete" ? "Close" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={simulateUpload}
              disabled={stage !== null}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--teal)] px-4 text-sm font-semibold text-white hover:bg-[var(--teal-dark)] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Upload aria-hidden="true" size={16} />
              Start mock upload
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
