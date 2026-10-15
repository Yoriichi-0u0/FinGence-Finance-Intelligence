/**
 * FinSight analytics utilities.
 *
 * This module consumes canonical records only. It deliberately does not parse
 * source files, reconcile records, infer account semantics, convert currencies,
 * or treat anomalies as evidence of fraud.
 */
import type { CanonicalTransaction } from "../ingestion/models";

export const SUPPORTED_ANALYTICS_SCHEMA_VERSION = "0.1";
export const SUPPORTED_ANALYTICS_RULESET_VERSION = "0.1";

export type WarningPolicy = "include" | "exclude";
export type SourceAnalysisRecord = Omit<CanonicalTransaction, "derived_ledger_net">;

export interface CanonicalEnvelope<T extends SourceAnalysisRecord = CanonicalTransaction> {
  schema_version: string;
  ruleset_version: string;
  normalized: readonly T[];
}
export interface PreparedRecords<T extends SourceAnalysisRecord = CanonicalTransaction> {
  records: readonly T[];
  excludedWarningRecords: readonly T[];
  counts: {
    received: number;
    included: number;
    valid: number;
    warning: number;
    excludedWarnings: number;
  };
}
export interface MonthlyAmountAggregate {
  period: string;
  currency: string;
  monetary_basis: CanonicalTransaction["monetary_basis"];
  transactionCount: number;
  warningCount: number;
  sourceAmountTotal: string | null;
  debitTotal: string | null;
  creditTotal: string | null;
  ledgerNetTotal: string | null;
}
export interface FinancialPeriod {
  period: string;
  revenue: number;
  expenses: number;
  budgetedExpenses?: number;
}
export interface FinancialMetrics {
  period: string;
  revenue: number;
  expenses: number;
  netOperatingAmount: number;
  operatingMargin: number | null;
  expenseToRevenue: number | null;
  expenseVariance: number | null;
  expenseVariancePercent: number | null;
  revenueChange: number | null;
  revenueChangePercent: number | null;
}
export interface ForecastEvaluation {
  predictions: number[];
  actuals: number[];
  mae: number | null;
  rmse: number | null;
  mapePercent: number | null;
  meanError: number | null;
}
export interface AnomalyFinding {
  source_row_id: string;
  source_file: string;
  source_row_number: number;
  canonical_date: string;
  account_code: string | null;
  currency: string;
  monetary_basis: CanonicalTransaction["monetary_basis"];
  magnitude: string;
  robustScore: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
  ingestion_status: "VALID" | "WARNING";
}


export interface AnalyticsRun {
  schema_version: string;
  ruleset_version: string;
  prepared: PreparedRecords;
  monthlyAggregates: MonthlyAmountAggregate[];
  anomalies: AnomalyFinding[];
}

