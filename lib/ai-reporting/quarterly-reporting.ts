import { aggregateSourceRecords, subtractDecimalStrings, type WarningPolicy } from "../analytics";
import { analyzeAcceptedDataPayload } from "../analytics/accepted-data-adapter";
import type { LoadedFile } from "../ingestion";
import type { AcceptedDataPayload, AcceptedDataset, AcceptedTransaction } from "../ingestion/accepted-data";
import type { MonetaryBasis } from "./contracts";
import {
  createLocalManagementReport,
  type LocalManagementReport,
  type QuarterlyActivityComparison,
  type QuarterlyActivityMonth,
  type QuarterlyPeriodActivity,
  type QuarterlyReportPeriod,
} from "./local-management-report";
import { extractQuarterlyWorkbookSupplements } from "./workbook-supplements";

const REPORT_TIMEZONE = "Asia/Kuching";
const SUPPLIED_SYNTHETIC_WORKBOOK_SHA256 = "13c0d038845941abb8e974bc55832f0b1f157bac343c4f4ab5189ba0b0a30bfb";
const REALISTIC_SYNTHETIC_LEDGER_SHA256 = "f10edefcf4f09a7695125ff1d727e2501ebb22f7283d441d0ed8a22336173d3a";
const RIMBA_DEMO_BANK_SHA256 = "da31e6f437ddff7cfb3a029db21caa56320bd1c6162c5701503f60687ba9ef3e";
const STRAITS_DEMO_BANK_SHA256 = "48668a7eb1fca288f8c853aee5a7b6d2ebcf9076e7cd7ba95a6d7f0df386a5fc";

const registeredSyntheticBusinessNames: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [RIMBA_DEMO_BANK_SHA256]: {
    "DEMO-001": "Rimba Demo Kitchen (Synthetic)",
  },
  [STRAITS_DEMO_BANK_SHA256]: {
    "DEMO-002": "Straits Demo Bakery (Synthetic)",
  },
  [REALISTIC_SYNTHETIC_LEDGER_SHA256]: {
    "SYNTH-DEMO-001": "Synthetic Example Sdn Bhd",
  },
  [SUPPLIED_SYNTHETIC_WORKBOOK_SHA256]: {
    "BUS-001": "Kopi Kita Cafe Sdn. Bhd.",
    "BUS-002": "Borneo BuildWorks Sdn. Bhd.",
    "BUS-003": "PixelCart Online Sdn. Bhd.",
  },
};

export interface ReportBusinessOption {
  businessId: string;
  displayName: string;
  nameBasis: "REGISTERED_SYNTHETIC" | "REVIEWED_USER_INPUT_REQUIRED";
  recordCount: number;
}

export interface ReportBusinessDiscovery {
  reliable: boolean;
  options: readonly ReportBusinessOption[];
  limitation: string | null;
}

export interface QuarterlyReportSelection {
  businessId: string;
  businessDisplayName: string;
  currentPeriod: QuarterlyReportPeriod;
  comparisonPeriod: QuarterlyReportPeriod | null;
}

function singleDataset(payload: AcceptedDataPayload): AcceptedDataset {
  if (payload.datasets.length !== 1) throw new Error("Quarterly reporting requires one explicitly selected dataset.");
  return payload.datasets[0];
}

function registeredBusinessName(fileSha256: string, businessId: string): string | null {
  return registeredSyntheticBusinessNames[fileSha256]?.[businessId] ?? null;
}

export function discoverReportBusinesses(payload: AcceptedDataPayload): ReportBusinessDiscovery {
  const dataset = singleDataset(payload);
  if (!dataset.normalized.length) {
    return { reliable: false, options: [], limitation: "The selected dataset has no accepted records." };
  }
  if (dataset.normalized.some(row => !row.entity_id?.trim())) {
    return {
      reliable: false,
      options: [],
      limitation: "At least one accepted record has no verified entity_id. Company ownership cannot be safely guessed, so company-specific reporting is unavailable.",
    };
  }
  const counts = new Map<string, number>();
  for (const row of dataset.normalized) {
    const businessId = row.entity_id!.trim();
    counts.set(businessId, (counts.get(businessId) ?? 0) + 1);
  }
  return {
    reliable: true,
    limitation: null,
    options: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([businessId, recordCount]) => {
      const registeredName = registeredBusinessName(dataset.file_sha256, businessId);
      return {
        businessId,
        displayName: registeredName ?? businessId,
        nameBasis: registeredName ? "REGISTERED_SYNTHETIC" : "REVIEWED_USER_INPUT_REQUIRED",
        recordCount,
      };
    }),
  };
}

