import {
  createManagementReportPresentation,
  formatReportDate,
  formatReportMoney,
  formatReportMonth,
  formatReportPeriod,
  formatReportTimestamp,
  type LocalManagementReport,
} from "@/lib/ai-reporting";
import { QuarterlyActivityReportPreview } from "./quarterly-activity-report-preview";

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h3
      id={id}
      className="border-b border-black pb-1 text-[15px] font-bold leading-6 text-slate-950 underline decoration-1 underline-offset-2"
    >
      {children}
    </h3>
  );
}

function attentionKind(kind: string): string {
  if (kind === "STATISTICAL_FLAG") return "Amount review";
  if (kind === "STATISTICAL_FLAG_SUMMARY") return "Review-list boundary";
  if (kind === "WARNING_RECORD") return "Source information";
  return "Excluded records";
}

export function ManagementReportPreview({ report }: { report: LocalManagementReport }) {
  if (report.reportType === "QUARTERLY_FINANCIAL_ACTIVITY" && report.quarterlyActivity) {
    return <QuarterlyActivityReportPreview report={report} />;
  }
  const presentation = createManagementReportPresentation(report);
  const visibleFigureColumns = [
    { label: "Supplied amount", key: "sourceAmountTotal" as const },
    { label: "Supplied debit", key: "debitTotal" as const },
    { label: "Supplied credit", key: "creditTotal" as const },
  ].filter(column => presentation.figureRows.some(row => row[column.key] !== null));
  const reportMetadata = [
    ["Reporting period", formatReportPeriod(report.reportingPeriod.startDate, report.reportingPeriod.endDate)],
    ["Source file", `${report.dataset.sourceFile} (${report.dataset.sourceSheet ?? "CSV"})`],
    ["Currency scope", report.currencyLabel],
    ["Records reviewed", `${presentation.checkedCount} checked; ${presentation.includedCount} included`],
    ["Report status", "Draft - not approved"],
    ["Generation method", "Deterministic calculations and manual template"],
  ];

  return (
    <article
      data-testid="management-report-preview"
      className="mx-auto w-full max-w-[900px] border border-slate-300 bg-white text-slate-950 shadow-[0_20px_60px_rgb(15_23_42/0.12)] print:max-w-none print:border-0 print:shadow-none"
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <header className="px-6 pb-8 pt-10 sm:px-14 sm:pb-10 sm:pt-12">
        <div className="flex items-start justify-between gap-6 border-b border-black pb-2 text-[10px] font-bold uppercase tracking-[0.08em]">
          <span>For internal review</span>
          <span className="text-right font-normal normal-case tracking-normal">
            Generated {formatReportTimestamp(report.generatedAt, report.reportingPeriod.timezone)}
          </span>
        </div>
        <div className="mx-auto max-w-3xl py-9 text-center sm:py-11">
          <p className="text-[13px] font-bold uppercase tracking-[0.08em]">{report.organizationName}</p>
          <h2 className="mt-6 text-2xl font-bold uppercase leading-tight tracking-[0.01em] sm:text-[28px]">
            {report.title}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm italic leading-6">{report.subtitle}</p>
          <p className="mt-5 text-sm font-bold">{presentation.reportingPeriodLabel}</p>
          <p className="mt-2 text-[11px]">Currency scope: {report.currencyLabel}</p>
        </div>
        <div className="border-y-2 border-black py-2 text-center text-[11px] font-bold uppercase tracking-[0.12em]">
          Draft - not approved
        </div>
      </header>

      <main className="space-y-9 px-6 pb-12 sm:px-14">
        <p className="text-justify text-[13px] leading-6">{presentation.overviewSummary}</p>

        <section aria-labelledby="highlights-title" className="space-y-4">
          <SectionHeading id="highlights-title">Selected Period Highlights</SectionHeading>
          <ul className="list-disc space-y-2 pl-5 text-[13px] leading-6">
            {presentation.findings.map(finding => (
              <li key={finding.id} className="pl-1">
                <strong>{finding.title}.</strong> {finding.detail}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="summary-results-title" className="space-y-3">
          <SectionHeading id="summary-results-title">Summary of Selected Source-Value Results</SectionHeading>
          <p className="text-[11px] leading-5">
            The amounts below are exact totals of monetary fields supplied in the uploaded file. They describe source fields only and are not automatically income, expenses, profit, or cash flow.
          </p>
          {presentation.periodComparisons.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-[11px]">
                <thead>
                  <tr className="border-y-2 border-black">
                    <th scope="col" className="px-2 py-2 text-left font-bold">Source measure</th>
                    <th scope="col" className="px-2 py-2 text-right font-bold">Latest reported month</th>
                    <th scope="col" className="px-2 py-2 text-right font-bold">Previous reported month</th>
                  </tr>
                </thead>
                <tbody>
                  {presentation.periodComparisons.map(item => (
                    <tr key={item.id} className="border-b border-slate-300">
                      <th scope="row" className="px-2 py-2 text-left font-normal">{item.label}</th>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <strong>{formatReportMoney(item.currency, item.currentExactValue)}</strong>
                        <span className="ml-2 text-[10px] text-slate-600">{formatReportMonth(item.currentPeriod)}</span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <strong>{formatReportMoney(item.currency, item.priorExactValue)}</strong>
                        <span className="ml-2 text-[10px] text-slate-600">{formatReportMonth(item.priorPeriod)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[11px] leading-5">A prior comparable month is not available for this selected dataset.</p>
          )}
        </section>

        <section aria-labelledby="basis-title" className="space-y-3">
          <SectionHeading id="basis-title">Report Basis and Scope</SectionHeading>
          <dl className="text-[11px] leading-5">
            {reportMetadata.map(([label, value]) => (
              <div key={label} className="grid gap-1 border-b border-dotted border-slate-400 py-2 sm:grid-cols-[180px_1fr]">
                <dt className="font-bold">{label}</dt>
                <dd className="break-words sm:text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="attention-title" className="space-y-3">
          <SectionHeading id="attention-title">Items Requiring Review</SectionHeading>
          {presentation.attentionItems.length ? (
            <div>
              {presentation.attentionItems.map(item => (
                <article key={item.id} className="border-b border-slate-300 py-4 first:pt-1">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
                    <h4 className="text-[13px] font-bold">{item.title}</h4>
                    <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-600">
                      {attentionKind(item.kind)}
                    </span>
                  </div>
                  {(item.sourceRowNumber !== null || item.date || item.reference) && (
                    <p className="mt-1 text-[10px] text-slate-600">
                      {[
                        item.sourceRowNumber === null ? null : `Source row ${item.sourceRowNumber}`,
                        item.date ? formatReportDate(item.date) : null,
                        item.reference ? `Reference: ${item.reference}` : null,
                      ].filter(Boolean).join(" | ")}
                    </p>
                  )}
                  {item.description && <p className="mt-2 text-[11px] leading-5"><strong>Description:</strong> {item.description}</p>}
                  <p className="mt-2 text-[11px] leading-5">{item.summary}</p>
                  <p className="mt-1 text-[11px] leading-5"><strong>Why it matters:</strong> {item.whyItMatters}</p>
                  <p className="mt-1 text-[11px] leading-5"><strong>Suggested action:</strong> {item.suggestedAction}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-[11px] leading-5">
              No specific warning, rejected-record, or statistical-flag action is currently listed. Normal source review and approval controls still apply.
            </p>
          )}
        </section>

        <section aria-labelledby="detail-results-title" className="space-y-3">
          <SectionHeading id="detail-results-title">Detailed Monthly Source Values</SectionHeading>
          {presentation.figureRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-[10px]">
                <thead>
                  <tr className="border-y-2 border-black">
                    {["Month", "Currency", ...visibleFigureColumns.map(column => column.label)].map((heading, index) => (
                      <th key={heading} scope="col" className={`px-2 py-2 font-bold ${index < 2 ? "text-left" : "text-right"}`}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {presentation.figureRows.map(row => (
                    <tr key={row.id} className="border-b border-slate-300">
                      <th scope="row" className="px-2 py-2 text-left font-normal">{formatReportMonth(row.period)}</th>
                      <td className="px-2 py-2 text-left">{row.currency ?? "Not specified"}</td>
                      {visibleFigureColumns.map(column => {
                        const value = row[column.key];
                        return <td key={column.key} className="px-2 py-2 text-right tabular-nums">{value === null ? "-" : formatReportMoney(row.currency, value)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[11px] leading-5">No monetary figure passed the current evidence checks. Review currency and report exceptions in Technical Details and Audit Information.</p>
          )}
          <p className="border-t border-black pt-2 text-[10px] leading-4">
            <strong>Interpretation note.</strong> Debit and credit are preserved source labels, not universal descriptions of money spent or received. Revenue, expenses, profit, and cash flow require approved accounting interpretation.
          </p>
        </section>

        <section aria-labelledby="quality-title" className="space-y-3">
          <SectionHeading id="quality-title">Data Quality</SectionHeading>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y-2 border-black">
                <th scope="col" className="px-2 py-2 text-left">Check</th>
                <th scope="col" className="px-2 py-2 text-right">Result</th>
                <th scope="col" className="px-2 py-2 text-left">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {presentation.qualityCards.map(card => (
                <tr key={card.label} className="border-b border-slate-300">
                  <th scope="row" className="px-2 py-2 text-left font-normal">{card.label}</th>
                  <td className="px-2 py-2 text-right font-bold tabular-nums">{card.value}</td>
                  <td className="px-2 py-2 text-left">{card.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] leading-4">
            Warnings identify accepted records needing source information checked; rejections identify excluded records; statistical flags identify unusual amounts among included records.
          </p>
        </section>

        <section aria-labelledby="next-steps-title" className="space-y-3">
          <SectionHeading id="next-steps-title">Management Review and Next Steps</SectionHeading>
          <p className="text-[13px] leading-6">{presentation.managementConclusion}</p>
          <ol className="list-decimal space-y-1 pl-5 text-[11px] leading-5">
            {presentation.nextSteps.map(step => <li key={step} className="pl-1">{step}</li>)}
          </ol>
        </section>

        <section aria-labelledby="limitations-title" className="space-y-3">
          <SectionHeading id="limitations-title">Report Limitations</SectionHeading>
          <ul className="list-disc space-y-1 pl-5 text-[10px] leading-5">
            {presentation.plainLimitations.map(limitation => <li key={limitation}>{limitation}</li>)}
          </ul>
          <p className="border-t border-slate-400 pt-2 text-[10px] leading-4">
            <strong>Not calculated:</strong> {report.unavailableMetrics.map(metric => metric.label).join(", ")}.
          </p>
          <p className="text-[10px] leading-4">
            Any optional AI explanation is separate, review-required, and cannot authorize publication.
          </p>
        </section>

        <details className="border-y border-black py-3 text-[10px]">
          <summary className="cursor-pointer text-[12px] font-bold underline underline-offset-2">
            Technical Details and Audit Information
          </summary>
          <div className="mt-5 space-y-5 leading-5">
            <div>
              <h4 className="font-bold">Source and report controls</h4>
              <dl className="mt-2">
                {[
                  ["Source system", report.dataset.sourceSystem],
                  ["Worksheet", report.dataset.sourceSheet ?? "CSV"],
                  ["Producer batch", report.dataset.ingestionBatchId],
                  ["Source file SHA-256", report.dataset.fileSha256],
                  ["Evidence bundle", report.evidenceBundle.bundleId],
                  ["Snapshot", report.evidenceBundle.snapshot.snapshotId],
                  ["Structural precheck", report.structuralPrecheck],
                  ["Warning policy", report.evidenceBundle.warningPolicy],
                  ["Generation method", `${report.generation.method}; LLM used: ${String(report.generation.llmUsed)}`],
                  ["Publication authorized", String(report.publicationAuthorized)],
                ].map(([label, value]) => (
                  <div key={label} className="grid gap-1 border-b border-dotted border-slate-400 py-1 sm:grid-cols-[160px_1fr]">
                    <dt className="font-bold">{label}</dt>
                    <dd className="break-all font-mono">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h4 className="font-bold">Policy exceptions</h4>
              {report.policyExceptions.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {report.policyExceptions.map(exception => <li key={exception.exceptionId}><strong>{exception.code}</strong>: {exception.message}</li>)}
                </ul>
              ) : <p className="mt-1">No bundle exception was detected by the AI-01 structural policy.</p>}
            </div>
            <div>
              <h4 className="font-bold">Grounded claim references</h4>
              <ul className="mt-1 space-y-1">
                {report.metrics.map(metric => (
                  <li key={metric.claim.claimId} className="break-all">
                    <span className="font-mono">{metric.claim.claimId}</span><br />
                    Evidence: <span className="font-mono">{metric.evidenceId}</span>
                  </li>
                ))}
              </ul>
            </div>
            {report.warnings.length > 0 && (
              <div>
                <h4 className="font-bold">Warning row references</h4>
                <ul className="mt-1">
                  {report.warnings.map(warning => <li key={warning.sourceRowId}>Source row {warning.sourceRowNumber}: <span className="break-all font-mono">{warning.sourceRowId}</span></li>)}
                </ul>
              </div>
            )}
            {report.anomalies.length > 0 && (
              <div>
                <h4 className="font-bold">Statistical audit values</h4>
                <ul className="mt-1">
                  {report.anomalies.slice(0, 50).map(finding => <li key={finding.source_row_id}>{finding.source_file}; source row {finding.source_row_number}; robust score {finding.robustScore}; {finding.reason}</li>)}
                  {report.anomalies.length > 50 && <li>{report.anomalies.length - 50} additional statistical flags are retained in the deterministic report snapshot and are not expanded in this preview.</li>}
                </ul>
              </div>
            )}
            <div>
              <h4 className="font-bold">Unavailable financial interpretations</h4>
              <ul className="mt-1 list-disc pl-5">
                {report.unavailableMetrics.map(metric => <li key={metric.label}><strong>{metric.label}:</strong> {metric.reason}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="font-bold">Complete implementation limitations</h4>
              <ul className="mt-1 list-disc pl-5">
                {report.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}
              </ul>
            </div>
          </div>
        </details>
      </main>

      <footer className="mx-6 flex flex-col justify-between gap-1 border-t border-black py-4 text-[9px] uppercase tracking-[0.05em] text-slate-600 sm:mx-14 sm:flex-row">
        <span>FinGence Finance Intelligence</span>
        <span>Report ID: {report.reportId}</span>
        <span>Draft - not approved</span>
      </footer>
    </article>
  );
}
