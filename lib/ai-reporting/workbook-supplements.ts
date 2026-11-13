import type { LoadedFile, RawCell, RawSheet } from "../ingestion";
import type {
  QuarterlyActivityMonth,
  QuarterlyReportPeriod,
  QuarterlyWorkbookSupplements,
  WorkbookCategoryActivityRow,
  WorkbookGroundTruthRow,
  WorkbookMonthlySummaryRow,
  WorkbookSupplementStatus,
  WorkbookTransactionScheduleRow,
} from "./local-management-report";
import type { AcceptedTransaction } from "../ingestion/accepted-data";

const MONTHLY_SUMMARY_HEADERS = [
  "Business ID", "Business Name", "Statement Month", "Opening Balance", "Total Credits",
  "Total Debits", "Closing Balance", "Transaction Count", "Anomaly Count",
] as const;
const GROUND_TRUTH_HEADERS = [
  "Transaction ID", "Business ID", "HF Category Ground Truth", "Business Category Ground Truth",
  "Is Anomaly", "Anomaly Type", "Review Expected",
] as const;
const CATEGORY_MAPPING_HEADERS = [
  "Business ID", "Business Name", "HF Category", "Business Category", "Generation Weight",
] as const;
const METHODOLOGY_HEADERS = ["Item", "Details"] as const;
const TRANSACTION_HEADERS = [
  "Transaction ID", "Business ID", "Business Name", "Industry", "Account Number", "Currency",
  "Transaction Date", "Statement Month", "Raw HF-Style Description", "Direction", "Amount",
  "HF Category", "Business Category", "Bank Format", "Counterparty", "Reference", "Running Balance",
  "Generation Method",
] as const;

function cellText(cell: RawCell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") return cell.value.trim();
  return String(cell).trim();
}

function sheet(file: LoadedFile, name: string): RawSheet | null {
  return file.sheets.find(candidate => candidate.name === name) ?? null;
}

function columnIndexes(sourceSheet: RawSheet, expectedHeaders: readonly string[]): Map<string, number> | null {
  const header = sourceSheet.rows[0];
  if (!header) return null;
  const headers = header.cells.map(cellText);
  const indexes = new Map<string, number>();
  for (const expected of expectedHeaders) {
    const index = headers.indexOf(expected);
    if (index < 0) return null;
    indexes.set(expected, index);
  }
  return indexes;
}

function value(sourceSheet: RawSheet, rowIndex: number, indexes: Map<string, number>, header: string): string {
  return cellText(sourceSheet.rows[rowIndex]?.cells[indexes.get(header) ?? -1]);
}

function exactDecimal(input: string): string | null {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(input)) return null;
  const negative = input.startsWith("-");
  const unsigned = input.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole || "0"}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

function nonnegativeInteger(input: string): number | null {
  if (!/^\d+$/.test(input)) return null;
  const parsed = Number(input);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function decimalParts(input: string): { units: bigint; scale: number } {
  const [whole, fraction = ""] = input.split(".");
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function decimalsEqual(left: string, right: string): boolean {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  return a.units * 10n ** BigInt(scale - a.scale) === b.units * 10n ** BigInt(scale - b.scale);
}

function decimalString(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  const whole = digits.slice(0, -scale) || "0";
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function addDecimals(left: string, right: string): string {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  return decimalString(
    a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale),
    scale,
  );
}

function workbookDate(input: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(input);
  return match?.[1] ?? null;
}

function yesNo(input: string): boolean | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "yes") return true;
  if (normalized === "no") return false;
  return null;
}

function monthKeys(period: QuarterlyReportPeriod): Set<string> {
  const firstMonth = (period.quarter - 1) * 3 + 1;
  return new Set([0, 1, 2].map(offset => `${period.year}-${String(firstMonth + offset).padStart(2, "0")}`));
}

function statusForCount(actual: number, expected: number): WorkbookSupplementStatus {
  if (actual === 0) return "UNAVAILABLE";
  return actual === expected ? "AVAILABLE" : "PARTIAL";
}

