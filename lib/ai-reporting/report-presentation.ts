import type { LocalManagementReport } from "./local-management-report";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function groupedWholeDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats an exact decimal string without converting it to a JavaScript number. */
export function formatReportMoney(currency: string | null, exactValue: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(exactValue);
  if (!match) return `${currency ?? "Currency not specified"} ${exactValue}`;
  const [, sign, whole, suppliedFraction = ""] = match;
  const fraction = suppliedFraction.padEnd(2, "0");
  const currencyLabel = currency === "MYR" ? "RM" : currency ?? "Currency not specified";
  const leadingSign = sign === "-" ? "-" : sign === "+" ? "+" : "";
  return `${leadingSign}${currencyLabel} ${groupedWholeDigits(whole)}.${fraction}`;
}

export function formatReportDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return isoDate;
  return `${Number(match[3])} ${MONTHS[month - 1]} ${match[1]}`;
}

export function formatReportPeriod(startDate: string, endDate: string): string {
  return startDate === endDate
    ? formatReportDate(startDate)
    : `${formatReportDate(startDate)} to ${formatReportDate(endDate)}`;
}

/** Produces a formal heading without changing the exact reporting-period dates. */
export function formatReportPeriodHeading(startDate: string, endDate: string): string {
  const start = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate);
  if (!start || !end || start[1] !== end[1]) {
    return `Period from ${formatReportPeriod(startDate, endDate)}`;
  }
  const year = Number(start[1]);
  const startMonth = Number(start[2]);
  const endMonth = Number(end[2]);
  const endDay = Number(end[3]);
  const lastDayOfEndMonth = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  if (startMonth === 1 && start[3] === "01" && endMonth === 12 && endDay === 31) {
    return `Year ended ${formatReportDate(endDate)}`;
  }
  if ([1, 4, 7, 10].includes(startMonth)
    && start[3] === "01"
    && endMonth === startMonth + 2
    && endDay === lastDayOfEndMonth) {
    return `Quarter ended ${formatReportDate(endDate)}`;
  }
  return `Period from ${formatReportPeriod(startDate, endDate)}`;
}

export function formatReportMonth(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;
  return `${MONTHS[month - 1]} ${match[1]}`;
}

export function formatReportTimestamp(isoTimestamp: string, timezone: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
}

export interface ReportFinding {
  id: string;
  tone: "POSITIVE" | "REVIEW" | "INFORMATION";
  title: string;
  detail: string;
}

export interface ReportAttentionItem {
  id: string;
  kind: "WARNING_RECORD" | "STATISTICAL_FLAG" | "STATISTICAL_FLAG_SUMMARY" | "REJECTED_RECORDS";
  title: string;
  summary: string;
  whyItMatters: string;
  suggestedAction: string;
  sourceRowNumber: number | null;
  sourceRowId: string | null;
  date: string | null;
  description: string | null;
  reference: string | null;
  amount: { currency: string | null; exactValue: string } | null;
}

export interface ReportFigureRow {
  id: string;
  period: string;
  currency: string | null;
  monetaryBasis: string;
  sourceAmountTotal: string | null;
  debitTotal: string | null;
  creditTotal: string | null;
}

export interface ReportPeriodComparison {
  id: string;
  label: "Supplied amount" | "Supplied debit" | "Supplied credit";
  currency: string | null;
  currentPeriod: string;
  currentExactValue: string;
  priorPeriod: string;
  priorExactValue: string;
}

export interface ReportQualityCard {
  label: string;
  value: number;
  note: string;
  tone: "NEUTRAL" | "POSITIVE" | "REVIEW" | "NEGATIVE";
}

