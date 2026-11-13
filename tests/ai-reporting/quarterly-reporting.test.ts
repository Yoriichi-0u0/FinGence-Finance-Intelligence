import { describe, expect, it } from "vitest";
import {
  createFinancialExplanationRequest,
  createQuarterlyFinancialActivityReport,
  discoverReportBusinesses,
  listAvailableQuarterPeriods,
  quarterPeriod,
  renderLocalManagementReportHtml,
  scopeQuarterlyReportPayload,
  type QuarterlyReportSelection,
} from "../../lib/ai-reporting";
import { validateStoredLocalManagementReport } from "../../lib/ai-reporting/local-report-repository";
import type { AcceptedDataPayload, AcceptedTransaction } from "../../lib/ingestion/accepted-data";

const workbookHash = "13c0d038845941abb8e974bc55832f0b1f157bac343c4f4ab5189ba0b0a30bfb";

function row(input: {
  id: string;
  entity: string | null;
  date: string;
  side: "DEBIT" | "CREDIT";
  amount: string;
  warning?: boolean;
}): AcceptedTransaction {
  return {
    source_row_number: Number(input.id.replace(/\D/g, "")) + 2,
    source_row_id: `synthetic:${input.id}`,
    transaction_date: input.date,
    posting_date: null,
    canonical_date: input.date,
    canonical_date_basis: "TRANSACTION_DATE",
    reference: `REF-${input.id}`,
    source_transaction_id: input.id,
    account_code: null,
    account_id: "****4821",
    entity_id: input.entity,
    description: `Synthetic ${input.side.toLowerCase()} transaction`,
    counterparty: "Synthetic counterparty",
    debit: null,
    credit: null,
    source_amount: input.amount,
    balance: null,
    entry_side: input.side,
    monetary_basis: "source_amount_with_direction",
    currency: "MYR",
    currency_basis: "SOURCE",
    ingestion_status: input.warning ? "WARNING" : "VALID",
    validation_messages: input.warning ? [{
      rule: "SYNTHETIC_WARNING",
      category: "business",
      severity: "WARNING",
      field: "reference",
      sourceColumn: "Reference",
      originalValue: `REF-${input.id}`,
      message: "Synthetic warning for test review.",
    }] : [],
    transformations: [],
  };
}

function businessRows(entity: string, prefix: string, multiplier = 1): AcceptedTransaction[] {
  const inputs = [
    ["2026-01-15", "CREDIT", String(100 * multiplier)], ["2026-01-20", "DEBIT", String(30 * multiplier)],
    ["2026-02-15", "CREDIT", String(50 * multiplier)], ["2026-02-20", "DEBIT", String(20 * multiplier)],
    ["2026-03-15", "CREDIT", String(0 * multiplier)], ["2026-03-20", "DEBIT", String(0 * multiplier)],
    ["2026-04-15", "CREDIT", String(200 * multiplier)], ["2026-04-20", "DEBIT", String(80 * multiplier)],
    ["2026-05-15", "CREDIT", String(100 * multiplier)], ["2026-05-20", "DEBIT", String(20 * multiplier)],
    ["2026-06-15", "CREDIT", String(50 * multiplier)], ["2026-06-20", "DEBIT", String(10 * multiplier)],
  ] as const;
  return inputs.map(([date, side, amount], index) => row({ id: `${prefix}${index + 1}`, entity, date, side, amount }));
}

function payload(overrides: { rejected?: number; duplicateRows?: number; rows?: AcceptedTransaction[] } = {}): AcceptedDataPayload {
  const rows = overrides.rows ?? [...businessRows("BUS-001", "a"), ...businessRows("BUS-002", "b", 10)];
  const warning = rows.filter(candidate => candidate.ingestion_status === "WARNING").length;
  const rejected = overrides.rejected ?? 0;
  return {
    schema_version: "0.1",
    ruleset_version: "0.1",
    datasets: [{
      dataset_id: "synthetic-quarterly",
      source_system: "Synthetic test bank",
      source_file: "Datasets.xlsx",
      source_sheet: "Transactions",
      file_sha256: workbookHash,
      ingestion_batch_id: "quarterly-test-batch",
      ingested_at: "2026-10-31T00:00:00.000Z",
      normalized: rows,
      summary: {
        rowsReceived: rows.length + rejected,
        accepted: rows.length,
        valid: rows.length - warning,
        warning,
        rejected,
        requiredCompleteness: 100,
        duplicateRows: overrides.duplicateRows ?? 0,
      },
    }],
  };
}