function lastDayOfQuarter(year: number, quarter: 1 | 2 | 3 | 4): number {
  return new Date(Date.UTC(year, quarter * 3, 0)).getUTCDate();
}

export function quarterPeriod(year: number, quarter: 1 | 2 | 3 | 4): QuarterlyReportPeriod {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error("Reporting year is outside the supported range.");
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = quarter * 3;
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    key: `${year}-Q${quarter}`,
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    startDate: `${year}-${pad(startMonth)}-01`,
    endDate: `${year}-${pad(endMonth)}-${pad(lastDayOfQuarter(year, quarter))}`,
  };
}

export function previousQuarter(period: QuarterlyReportPeriod): QuarterlyReportPeriod {
  return period.quarter === 1
    ? quarterPeriod(period.year - 1, 4)
    : quarterPeriod(period.year, (period.quarter - 1) as 1 | 2 | 3);
}

function periodForDate(date: string): QuarterlyReportPeriod | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return quarterPeriod(year, Math.ceil(month / 3) as 1 | 2 | 3 | 4);
}

export function listAvailableQuarterPeriods(payload: AcceptedDataPayload, businessId: string): QuarterlyReportPeriod[] {
  const dataset = singleDataset(payload);
  const periods = new Map<string, QuarterlyReportPeriod>();
  for (const row of dataset.normalized) {
    if (row.entity_id !== businessId) continue;
    const period = periodForDate(row.canonical_date);
    if (period) periods.set(period.key, period);
  }
  return [...periods.values()].sort((left, right) => right.startDate.localeCompare(left.startDate));
}

function inPeriod(row: AcceptedTransaction, period: QuarterlyReportPeriod): boolean {
  return row.canonical_date >= period.startDate && row.canonical_date <= period.endDate;
}

function rowsForPeriod(rows: readonly AcceptedTransaction[], period: QuarterlyReportPeriod): AcceptedTransaction[] {
  return rows.filter(row => inPeriod(row, period));
}

function scopedDataset(dataset: AcceptedDataset, rows: AcceptedTransaction[]): AcceptedDataset {
  const warning = rows.filter(row => row.ingestion_status === "WARNING").length;
  return {
    ...dataset,
    normalized: rows,
    summary: {
      rowsReceived: rows.length,
      accepted: rows.length,
      valid: rows.length - warning,
      warning,
      rejected: 0,
      duplicateRows: 0,
      requiredCompleteness: dataset.summary.requiredCompleteness,
    },
  };
}

function assertPeriodDefinition(period: QuarterlyReportPeriod): void {
  const expected = quarterPeriod(period.year, period.quarter);
  if (period.key !== expected.key || period.label !== expected.label || period.startDate !== expected.startDate || period.endDate !== expected.endDate) {
    throw new Error("The requested reporting period does not match the canonical calendar-quarter definition.");
  }
}

export function scopeQuarterlyReportPayload(
  payload: AcceptedDataPayload,
  selection: QuarterlyReportSelection,
): { payload: AcceptedDataPayload; currentRows: AcceptedTransaction[]; comparisonRows: AcceptedTransaction[] } {
  const dataset = singleDataset(payload);
  const discovery = discoverReportBusinesses(payload);
  if (!discovery.reliable) throw new Error(discovery.limitation ?? "Company identifiers are unavailable.");
  if (!discovery.options.some(option => option.businessId === selection.businessId)) {
    throw new Error("The selected business identifier is not present in this dataset.");
  }
  if (!selection.businessDisplayName.trim()) throw new Error("A reviewed business display name is required.");
  if (dataset.summary.rejected > 0) {
    throw new Error("Company-specific reporting is unavailable because rejected rows cannot be safely attributed to a business through the accepted-data contract.");
  }
  if (dataset.summary.duplicateRows > 0) {
    throw new Error("Company-specific reporting is unavailable because duplicate-row counts cannot be safely attributed to a business through the accepted-data contract.");
  }
  assertPeriodDefinition(selection.currentPeriod);
  if (selection.comparisonPeriod) assertPeriodDefinition(selection.comparisonPeriod);
  const businessRows = dataset.normalized.filter(row => row.entity_id === selection.businessId);
  const currentRows = rowsForPeriod(businessRows, selection.currentPeriod);
  const comparisonRows = selection.comparisonPeriod ? rowsForPeriod(businessRows, selection.comparisonPeriod) : [];
  if (!currentRows.length) throw new Error(`No accepted records are available for ${selection.currentPeriod.label}.`);
  if (selection.comparisonPeriod && !comparisonRows.length) {
    throw new Error(`No accepted records are available for comparison period ${selection.comparisonPeriod.label}.`);
  }
  const selectedRows = [...comparisonRows, ...currentRows].sort((left, right) =>
    left.canonical_date.localeCompare(right.canonical_date) || left.source_row_number - right.source_row_number);
  return {
    payload: { ...payload, datasets: [scopedDataset(dataset, selectedRows)] },
    currentRows,
    comparisonRows,
  };
}