function monthlySummary(
  file: LoadedFile,
  businessId: string,
  period: QuarterlyReportPeriod,
  calculatedMonths: readonly QuarterlyActivityMonth[],
): QuarterlyWorkbookSupplements["monthlySummary"] {
  const sourceSheet = sheet(file, "Monthly Summary");
  if (!sourceSheet) return { status: "UNAVAILABLE", sourceSheet: "Monthly Summary", reason: "The workbook does not contain a Monthly Summary worksheet.", rows: [] };
  const indexes = columnIndexes(sourceSheet, MONTHLY_SUMMARY_HEADERS);
  if (!indexes) return { status: "UNAVAILABLE", sourceSheet: "Monthly Summary", reason: "The Monthly Summary worksheet does not match the supported supplementary schema.", rows: [] };
  const expectedMonths = monthKeys(period);
  const rows: WorkbookMonthlySummaryRow[] = [];
  for (let index = 1; index < sourceSheet.rows.length; index += 1) {
    if (value(sourceSheet, index, indexes, "Business ID") !== businessId) continue;
    const statementMonth = value(sourceSheet, index, indexes, "Statement Month");
    if (!expectedMonths.has(statementMonth)) continue;
    const openingBalance = exactDecimal(value(sourceSheet, index, indexes, "Opening Balance"));
    const totalCredits = exactDecimal(value(sourceSheet, index, indexes, "Total Credits"));
    const totalDebits = exactDecimal(value(sourceSheet, index, indexes, "Total Debits"));
    const closingBalance = exactDecimal(value(sourceSheet, index, indexes, "Closing Balance"));
    const transactionCount = nonnegativeInteger(value(sourceSheet, index, indexes, "Transaction Count"));
    const labeledAnomalyCount = nonnegativeInteger(value(sourceSheet, index, indexes, "Anomaly Count"));
    if ([openingBalance, totalCredits, totalDebits, closingBalance, transactionCount, labeledAnomalyCount].some(item => item === null)) continue;
    const calculated = calculatedMonths.find(month => month.period === statementMonth);
    rows.push({
      sourceRowNumber: sourceSheet.rows[index].rowNumber,
      period: statementMonth,
      openingBalance: openingBalance!,
      totalCredits: totalCredits!,
      totalDebits: totalDebits!,
      closingBalance: closingBalance!,
      transactionCount: transactionCount!,
      labeledAnomalyCount: labeledAnomalyCount!,
      reconciliation: {
        credits: calculated && decimalsEqual(totalCredits!, calculated.bankCredits) ? "MATCH" : "MISMATCH",
        debits: calculated && decimalsEqual(totalDebits!, calculated.bankDebits) ? "MATCH" : "MISMATCH",
        transactionCount: calculated?.transactionCount === transactionCount ? "MATCH" : "MISMATCH",
      },
    });
  }
  rows.sort((left, right) => left.period.localeCompare(right.period));
  const status = statusForCount(rows.length, 3);
  return {
    status,
    sourceSheet: "Monthly Summary",
    reason: status === "AVAILABLE" ? null : status === "PARTIAL" ? "Only part of the selected quarter is available in the supported Monthly Summary schema." : "No matching Monthly Summary rows were found for the selected company and quarter.",
    rows,
  };
}