export interface ManagementReportPresentation {
  checkedCount: number;
  includedCount: number;
  reportingPeriodLabel: string;
  overviewSummary: string;
  managementConclusion: string;
  findings: readonly ReportFinding[];
  attentionItems: readonly ReportAttentionItem[];
  figureRows: readonly ReportFigureRow[];
  periodComparisons: readonly ReportPeriodComparison[];
  qualityCards: readonly ReportQualityCard[];
  nextSteps: readonly string[];
  plainLimitations: readonly string[];
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function warningTitle(rules: readonly string[]): string {
  if (rules.length === 1 && rules[0] === "MISSING_REFERENCE") return "Transaction reference is missing";
  if (rules.length === 1 && rules[0] === "MISSING_DESCRIPTION") return "Transaction description is missing";
  if (rules.includes("MISSING_CURRENCY")) return "Transaction currency needs confirmation";
  if (rules.includes("DUPLICATE_ROW")) return "Possible duplicate transaction needs checking";
  return "Record information needs checking";
}

function warningSummary(rules: readonly string[], fallback: readonly string[]): string {
  if (rules.length === 1 && rules[0] === "MISSING_REFERENCE") {
    return "This accepted record does not contain a transaction reference.";
  }
  if (rules.length === 1 && rules[0] === "MISSING_DESCRIPTION") {
    return "This accepted record does not contain a transaction description.";
  }
  if (rules.includes("MISSING_CURRENCY")) {
    return "The currency for this accepted record is not available from the uploaded data.";
  }
  if (rules.includes("DUPLICATE_ROW")) {
    return "This accepted record may repeat another row in the uploaded data.";
  }
  return fallback.join("; ") || "An import check marked this accepted record for review.";
}

function warningReason(rules: readonly string[]): string {
  if (rules.includes("MISSING_CURRENCY")) {
    return "Amounts without a confirmed currency cannot be safely compared or combined with other monetary values.";
  }
  if (rules.includes("DUPLICATE_ROW")) {
    return "An unconfirmed duplicate could cause a total to include the same transaction more than once.";
  }
  return "Missing or uncertain source details make the transaction harder to trace back to supporting records.";
}

function warningAction(rules: readonly string[]): string {
  if (rules.includes("DUPLICATE_ROW")) {
    return "Compare this row with the original source and any similar row. Correct the source file and re-import it if necessary.";
  }
  if (rules.includes("MISSING_CURRENCY")) {
    return "Confirm the currency from the original source. Correct the source file and re-import it before relying on the amount.";
  }
  return "Check the original transaction or supporting document. Add the missing detail to the source file and re-import it if available.";
}

function buildOverviewSummary(report: LocalManagementReport, checkedCount: number, includedCount: number): string {
  const quality = report.evidenceBundle.quality;
  const acceptedSentence = includedCount === quality.acceptedCount
    ? `All ${includedCount} accepted ${plural(includedCount, "record")} ${includedCount === 1 ? "was" : "were"} included in the report figures.`
    : `${includedCount} of ${quality.acceptedCount} accepted ${plural(quality.acceptedCount, "record")} ${includedCount === 1 ? "was" : "were"} included under the selected warning policy.`;
  const reviewNotes: string[] = [];
  if (quality.warningCount > 0) {
    reviewNotes.push(`${quality.warningCount} accepted ${plural(quality.warningCount, "record")} ${quality.warningCount === 1 ? "has" : "have"} information to review`);
  }
  if (quality.rejectedCount > 0) {
    reviewNotes.push(`${quality.rejectedCount} ${plural(quality.rejectedCount, "record")} ${quality.rejectedCount === 1 ? "was" : "were"} rejected and excluded from the figures`);
  }
  if (report.anomalies.length > 0) {
    reviewNotes.push(`${report.anomalies.length} ${plural(report.anomalies.length, "amount")} ${report.anomalies.length === 1 ? "was" : "were"} statistically flagged for review`);
  }
  const reviewSentence = reviewNotes.length
    ? `${reviewNotes.join("; ")}.`
    : "The available checks found no validation warnings, rejected records or statistical amount flags.";
  return `This review examined ${checkedCount} uploaded financial ${plural(checkedCount, "record")} from ${formatReportPeriod(report.reportingPeriod.startDate, report.reportingPeriod.endDate)}. ${acceptedSentence} ${reviewSentence}`;
}

function buildFindings(report: LocalManagementReport, checkedCount: number, includedCount: number): ReportFinding[] {
  const quality = report.evidenceBundle.quality;
  const findings: ReportFinding[] = [{
    id: "accepted-records",
    tone: "POSITIVE",
    title: `${quality.acceptedCount} of ${checkedCount} checked ${plural(checkedCount, "record")} passed acceptance checks`,
    detail: includedCount === quality.acceptedCount
      ? `All ${includedCount} accepted ${plural(includedCount, "record")} ${includedCount === 1 ? "is" : "are"} included in the figures below.`
      : `${includedCount} accepted ${plural(includedCount, "record")} ${includedCount === 1 ? "is" : "are"} included; warning records were excluded by the selected report setting.`,
  }];

  findings.push(quality.warningCount > 0 ? {
    id: "warning-records",
    tone: "REVIEW",
    title: `${quality.warningCount} accepted ${plural(quality.warningCount, "record")} ${quality.warningCount === 1 ? "needs" : "need"} information checked`,
    detail: quality.includedWarningCount > 0
      ? `${quality.includedWarningCount} warning ${plural(quality.includedWarningCount, "record")} ${quality.includedWarningCount === 1 ? "is" : "are"} included with caveats. See Items requiring attention for the affected source ${plural(quality.warningCount, "row")}.`
      : "Warning records are excluded from these figures under the selected report setting.",
  } : {
    id: "warning-records",
    tone: "POSITIVE",
    title: "No accepted records carry validation warnings",
    detail: "The available import checks did not mark any accepted record as needing additional source information.",
  });

  findings.push(quality.rejectedCount > 0 ? {
    id: "rejected-records",
    tone: "REVIEW",
    title: `${quality.rejectedCount} ${plural(quality.rejectedCount, "record")} ${quality.rejectedCount === 1 ? "was" : "were"} rejected`,
    detail: "Rejected records are excluded from every report figure and their contents are not included in the evidence bundle.",
  } : {
    id: "rejected-records",
    tone: "POSITIVE",
    title: "No records were rejected",
    detail: "Every checked record passed the minimum import requirements for an accepted record.",
  });

  findings.push(report.anomalies.length > 0 ? {
    id: "statistical-flags",
    tone: "REVIEW",
    title: `${report.anomalies.length} unusually large ${plural(report.anomalies.length, "amount")} ${report.anomalies.length === 1 ? "needs" : "need"} review`,
    detail: "These are comparison-based review flags, not proof of fraud, error or incorrect accounting.",
  } : {
    id: "statistical-flags",
    tone: "INFORMATION",
    title: "No unusually large amounts were flagged",
    detail: "This only reflects eligible comparison groups and does not prove that every transaction is correct.",
  });
  return findings;
}

function buildAttentionItems(report: LocalManagementReport): ReportAttentionItem[] {
  const warningItems: ReportAttentionItem[] = report.warnings.map(warning => {
    const rules = warning.issues.map(issue => issue.rule);
    return {
      id: `warning:${warning.sourceRowId}`,
      kind: "WARNING_RECORD",
      title: warningTitle(rules),
      summary: warningSummary(rules, warning.messages),
      whyItMatters: warningReason(rules),
      suggestedAction: warningAction(rules),
      sourceRowNumber: warning.sourceRowNumber,
      sourceRowId: warning.sourceRowId,
      date: warning.canonicalDate,
      description: warning.description,
      reference: warning.reference,
      amount: null,
    };
  });

  const visibleAnomalyLimit = 25;
  const anomalyItems: ReportAttentionItem[] = report.anomalies.slice(0, visibleAnomalyLimit).map(finding => ({
    id: `statistical:${finding.source_row_id}`,
    kind: "STATISTICAL_FLAG",
    title: `${formatReportMoney(finding.currency === "UNSPECIFIED" ? null : finding.currency, finding.magnitude)} may need review`,
    summary: "This amount is unusually large compared with other eligible records that share its currency, account code and monetary structure.",
    whyItMatters: "A large difference can be valid, but checking the supporting record helps confirm that the amount was entered and classified as intended.",
    suggestedAction: "Compare the transaction with its invoice, receipt or other original source. Escalate only if that check identifies a concern.",
    sourceRowNumber: finding.source_row_number,
    sourceRowId: finding.source_row_id,
    date: finding.canonical_date,
    description: finding.description,
    reference: finding.reference,
    amount: {
      currency: finding.currency === "UNSPECIFIED" ? null : finding.currency,
      exactValue: finding.magnitude,
    },
  }));

  const remainingAnomalyCount = Math.max(0, report.anomalies.length - visibleAnomalyLimit);
  const anomalySummary: ReportAttentionItem[] = remainingAnomalyCount > 0 ? [{
    id: "statistical:remaining-summary",
    kind: "STATISTICAL_FLAG_SUMMARY",
    title: `${remainingAnomalyCount} additional statistically flagged ${plural(remainingAnomalyCount, "amount")} ${remainingAnomalyCount === 1 ? "is" : "are"} not listed individually`,
    summary: `This management view shows the first ${visibleAnomalyLimit} review candidates. The deterministic report snapshot retains all ${report.anomalies.length} statistical flags.`,
    whyItMatters: "A bounded review list keeps the report usable while preserving the full detector output for controlled technical review.",
    suggestedAction: "Use a reviewed operational workflow to triage the complete flag set in batches; do not treat the flags as confirmed errors or fraud.",
    sourceRowNumber: null,
    sourceRowId: null,
    date: null,
    description: null,
    reference: null,
    amount: null,
  }] : [];

  const rejectedItem: ReportAttentionItem[] = report.evidenceBundle.quality.rejectedCount > 0 ? [{
    id: "rejected-records",
    kind: "REJECTED_RECORDS",
    title: `${report.evidenceBundle.quality.rejectedCount} rejected ${plural(report.evidenceBundle.quality.rejectedCount, "record")} must be checked separately`,
    summary: "These records did not meet the minimum import requirements and are excluded from all report figures.",
    whyItMatters: "The report cannot determine whether excluded records would change the figures if corrected and accepted.",
    suggestedAction: "Review the rejected-record export or original file, correct confirmed source issues, and re-import before relying on this report as complete.",
    sourceRowNumber: null,
    sourceRowId: null,
    date: null,
    description: null,
    reference: null,
    amount: null,
  }] : [];

  return [...warningItems, ...anomalyItems, ...anomalySummary, ...rejectedItem];
}

function buildFigureRows(report: LocalManagementReport): ReportFigureRow[] {
  const rows = new Map<string, ReportFigureRow>();
  for (const metric of report.metrics) {
    const key = `${metric.period}|${metric.currency ?? "UNSPECIFIED"}|${metric.monetaryBasis}`;
    const row = rows.get(key) ?? {
      id: key,
      period: metric.period,
      currency: metric.currency,
      monetaryBasis: metric.monetaryBasis,
      sourceAmountTotal: null,
      debitTotal: null,
      creditTotal: null,
    };
    if (metric.label === "Total supplied amount values") row.sourceAmountTotal = metric.exactValue;
    if (metric.label === "Total supplied debit values") row.debitTotal = metric.exactValue;
    if (metric.label === "Total supplied credit values") row.creditTotal = metric.exactValue;
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => left.period.localeCompare(right.period)
    || (left.currency ?? "").localeCompare(right.currency ?? "")
    || left.monetaryBasis.localeCompare(right.monetaryBasis));
}

function buildPeriodComparisons(rows: readonly ReportFigureRow[]): ReportPeriodComparison[] {
  const groups = new Map<string, ReportFigureRow[]>();
  for (const row of rows) {
    const key = `${row.currency ?? "UNSPECIFIED"}|${row.monetaryBasis}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const definitions = [
    { label: "Supplied amount" as const, key: "sourceAmountTotal" as const },
    { label: "Supplied debit" as const, key: "debitTotal" as const },
    { label: "Supplied credit" as const, key: "creditTotal" as const },
  ];
  return [...groups.entries()].flatMap(([groupKey, groupRows]) => {
    const sorted = [...groupRows].sort((left, right) => left.period.localeCompare(right.period));
    const current = sorted.at(-1);
    const prior = sorted.at(-2);
    if (!current || !prior) return [];
    return definitions.flatMap(definition => {
      const currentValue = current[definition.key];
      const priorValue = prior[definition.key];
      if (currentValue === null || priorValue === null) return [];
      return [{
        id: `${groupKey}|${definition.key}|${current.period}|${prior.period}`,
        label: definition.label,
        currency: current.currency,
        currentPeriod: current.period,
        currentExactValue: currentValue,
        priorPeriod: prior.period,
        priorExactValue: priorValue,
      } satisfies ReportPeriodComparison];
    });
  });
}

function buildNextSteps(report: LocalManagementReport): string[] {
  const steps: string[] = [];
  if (report.warnings.length > 0) {
    steps.push(`Check the ${report.warnings.length} accepted ${plural(report.warnings.length, "record")} listed above against the original source, then correct and re-import the file if needed.`);
  }
  if (report.anomalies.length > 0) {
    steps.push(`Compare the ${report.anomalies.length} statistically flagged ${plural(report.anomalies.length, "transaction")} with supporting documents; a flag alone is not evidence of an error.`);
  }
  if (report.evidenceBundle.quality.rejectedCount > 0) {
    steps.push("Resolve rejected records and re-import them before treating this review as complete.");
  }
  if (!steps.length) {
    steps.push("No warning, rejection or statistical-flag action is currently indicated; continue normal source-document review and approval controls.");
  }
  steps.push("Confirm approved accounting classifications before describing any supplied amount, debit or credit total as revenue, expenses, profit or cash flow.");
  steps.push("Have an authorized reviewer check this draft before sharing or using it for a decision.");
  return steps;
}

function buildManagementConclusion(report: LocalManagementReport, includedCount: number): string {
  const reviewItems: string[] = [];
  if (report.warnings.length > 0) reviewItems.push(`${report.warnings.length} accepted warning ${plural(report.warnings.length, "record")}`);
  if (report.anomalies.length > 0) reviewItems.push(`${report.anomalies.length} statistically flagged ${plural(report.anomalies.length, "amount")}`);
  if (report.evidenceBundle.quality.rejectedCount > 0) reviewItems.push(`${report.evidenceBundle.quality.rejectedCount} rejected ${plural(report.evidenceBundle.quality.rejectedCount, "record")}`);
  if (!reviewItems.length) {
    return `${includedCount} accepted ${plural(includedCount, "record")} ${includedCount === 1 ? "is" : "are"} included in this draft. The available checks identified no specific warning, rejection, or statistical-flag action, but normal source review and authorization are still required.`;
  }
  return `${includedCount} accepted ${plural(includedCount, "record")} ${includedCount === 1 ? "is" : "are"} included in this draft. Before relying on it, complete the checks for ${reviewItems.join(", ")}.`;
}

export function createManagementReportPresentation(report: LocalManagementReport): ManagementReportPresentation {
  const quality = report.evidenceBundle.quality;
  const checkedCount = quality.acceptedCount + quality.rejectedCount;
  const includedCount = quality.validCount + quality.includedWarningCount;
  const figureRows = buildFigureRows(report);
  return {
    checkedCount,
    includedCount,
    reportingPeriodLabel: formatReportPeriodHeading(report.reportingPeriod.startDate, report.reportingPeriod.endDate),
    overviewSummary: buildOverviewSummary(report, checkedCount, includedCount),
    managementConclusion: buildManagementConclusion(report, includedCount),
    findings: buildFindings(report, checkedCount, includedCount),
    attentionItems: buildAttentionItems(report),
    figureRows,
    periodComparisons: buildPeriodComparisons(figureRows),
    qualityCards: [
      { label: "Records checked", value: checkedCount, note: "Every row presented to the import checks", tone: "NEUTRAL" },
      { label: "Included in figures", value: includedCount, note: "Accepted records included under the selected warning policy", tone: "POSITIVE" },
      { label: "Need information checked", value: quality.warningCount, note: "Accepted records carrying validation warnings", tone: quality.warningCount ? "REVIEW" : "POSITIVE" },
      { label: "Rejected", value: quality.rejectedCount, note: "Excluded from figures and report evidence", tone: quality.rejectedCount ? "NEGATIVE" : "POSITIVE" },
    ],
    nextSteps: buildNextSteps(report),
    plainLimitations: [
      "This review covers the uploaded transaction records only. It does not establish that the data is audited, reconciled or complete.",
      "Supplied amount, debit and credit fields do not automatically mean revenue, expenses, profit or cash flow. Those meanings require approved accounting interpretation.",
      "Warning records follow the selected inclusion setting. Rejected records are excluded, so correcting them could change a later report.",
      "Statistical flags identify unusual amounts for review. They do not confirm fraud, mistakes or accounting problems.",
      "The report body is produced by a fixed template. Any optional AI explanation is separate, review-required and cannot authorize publication.",
    ],
  };
}
