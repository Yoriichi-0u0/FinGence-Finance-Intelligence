import { beforeAll, describe, expect, it } from "vitest";
import { analyzeAcceptedDataPayload } from "../../lib/analytics/accepted-data-adapter";
import {
  createManagementReportPresentation,
  createLocalManagementReport,
  renderLocalManagementReportHtml,
} from "../../lib/ai-reporting";
import { createAcceptedDataPayload, type IngestionResult } from "../../lib/ingestion";
import { consultationResults } from "../integration/fixtures";

let results: IngestionResult[];

beforeAll(async () => {
  results = await consultationResults();
});

async function reportFor(filename: string, warningPolicy: "include" | "exclude" = "include") {
  const selected = results.find(result => result.dataset.file.name === filename);
  if (!selected) throw new Error(`Missing synthetic fixture ${filename}.`);
  const payload = createAcceptedDataPayload([selected]);
  const analysis = analyzeAcceptedDataPayload(payload, warningPolicy);
  return createLocalManagementReport({
    payload,
    analysis,
    warningPolicy,
    organizationName: "Synthetic Test Workspace",
    generatedAt: "2026-10-27T12:00:00.000Z",
  });
}

describe("local management report integration", () => {
  it("builds a grounded manual-template draft from the real ledger ingestion and analytics path", async () => {
    const report = await reportFor("ledger.csv");

    expect(report).toMatchObject({
      status: "LOCAL_DRAFT_PREVIEW",
      organizationName: "Synthetic Test Workspace",
      title: "Management Financial Data Review",
      subtitle: "Source-value results and data-quality review for 1 September 2026 to 10 September 2026.",
      generation: { method: "MANUAL_TEMPLATE", templateVersion: "local-management-source-values-0.3", llmUsed: false },
      reportingPeriod: { startDate: "2026-09-01", endDate: "2026-09-10", dateBasis: "CANONICAL_DATE" },
      currencyLabel: "MYR",
      structuralPrecheck: "PASSED",
      publicationAuthorized: false,
      dataset: { sourceFile: "ledger.csv", sourceSystem: "Ledger" },
    });
    expect(report.metrics.map(metric => [metric.label, metric.exactValue])).toEqual([
      ["Total supplied debit values", "2129.4"],
      ["Total supplied credit values", "403.55"],
    ]);
    expect(report.metrics.every(metric => metric.claim.support.assurance === "STRUCTURAL_ONLY")).toBe(true);
    expect(report.metrics.every(metric => metric.claim.support.status === "SUPPORTED_WITH_CAVEAT")).toBe(true);
    expect(report.metrics.every(metric => metric.claim.support.requiredCaveats.includes("INTERPRETATION_LIMITATION"))).toBe(true);
    expect(report.unavailableMetrics.map(metric => metric.label)).toEqual([
      "Revenue", "Expenses", "Profit", "Cash flow", "Budget variance", "Reconciliation",
    ]);
    expect(report.evidenceBundle.items).toHaveLength(28);
    expect(report.evidenceBundle.currencyScope).toEqual({
      status: "SINGLE", currencies: ["MYR"], hasMissingCurrency: false,
    });
  });

  it("keeps warning, rejected-count and mixed-currency limitations visible", async () => {
    const report = await reportFor("edge_cases.csv");
    const codes = report.policyExceptions.map(exception => exception.code);

    expect(report.evidenceBundle.quality).toMatchObject({
      acceptedCount: 5,
      warningCount: 3,
      rejectedCount: 3,
      rejectedRecordsInEvidence: 0,
    });
    expect(report.warnings).toHaveLength(3);
    expect(report.warnings[0]).toMatchObject({
      canonicalDate: expect.any(String),
      issues: expect.any(Array),
    });
    expect(codes).toEqual(expect.arrayContaining([
      "MIXED_CURRENCY",
      "WARNING_RECORDS_INCLUDED",
      "REJECTED_ROWS_PRESENT",
    ]));
    expect(renderLocalManagementReportHtml(report)).toContain(report.warnings[0].sourceRowId);
    expect(report.structuralPrecheck).toBe("REVIEW_REQUIRED");
    expect(report.publicationAuthorized).toBe(false);
    expect(report.anomalies).toHaveLength(0);

    const presentation = createManagementReportPresentation(report);
    expect(presentation).toMatchObject({ checkedCount: 8, includedCount: 5 });
    expect(presentation.attentionItems.filter(item => item.kind === "WARNING_RECORD")).toHaveLength(3);
    expect(presentation.attentionItems.find(item => item.kind === "REJECTED_RECORDS")?.suggestedAction).toContain("re-import");
    expect(presentation.findings.find(finding => finding.id === "statistical-flags")?.title).toBe("No unusually large amounts were flagged");
  });

  it("uses the selected warning policy when describing records included in figures", async () => {
    const report = await reportFor("edge_cases.csv", "exclude");
    const presentation = createManagementReportPresentation(report);

    expect(report.evidenceBundle.quality).toMatchObject({
      acceptedCount: 5,
      validCount: 2,
      warningCount: 3,
      includedWarningCount: 0,
      excludedWarningCount: 3,
    });
    expect(presentation.includedCount).toBe(2);
    expect(presentation.overviewSummary).toContain("2 of 5 accepted records were included");
    expect(presentation.findings.find(finding => finding.id === "warning-records")?.detail).toContain("excluded");
  });

  it("reports the synthetic bank statement as source amounts without inventing cash-flow meaning", async () => {
    const report = await reportFor("bank_statement.xlsx");

    expect(report.evidenceBundle.quality).toMatchObject({
      acceptedCount: 8,
      warningCount: 0,
      rejectedCount: 0,
    });
    expect(report.metrics.map(metric => [metric.label, metric.exactValue])).toEqual([
      ["Total supplied amount values", "2345.75"],
    ]);
    expect(report.metrics[0].claim.text).toContain("no automatic revenue, expense, profit, or cash-flow meaning");
    expect(report.unavailableMetrics.find(metric => metric.label === "Cash flow")?.reason).toContain("do not establish universal cash-flow meaning");
    expect(createManagementReportPresentation(report).findings.find(finding => finding.id === "warning-records")?.title)
      .toBe("No accepted records carry validation warnings");
    const html = renderLocalManagementReportHtml(report);
    expect(html).toContain(">Supplied amount</th>");
    expect(html).not.toContain(">Supplied debit</th>");
    expect(html).not.toContain(">Supplied credit</th>");
    expect(html).not.toContain("<small>source_amount_with_direction</small>");
  });

  it("exports the same grounded figures and honesty labels in a self-contained HTML draft", async () => {
    const report = await reportFor("ledger.csv");
    const html = renderLocalManagementReportHtml(report);

    expect(html).toContain("RM 2,129.40");
    expect(html).toContain("RM 403.55");
    expect(html).toContain(report.metrics[0].evidenceId);
    expect(html).toContain(report.dataset.fileSha256);
    expect(html).toContain("Any optional AI explanation is separate");
    expect(html).toContain("Draft - not approved");
    expect(html).toContain("Management Financial Data Review");
    expect(html).toContain("For internal review");
    expect(html).toContain("Selected Period Highlights");
    expect(html).toContain("Items Requiring Review");
    expect(html).toContain("Summary of Selected Source-Value Results");
    expect(html).toContain("Detailed Monthly Source Values");
    expect(html).toContain("Management Review and Next Steps");
    expect(html).toContain("Technical Details and Audit Information");
    expect(html).toContain("Revenue: No client-approved revenue interpretation");
    expect(html.indexOf("Selected Period Highlights")).toBeLessThan(html.indexOf("Summary of Selected Source-Value Results"));
    expect(html).toContain("details>*{display:block!important}");
    expect(html).toContain("@page{size:A4");
    expect(html).not.toContain("What this report is");
    expect(html).not.toContain("quality-card");
    expect(html).not.toContain("border-radius");
    expect(html).not.toContain(">Supplied amount</th>");
    expect(html).not.toContain("<small>debit_credit</small>");
    expect(html).not.toContain("Revenue</span><strong>RM");
  });
});