function groundTruth(
  file: LoadedFile,
  businessId: string,
  currentRows: readonly AcceptedTransaction[],
): QuarterlyWorkbookSupplements["groundTruth"] {
  const expectedIds = new Set(currentRows.map(row => row.source_transaction_id).filter((id): id is string => Boolean(id)));
  const sourceSheet = sheet(file, "Ground Truth");
  const unavailable = (reason: string): QuarterlyWorkbookSupplements["groundTruth"] => ({
    status: "UNAVAILABLE", sourceSheet: "Ground Truth", reason, evaluationOnly: true,
    expectedTransactionCount: expectedIds.size, matchedTransactionCount: 0, labeledAnomalyCount: 0,
    reviewExpectedCount: 0, anomalyTypes: [], rows: [],
  });
  if (!sourceSheet) return unavailable("The workbook does not contain a Ground Truth worksheet.");
  const indexes = columnIndexes(sourceSheet, GROUND_TRUTH_HEADERS);
  if (!indexes) return unavailable("The Ground Truth worksheet does not match the supported evaluation schema.");
  let matchedTransactionCount = 0;
  let labeledAnomalyCount = 0;
  let reviewExpectedCount = 0;
  const anomalyTypes = new Map<string, number>();
  const rows: WorkbookGroundTruthRow[] = [];
  for (let index = 1; index < sourceSheet.rows.length; index += 1) {
    if (value(sourceSheet, index, indexes, "Business ID") !== businessId) continue;
    const transactionId = value(sourceSheet, index, indexes, "Transaction ID");
    if (!expectedIds.has(transactionId)) continue;
    const isAnomaly = yesNo(value(sourceSheet, index, indexes, "Is Anomaly"));
    const reviewExpected = yesNo(value(sourceSheet, index, indexes, "Review Expected"));
    if (isAnomaly === null || reviewExpected === null) continue;
    matchedTransactionCount += 1;
    const anomalyType = value(sourceSheet, index, indexes, "Anomaly Type") || null;
    if (isAnomaly) {
      labeledAnomalyCount += 1;
      const label = anomalyType ?? "Unspecified label";
      anomalyTypes.set(label, (anomalyTypes.get(label) ?? 0) + 1);
    }
    if (reviewExpected) reviewExpectedCount += 1;
    rows.push({
      sourceRowNumber: sourceSheet.rows[index].rowNumber,
      transactionId,
      sourceCategory: value(sourceSheet, index, indexes, "HF Category Ground Truth"),
      businessCategory: value(sourceSheet, index, indexes, "Business Category Ground Truth"),
      isAnomaly,
      anomalyType,
      reviewExpected,
    });
  }
  rows.sort((left, right) => left.transactionId.localeCompare(right.transactionId));
  const status = statusForCount(matchedTransactionCount, expectedIds.size);
  return {
    status,
    sourceSheet: "Ground Truth",
    reason: status === "AVAILABLE" ? null : status === "PARTIAL" ? "Only part of the selected transaction population has matching evaluation labels." : "No matching evaluation labels were found for the selected company and quarter.",
    evaluationOnly: true,
    expectedTransactionCount: expectedIds.size,
    matchedTransactionCount,
    labeledAnomalyCount,
    reviewExpectedCount,
    anomalyTypes: [...anomalyTypes.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, count]) => ({ label, count })),
    rows,
  };
}

function categoryMapping(file: LoadedFile, businessId: string): QuarterlyWorkbookSupplements["categoryMapping"] {
  const sourceSheet = sheet(file, "Category Mapping");
  const unavailable = (reason: string): QuarterlyWorkbookSupplements["categoryMapping"] => ({
    status: "UNAVAILABLE", sourceSheet: "Category Mapping", reason,
    interpretationApproval: "UNAPPROVED_REFERENCE_ONLY", rows: [],
  });
  if (!sourceSheet) return unavailable("The workbook does not contain a Category Mapping worksheet.");
  const indexes = columnIndexes(sourceSheet, CATEGORY_MAPPING_HEADERS);
  if (!indexes) return unavailable("The Category Mapping worksheet does not match the supported reference schema.");
  const rows = sourceSheet.rows.slice(1).flatMap((sourceRow, offset) => {
    const index = offset + 1;
    if (value(sourceSheet, index, indexes, "Business ID") !== businessId) return [];
    const sourceCategory = value(sourceSheet, index, indexes, "HF Category");
    const businessCategory = value(sourceSheet, index, indexes, "Business Category");
    const generationWeight = exactDecimal(value(sourceSheet, index, indexes, "Generation Weight"));
    if (!sourceCategory || !businessCategory || generationWeight === null) return [];
    return [{ sourceRowNumber: sourceRow.rowNumber, sourceCategory, businessCategory, generationWeight }];
  });
  return {
    status: rows.length ? "AVAILABLE" : "UNAVAILABLE",
    sourceSheet: "Category Mapping",
    reason: rows.length ? null : "No category mapping rows were found for the selected business.",
    interpretationApproval: "UNAPPROVED_REFERENCE_ONLY",
    rows,
  };
}

