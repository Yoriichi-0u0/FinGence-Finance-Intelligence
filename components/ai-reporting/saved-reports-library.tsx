"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  Download,
  Eye,
  FileText,
  HardDrive,
  Search,
  Trash2,
} from "lucide-react";
import { Panel, StatusBadge } from "@/components/ui";
import {
  createManagementReportPresentation,
  formatReportPeriod,
  formatReportTimestamp,
} from "@/lib/ai-reporting";
import type { SavedLocalReport } from "@/lib/ai-reporting/local-report-repository";

type StorageState = "LOADING" | "READY" | "UNAVAILABLE";

interface SavedReportsLibraryProps {
  reports: readonly SavedLocalReport[];
  activeReportId: string | null;
  storageState: StorageState;
  onView: (entry: SavedLocalReport) => void;
  onDownload: (entry: SavedLocalReport) => void;
  onRequestDelete: (entry: SavedLocalReport) => void;
}

function attentionCount(entry: SavedLocalReport): number {
  if (entry.report.reportType === "QUARTERLY_FINANCIAL_ACTIVITY") {
    return entry.report.anomalies.length + entry.report.warnings.length;
  }
  return createManagementReportPresentation(entry.report).attentionItems.length;
}

function reportKind(entry: SavedLocalReport): string {
  return entry.report.reportType === "QUARTERLY_FINANCIAL_ACTIVITY"
    ? `Quarterly financial activity · ${entry.report.organizationName}`
    : "Management source-data review";
}

function LibraryEmptyState({ unavailable }: { unavailable: boolean }) {
  return (
    <div className="grid min-h-56 place-items-center px-6 py-12 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
          {unavailable ? <HardDrive aria-hidden="true" size={22} /> : <FileText aria-hidden="true" size={22} />}
        </span>
        <h3 className="mt-4 text-sm font-semibold text-[var(--ink)]">
          {unavailable ? "Local report storage is unavailable" : "No saved reports yet"}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[var(--muted)]">
          {unavailable
            ? "You can still prepare and download a report during this session, but it will not survive a refresh."
            : "Generate a report from a checked registered synthetic dataset. The draft will appear here automatically."}
        </p>
      </div>
    </div>
  );
}

