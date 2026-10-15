import { describe, expect, it } from "vitest";
import type { CanonicalTransaction } from "../lib/ingestion/models";
import {
  aggregateCanonicalRecords,
  calculateFinancialMetrics,
  detectRobustAmountAnomalies,
  evaluateNaiveWalkForward,
  forecastMovingAverage,
  forecastNaive,
  prepareAcceptedRecords,
} from "../lib/analytics";

function row(overrides: Partial<CanonicalTransaction> = {}): CanonicalTransaction {
  return {
    source_system: "test", source_file: "test.csv", source_sheet: null, source_row_number: 2,
    source_row_id: "row-1", file_sha256: "a".repeat(64), ingestion_batch_id: "batch-1",
    ingested_at: "2026-10-01T00:00:00.000Z", transaction_date: "2026-01-01", posting_date: null,
    canonical_date: "2026-01-01", canonical_date_basis: "TRANSACTION_DATE", reference: null,
    source_transaction_id: null, account_code: "1000", account_id: null, entity_id: null,
    description: "Test", counterparty: null, debit: null, credit: null, source_amount: "10.00",
    derived_ledger_net: null, balance: null, entry_side: "DEBIT", monetary_basis: "source_amount_with_direction",
    currency: "MYR", currency_basis: "SOURCE", transformations: [], ingestion_status: "VALID",
    validation_messages: [], ...overrides,
  };
}
const envelope = (normalized: CanonicalTransaction[]) => ({ schema_version: "0.1", ruleset_version: "0.1", normalized });

describe("prepareAcceptedRecords", () => {
  it("includes warnings by default and can exclude them explicitly", () => {
    const rows = [row(), row({ source_row_id: "row-2", ingestion_status: "WARNING" })];
    expect(prepareAcceptedRecords(envelope(rows)).counts).toMatchObject({ received: 2, included: 2, valid: 1, warning: 1, excludedWarnings: 0 });
    const excluded = prepareAcceptedRecords(envelope(rows), "exclude");
    expect(excluded.records.map((item) => item.source_row_id)).toEqual(["row-1"]);
    expect(excluded.excludedWarningRecords).toHaveLength(1);
  });
  it("rejects unsupported contract versions before processing", () => {
    expect(() => prepareAcceptedRecords({ ...envelope([]), schema_version: "9.0" })).toThrow(/Unsupported schema_version/);
  });
});

describe("aggregateCanonicalRecords", () => {
  it("rejects malformed canonical money instead of silently dropping it", () => {
    expect(() => aggregateCanonicalRecords([row({ source_amount: "not-money" })])).toThrow(/valid decimal string/);
  });
  it("keeps money as exact decimal strings and separates currencies and monetary bases", () => {
    const rows = [
      row({ source_amount: "9007199254740993.10" }),
      row({ source_row_id: "row-2", source_amount: "0.90" }),
      row({ source_row_id: "row-3", currency: "USD", source_amount: "2" }),
      row({ source_row_id: "row-4", monetary_basis: "debit_credit", source_amount: null, debit: "4.20", credit: "1.20", derived_ledger_net: "3" }),
    ];
    const result = aggregateCanonicalRecords(rows);
    expect(result.find((item) => item.currency === "MYR" && item.monetary_basis === "source_amount_with_direction")?.sourceAmountTotal).toBe("9007199254740994");
    expect(result.find((item) => item.currency === "USD")?.sourceAmountTotal).toBe("2");
    expect(result.find((item) => item.monetary_basis === "debit_credit")).toMatchObject({ debitTotal: "4.2", creditTotal: "1.2", ledgerNetTotal: "3" });
  });
});

describe("financial metrics", () => {
  it("calculates net, ratios, budget variance and period change deterministically", () => {
    expect(calculateFinancialMetrics([
      { period: "2026-01", revenue: 100, expenses: 60, budgetedExpenses: 50 },
      { period: "2026-02", revenue: 120, expenses: 90, budgetedExpenses: 80 },
    ])).toEqual([
      { period: "2026-01", revenue: 100, expenses: 60, netOperatingAmount: 40, operatingMargin: 0.4, expenseToRevenue: 0.6, expenseVariance: 10, expenseVariancePercent: 0.2, revenueChange: null, revenueChangePercent: null },
      { period: "2026-02", revenue: 120, expenses: 90, netOperatingAmount: 30, operatingMargin: 0.25, expenseToRevenue: 0.75, expenseVariance: 10, expenseVariancePercent: 0.125, revenueChange: 20, revenueChangePercent: 0.2 },
    ]);
  });
  it("returns null for ratios with zero denominators", () => {
    expect(calculateFinancialMetrics([{ period: "2026-01", revenue: 0, expenses: 10 }])[0]).toMatchObject({ operatingMargin: null, expenseToRevenue: null });
  });
});

describe("forecasting baselines and evaluation", () => {
  it("creates naive and moving-average forecasts", () => {
    expect(forecastNaive([10, 20, 30], 2)).toEqual([30, 30]);
    expect(forecastMovingAverage([10, 20, 30, 40], 2, 2)).toEqual([35, 35]);
  });
  it("evaluates only one-step-ahead predictions using prior values", () => {
    expect(evaluateNaiveWalkForward([10, 20, 30, 40], 2)).toMatchObject({
      predictions: [20, 30], actuals: [30, 40], mae: 10, rmse: 10, meanError: -10,
    });
  });
  it("rejects insufficient history and invalid horizon", () => {
    expect(() => forecastNaive([], 1)).toThrow(/At least one/);
    expect(() => forecastMovingAverage([1], 0)).toThrow(/horizon/);
    expect(() => evaluateNaiveWalkForward([1, 2], 2)).toThrow(/Not enough/);
  });
});

describe("robust anomaly baseline", () => {
  it("uses the midpoint median for an even group instead of dividing the middle sum by ten", () => {
    // Median=35, absolute deviations=5,5,15,15,25,25; MAD=15.
    // Largest score=0.6745*25/15=1.124..., safely below the threshold 4.5.
    const rows = ["10", "20", "30", "40", "50", "60"].map((amount, index) => row({
      source_row_id: `even-${index}`, source_amount: amount,
    }));
    expect(detectRobustAmountAnomalies(rows)).toEqual([]);
  });
  it("flags an extreme amount within a comparable group and retains provenance", () => {
    const rows = [10, 11, 9, 10, 12, 1000].map((amount, index) => row({
      source_row_id: `row-${index}`, source_row_number: index + 2, source_amount: String(amount),
    }));
    const result = detectRobustAmountAnomalies(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source_row_id: "row-5", source_file: "test.csv", source_row_number: 7, currency: "MYR", severity: "HIGH" });
    expect(result[0].reason).toContain("Review the source");
  });
  it("does not compare rows across currencies or account codes", () => {
    const rows = [10, 11, 9, 10, 12].map((amount, index) => row({ source_row_id: `a-${index}`, source_amount: String(amount) }));
    rows.push(row({ source_row_id: "usd-outlier", currency: "USD", source_amount: "1000" }));
    expect(detectRobustAmountAnomalies(rows)).toEqual([]);
  });
  it("validates detector options", () => {
    expect(() => detectRobustAmountAnomalies([row()], { threshold: 0 })).toThrow(/threshold/);
  });
});