function methodology(file: LoadedFile): QuarterlyWorkbookSupplements["methodology"] {
  const sourceSheet = sheet(file, "Source & Methodology");
  const unavailable = (reason: string): QuarterlyWorkbookSupplements["methodology"] => ({
    status: "UNAVAILABLE", sourceSheet: "Source & Methodology", reason, externallyVerified: false, entries: [],
  });
  if (!sourceSheet) return unavailable("The workbook does not contain a Source & Methodology worksheet.");
  const indexes = columnIndexes(sourceSheet, METHODOLOGY_HEADERS);
  if (!indexes) return unavailable("The Source & Methodology worksheet does not match the supported disclosure schema.");
  const entries = sourceSheet.rows.slice(1, 51).flatMap((sourceRow, offset) => {
    const index = offset + 1;
    const item = value(sourceSheet, index, indexes, "Item");
    const details = value(sourceSheet, index, indexes, "Details");
    return item && details ? [{ sourceRowNumber: sourceRow.rowNumber, item, details }] : [];
  });
  return {
    status: entries.length ? "AVAILABLE" : "UNAVAILABLE",
    sourceSheet: "Source & Methodology",
    reason: entries.length ? null : "No methodology disclosures were found.",
    externallyVerified: false,
    entries,
  };
}

function readme(file: LoadedFile): NonNullable<QuarterlyWorkbookSupplements["readme"]> {
  const sourceSheet = sheet(file, "README");
  const unavailable = (reason: string): NonNullable<QuarterlyWorkbookSupplements["readme"]> => ({
    status: "UNAVAILABLE", sourceSheet: "README", reason, title: null, entries: [], businessCoverage: [],
  });
  if (!sourceSheet) return unavailable("The workbook does not contain a README worksheet.");
  const title = cellText(sourceSheet.rows[0]?.cells[0]) || null;
  const entries: Array<{ sourceRowNumber: number; item: string; value: string; reference: string | null }> = [];
  const businessCoverage: Array<{
    sourceRowNumber: number;
    businessName: string;
    transactionCount: number;
    labeledAnomalyCount: number;
  }> = [];
  let businessHeaderIndex = -1;
  for (let index = 1; index < sourceSheet.rows.length; index += 1) {
    const item = cellText(sourceSheet.rows[index]?.cells[0]);
    if (item === "Business") {
      businessHeaderIndex = index;
      break;
    }
    const entryValue = cellText(sourceSheet.rows[index]?.cells[1]);
    if (!item || !entryValue) continue;
    entries.push({
      sourceRowNumber: sourceSheet.rows[index].rowNumber,
      item,
      value: entryValue,
      reference: cellText(sourceSheet.rows[index]?.cells[2]) || null,
    });
  }
  if (businessHeaderIndex >= 0) {
    for (let index = businessHeaderIndex + 1; index < sourceSheet.rows.length; index += 1) {
      const businessName = cellText(sourceSheet.rows[index]?.cells[0]);
      const transactionCount = nonnegativeInteger(cellText(sourceSheet.rows[index]?.cells[1]));
      const labeledAnomalyCount = nonnegativeInteger(cellText(sourceSheet.rows[index]?.cells[2]));
      if (!businessName || transactionCount === null || labeledAnomalyCount === null) continue;
      businessCoverage.push({
        sourceRowNumber: sourceSheet.rows[index].rowNumber,
        businessName,
        transactionCount,
        labeledAnomalyCount,
      });
    }
  }
  const status: WorkbookSupplementStatus = title || entries.length || businessCoverage.length ? "AVAILABLE" : "UNAVAILABLE";
  return {
    status,
    sourceSheet: "README",
    reason: status === "AVAILABLE" ? null : "No supported README disclosures were found.",
    title,
    entries,
    businessCoverage,
  };
}