export function SavedReportsLibrary({
  reports,
  activeReportId,
  storageState,
  onView,
  onDownload,
  onRequestDelete,
}: SavedReportsLibraryProps) {
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"NEWEST" | "OLDEST">("NEWEST");
  const visibleReports = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return reports
      .filter(entry => {
        if (!normalizedQuery) return true;
        const report = entry.report;
        return [
          report.title,
          report.organizationName,
          report.dataset.sourceFile,
          formatReportPeriod(report.reportingPeriod.startDate, report.reportingPeriod.endDate),
        ].some(value => value.toLocaleLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => {
        const difference = Date.parse(right.savedAt) - Date.parse(left.savedAt);
        return sortOrder === "NEWEST" ? difference : -difference;
      });
  }, [query, reports, sortOrder]);

  return (
    <section id="saved-reports" className="scroll-mt-20" aria-labelledby="saved-reports-title">
      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--teal)]">Report library</p>
            <h2 id="saved-reports-title" className="mt-1 text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">Saved reports</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Immutable synthetic report snapshots saved in this browser only.</p>
          </div>
          {reports.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative block min-w-0 sm:w-64">
                <span className="sr-only">Search saved reports</span>
                <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search reports"
                  className="min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-white pl-9 pr-3 text-sm outline-none focus:border-[var(--teal)] focus:ring-2 focus:ring-teal-100"
                />
              </label>
              <label className="relative block sm:w-40">
                <span className="sr-only">Sort saved reports</span>
                <ArrowDownUp aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
                <select
                  aria-label="Sort saved reports"
                  value={sortOrder}
                  onChange={event => setSortOrder(event.target.value as "NEWEST" | "OLDEST")}
                  className="min-h-11 w-full appearance-none rounded-lg border border-[var(--border-strong)] bg-white pl-9 pr-8 text-sm outline-none focus:border-[var(--teal)] focus:ring-2 focus:ring-teal-100"
                >
                  <option value="NEWEST">Newest first</option>
                  <option value="OLDEST">Oldest first</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {storageState === "LOADING" ? (
          <div className="space-y-3 p-5" aria-label="Loading saved reports">
            {[0, 1, 2].map(item => <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        ) : reports.length === 0 ? (
          <LibraryEmptyState unavailable={storageState === "UNAVAILABLE"} />
        ) : visibleReports.length === 0 ? (
          <div className="grid min-h-48 place-items-center p-8 text-center">
            <div><Search aria-hidden="true" className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-semibold">No reports match your search</p><button type="button" onClick={() => setQuery("")} className="mt-2 min-h-11 text-sm font-semibold text-[var(--teal)]">Clear search</button></div>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.06em] text-[var(--muted)]">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-semibold">Report</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Reporting period</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Generated</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Storage</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {visibleReports.map(entry => {
                    const report = entry.report;
                    const attention = attentionCount(entry);
                    const selected = activeReportId === entry.reportId;
                    return (
                      <tr key={entry.reportId} className={selected ? "bg-teal-50/50" : "bg-white hover:bg-slate-50/70"}>
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-teal-100 bg-[var(--teal-soft)] text-[var(--teal)]"><FileText aria-hidden="true" size={17} /></span>
                            <div className="min-w-0"><p className="font-semibold text-[var(--ink)]">{report.title}</p><p className="mt-0.5 max-w-64 truncate text-xs text-[var(--muted)]">{report.dataset.sourceFile}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{reportKind(entry)}</p></div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-xs text-[var(--muted-strong)]">{formatReportPeriod(report.reportingPeriod.startDate, report.reportingPeriod.endDate)}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-xs text-[var(--muted-strong)]">{formatReportTimestamp(report.generatedAt, report.reportingPeriod.timezone)}</td>
                        <td className="px-4 py-4"><StatusBadge status="Draft" />{attention > 0 && <p className="mt-1.5 text-[10px] font-medium text-amber-700">{attention} {attention === 1 ? "item" : "items"} to review</p>}</td>
                        <td className="px-4 py-4"><span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-600"><HardDrive aria-hidden="true" size={14} />This browser</span></td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-1">
                            <button data-testid={`view-saved-report-${entry.reportId}`} type="button" onClick={() => onView(entry)} className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-[var(--teal-dark)] hover:bg-teal-50"><Eye aria-hidden="true" size={15} />View</button>
                            <button type="button" onClick={() => onDownload(entry)} className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"><Download aria-hidden="true" size={15} />HTML</button>
                            <button type="button" onClick={() => onRequestDelete(entry)} className="inline-flex min-h-10 items-center rounded-md px-2.5 text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label={`Delete ${report.title} generated ${formatReportTimestamp(report.generatedAt, report.reportingPeriod.timezone)}`}><Trash2 aria-hidden="true" size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--border)] md:hidden">
              {visibleReports.map(entry => {
                const report = entry.report;
                const attention = attentionCount(entry);
                return (
                  <article key={entry.reportId} className={`p-5 ${activeReportId === entry.reportId ? "bg-teal-50/50" : "bg-white"}`}>
                    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{report.title}</h3><p className="mt-1 text-[10px] text-[var(--muted)]">{reportKind(entry)}</p><p className="mt-1 break-all text-xs text-[var(--muted)]">{report.dataset.sourceFile}</p></div><StatusBadge status="Draft" /></div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-[var(--muted)]">Period</dt><dd className="mt-1 font-medium">{formatReportPeriod(report.reportingPeriod.startDate, report.reportingPeriod.endDate)}</dd></div><div><dt className="text-[var(--muted)]">Review items</dt><dd className="mt-1 font-medium">{attention}</dd></div><div className="col-span-2"><dt className="text-[var(--muted)]">Generated</dt><dd className="mt-1 font-medium">{formatReportTimestamp(report.generatedAt, report.reportingPeriod.timezone)}</dd></div></dl>
                    <div className="mt-4 grid grid-cols-3 gap-2"><button type="button" onClick={() => onView(entry)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-[var(--teal)] px-3 text-xs font-semibold text-white"><Eye aria-hidden="true" size={15} />View</button><button type="button" onClick={() => onDownload(entry)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 text-xs font-semibold"><Download aria-hidden="true" size={15} />HTML</button><button type="button" onClick={() => onRequestDelete(entry)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700"><Trash2 aria-hidden="true" size={15} />Delete</button></div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </Panel>
    </section>
  );
}
