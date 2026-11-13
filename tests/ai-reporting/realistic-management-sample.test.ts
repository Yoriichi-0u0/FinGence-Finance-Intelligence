import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { analyzeAcceptedDataPayload } from "../../lib/analytics/accepted-data-adapter";
import {
  createManagementReportPresentation,
  createFinancialExplanationRequest,
  createLocalManagementReport,
  renderLocalManagementReportHtml,
} from "../../lib/ai-reporting";
import {
  DEFAULT_OPTIONS,
  approveMapping,
  createAcceptedDataPayload,
  createDataset,
  ingestDatasetRun,
  inspectFile,
  mappingErrors,
  suggestMapping,
} from "../../lib/ingestion";

describe("realistic synthetic management-report sample", () => {
  it("passes the real ingestion, analytics, report and explanation-input path", async () => {
    const bytes = await readFile("public/samples/ai-reporting/realistic_company_ledger.csv");
    const file = await inspectFile(bytes, { name: "realistic_company_ledger.csv" });
    const dataset = createDataset(file, 0);
    const mapping = approveMapping(suggestMapping(dataset));
    const options = {
      ...DEFAULT_OPTIONS,
      sourceSystem: "Synthetic Company Ledger",
      monetaryMode: "debit_credit" as const,
      dateBasis: "transaction_date" as const,
    };

    expect(mappingErrors(dataset, mapping, options)).toEqual([]);
    const result = ingestDatasetRun(dataset, mapping, options, {
      idFactory: () => "00000000-0000-4000-8000-000000000099",
      now: () => new Date("2026-10-29T12:00:00.000Z"),
    });
    expect(result.summary).toMatchObject({
      rowsReceived: 36,
      accepted: 36,
      valid: 35,
      warning: 1,
      rejected: 0,
    });
    expect(result.normalized[17].validation_messages.map(issue => issue.rule)).toContain("MISSING_REFERENCE");

    const payload = createAcceptedDataPayload([result]);
    const analysis = analyzeAcceptedDataPayload(payload, "include");
    expect(analysis.monthlyAggregates.map(group => [group.period, group.debitTotal, group.creditTotal])).toEqual([
      ["2026-07", "25500", "13530"],
      ["2026-08", "28600", "14380"],
      ["2026-09", "31500", "15100"],
    ]);

    const report = await createLocalManagementReport({
      payload,
      analysis,
      warningPolicy: "include",
      organizationName: "Synthetic Example Sdn Bhd",
      generatedAt: "2026-10-29T12:05:00.000Z",
    });
    expect(report.metrics.map(metric => [metric.period, metric.label, metric.exactValue])).toEqual([
      ["2026-07", "Total supplied debit values", "25500"],
      ["2026-07", "Total supplied credit values", "13530"],
      ["2026-08", "Total supplied debit values", "28600"],
      ["2026-08", "Total supplied credit values", "14380"],
      ["2026-09", "Total supplied debit values", "31500"],
      ["2026-09", "Total supplied credit values", "15100"],
    ]);
    expect(report.currencyLabel).toBe("MYR");
    expect(report.warnings).toHaveLength(1);
    expect(report.anomalies).toHaveLength(3);
    expect(report.publicationAuthorized).toBe(false);

    const presentation = createManagementReportPresentation(report);
    expect(presentation).toMatchObject({ checkedCount: 36, includedCount: 36 });
    expect(presentation.overviewSummary).toContain("36 uploaded financial records");
    expect(presentation.findings.find(finding => finding.id === "warning-records")?.title).toContain("1 accepted record");
    expect(presentation.findings.find(finding => finding.id === "statistical-flags")?.title).toContain("3 unusually large amounts");
    expect(presentation.attentionItems.filter(item => item.kind === "WARNING_RECORD")).toHaveLength(1);
    expect(presentation.attentionItems.filter(item => item.kind === "STATISTICAL_FLAG")).toHaveLength(3);
    expect(presentation.figureRows.map(row => [row.period, row.debitTotal, row.creditTotal])).toEqual([
      ["2026-07", "25500", "13530"],
      ["2026-08", "28600", "14380"],
      ["2026-09", "31500", "15100"],
    ]);
    expect(presentation.reportingPeriodLabel).toBe("Period from 2 July 2026 to 29 September 2026");
    expect(presentation.periodComparisons.map(item => [
      item.label,
      item.currentPeriod,
      item.currentExactValue,
      item.priorPeriod,
      item.priorExactValue,
    ])).toEqual([
      ["Supplied debit", "2026-09", "31500", "2026-08", "28600"],
      ["Supplied credit", "2026-09", "15100", "2026-08", "14380"],
    ]);

    const html = renderLocalManagementReportHtml(report);
    expect(html).toContain("Management Financial Data Review");
    expect(html).toContain("Period from 2 July 2026 to 29 September 2026");
    expect(html).toContain("Summary of Selected Source-Value Results");
    expect(html).toContain("Latest reported month");
    expect(html).toContain("Management Review and Next Steps");
    expect(html.indexOf("Selected Period Highlights")).toBeLessThan(html.indexOf("Summary of Selected Source-Value Results"));
    expect(html.indexOf("Items Requiring Review")).toBeLessThan(html.indexOf("Detailed Monthly Source Values"));
    expect(html.indexOf("Statistical audit values")).toBeLessThan(html.indexOf("robust score"));

    const explanationInput = createFinancialExplanationRequest(report);
    expect(explanationInput.sourceFileSha256).toBe("f10edefcf4f09a7695125ff1d727e2501ebb22f7283d441d0ed8a22336173d3a");
    expect(explanationInput.untrustedSourceTextPolicy).toBe("EXCLUDED_FROM_MODEL_INPUT");
    expect(JSON.stringify(explanationInput)).not.toContain("Northstar Retail");
  });
});