function transactionSchedule(
  file: LoadedFile,
  businessId: string,
  currentRows: readonly AcceptedTransaction[],
  groundTruthRows: readonly WorkbookGroundTruthRow[],
): NonNullable<QuarterlyWorkbookSupplements["transactionSchedule"]> {
  const expectedIds = new Set(currentRows.map(row => row.source_transaction_id).filter((id): id is string => Boolean(id)));
  const sourceSheet = sheet(file, "Transactions");
  const unavailable = (reason: string): NonNullable<QuarterlyWorkbookSupplements["transactionSchedule"]> => ({
    status: "UNAVAILABLE", sourceSheet: "Transactions", reason,
    scope: "SELECTED_BUSINESS_CURRENT_QUARTER", expectedTransactionCount: expectedIds.size,
    matchedTransactionCount: 0, rows: [],
  });
  if (!sourceSheet) return unavailable("The workbook does not contain a Transactions worksheet.");
  const indexes = columnIndexes(sourceSheet, TRANSACTION_HEADERS);
  if (!indexes) return unavailable("The Transactions worksheet does not match the supported detailed-schedule schema.");
  const evaluationById = new Map(groundTruthRows.map(row => [row.transactionId, row]));
  const rows: WorkbookTransactionScheduleRow[] = [];
  for (let index = 1; index < sourceSheet.rows.length; index += 1) {
    if (value(sourceSheet, index, indexes, "Business ID") !== businessId) continue;
    const transactionId = value(sourceSheet, index, indexes, "Transaction ID");
    if (!expectedIds.has(transactionId)) continue;
    const transactionDate = workbookDate(value(sourceSheet, index, indexes, "Transaction Date"));
    const directionValue = value(sourceSheet, index, indexes, "Direction").toUpperCase();
    const direction = directionValue === "DEBIT" || directionValue === "CREDIT" ? directionValue : null;
    const amount = exactDecimal(value(sourceSheet, index, indexes, "Amount"));
    const runningBalance = exactDecimal(value(sourceSheet, index, indexes, "Running Balance"));
    if (!transactionDate || !direction || amount === null || runningBalance === null) continue;
    const evaluation = evaluationById.get(transactionId);
    rows.push({
      sourceRowNumber: sourceSheet.rows[index].rowNumber,
      transactionId,
      transactionDate,
      statementMonth: value(sourceSheet, index, indexes, "Statement Month"),
      industry: value(sourceSheet, index, indexes, "Industry"),
      accountNumber: value(sourceSheet, index, indexes, "Account Number"),
      currency: value(sourceSheet, index, indexes, "Currency"),
      description: value(sourceSheet, index, indexes, "Raw HF-Style Description"),
      direction,
      amount,
      sourceCategory: value(sourceSheet, index, indexes, "HF Category"),
      businessCategory: value(sourceSheet, index, indexes, "Business Category"),
      bankFormat: value(sourceSheet, index, indexes, "Bank Format"),
      counterparty: value(sourceSheet, index, indexes, "Counterparty"),
      reference: value(sourceSheet, index, indexes, "Reference"),
      runningBalance,
      generationMethod: value(sourceSheet, index, indexes, "Generation Method"),
      groundTruth: evaluation ? {
        matched: true,
        sourceCategory: evaluation.sourceCategory,
        businessCategory: evaluation.businessCategory,
        isAnomaly: evaluation.isAnomaly,
        anomalyType: evaluation.anomalyType,
        reviewExpected: evaluation.reviewExpected,
      } : {
        matched: false,
        sourceCategory: null,
        businessCategory: null,
        isAnomaly: null,
        anomalyType: null,
        reviewExpected: null,
      },
    });
  }
  rows.sort((left, right) => left.transactionDate.localeCompare(right.transactionDate) || left.sourceRowNumber - right.sourceRowNumber);
  const status = statusForCount(rows.length, expectedIds.size);
  return {
    status,
    sourceSheet: "Transactions",
    reason: status === "AVAILABLE" ? null : status === "PARTIAL"
      ? "Only part of the selected accepted population could be matched to the raw workbook transaction schedule."
      : "No raw workbook transactions matched the selected accepted population.",
    scope: "SELECTED_BUSINESS_CURRENT_QUARTER",
    expectedTransactionCount: expectedIds.size,
    matchedTransactionCount: rows.length,
    rows,
  };
}