interface ParsedDecimal { units: bigint; scale: number }

function parseDecimal(value: string): ParsedDecimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error("A quarterly monetary calculation received an invalid exact decimal string.");
  const fraction = match[3] ?? "";
  return {
    units: BigInt(`${match[1]}${match[2]}${fraction}`),
    scale: fraction.length,
  };
}

function decimalString(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  const whole = digits.slice(0, -scale) || "0";
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function addDecimals(values: readonly (string | null)[]): string {
  const parsed = values.filter((value): value is string => value !== null).map(parseDecimal);
  if (!parsed.length) return "0";
  const scale = Math.max(...parsed.map(value => value.scale));
  const units = parsed.reduce((sum, value) => sum + value.units * 10n ** BigInt(scale - value.scale), 0n);
  return decimalString(units, scale);
}

function percentChange(current: string, comparison: string): { value: string | null; reason: string | null } {
  const currentDecimal = parseDecimal(current);
  const comparisonDecimal = parseDecimal(comparison);
  if (comparisonDecimal.units <= 0n) {
    return { value: null, reason: "Percentage change is unavailable because the comparison value is zero or negative." };
  }
  const scale = Math.max(currentDecimal.scale, comparisonDecimal.scale);
  const currentUnits = currentDecimal.units * 10n ** BigInt(scale - currentDecimal.scale);
  const comparisonUnits = comparisonDecimal.units * 10n ** BigInt(scale - comparisonDecimal.scale);
  const numerator = (currentUnits - comparisonUnits) * 10_000n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const rounded = (absoluteNumerator + comparisonUnits / 2n) / comparisonUnits;
  return { value: decimalString(numerator < 0n ? -rounded : rounded, 2), reason: null };
}

function includedRows(rows: readonly AcceptedTransaction[], warningPolicy: WarningPolicy): AcceptedTransaction[] {
  return warningPolicy === "include" ? [...rows] : rows.filter(row => row.ingestion_status === "VALID");
}

function assertSupportedBankActivity(rows: readonly AcceptedTransaction[]): { currency: string; monetaryBasis: MonetaryBasis } {
  const currencies = [...new Set(rows.map(row => row.currency))];
  if (currencies.includes(null)) throw new Error("Quarterly bank-activity totals require currency on every selected record.");
  if (currencies.length !== 1) throw new Error("Quarterly bank-activity totals cannot combine mixed currencies.");
  const monetaryBases = [...new Set(rows.map(row => row.monetary_basis))];
  if (monetaryBases.length !== 1 || !["debit_credit", "source_amount_with_direction"].includes(monetaryBases[0])) {
    throw new Error("Quarterly bank-activity totals require one consistent supported monetary basis.");
  }
  const monetaryBasis = monetaryBases[0] as MonetaryBasis;
  if (monetaryBasis === "debit_credit" && rows.some(row => row.debit === null && row.credit === null)) {
    throw new Error("Quarterly debit/credit activity requires at least one verified ledger-side value on every selected record.");
  }
  if (monetaryBasis === "source_amount_with_direction" && rows.some(row =>
    row.source_amount === null || (row.entry_side !== "DEBIT" && row.entry_side !== "CREDIT"))) {
    throw new Error("Quarterly directional activity requires a verified source amount and Debit/Credit direction on every selected record.");
  }
  return { currency: currencies[0]!, monetaryBasis };
}

function monthKeys(period: QuarterlyReportPeriod): string[] {
  const first = (period.quarter - 1) * 3 + 1;
  return [0, 1, 2].map(offset => `${period.year}-${String(first + offset).padStart(2, "0")}`);
}

function periodActivity(
  period: QuarterlyReportPeriod,
  rows: readonly AcceptedTransaction[],
  warningPolicy: WarningPolicy,
  statisticalFlagCount: number,
  currency: string,
  monetaryBasis: MonetaryBasis,
  dataset: AcceptedDataset,
): QuarterlyPeriodActivity {
  const included = includedRows(rows, warningPolicy);
  const totals = bankActivityTotals(included, monetaryBasis, dataset);
  return {
    period,
    acceptedTransactionCount: rows.length,
    includedTransactionCount: included.length,
    warningCount: rows.filter(row => row.ingestion_status === "WARNING").length,
    includedWarningCount: included.filter(row => row.ingestion_status === "WARNING").length,
    statisticalFlagCount,
    bankCredits: totals.bankCredits,
    bankDebits: totals.bankDebits,
    currency,
    monetaryBasis,
    evidenceIds: totals.evidenceIds,
    netRecordedBankMovement: {
      status: "UNAVAILABLE",
      exactValue: null,
      reason: "No reviewed source-direction convention approves subtracting debits from credits as net bank movement.",
    },
    openingBankBalance: {
      status: "UNAVAILABLE",
      exactValue: null,
      reason: "The accepted-data contract does not establish a complete approved opening-balance schedule for the selected company.",
    },
    closingBankBalance: {
      status: "UNAVAILABLE",
      exactValue: null,
      reason: "The accepted-data contract does not establish a complete approved closing-balance schedule for the selected company.",
    },
  };
}

function monthlyActivity(
  period: QuarterlyReportPeriod,
  rows: readonly AcceptedTransaction[],
  warningPolicy: WarningPolicy,
  currency: string,
  monetaryBasis: MonetaryBasis,
  dataset: AcceptedDataset,
): QuarterlyActivityMonth[] {
  const included = includedRows(rows, warningPolicy);
  return monthKeys(period).map(periodKey => {
    const monthRows = included.filter(row => row.canonical_date.startsWith(`${periodKey}-`));
    const totals = bankActivityTotals(monthRows, monetaryBasis, dataset);
    const date = new Date(`${periodKey}-01T00:00:00Z`);
    return {
      period: periodKey,
      label: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(date),
      bankCredits: totals.bankCredits,
      bankDebits: totals.bankDebits,
      transactionCount: monthRows.length,
      warningCount: monthRows.filter(row => row.ingestion_status === "WARNING").length,
      currency,
      monetaryBasis,
      evidenceIds: totals.evidenceIds,
    };
  });
}

function bankActivityTotals(
  rows: readonly AcceptedTransaction[],
  monetaryBasis: MonetaryBasis,
  dataset: AcceptedDataset,
): { bankCredits: string; bankDebits: string; evidenceIds: { bankCredits: string[]; bankDebits: string[] } } {
  const analyticsRows = (selectedRows: readonly AcceptedTransaction[]) => selectedRows.map(row => ({
    ...row,
    source_system: dataset.source_system,
    source_file: dataset.source_file,
    source_sheet: dataset.source_sheet,
    file_sha256: dataset.file_sha256,
    ingestion_batch_id: dataset.ingestion_batch_id,
    ingested_at: dataset.ingested_at,
  }));
  if (monetaryBasis === "source_amount_with_direction") {
    const creditRows = rows.filter(row => row.entry_side === "CREDIT");
    const debitRows = rows.filter(row => row.entry_side === "DEBIT");
    return {
      bankCredits: addDecimals(aggregateSourceRecords(analyticsRows(creditRows)).map(group => group.sourceAmountTotal)),
      bankDebits: addDecimals(aggregateSourceRecords(analyticsRows(debitRows)).map(group => group.sourceAmountTotal)),
      evidenceIds: {
        bankCredits: creditRows.map(row => `source:${dataset.dataset_id}:${row.source_row_id}:source_amount`),
        bankDebits: debitRows.map(row => `source:${dataset.dataset_id}:${row.source_row_id}:source_amount`),
      },
    };
  }
  return {
    bankCredits: addDecimals(aggregateSourceRecords(analyticsRows(rows)).map(group => group.creditTotal)),
    bankDebits: addDecimals(aggregateSourceRecords(analyticsRows(rows)).map(group => group.debitTotal)),
    evidenceIds: {
      bankCredits: rows.filter(row => row.credit !== null).map(row => `source:${dataset.dataset_id}:${row.source_row_id}:credit`),
      bankDebits: rows.filter(row => row.debit !== null).map(row => `source:${dataset.dataset_id}:${row.source_row_id}:debit`),
    },
  };
}

function comparison(
  measure: QuarterlyActivityComparison["measure"],
  label: string,
  current: string,
  prior: string,
  currency: string | null,
): QuarterlyActivityComparison {
  const percentage = percentChange(current, prior);
  return {
    measure,
    label,
    currentExactValue: current,
    comparisonExactValue: prior,
    absoluteChange: subtractDecimalStrings(current, prior),
    percentageChange: percentage.value,
    percentageUnavailableReason: percentage.reason,
    currency,
  };
}

function periodTitle(period: QuarterlyReportPeriod): string {
  const names = ["FIRST", "SECOND", "THIRD", "FOURTH"];
  return `${names[period.quarter - 1]} QUARTER ${period.year} FINANCIAL ACTIVITY RESULTS`;
}

export async function createQuarterlyFinancialActivityReport(input: {
  payload: AcceptedDataPayload;
  warningPolicy: WarningPolicy;
  selection: QuarterlyReportSelection;
  supplementaryWorkbook?: LoadedFile;
  generatedAt?: string;
}): Promise<LocalManagementReport> {
  const originalDataset = singleDataset(input.payload);
  if (input.supplementaryWorkbook && input.supplementaryWorkbook.fingerprint !== originalDataset.file_sha256) {
    throw new Error("Supplementary workbook context must come from the same source file as the accepted transaction dataset.");
  }
  const scoped = scopeQuarterlyReportPayload(input.payload, input.selection);
  const selectedRows = scoped.payload.datasets[0].normalized;
  const activityBasis = assertSupportedBankActivity(selectedRows);
  const { currency, monetaryBasis } = activityBasis;
  const analysis = analyzeAcceptedDataPayload(scoped.payload, input.warningPolicy);
  const currentPayload = {
    ...scoped.payload,
    datasets: [scopedDataset(scoped.payload.datasets[0], scoped.currentRows)],
  };
  const currentAnalysis = analyzeAcceptedDataPayload(currentPayload, input.warningPolicy);
  const comparisonAnalysis = scoped.comparisonRows.length
    ? analyzeAcceptedDataPayload({ ...scoped.payload, datasets: [scopedDataset(scoped.payload.datasets[0], scoped.comparisonRows)] }, input.warningPolicy)
    : null;
  const base = await createLocalManagementReport({
    payload: scoped.payload,
    analysis,
    warningPolicy: input.warningPolicy,
    organizationName: input.selection.businessDisplayName.trim(),
    generatedAt: input.generatedAt,
  });
  const current = periodActivity(
    input.selection.currentPeriod,
    scoped.currentRows,
    input.warningPolicy,
    currentAnalysis.anomalies.length,
    currency,
    monetaryBasis,
    scoped.payload.datasets[0],
  );
  const prior = input.selection.comparisonPeriod && comparisonAnalysis
    ? periodActivity(input.selection.comparisonPeriod, scoped.comparisonRows, input.warningPolicy, comparisonAnalysis.anomalies.length, currency, monetaryBasis, scoped.payload.datasets[0])
    : null;
  const comparisons = prior ? [
    comparison("BANK_CREDITS", "Recorded bank credits", current.bankCredits, prior.bankCredits, currency),
    comparison("BANK_DEBITS", "Recorded bank debits", current.bankDebits, prior.bankDebits, currency),
    comparison("TRANSACTION_COUNT", "Included transaction count", String(current.includedTransactionCount), String(prior.includedTransactionCount), null),
  ] : [];
  const registeredName = registeredBusinessName(originalDataset.file_sha256, input.selection.businessId);
  const currentRowIds = new Set(scoped.currentRows.map(row => row.source_row_id));
  const months = monthlyActivity(
    input.selection.currentPeriod,
    scoped.currentRows,
    input.warningPolicy,
    currency,
    monetaryBasis,
    scoped.payload.datasets[0],
  );
  const workbookSupplements = input.supplementaryWorkbook
    ? extractQuarterlyWorkbookSupplements({
      file: input.supplementaryWorkbook,
      businessId: input.selection.businessId,
      currentPeriod: input.selection.currentPeriod,
      currentRows: scoped.currentRows,
      calculatedMonths: months,
    })
    : null;
  const currentAnomalies = currentAnalysis.anomalies.map(finding => {
    const row = scoped.currentRows.find(candidate => candidate.source_row_id === finding.source_row_id);
    return { ...finding, description: row?.description ?? null, reference: row?.reference ?? null };
  });

  return {
    ...base,
    reportType: "QUARTERLY_FINANCIAL_ACTIVITY",
    reportId: `${base.reportId}:quarterly:${encodeURIComponent(input.selection.businessId)}:${input.selection.currentPeriod.key}`,
    organizationName: input.selection.businessDisplayName.trim(),
    title: periodTitle(input.selection.currentPeriod),
    subtitle: prior
      ? `Verified bank transaction activity for ${input.selection.currentPeriod.label}, compared with ${prior.period.label}.`
      : `Verified bank transaction activity for ${input.selection.currentPeriod.label}.`,
    reportingPeriod: {
      startDate: input.selection.currentPeriod.startDate,
      endDate: input.selection.currentPeriod.endDate,
      timezone: REPORT_TIMEZONE,
      dateBasis: "CANONICAL_DATE",
    },
    currencyLabel: currency,
    quarterlyActivity: {
      business: {
        identifier: input.selection.businessId,
        displayName: input.selection.businessDisplayName.trim(),
        nameBasis: registeredName === input.selection.businessDisplayName.trim() ? "REGISTERED_SYNTHETIC" : "REVIEWED_USER_INPUT",
        sourceField: "entity_id",
      },
      current,
      comparison: prior,
      comparisons,
      months,
      evidenceWindow: base.evidenceBundle.period,
      calculation: {
        functionId: "analytics.aggregateSourceRecords",
        version: `${scoped.payload.schema_version}/${scoped.payload.ruleset_version}`,
        warningPolicy: input.warningPolicy,
        exactDecimalStrings: true,
      },
      categoryBreakdown: {
        status: "UNAVAILABLE",
        reason: "No approved accounting-category mapping is present in the accepted-data contract.",
      },
      workbookSupplements,
    },
    anomalies: currentAnomalies,
    warnings: base.warnings.filter(warning => currentRowIds.has(warning.sourceRowId)),
    unavailableMetrics: [
      ...base.unavailableMetrics,
      { label: "Net recorded bank movement", reason: current.netRecordedBankMovement.reason },
      { label: "Opening and closing bank balances", reason: current.openingBankBalance.reason },
      { label: "Transaction-category breakdown", reason: "No approved accounting-category mapping is present in the accepted-data contract." },
    ],
    limitations: [
      `Company scope uses the verified entity_id ${input.selection.businessId}; no other entity's accepted records are included in the report calculation snapshot.`,
      `The evidence snapshot covers ${base.evidenceBundle.period.startDate} to ${base.evidenceBundle.period.endDate} because it contains both the selected quarter and its comparison period.`,
      ...(workbookSupplements ? [
        "README, Monthly Summary, raw transaction schedules, Ground Truth, Category Mapping, and Source & Methodology are supplementary raw-workbook context. They do not replace accepted Transactions evidence or feed the optional AI explanation.",
        "Ground Truth is synthetic evaluation data only. Category mappings and workbook methodology claims are not approved accounting interpretations or independently verified external facts.",
      ] : []),
      "Recorded bank credits and debits preserve verified source fields. They are not revenue, expenses, profit, or a formal cash-flow statement.",
      "Net movement is withheld until a reviewed source-direction convention is associated with this dataset.",
      "Opening and closing balances are withheld because the accepted-data contract does not prove a complete approved account schedule.",
      "Source category columns are outside the accepted-data contract and are not treated as approved accounting classifications.",
      ...base.limitations,
    ],
  };
}
