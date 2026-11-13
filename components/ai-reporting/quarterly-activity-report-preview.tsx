import {
  formatReportDate,
  formatReportMoney,
  formatReportPeriod,
  formatReportTimestamp,
  type LocalManagementReport,
  type QuarterlyActivityComparison,
} from "@/lib/ai-reporting";

function SectionHeading({ id, children }: { id: string; children: string }) {
  return <h3 id={id} className="border-b border-black pb-1 text-[15px] font-bold leading-6 underline decoration-1 underline-offset-2">{children}</h3>;
}

function comparisonValue(item: QuarterlyActivityComparison, value: string): string {
  return item.currency ? formatReportMoney(item.currency, value) : Number(value).toLocaleString("en-MY");
}

function direction(value: string): "increased" | "decreased" | "was unchanged" {
  if (/^-/.test(value)) return "decreased";
  if (/^0(?:\.0+)?$/.test(value)) return "was unchanged";
  return "increased";
}

function changeText(item: QuarterlyActivityComparison): string {
  if (direction(item.absoluteChange) === "was unchanged") return "No change";
  const exact = comparisonValue(item, item.absoluteChange.replace(/^-/, ""));
  const percentage = item.percentageChange === null
    ? item.percentageUnavailableReason ?? "Percentage unavailable"
    : `${item.percentageChange.startsWith("-") ? "" : "+"}${item.percentageChange}%`;
  return `${direction(item.absoluteChange) === "increased" ? "+" : "-"}${exact} (${percentage})`;
}

function sentenceForComparison(item: QuarterlyActivityComparison): string {
  const verb = direction(item.absoluteChange);
  if (verb === "was unchanged") return `${item.label} was unchanged from the comparison quarter.`;
  const amount = comparisonValue(item, item.absoluteChange.replace(/^-/, ""));
  const percentage = item.percentageChange === null ? "" : ` (${item.percentageChange.replace(/^-/, "")}% )`.replace("% )", "%)");
  return `${item.label} ${verb} by ${amount}${percentage} compared with the previous quarter.`;
}

function yesNo(value: boolean | null): string {
  if (value === null) return "Not matched";
  return value ? "Yes" : "No";
}