function categoryActivity(
  schedule: NonNullable<QuarterlyWorkbookSupplements["transactionSchedule"]>,
): NonNullable<QuarterlyWorkbookSupplements["categoryActivity"]> {
  const grouped = new Map<string, WorkbookCategoryActivityRow>();
  const formatCounts = new Map<string, number>();
  const currencies = new Set<string>();
  for (const row of schedule.rows) {
    if (row.currency) currencies.add(row.currency);
    if (row.bankFormat) formatCounts.set(row.bankFormat, (formatCounts.get(row.bankFormat) ?? 0) + 1);
    const key = `${row.sourceCategory}\u0000${row.businessCategory}`;
    const current = grouped.get(key) ?? {
      sourceCategory: row.sourceCategory || "Unspecified",
      businessCategory: row.businessCategory || "Unspecified",
      transactionCount: 0,
      creditCount: 0,
      debitCount: 0,
      creditAmount: "0",
      debitAmount: "0",
    };
    current.transactionCount += 1;
    if (row.direction === "CREDIT") {
      current.creditCount += 1;
      current.creditAmount = addDecimals(current.creditAmount, row.amount);
    } else {
      current.debitCount += 1;
      current.debitAmount = addDecimals(current.debitAmount, row.amount);
    }
    grouped.set(key, current);
  }
  const rows = [...grouped.values()].sort((left, right) =>
    right.transactionCount - left.transactionCount || left.businessCategory.localeCompare(right.businessCategory));
  return {
    status: schedule.status,
    sourceSheet: "Transactions",
    reason: schedule.reason,
    interpretationApproval: "UNAPPROVED_REFERENCE_ONLY",
    currency: currencies.size === 1 ? [...currencies][0] : null,
    rows,
    bankFormats: [...formatCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([label, count]) => ({ label, count })),
  };
}

export const SUPPLEMENTARY_REPORT_SHEETS = [
  "README", "Monthly Summary", "Ground Truth", "Category Mapping", "Source & Methodology",
] as const;

export function extractQuarterlyWorkbookSupplements(input: {
  file: LoadedFile;
  businessId: string;
  currentPeriod: QuarterlyReportPeriod;
  currentRows: readonly AcceptedTransaction[];
  calculatedMonths: readonly QuarterlyActivityMonth[];
}): QuarterlyWorkbookSupplements {
  const groundTruthData = groundTruth(input.file, input.businessId, input.currentRows);
  const schedule = transactionSchedule(input.file, input.businessId, input.currentRows, groundTruthData.rows ?? []);
  return {
    version: "quarterly-workbook-supplements-0.1",
    fileSha256: input.file.fingerprint,
    authority: "SUPPLEMENTARY_WORKBOOK_CONTEXT_ONLY",
    usedForHeadlineCalculations: false,
    monthlySummary: monthlySummary(input.file, input.businessId, input.currentPeriod, input.calculatedMonths),
    groundTruth: groundTruthData,
    categoryMapping: categoryMapping(input.file, input.businessId),
    methodology: methodology(input.file),
    readme: readme(input.file),
    transactionSchedule: schedule,
    categoryActivity: categoryActivity(schedule),
  };
}