function assertCompatible(envelope: Pick<CanonicalEnvelope, "schema_version" | "ruleset_version">): void {
  if (envelope.schema_version !== SUPPORTED_ANALYTICS_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema_version: ${envelope.schema_version}. Analytics supports ${SUPPORTED_ANALYTICS_SCHEMA_VERSION}.`);
  }
  if (envelope.ruleset_version !== SUPPORTED_ANALYTICS_RULESET_VERSION) {
    throw new Error(`Unsupported ruleset_version: ${envelope.ruleset_version}. Analytics supports ${SUPPORTED_ANALYTICS_RULESET_VERSION}.`);
  }
}

/** Check the versioned boundary and apply the chosen WARNING-record policy. */
export function prepareAcceptedRecords<T extends SourceAnalysisRecord>(
  envelope: CanonicalEnvelope<T>,
  warningPolicy: WarningPolicy = "include",
): PreparedRecords<T> {
  assertCompatible(envelope);
  if (warningPolicy !== "include" && warningPolicy !== "exclude") throw new Error("Unknown WARNING policy.");
  const warnings = envelope.normalized.filter((row) => row.ingestion_status === "WARNING");
  const records = warningPolicy === "include"
    ? [...envelope.normalized]
    : envelope.normalized.filter((row) => row.ingestion_status === "VALID");
  return {
    records,
    excludedWarningRecords: warningPolicy === "exclude" ? warnings : [],
    counts: {
      received: envelope.normalized.length,
      included: records.length,
      valid: envelope.normalized.length - warnings.length,
      warning: warnings.length,
      excludedWarnings: warningPolicy === "exclude" ? warnings.length : 0,
    },
  };
}

function parseDecimal(value: string | null): { units: bigint; scale: number } | null {
  if (value === null || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const normalized = value.trim();
  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = `${whole || "0"}${fraction}`;
  const units = BigInt(digits || "0") * (negative ? -1n : 1n);
  return { units, scale: fraction.length };
}

function addDecimalStrings(values: Array<string | null>): string | null {
  const parsed = values.map(parseDecimal);
  if (values.some((value, index) => value !== null && parsed[index] === null)) {
    throw new Error("Canonical monetary value is not a valid decimal string.");
  }
  const usable = parsed.filter((item): item is NonNullable<typeof item> => item !== null);
  if (usable.length === 0) return null;
  const scale = Math.max(...usable.map((item) => item.scale));
  const total = usable.reduce((sum, item) => sum + item.units * 10n ** BigInt(scale - item.scale), 0n);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  const whole = digits.slice(0, -scale) || "0";
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Aggregate source monetary representations without inventing a universal
 * signed amount. Currency and monetary basis are separate grouping dimensions.
 */
export function aggregateCanonicalRecords(records: readonly CanonicalTransaction[]): MonthlyAmountAggregate[] {
  return aggregateRecords(records, row => row.derived_ledger_net, false);
}

/** Source-only analytics: an incomplete ledger interpretation never becomes a partial total. */
export function aggregateSourceRecords<T extends SourceAnalysisRecord>(
  records: readonly T[], ledgerValue: (row: T) => string | null = () => null,
): MonthlyAmountAggregate[] {
  return aggregateRecords(records, ledgerValue, true);
}

function aggregateRecords<T extends SourceAnalysisRecord>(
  records: readonly T[], ledgerValue: (row: T) => string | null, requireComplete: boolean,
): MonthlyAmountAggregate[] {
  const groups = new Map<string, T[]>();
  for (const row of records) {
    const period = row.canonical_date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) continue;
    const currency = row.currency ?? "UNSPECIFIED";
    const key = [period, currency, row.monetary_basis].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [period, currency, monetaryBasis] = key.split("|") as [string, string, CanonicalTransaction["monetary_basis"]];
    return {
      period,
      currency,
      monetary_basis: monetaryBasis,
      transactionCount: rows.length,
      warningCount: rows.filter((row) => row.ingestion_status === "WARNING").length,
      sourceAmountTotal: addDecimalStrings(rows.map((row) => row.source_amount)),
      debitTotal: addDecimalStrings(rows.map((row) => row.debit)),
      creditTotal: addDecimalStrings(rows.map((row) => row.credit)),
      ledgerNetTotal: requireComplete && (monetaryBasis !== "debit_credit" || rows.some(row => ledgerValue(row) === null))
        ? null : addDecimalStrings(rows.map(ledgerValue)),
    };
  }).sort((a, b) => a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency) || a.monetary_basis.localeCompare(b.monetary_basis));
}

/** Deterministic metrics for already-interpreted periods; amounts must use one currency. */
export function calculateFinancialMetrics(periods: readonly FinancialPeriod[]): FinancialMetrics[] {
  return periods.map((current, index) => {
    if (!Number.isFinite(current.revenue) || !Number.isFinite(current.expenses) ||
        (current.budgetedExpenses !== undefined && !Number.isFinite(current.budgetedExpenses))) {
      throw new Error(`Financial period ${current.period} contains a non-finite value.`);
    }
    const previous = periods[index - 1];
    const net = current.revenue - current.expenses;
    const budget = current.budgetedExpenses;
    const variance = budget === undefined ? null : current.expenses - budget;
    return {
      period: current.period,
      revenue: current.revenue,
      expenses: current.expenses,
      netOperatingAmount: net,
      operatingMargin: current.revenue === 0 ? null : net / current.revenue,
      expenseToRevenue: current.revenue === 0 ? null : current.expenses / current.revenue,
      expenseVariance: variance,
      expenseVariancePercent: variance === null || budget === 0 || budget === undefined ? null : variance / budget,
      revenueChange: previous ? current.revenue - previous.revenue : null,
      revenueChangePercent: previous && previous.revenue !== 0 ? (current.revenue - previous.revenue) / previous.revenue : null,
    };
  });
}

/** Repeat-last-value baseline. */
export function forecastNaive(values: readonly number[], horizon: number): number[] {
  validateForecastInput(values, horizon);
  return Array.from({ length: horizon }, () => values[values.length - 1]);
}

/** Mean of the most recent window, repeated for the requested horizon. */
export function forecastMovingAverage(values: readonly number[], horizon: number, window = 3): number[] {
  validateForecastInput(values, horizon);
  if (!Number.isInteger(window) || window < 1) throw new Error("window must be a positive integer.");
  const sample = values.slice(-window);
  const average = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  return Array.from({ length: horizon }, () => average);
}

function validateForecastInput(values: readonly number[], horizon: number): void {
  if (values.length === 0) throw new Error("At least one historical observation is required.");
  if (values.some((value) => !Number.isFinite(value))) throw new Error("Forecast observations must be finite numbers.");
  if (!Number.isInteger(horizon) || horizon < 1) throw new Error("horizon must be a positive integer.");
}

/** One-step walk-forward evaluation; each prediction only sees earlier observations. */
export function evaluateNaiveWalkForward(values: readonly number[], minTrainingSize = 2): ForecastEvaluation {
  if (!Number.isInteger(minTrainingSize) || minTrainingSize < 1) throw new Error("minTrainingSize must be a positive integer.");
  if (values.length <= minTrainingSize) throw new Error("Not enough observations for walk-forward evaluation.");
  const actuals = values.slice(minTrainingSize);
  const predictions = actuals.map((_, index) => values[minTrainingSize + index - 1]);
  const errors = predictions.map((prediction, index) => prediction - actuals[index]);
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
  const nonZero = actuals.map((actual, index) => ({ actual, prediction: predictions[index] })).filter((item) => item.actual !== 0);
  const mapePercent = nonZero.length
    ? nonZero.reduce((sum, item) => sum + Math.abs((item.prediction - item.actual) / item.actual), 0) / nonZero.length * 100
    : null;
  return {
    predictions,
    actuals,
    mae,
    rmse,
    mapePercent,
    meanError: errors.reduce((sum, error) => sum + error, 0) / errors.length,
  };
}

type DecimalValue = { units: bigint; scale: number };

function absDecimal(value: DecimalValue): DecimalValue {
  return { units: value.units < 0n ? -value.units : value.units, scale: value.scale };
}

function alignDecimal(value: DecimalValue, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

function compareDecimal(a: DecimalValue, b: DecimalValue): number {
  const scale = Math.max(a.scale, b.scale);
  const left = alignDecimal(a, scale);
  const right = alignDecimal(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

function subtractDecimal(a: DecimalValue, b: DecimalValue): DecimalValue {
  const scale = Math.max(a.scale, b.scale);
  return { units: alignDecimal(a, scale) - alignDecimal(b, scale), scale };
}

function averageDecimals(a: DecimalValue, b: DecimalValue): DecimalValue {
  const scale = Math.max(a.scale, b.scale);
  // Increasing scale by one makes the mean exact even when the sum is odd.
  return { units: (alignDecimal(a, scale) + alignDecimal(b, scale)) * 5n, scale: scale + 1 };
}

function medianDecimal(values: DecimalValue[]): DecimalValue {
  const sorted = [...values].sort(compareDecimal);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : averageDecimals(sorted[middle - 1], sorted[middle]);
}

function decimalToString(value: DecimalValue): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, "0");
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const whole = digits.slice(0, -value.scale) || "0";
  const fraction = digits.slice(-value.scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function decimalRatio(numerator: DecimalValue, denominator: DecimalValue): number {
  if (denominator.units === 0n) return numerator.units === 0n ? 0 : Number.POSITIVE_INFINITY;
  const scale = Math.max(numerator.scale, denominator.scale);
  const top = alignDecimal(absDecimal(numerator), scale);
  const bottom = alignDecimal(absDecimal(denominator), scale);
  // Only the dimensionless score is converted to Number, never the money values.
  const precision = 1_000_000_000n;
  return Number((top * precision) / bottom) / Number(precision);
}

function comparableMagnitude(row: SourceAnalysisRecord): DecimalValue | null {
  if (row.monetary_basis === "debit_credit") {
    const values = [row.debit, row.credit].map(parseDecimal).filter((value): value is DecimalValue => value !== null).map(absDecimal);
    if (!values.length) return null;
    return values.reduce((largest, value) => compareDecimal(value, largest) > 0 ? value : largest);
  }
  const parsed = parseDecimal(row.source_amount);
  return parsed === null ? null : absDecimal(parsed);
}

/**
 * Robust, explainable outlier baseline. Groups by currency, account and
 * monetary basis so incomparable amounts are not mixed. A flag is not a fraud
 * finding. This is intentionally not labelled as Isolation Forest/ML.
 */
export function detectRobustAmountAnomalies(
  records: readonly SourceAnalysisRecord[],
  options: { threshold?: number; minimumGroupSize?: number } = {},
): AnomalyFinding[] {
  const threshold = options.threshold ?? 4.5;
  const minimumGroupSize = options.minimumGroupSize ?? 5;
  if (!(threshold > 0)) throw new Error("threshold must be greater than zero.");
  if (!Number.isInteger(minimumGroupSize) || minimumGroupSize < 3) throw new Error("minimumGroupSize must be an integer of at least 3.");
  const candidates = records.map((row) => ({ row, magnitude: comparableMagnitude(row) }))
    .filter((item): item is { row: SourceAnalysisRecord; magnitude: DecimalValue } => item.magnitude !== null);
  const groups = new Map<string, typeof candidates>();
  for (const item of candidates) {
    const key = [item.row.currency ?? "UNSPECIFIED", item.row.account_code ?? "UNSPECIFIED", item.row.monetary_basis].join("|");
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const findings: AnomalyFinding[] = [];
  for (const group of groups.values()) {
    if (group.length < minimumGroupSize) continue;
    const magnitudes = group.map((item) => item.magnitude);
    const centre = medianDecimal(magnitudes);
    const mad = medianDecimal(magnitudes.map((value) => absDecimal(subtractDecimal(value, centre))));
    for (const item of group) {
      const deviation = absDecimal(subtractDecimal(item.magnitude, centre));
      const robustScore = mad.units !== 0n
        ? 0.6745 * decimalRatio(deviation, mad)
        : compareDecimal(item.magnitude, centre) === 0 ? 0 : decimalRatio(deviation, centre);
      if (robustScore < threshold) continue;
      findings.push({
        source_row_id: item.row.source_row_id,
        source_file: item.row.source_file,
        source_row_number: item.row.source_row_number,
        canonical_date: item.row.canonical_date,
        account_code: item.row.account_code,
        currency: item.row.currency ?? "UNSPECIFIED",
        monetary_basis: item.row.monetary_basis,
        magnitude: decimalToString(item.magnitude),
        robustScore,
        severity: robustScore >= threshold * 2 ? "HIGH" : "MEDIUM",
        reason: `Amount magnitude is unusual within this currency/account/monetary-basis group (robust score ${Number.isFinite(robustScore) ? robustScore.toFixed(2) : "infinite"}). Review the source and business context.`,
        ingestion_status: item.row.ingestion_status,
      });
    }
  }
  return findings.sort((a, b) => b.robustScore - a.robustScore);
}

/** Exact arithmetic only; interpretation requires separately reviewed dataset context. */
export function subtractDecimalStrings(debit: string, credit: string): string {
  const left = parseDecimal(debit), right = parseDecimal(credit);
  if (left === null || right === null) throw new Error("Invalid canonical decimal string.");
  return decimalToString(subtractDecimal(left, right));
}