export function QuarterlyActivityReportPreview({ report }: { report: LocalManagementReport }) {
  const activity = report.quarterlyActivity;
  if (!activity) return null;
  const { current, comparison, comparisons } = activity;
  const reportReference = report.evidenceBundle.snapshot.snapshotSha256.slice(0, 12).toUpperCase();
  const mainFindings = report.anomalies.slice(0, 10);
  const supplements = activity.workbookSupplements;

  return (
    <article
      data-testid="quarterly-activity-report-preview"
      className="mx-auto w-full max-w-[900px] border border-slate-300 bg-white text-slate-950 shadow-[0_20px_60px_rgb(15_23_42/0.12)] print:max-w-none print:border-0 print:shadow-none"
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <header className="px-6 pb-8 pt-10 sm:px-14 sm:pb-10 sm:pt-12">
        <div className="flex items-start justify-between gap-6 border-b border-black pb-2 text-[10px] font-bold uppercase tracking-[0.08em]"><span>For internal management review</span><span className="text-right font-normal normal-case tracking-normal">Generated {formatReportTimestamp(report.generatedAt, report.reportingPeriod.timezone)}</span></div>
        <div className="mx-auto max-w-3xl py-9 text-center sm:py-11">
          <p className="text-[13px] font-bold uppercase tracking-[0.08em]">{activity.business.displayName}</p>
          <h2 className="mt-6 text-2xl font-bold uppercase leading-tight tracking-[0.01em] sm:text-[28px]">{report.title}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm italic leading-6">{report.subtitle}</p>
          <p className="mt-5 text-sm font-bold">Quarter ended {formatReportDate(current.period.endDate)}</p>
          <p className="mt-2 text-[11px]">Currency: {current.currency}</p>
        </div>
        <div className="border-y-2 border-black py-2 text-center text-[11px] font-bold uppercase tracking-[0.12em]">Draft - not approved</div>
      </header>

      <main className="space-y-9 px-6 pb-12 sm:px-14">
        {!supplements && (
          <section className="border-2 border-red-800 p-4 text-red-950" aria-labelledby="missing-workbook-schedules">
            <h3 id="missing-workbook-schedules" className="text-sm font-bold">Workbook schedules are missing from this saved draft</h3>
            <p className="mt-2 text-[11px] leading-5">Generate a new draft while the original XLSX remains in the current browser session. Older saved drafts cannot reconstruct worksheets that were not retained in their report snapshot.</p>
          </section>
        )}

        <section aria-labelledby="quarterly-highlights" className="space-y-4">
          <SectionHeading id="quarterly-highlights">Quarterly Financial Highlights</SectionHeading>
          <ul className="list-disc space-y-2 pl-5 text-[13px] leading-6">
            <li className="pl-1"><strong>Recorded bank credits were {formatReportMoney(current.currency, current.bankCredits)}</strong> across the selected company&apos;s included transactions.</li>
            <li className="pl-1"><strong>Recorded bank debits were {formatReportMoney(current.currency, current.bankDebits)}</strong>; this is source activity and is not an expense total.</li>
            {comparisons.map(item => <li key={item.measure} className="pl-1">{sentenceForComparison(item)}</li>)}
            <li className="pl-1"><strong>{current.includedTransactionCount.toLocaleString("en-MY")} transactions</strong> were included for {current.period.label}; {current.statisticalFlagCount.toLocaleString("en-MY")} amounts were statistically flagged for review.</li>
            <li className="pl-1"><strong>Net movement is not reported.</strong> The dataset has no associated reviewed convention approving the subtraction of recorded debits from credits.</li>
          </ul>
        </section>

        <section aria-labelledby="executive-summary" className="space-y-3">
          <SectionHeading id="executive-summary">Executive Financial Summary</SectionHeading>
          <p className="text-justify text-[13px] leading-6">This report reviews verified bank transaction activity for {activity.business.displayName} from {formatReportPeriod(current.period.startDate, current.period.endDate)}. Under the selected warning policy, {current.includedTransactionCount.toLocaleString("en-MY")} of {current.acceptedTransactionCount.toLocaleString("en-MY")} accepted transactions were included. Recorded credits and debits are presented separately and preserve their source meaning.</p>
          {comparison ? <p className="text-justify text-[13px] leading-6">The comparison is based on {comparison.period.label} for the same verified business identifier. {comparisons.map(sentenceForComparison).join(" ")} These movements describe recorded bank activity only; they do not establish revenue, expenses, profit, or formal cash flow.</p> : <p className="text-[13px] leading-6">No supported comparison quarter was selected. The report does not manufacture a prior-period result.</p>}
          <p className="text-justify text-[13px] leading-6">Management should review the statistical candidates and any source warnings below against original supporting records. A statistical flag identifies an unusual amount within the selected population; it is not proof of fraud, loss, or error.</p>
        </section>

        <section aria-labelledby="quarterly-comparison" className="space-y-3">
          <SectionHeading id="quarterly-comparison">Quarterly Performance Comparison</SectionHeading>
          {comparison ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] border-collapse text-[11px]"><thead><tr className="border-y-2 border-black"><th className="px-2 py-2 text-left">Financial activity measure</th><th className="px-2 py-2 text-right">{current.period.label}</th><th className="px-2 py-2 text-right">{comparison.period.label}</th><th className="px-2 py-2 text-right">Change</th></tr></thead><tbody>{comparisons.map(item => <tr key={item.measure} className="border-b border-slate-300"><th scope="row" className="px-2 py-2 text-left font-normal">{item.label}</th><td className="px-2 py-2 text-right font-bold tabular-nums">{comparisonValue(item, item.currentExactValue)}</td><td className="px-2 py-2 text-right tabular-nums">{comparisonValue(item, item.comparisonExactValue)}</td><td className="px-2 py-2 text-right tabular-nums">{changeText(item)}</td></tr>)}</tbody></table></div> : <p className="text-[11px] leading-5">A comparable prior quarter is unavailable for the selected scope.</p>}
          <p className="border-t border-black pt-2 text-[10px] leading-4"><strong>Interpretation boundary.</strong> Credit and debit totals are verified directional bank activity. They are not automatically revenue or expenses, and no profit or cash-flow statement is implied.</p>
        </section>

        <section aria-labelledby="monthly-activity" className="space-y-3">
          <SectionHeading id="monthly-activity">Monthly Financial Activity</SectionHeading>
          <div className="overflow-x-auto"><table className="w-full min-w-[650px] border-collapse text-[11px]"><thead><tr className="border-y-2 border-black"><th className="px-2 py-2 text-left">Month</th><th className="px-2 py-2 text-right">Recorded bank credits</th><th className="px-2 py-2 text-right">Recorded bank debits</th><th className="px-2 py-2 text-right">Transactions</th><th className="px-2 py-2 text-right">Warnings</th></tr></thead><tbody>{activity.months.map(month => <tr key={month.period} className="border-b border-slate-300"><th scope="row" className="px-2 py-2 text-left font-normal">{month.label}</th><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(month.currency, month.bankCredits)}</td><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(month.currency, month.bankDebits)}</td><td className="px-2 py-2 text-right tabular-nums">{month.transactionCount}</td><td className="px-2 py-2 text-right tabular-nums">{month.warningCount}</td></tr>)}<tr className="border-y-2 border-black font-bold"><th scope="row" className="px-2 py-2 text-left">Quarter total</th><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(current.currency, current.bankCredits)}</td><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(current.currency, current.bankDebits)}</td><td className="px-2 py-2 text-right tabular-nums">{current.includedTransactionCount}</td><td className="px-2 py-2 text-right tabular-nums">{current.includedWarningCount}</td></tr></tbody></table></div>
        </section>

        {supplements && (
          <section aria-labelledby="monthly-summary-schedule" className="space-y-3">
            <SectionHeading id="monthly-summary-schedule">Supplementary Monthly Summary and Reconciliation</SectionHeading>
            <p className="text-[10px] leading-5">This schedule comes from the workbook&apos;s <strong>{supplements.monthlySummary.sourceSheet}</strong> sheet. It is an independent comparison with the transaction-derived figures above. It does not replace checked Transactions data or make workbook-provided balances an approved accounting result.</p>
            {supplements.monthlySummary.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-[10px]"><thead><tr className="border-y-2 border-black"><th className="px-2 py-2 text-left">Month</th><th className="px-2 py-2 text-right">Opening balance</th><th className="px-2 py-2 text-right">Credits</th><th className="px-2 py-2 text-right">Debits</th><th className="px-2 py-2 text-right">Closing balance</th><th className="px-2 py-2 text-right">Transactions</th><th className="px-2 py-2 text-right">Labeled anomalies</th><th className="px-2 py-2 text-left">Reconciliation</th></tr></thead><tbody>{supplements.monthlySummary.rows.map(row => <tr key={row.sourceRowNumber} className="border-b border-slate-300"><th scope="row" className="px-2 py-2 text-left font-normal">{row.period}</th><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(current.currency, row.openingBalance)}</td><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(current.currency, row.totalCredits)}</td><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(current.currency, row.totalDebits)}</td><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(current.currency, row.closingBalance)}</td><td className="px-2 py-2 text-right tabular-nums">{row.transactionCount}</td><td className="px-2 py-2 text-right tabular-nums">{row.labeledAnomalyCount}</td><td className="px-2 py-2 text-left">Credits {row.reconciliation.credits.toLowerCase()}, debits {row.reconciliation.debits.toLowerCase()}, count {row.reconciliation.transactionCount.toLowerCase()}</td></tr>)}</tbody></table></div> : <p className="text-[11px] leading-5">{supplements.monthlySummary.reason ?? "No matching Monthly Summary rows are available."}</p>}
            {supplements.monthlySummary.reason && supplements.monthlySummary.rows.length > 0 && <p className="text-[10px] leading-5"><strong>Coverage note:</strong> {supplements.monthlySummary.reason}</p>}
          </section>
        )}

        {supplements?.categoryActivity && (
          <section aria-labelledby="source-category-activity" className="space-y-3 break-before-page">
            <SectionHeading id="source-category-activity">Source Category Activity Schedule</SectionHeading>
            <p className="text-[10px] leading-5"><strong>Reference classification only.</strong> These totals group raw workbook rows by supplied source labels. They are not approved accounting categories and do not establish revenue or expense meaning.</p>
            {supplements.categoryActivity.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-[9px]"><thead><tr className="border-y-2 border-black"><th className="px-2 py-2 text-left">Workbook business category</th><th className="px-2 py-2 text-left">Source category</th><th className="px-2 py-2 text-right">Transactions</th><th className="px-2 py-2 text-right">Credits</th><th className="px-2 py-2 text-right">Credit amount</th><th className="px-2 py-2 text-right">Debits</th><th className="px-2 py-2 text-right">Debit amount</th></tr></thead><tbody>{supplements.categoryActivity.rows.map(row => <tr key={`${row.sourceCategory}:${row.businessCategory}`} className="border-b border-slate-300"><th scope="row" className="px-2 py-2 text-left font-normal">{row.businessCategory}</th><td className="px-2 py-2 text-left">{row.sourceCategory}</td><td className="px-2 py-2 text-right tabular-nums">{row.transactionCount}</td><td className="px-2 py-2 text-right tabular-nums">{row.creditCount}</td><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(supplements.categoryActivity?.currency ?? null, row.creditAmount)}</td><td className="px-2 py-2 text-right tabular-nums">{row.debitCount}</td><td className="px-2 py-2 text-right tabular-nums">{formatReportMoney(supplements.categoryActivity?.currency ?? null, row.debitAmount)}</td></tr>)}</tbody></table></div> : <p className="text-[11px]">{supplements.categoryActivity.reason}</p>}
            {supplements.categoryActivity.bankFormats.length > 0 && <div><h4 className="text-[11px] font-bold">Bank-description format distribution</h4><div className="mt-2 grid grid-cols-2 gap-px overflow-hidden border border-slate-300 bg-slate-300 text-[10px] sm:grid-cols-4">{supplements.categoryActivity.bankFormats.map(item => <div key={item.label} className="bg-white p-2"><span>{item.label}</span><strong className="ml-2 tabular-nums">{item.count}</strong></div>)}</div></div>}
          </section>
        )}

        <section aria-labelledby="management-commentary" className="space-y-3">
          <SectionHeading id="management-commentary">Management Commentary</SectionHeading>
          <p className="text-[13px] leading-6">{comparisons.length ? comparisons.map(sentenceForComparison).join(" ") : "A prior-quarter comparison is unavailable."} The available records do not provide evidence for the business reasons behind these movements. Any future management explanation must be supplied and reviewed separately.</p>
        </section>

        <section aria-labelledby="important-findings" className="space-y-3">
          <SectionHeading id="important-findings">Important Findings and Items Requiring Review</SectionHeading>
          <p className="text-[11px] leading-5">{report.anomalies.length.toLocaleString("en-MY")} amount{report.anomalies.length === 1 ? " was" : "s were"} statistically flagged within the selected company and current quarter. Up to ten candidates are shown for management review; the retained snapshot and technical appendix preserve the wider audit trail.</p>
          {mainFindings.length ? <div>{mainFindings.map(finding => <article key={finding.source_row_id} className="break-inside-avoid border-b border-slate-300 py-4 first:pt-1"><div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline"><h4 className="text-[13px] font-bold">Amount review candidate</h4><span className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-600">Statistical flag - not a confirmed error</span></div><p className="mt-1 text-[10px] text-slate-600">Source row {finding.source_row_number} | {formatReportDate(finding.canonical_date)}{finding.reference ? ` | Reference: ${finding.reference}` : ""}</p>{finding.description && <p className="mt-2 text-[11px] leading-5"><strong>Description:</strong> {finding.description}</p>}<p className="mt-2 text-[11px] leading-5"><strong>Recorded amount magnitude:</strong> {formatReportMoney(finding.currency, finding.magnitude)}. <strong>Why flagged:</strong> {finding.reason}</p><p className="mt-1 text-[11px] leading-5"><strong>Suggested action:</strong> Compare the transaction with the original bank record and supporting document before drawing a conclusion.</p></article>)}</div> : <p className="text-[11px] leading-5">No amount was statistically flagged in the selected current-quarter population. Normal review controls still apply.</p>}
        </section>

        {supplements && (
          <section aria-labelledby="ground-truth-evaluation" className="space-y-3">
            <SectionHeading id="ground-truth-evaluation">Ground Truth Evaluation Reference</SectionHeading>
            <p className="text-[10px] leading-5"><strong>Synthetic evaluation data only.</strong> This section summarizes labels from the workbook&apos;s {supplements.groundTruth.sourceSheet} sheet for the selected company and quarter. These labels are not financial results, do not prove that a transaction is wrong, and are not used to calculate credits, debits, or balances.</p>
            <dl className="grid grid-cols-2 gap-px overflow-hidden border border-slate-300 bg-slate-300 text-[11px] sm:grid-cols-4"><div className="bg-white p-3"><dt className="text-slate-600">Transactions in scope</dt><dd className="mt-1 font-bold tabular-nums">{supplements.groundTruth.expectedTransactionCount}</dd></div><div className="bg-white p-3"><dt className="text-slate-600">Labels matched</dt><dd className="mt-1 font-bold tabular-nums">{supplements.groundTruth.matchedTransactionCount}</dd></div><div className="bg-white p-3"><dt className="text-slate-600">Labeled anomalies</dt><dd className="mt-1 font-bold tabular-nums">{supplements.groundTruth.labeledAnomalyCount}</dd></div><div className="bg-white p-3"><dt className="text-slate-600">Review expected</dt><dd className="mt-1 font-bold tabular-nums">{supplements.groundTruth.reviewExpectedCount}</dd></div></dl>
            {supplements.groundTruth.anomalyTypes.length > 0 && <div className="overflow-x-auto"><table className="w-full border-collapse text-[10px]"><thead><tr className="border-y-2 border-black"><th className="px-2 py-2 text-left">Evaluation label</th><th className="px-2 py-2 text-right">Count</th></tr></thead><tbody>{supplements.groundTruth.anomalyTypes.map(item => <tr key={item.label} className="border-b border-slate-300"><th scope="row" className="px-2 py-2 text-left font-normal">{item.label}</th><td className="px-2 py-2 text-right tabular-nums">{item.count}</td></tr>)}</tbody></table></div>}
            {(supplements.groundTruth.rows?.some(row => row.isAnomaly || row.reviewExpected)) && <div className="overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-[9px]"><thead><tr className="border-y-2 border-black"><th className="px-2 py-2 text-left">Transaction ID</th><th className="px-2 py-2 text-left">Source category</th><th className="px-2 py-2 text-left">Business category</th><th className="px-2 py-2 text-left">Anomaly type</th><th className="px-2 py-2 text-left">Review expected</th></tr></thead><tbody>{supplements.groundTruth.rows.filter(row => row.isAnomaly || row.reviewExpected).map(row => <tr key={row.transactionId} className="border-b border-slate-300"><th scope="row" className="px-2 py-2 text-left font-normal">{row.transactionId}</th><td className="px-2 py-2">{row.sourceCategory}</td><td className="px-2 py-2">{row.businessCategory}</td><td className="px-2 py-2">{row.anomalyType ?? "Unspecified"}</td><td className="px-2 py-2">{yesNo(row.reviewExpected)}</td></tr>)}</tbody></table></div>}
            {supplements.groundTruth.reason && <p className="text-[10px] leading-5"><strong>Coverage note:</strong> {supplements.groundTruth.reason}</p>}
          </section>
        )}

        <section aria-labelledby="basis-limitations" className="space-y-3">
          <SectionHeading id="basis-limitations">Basis of Preparation and Limitations</SectionHeading>
          <p className="text-[11px] leading-5">This draft was prepared from accepted bank transaction records for entity <strong>{activity.business.identifier}</strong>, using canonical transaction dates and exact decimal-string calculations. Company isolation uses the accepted-data <code>entity_id</code> field. The report is not an audited financial statement.</p>
          <ul className="list-disc space-y-1 pl-5 text-[10px] leading-5"><li>Evidence window: {formatReportPeriod(activity.evidenceWindow.startDate, activity.evidenceWindow.endDate)}; it includes the current and comparison populations only.</li><li>Net bank movement, opening and closing balances, category analysis, revenue, expenses, profit, and formal cash flow remain unavailable under current approved contracts.</li><li>Warnings follow the selected {activity.calculation.warningPolicy} policy. Rejected and duplicate source rows must be absent because company attribution is unavailable for those rows.</li><li>The optional AI explanation is a separate review-required artifact and cannot approve or publish this report.</li></ul>
        </section>

        {supplements && (
          <section aria-labelledby="category-mapping-reference" className="space-y-3">
            <SectionHeading id="category-mapping-reference">Category Mapping Reference</SectionHeading>
            <p className="text-[10px] leading-5">The mappings below come from the workbook&apos;s {supplements.categoryMapping.sourceSheet} sheet. They describe how this synthetic file was generated. They are <strong>not approved accounting classifications</strong> and do not feed the financial activity totals or AI explanation.</p>
            {supplements.categoryMapping.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] border-collapse text-[10px]"><thead><tr className="border-y-2 border-black"><th className="px-2 py-2 text-left">Source category</th><th className="px-2 py-2 text-left">Workbook business category</th><th className="px-2 py-2 text-right">Generation weight</th></tr></thead><tbody>{supplements.categoryMapping.rows.map(row => <tr key={row.sourceRowNumber} className="border-b border-slate-300"><th scope="row" className="px-2 py-2 text-left font-normal">{row.sourceCategory}</th><td className="px-2 py-2 text-left">{row.businessCategory}</td><td className="px-2 py-2 text-right tabular-nums">{row.generationWeight}</td></tr>)}</tbody></table></div> : <p className="text-[11px] leading-5">{supplements.categoryMapping.reason ?? "No matching category mappings are available."}</p>}
          </section>
        )}

        {supplements && (
          <section aria-labelledby="source-methodology-disclosure" className="space-y-3">
            <SectionHeading id="source-methodology-disclosure">Dataset Notice, Source and Methodology</SectionHeading>
            <p className="border border-black p-3 text-[10px] font-bold uppercase leading-5">Synthetic test data only. This workbook must not be represented as real client financial records.</p>
            {supplements.readme?.title && <h4 className="text-[12px] font-bold">{supplements.readme.title}</h4>}
            {supplements.readme?.entries.length ? <dl className="text-[10px] leading-5">{supplements.readme.entries.map(entry => <div key={entry.sourceRowNumber} className="grid gap-1 border-b border-dotted border-slate-400 py-2 sm:grid-cols-[170px_1fr]"><dt className="font-bold">{entry.item}</dt><dd className="break-words">{entry.value}{entry.reference && <span className="mt-1 block break-all text-[9px] text-slate-600">{entry.reference}</span>}</dd></div>)}</dl> : null}
            {supplements.readme?.businessCoverage.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-[10px]"><thead><tr className="border-y-2 border-black"><th className="px-2 py-2 text-left">Synthetic business</th><th className="px-2 py-2 text-right">Transactions</th><th className="px-2 py-2 text-right">Labeled anomalies</th></tr></thead><tbody>{supplements.readme.businessCoverage.map(row => <tr key={row.sourceRowNumber} className="border-b border-slate-300"><th scope="row" className="px-2 py-2 text-left font-normal">{row.businessName}</th><td className="px-2 py-2 text-right">{row.transactionCount}</td><td className="px-2 py-2 text-right">{row.labeledAnomalyCount}</td></tr>)}</tbody></table></div> : null}
            <h4 className="text-[11px] font-bold">Source and methodology worksheet</h4>
            <p className="text-[10px] leading-5">These statements are reproduced as workbook-provided methodology metadata. FinGence has not independently verified the external source, license, source size, taxonomy, or generation claims.</p>
            {supplements.methodology.entries.length ? <dl className="text-[10px] leading-5">{supplements.methodology.entries.map(entry => <div key={entry.sourceRowNumber} className="grid gap-1 border-b border-dotted border-slate-400 py-2 sm:grid-cols-[170px_1fr]"><dt className="font-bold">{entry.item}</dt><dd className="break-words">{entry.details}</dd></div>)}</dl> : <p className="text-[11px] leading-5">{supplements.methodology.reason ?? "No methodology disclosures are available."}</p>}
          </section>
        )}

        {supplements?.transactionSchedule && (
          <details className="break-before-page border-y border-black py-3">
            <summary id="complete-transaction-schedule" className="cursor-pointer text-[15px] font-bold underline underline-offset-4">
              Appendix A - Complete Current-Quarter Transaction Schedule
              <span className="ml-2 text-[10px] font-normal text-slate-600 no-underline">({supplements.transactionSchedule.matchedTransactionCount.toLocaleString("en-MY")} transactions - select to expand)</span>
            </summary>
            <div className="mt-5 space-y-3">
              <p className="text-[10px] leading-5">All {supplements.transactionSchedule.matchedTransactionCount.toLocaleString("en-MY")} raw workbook transactions matched to the accepted population for {activity.business.displayName} in {current.period.label} are shown below. Source categories, running balances, and evaluation labels remain supplementary workbook context.</p>
              {supplements.transactionSchedule.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-[8px] leading-4"><thead><tr className="border-y-2 border-black"><th className="px-1.5 py-2 text-right">#</th><th className="px-1.5 py-2 text-left">Date and transaction</th><th className="px-1.5 py-2 text-left">Description and source reference</th><th className="px-1.5 py-2 text-left">Direction and amount</th><th className="px-1.5 py-2 text-left">Workbook context</th><th className="px-1.5 py-2 text-left">Evaluation context</th></tr></thead><tbody>{supplements.transactionSchedule.rows.map((row, index) => <tr key={row.transactionId} className="break-inside-avoid border-b border-slate-300 align-top"><td className="px-1.5 py-2 text-right tabular-nums">{index + 1}</td><td className="px-1.5 py-2"><strong>{formatReportDate(row.transactionDate)}</strong><span className="mt-1 block text-[7px] text-slate-600">{row.transactionId}<br />Source row {row.sourceRowNumber}</span></td><td className="px-1.5 py-2"><strong>{row.description}</strong><br />Counterparty: {row.counterparty}<br />Reference: {row.reference}</td><td className="px-1.5 py-2"><strong>{row.direction} {formatReportMoney(row.currency, row.amount)}</strong><br />Running balance: {formatReportMoney(row.currency, row.runningBalance)}</td><td className="px-1.5 py-2">Account: {row.accountNumber}<br />Format: {row.bankFormat}<br />Industry: {row.industry}<br />Source category: {row.sourceCategory}<br />Business category: {row.businessCategory}</td><td className="px-1.5 py-2">Evaluation matched: {yesNo(row.groundTruth.matched)}<br />Ground truth category: {row.groundTruth.businessCategory ?? "Not matched"}<br />Labeled anomaly: {yesNo(row.groundTruth.isAnomaly)}<br />Anomaly type: {row.groundTruth.anomalyType ?? "None"}<br />Review expected: {yesNo(row.groundTruth.reviewExpected)}<span className="mt-1 block text-[7px] text-slate-600">Generation: {row.generationMethod}</span></td></tr>)}</tbody></table></div> : <p className="text-[11px]">{supplements.transactionSchedule.reason ?? "No detailed transaction schedule is available."}</p>}
            </div>
          </details>
        )}

        <details className="break-before-page border-y border-black py-3 text-[10px]"><summary className="cursor-pointer text-[12px] font-bold underline underline-offset-2">Supporting Schedules and Technical Appendix</summary><div className="mt-5 space-y-5 leading-5"><div><h4 className="font-bold">Source and calculation controls</h4><dl className="mt-2">{[["Business identifier", activity.business.identifier], ["Business name basis", activity.business.nameBasis], ["Source file", `${report.dataset.sourceFile} (${report.dataset.sourceSheet ?? "CSV"})`], ["Source file SHA-256", report.dataset.fileSha256], ["Producer batch", report.dataset.ingestionBatchId], ["Evidence snapshot", report.evidenceBundle.snapshot.snapshotId], ["Snapshot SHA-256", report.evidenceBundle.snapshot.snapshotSha256], ["Calculation", `${activity.calculation.functionId} ${activity.calculation.version}`], ["Monetary basis", current.monetaryBasis], ["Structural precheck", report.structuralPrecheck], ["Publication authorized", String(report.publicationAuthorized)], ["Supplementary workbook context", supplements ? `${supplements.authority}; headline calculations: ${String(supplements.usedForHeadlineCalculations)}` : "Not included"]].map(([label, value]) => <div key={label} className="grid gap-1 border-b border-dotted border-slate-400 py-1 sm:grid-cols-[160px_1fr]"><dt className="font-bold">{label}</dt><dd className="break-all font-mono">{value}</dd></div>)}</dl></div><div><h4 className="font-bold">Statistical audit schedule</h4>{report.anomalies.length ? <ul className="mt-1">{report.anomalies.slice(0, 100).map(finding => <li key={finding.source_row_id}>{finding.source_file}; source row {finding.source_row_number}; {finding.canonical_date}; {finding.currency} {finding.magnitude}; robust score {finding.robustScore}; {finding.reason}</li>)}{report.anomalies.length > 100 && <li>{report.anomalies.length - 100} additional flags remain in the deterministic report snapshot.</li>}</ul> : <p>No current-quarter statistical flags.</p>}</div><div><h4 className="font-bold">Unavailable interpretations</h4><ul className="mt-1 list-disc pl-5">{report.unavailableMetrics.map(metric => <li key={`${metric.label}:${metric.reason}`}><strong>{metric.label}:</strong> {metric.reason}</li>)}</ul></div><div><h4 className="font-bold">Policy exceptions</h4>{report.policyExceptions.length ? <ul className="mt-1 list-disc pl-5">{report.policyExceptions.map(exception => <li key={exception.exceptionId}><strong>{exception.code}:</strong> {exception.message}</li>)}</ul> : <p>No evidence-bundle exception was detected by the AI-01 structural policy.</p>}</div></div></details>
      </main>

      <footer className="mx-6 flex flex-col justify-between gap-1 border-t border-black py-4 text-[9px] uppercase tracking-[0.05em] text-slate-600 sm:mx-14 sm:flex-row"><span>FinGence Finance Intelligence</span><span>Report ref: {reportReference}</span><span>Draft - not approved</span></footer>
    </article>
  );
}
