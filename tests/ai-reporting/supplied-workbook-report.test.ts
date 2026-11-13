import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { analyzeAcceptedDataPayload } from "../../lib/analytics/accepted-data-adapter";
import {
  createLocalManagementReport,
  createQuarterlyFinancialActivityReport,
  createManagementReportPresentation,
  createFinancialExplanationRequest,
  discoverReportBusinesses,
  quarterPeriod,
  renderLocalManagementReportHtml,
  type SourceLineage,
} from "../../lib/ai-reporting";
import { validateStoredLocalManagementReport } from "../../lib/ai-reporting/local-report-repository";
import {
  DEFAULT_OPTIONS,
  approveMapping,
  createAcceptedDataPayload,
  createDataset,
  ingestDataset,
  inspectFile,
  suggestMapping,
} from "../../lib/ingestion";

const workbookPath = process.env.FINSIGHT_WORKBOOK_PATH;

// Optional local integration evidence. The supplied workbook is explicitly
// synthetic, stays outside Git, and contributes only its Transactions sheet.
it.skipIf(!workbookPath)("builds a storable source-value report from the supplied synthetic workbook", async () => {
  const file = await inspectFile(readFileSync(workbookPath!), { name: "Datasets.xlsx" });
  const sheet = file.sheets.find(candidate => candidate.name === "Transactions");
  expect(sheet).toBeDefined();

  const dataset = createDataset(file, sheet!.index);
  const result = ingestDataset(dataset, approveMapping(suggestMapping(dataset)), {
    ...DEFAULT_OPTIONS,
    monetaryMode: "amount_direction",
    sourceSystem: "Supplied synthetic bank",
  }, {
    batchId: "supplied-synthetic-report",
    ingestedAt: "2026-09-28T00:00:00Z",
  });
  expect(result.summary).toMatchObject({ rowsReceived: 6000, accepted: 6000, rejected: 0 });
  expect(result.normalized.every(row => row.source_sheet === "Transactions")).toBe(true);

  const payload = createAcceptedDataPayload([result]);
  const analysis = analyzeAcceptedDataPayload(payload, "include");
  const report = await createLocalManagementReport({
    payload,
    analysis,
    warningPolicy: "include",
    organizationName: "Synthetic Workbook Demonstration",
    generatedAt: "2026-10-31T02:00:00.000Z",
  });
  const presentation = createManagementReportPresentation(report);

  expect(report.dataset).toMatchObject({
    sourceFile: "Datasets.xlsx",
    sourceSheet: "Transactions",
    fileSha256: "13c0d038845941abb8e974bc55832f0b1f157bac343c4f4ab5189ba0b0a30bfb",
  });
  expect(report.reportingPeriod).toMatchObject({ startDate: "2025-09-01", endDate: "2026-08-31" });
  expect(report.currencyLabel).toBe("MYR");
  expect(presentation.reportingPeriodLabel).toBe("Period from 1 September 2025 to 31 August 2026");
  expect(presentation.figureRows).toHaveLength(12);
  expect(report.anomalies).toHaveLength(757);
  expect(presentation.figureRows.every(row => row.sourceAmountTotal !== null && row.debitTotal === null && row.creditTotal === null)).toBe(true);
  expect(presentation.periodComparisons.map(item => [item.label, item.currentPeriod, item.priorPeriod])).toEqual([
    ["Supplied amount", "2026-08", "2026-07"],
  ]);
  expect(JSON.stringify(report).length).toBeLessThanOrEqual(16_000_000);
  expect(presentation.attentionItems.filter(item => item.kind === "STATISTICAL_FLAG")).toHaveLength(25);
  expect(presentation.attentionItems.find(item => item.kind === "STATISTICAL_FLAG_SUMMARY")?.summary).toContain("all 757 statistical flags");
  const explanationRequest = createFinancialExplanationRequest(report);
  expect(explanationRequest.bundle.evidenceItems).toHaveLength(17);
  expect(explanationRequest.bundle.evidenceItems.find(item => item.derivation.functionId === "analytics.detectRobustAmountAnomalies.count")?.value).toEqual({
    kind: "COUNT",
    value: 757,
    unit: "OTHER",
  });
  expect(validateStoredLocalManagementReport(report)).toBe(report);

  const html = renderLocalManagementReportHtml(report);
  expect(html).toContain("Management Financial Data Review");
  expect(html).toContain("Summary of Selected Source-Value Results");
  expect(html).toContain("Detailed Monthly Source Values");
  expect(html).toContain("not automatically income, expenses, profit, or cash flow");
  expect(html).toContain("Transactions");

  const businesses = discoverReportBusinesses(payload);
  expect(businesses).toMatchObject({
    reliable: true,
    options: [
      { businessId: "BUS-001", displayName: "Kopi Kita Cafe Sdn. Bhd.", recordCount: 2000 },
      { businessId: "BUS-002", displayName: "Borneo BuildWorks Sdn. Bhd.", recordCount: 2000 },
      { businessId: "BUS-003", displayName: "PixelCart Online Sdn. Bhd.", recordCount: 2000 },
    ],
  });

  const quarterly = await createQuarterlyFinancialActivityReport({
    payload,
    warningPolicy: "include",
    selection: {
      businessId: "BUS-001",
      businessDisplayName: "Kopi Kita Cafe Sdn. Bhd.",
      currentPeriod: quarterPeriod(2026, 2),
      comparisonPeriod: quarterPeriod(2026, 1),
    },
    generatedAt: "2026-10-31T02:10:00.000Z",
  });
  expect(quarterly.quarterlyActivity?.current).toMatchObject({
    period: { key: "2026-Q2", startDate: "2026-04-01", endDate: "2026-06-30" },
    bankCredits: "580757.41",
    bankDebits: "402082.45",
    acceptedTransactionCount: 494,
    includedTransactionCount: 494,
    currency: "MYR",
    monetaryBasis: "source_amount_with_direction",
  });
  expect(quarterly.quarterlyActivity?.comparison).toMatchObject({
    period: { key: "2026-Q1" },
    bankCredits: "532894.69",
    bankDebits: "343104.66",
    acceptedTransactionCount: 483,
  });
  expect(quarterly.quarterlyActivity?.months.reduce((sum, month) => sum + month.transactionCount, 0)).toBe(494);
  expect(quarterly.anomalies.every(finding => finding.canonical_date >= "2026-04-01" && finding.canonical_date <= "2026-06-30")).toBe(true);
  const sourceRows = new Map(payload.datasets[0].normalized.map(row => [row.source_row_id, row]));
  const lineageRows = quarterly.evidenceBundle.items.flatMap(item => {
    if (!("lineage" in item)) return [];
    const lineages: readonly SourceLineage[] = Array.isArray(item.lineage)
      ? item.lineage
      : [item.lineage as SourceLineage];
    return lineages.map(lineage => lineage.sourceRowId ? sourceRows.get(lineage.sourceRowId) : undefined);
  });
  expect(lineageRows.length).toBeGreaterThan(0);
  expect(lineageRows.every(row => row?.entity_id === "BUS-001")).toBe(true);
  expect(lineageRows.every(row => row!.canonical_date >= "2026-01-01" && row!.canonical_date <= "2026-06-30")).toBe(true);
  expect(validateStoredLocalManagementReport(quarterly)).toBe(quarterly);
  const quarterlyHtml = renderLocalManagementReportHtml(quarterly);
  expect(quarterlyHtml).toContain("Kopi Kita Cafe Sdn. Bhd.");
  expect(quarterlyHtml).toContain("SECOND QUARTER 2026 FINANCIAL ACTIVITY RESULTS");
  expect(quarterlyHtml).toContain("RM 580,757.41");
  expect(quarterlyHtml).toContain("RM 402,082.45");
  expect(quarterlyHtml).toContain("Net movement is not reported");
});