const selection: QuarterlyReportSelection = {
  businessId: "BUS-001",
  businessDisplayName: "Kopi Kita Cafe Sdn. Bhd.",
  currentPeriod: quarterPeriod(2026, 2),
  comparisonPeriod: quarterPeriod(2026, 1),
};

describe("company-scoped quarterly financial activity reporting", () => {
  it("discovers verified businesses and supported calendar quarters", () => {
    const input = payload();
    expect(discoverReportBusinesses(input)).toMatchObject({
      reliable: true,
      options: [
        { businessId: "BUS-001", displayName: "Kopi Kita Cafe Sdn. Bhd.", recordCount: 12 },
        { businessId: "BUS-002", displayName: "Borneo BuildWorks Sdn. Bhd.", recordCount: 12 },
      ],
    });
    expect(listAvailableQuarterPeriods(input, "BUS-001").map(period => period.key)).toEqual(["2026-Q2", "2026-Q1"]);
  });

  it("isolates one company and only the selected current/comparison periods", () => {
    const scoped = scopeQuarterlyReportPayload(payload(), selection);
    expect(scoped.currentRows).toHaveLength(6);
    expect(scoped.comparisonRows).toHaveLength(6);
    expect(scoped.payload.datasets[0].normalized).toHaveLength(12);
    expect(scoped.payload.datasets[0].normalized.every(candidate => candidate.entity_id === "BUS-001")).toBe(true);
    expect(scoped.payload.datasets[0].normalized.every(candidate => candidate.canonical_date >= "2026-01-01" && candidate.canonical_date <= "2026-06-30")).toBe(true);
  });

  it("calculates exact directional activity, safe changes, monthly reconciliation, and explicit unavailable meanings", async () => {
    const report = await createQuarterlyFinancialActivityReport({
      payload: payload(),
      warningPolicy: "include",
      selection,
      generatedAt: "2026-10-31T02:10:00.000Z",
    });
    const activity = report.quarterlyActivity!;

    expect(report).toMatchObject({
      reportType: "QUARTERLY_FINANCIAL_ACTIVITY",
      organizationName: "Kopi Kita Cafe Sdn. Bhd.",
      title: "SECOND QUARTER 2026 FINANCIAL ACTIVITY RESULTS",
      reportingPeriod: { startDate: "2026-04-01", endDate: "2026-06-30" },
      currencyLabel: "MYR",
      publicationAuthorized: false,
    });
    expect(activity.current).toMatchObject({ bankCredits: "350", bankDebits: "110", includedTransactionCount: 6, monetaryBasis: "source_amount_with_direction" });
    expect(activity.comparison).toMatchObject({ bankCredits: "150", bankDebits: "50", includedTransactionCount: 6 });
    expect(activity.comparisons).toEqual([
      expect.objectContaining({ measure: "BANK_CREDITS", absoluteChange: "200", percentageChange: "133.33" }),
      expect.objectContaining({ measure: "BANK_DEBITS", absoluteChange: "60", percentageChange: "120" }),
      expect.objectContaining({ measure: "TRANSACTION_COUNT", absoluteChange: "0", percentageChange: "0" }),
    ]);
    expect(activity.months.map(month => [month.period, month.bankCredits, month.bankDebits, month.transactionCount])).toEqual([
      ["2026-04", "200", "80", 2],
      ["2026-05", "100", "20", 2],
      ["2026-06", "50", "10", 2],
    ]);
    expect(activity.months.reduce((sum, month) => sum + Number(month.bankCredits), 0)).toBe(350);
    expect(activity.current.netRecordedBankMovement).toMatchObject({ status: "UNAVAILABLE", exactValue: null });
    expect(activity.current.openingBankBalance.status).toBe("UNAVAILABLE");
    expect(activity.categoryBreakdown.status).toBe("UNAVAILABLE");
    expect(report.limitations.join(" ")).toContain("not revenue, expenses, profit");
    const explanationRequest = createFinancialExplanationRequest(report);
    expect(explanationRequest.bundle.period).toMatchObject({ startDate: "2026-04-01", endDate: "2026-06-30" });
    expect(explanationRequest.bundle.quality).toMatchObject({ acceptedCount: 6, warningCount: 0, rejectedCount: 0 });
    expect(explanationRequest.bundle.evidenceItems.map(item => [item.label, item.value])).toEqual([
      ["Recorded bank credits for Q2 2026", expect.objectContaining({ kind: "MONETARY", amount: "350", sourceComponent: "CREDIT" })],
      ["Recorded bank debits for Q2 2026", expect.objectContaining({ kind: "MONETARY", amount: "110", sourceComponent: "DEBIT" })],
      ["Records included for Q2 2026 under the selected warning policy", { kind: "COUNT", value: 6, unit: "RECORDS" }],
      ["Statistical amount review candidates for Q2 2026", expect.objectContaining({ kind: "COUNT" })],
    ]);
    expect(validateStoredLocalManagementReport(report)).toBe(report);
  });

  it("keeps every current-quarter directional figure tied to selected-company source evidence", async () => {
    const report = await createQuarterlyFinancialActivityReport({ payload: payload(), warningPolicy: "include", selection });
    const evidenceIds = new Set(report.evidenceBundle.items.map(item => item.evidenceId));
    const cited = [
      ...report.quarterlyActivity!.current.evidenceIds.bankCredits,
      ...report.quarterlyActivity!.current.evidenceIds.bankDebits,
      ...report.quarterlyActivity!.months.flatMap(month => [...month.evidenceIds.bankCredits, ...month.evidenceIds.bankDebits]),
    ];
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.every(id => evidenceIds.has(id))).toBe(true);
    expect(cited.every(id => id.includes("synthetic:a"))).toBe(true);
    expect(cited.some(id => id.includes("synthetic:b"))).toBe(false);
  });

  it("rejects unreliable company ownership, unattributable rejected rows, and duplicate counts", () => {
    const missingEntityRows = businessRows("BUS-001", "a");
    missingEntityRows[0] = { ...missingEntityRows[0], entity_id: null };
    expect(discoverReportBusinesses(payload({ rows: missingEntityRows })).reliable).toBe(false);
    expect(() => scopeQuarterlyReportPayload(payload({ rejected: 1 }), selection)).toThrow(/rejected rows cannot be safely attributed/i);
    expect(() => scopeQuarterlyReportPayload(payload({ duplicateRows: 1 }), selection)).toThrow(/duplicate-row counts cannot be safely attributed/i);
  });

  it("keeps companies in separate report identities and renders a formal honest HTML report", async () => {
    const input = payload();
    const kopi = await createQuarterlyFinancialActivityReport({ payload: input, warningPolicy: "include", selection, generatedAt: "2026-10-31T02:10:00.000Z" });
    const borneo = await createQuarterlyFinancialActivityReport({
      payload: input,
      warningPolicy: "include",
      selection: { ...selection, businessId: "BUS-002", businessDisplayName: "Borneo BuildWorks Sdn. Bhd." },
      generatedAt: "2026-10-31T02:10:00.000Z",
    });
    expect(kopi.reportId).not.toBe(borneo.reportId);
    expect(kopi.quarterlyActivity!.current.bankCredits).toBe("350");
    expect(borneo.quarterlyActivity!.current.bankCredits).toBe("3500");

    const html = renderLocalManagementReportHtml(kopi);
    expect(html).toContain("SECOND QUARTER 2026 FINANCIAL ACTIVITY RESULTS");
    expect(html).toContain("Q2 2026 Highlights");
    expect(html).toContain("Quarterly Performance Comparison");
    expect(html).toContain("Monthly Financial Activity");
    expect(html).toContain("Basis of Preparation and Limitations");
    expect(html).toContain("Appendix B - Report Controls and Audit Trail");
    expect(html).toContain("RM 350.00");
    expect(html).toContain("Net movement, profit and formal cash flow are not reported");
    expect(html).toContain("@page{size:A4");
    expect(html).not.toMatch(/Revenue<\/th>[^]*RM/i);
    expect(html).not.toMatch(/Profit<\/th>[^]*RM/i);
  });
});
