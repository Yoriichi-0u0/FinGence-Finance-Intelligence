import type { WarningPolicy } from "../analytics";
import { analyzeAcceptedDataPayload } from "../analytics/accepted-data-adapter";
import type { DocumentInput, ProcessingContext } from "../demo/pipeline";
import {
  DEFAULT_OPTIONS,
  approveMapping,
  createAcceptedDataPayload,
  createDataset,
  ingestDatasetRun,
  inspectFile,
  mappingErrors,
  type CanonicalField,
  type ColumnMapping,
  type IngestionOptions,
} from "../ingestion";
import { cashCents } from "../poc-reconciliation/engine";
import type { CashSource, CashSourceRow } from "../poc-reconciliation/contracts";
import {
  createLocalManagementReport,
  type LocalManagementReport,
} from "./local-management-report";
import {
  createQuarterlyFinancialActivityReport,
  discoverReportBusinesses,
  listAvailableQuarterPeriods,
} from "./quarterly-reporting";

const BANK_COLUMN_TARGETS: Readonly<Record<string, CanonicalField>> = {
  ValueDate: "transaction_date",
  BankReference: "reference",
  SourceTransactionID: "source_transaction_id",
  AccountNumber: "account_id",
  BusinessID: "entity_id",
  BankDescription: "description",
  Counterparty: "counterparty",
  BankAmountMYR: "source_amount",
  BankDirection: "entry_side",
  Currency: "currency",
};

const REQUIRED_BANK_COLUMNS = Object.keys(BANK_COLUMN_TARGETS);

export type DemoDocumentReportCompatibilityCode =
  | "REPORT_CONTEXT_UNAVAILABLE"
  | "ORIGINAL_BANK_DOCUMENT_UNAVAILABLE"
  | "UNSUPPORTED_ORIGINAL_FORMAT"
  | "UNSUPPORTED_BANK_LAYOUT"
  | "SOURCE_FINGERPRINT_MISMATCH"
  | "C1_INGESTION_REJECTED"
  | "INDEPENDENT_VERIFICATION_MISMATCH";

export class DemoDocumentReportCompatibilityError extends Error {
  constructor(
    readonly code: DemoDocumentReportCompatibilityCode,
    message: string,
  ) {
    super(message);
    this.name = "DemoDocumentReportCompatibilityError";
  }
}

export interface DemoDocumentReportVerification {
  method: "INDEPENDENT_C1_REINGESTION";
  sourceFile: string;
  sourceSha256: string;
  acceptedRows: number;
  comparedRows: number;
  checks: readonly [
    "SOURCE_SHA256",
    "ROW_COUNT",
    "ROW_PROVENANCE",
    "BUSINESS",
    "CURRENCY",
    "DATE",
    "REFERENCE",
    "DESCRIPTION",
    "SOURCE_TRANSACTION_ID",
    "DIRECTION_AND_EXACT_CENTS",
  ];
}

export interface DemoDocumentReportResult {
  report: LocalManagementReport;
  verification: DemoDocumentReportVerification;
}

export interface CreateDemoDocumentReportInput {
  context: ProcessingContext;
  inputs: readonly DocumentInput[];
  warningPolicy?: WarningPolicy;
  generatedAt?: string;
}

function basename(value: string): string {
  return value.split(/[\\/]/).at(-1) ?? value;
}

function compatibleInput(inputs: readonly DocumentInput[], bank: CashSource): DocumentInput {
  const matches = inputs.filter(input => basename(input.name) === bank.filename);
  if (matches.length !== 1) {
    throw new DemoDocumentReportCompatibilityError(
      "ORIGINAL_BANK_DOCUMENT_UNAVAILABLE",
      "The exact original bank statement for this processing is unavailable, so AI Reporting was not generated.",
    );
  }
  if (!/\.csv$/i.test(matches[0].name)) {
    throw new DemoDocumentReportCompatibilityError(
      "UNSUPPORTED_ORIGINAL_FORMAT",
      "This older reporting workflow currently accepts the Data page's original bank CSV samples. The current bank document uses another format, so no conversion was attempted.",
    );
  }
  return matches[0];
}

function bankMapping(columns: readonly string[]): ColumnMapping[] {
  const available = new Set(columns);
  const missing = REQUIRED_BANK_COLUMNS.filter(column => !available.has(column));
  if (missing.length) {
    throw new DemoDocumentReportCompatibilityError(
      "UNSUPPORTED_BANK_LAYOUT",
      `The original bank document does not expose the reviewed Data sample columns required by AI Reporting: ${missing.join(", ")}. No fields were guessed.`,
    );
  }
  return approveMapping(columns.map((sourceColumn, sourceIndex) => ({
    sourceIndex,
    sourceColumn,
    target: BANK_COLUMN_TARGETS[sourceColumn] ?? null,
    method: BANK_COLUMN_TARGETS[sourceColumn] ? "manual" : "unmapped",
    confidence: null,
    userConfirmed: false,
  })));
}

function signedCents(row: { source_amount: string | null; entry_side: "DEBIT" | "CREDIT" | null }): bigint | null {
  if (row.source_amount === null || row.entry_side === null) return null;
  const magnitude = cashCents(row.source_amount);
  return row.entry_side === "CREDIT" ? magnitude : -magnitude;
}

function rowAgrees(
  accepted: ReturnType<typeof createAcceptedDataPayload>["datasets"][number]["normalized"][number],
  authoritative: CashSourceRow,
): boolean {
  return accepted.source_row_number === authoritative.row
    && accepted.entity_id === authoritative.businessId
    && accepted.currency === authoritative.currency
    && accepted.canonical_date === authoritative.date
    && accepted.reference === authoritative.reference
    && accepted.description === authoritative.description
    && accepted.source_transaction_id === authoritative.sourceTransactionId
    && signedCents(accepted) === BigInt(authoritative.signedCents);
}

function fullCalendarQuarter(months: readonly string[]): { year: number; quarter: 1 | 2 | 3 | 4 } | null {
  const unique = [...new Set(months)].sort();
  if (unique.length !== 3) return null;
  const first = /^(\d{4})-(\d{2})$/.exec(unique[0]);
  if (!first) return null;
  const year = Number(first[1]), firstMonth = Number(first[2]);
  const quarter = Math.ceil(firstMonth / 3) as 1 | 2 | 3 | 4;
  const start = (quarter - 1) * 3 + 1;
  const expected = [0, 1, 2].map(offset => `${year}-${String(start + offset).padStart(2, "0")}`);
  return unique.every((month, index) => month === expected[index]) ? { year, quarter } : null;
}

/**
 * Builds the older C1-backed report from the same original bank bytes used by Data.
 * The current processing output is used only as an independent comparison target; it is never cast into C1.
 */
export async function createDemoDocumentReport(input: CreateDemoDocumentReportInput): Promise<DemoDocumentReportResult> {
  const bank = input.context.outputs.bank;
  const scope = input.context.scope;
  if (!bank || !scope) {
    throw new DemoDocumentReportCompatibilityError(
      "REPORT_CONTEXT_UNAVAILABLE",
      "The current Data processing has no accepted bank source and scope, so AI Reporting was not generated.",
    );
  }
  const original = compatibleInput(input.inputs, bank);
  const file = await inspectFile(original.bytes, { name: original.name });
  if (file.fingerprint !== bank.sha256) {
    throw new DemoDocumentReportCompatibilityError(
      "SOURCE_FINGERPRINT_MISMATCH",
      "The original bank document no longer matches the source fingerprint shown by Data, so AI Reporting was withheld.",
    );
  }
  const dataset = createDataset(file, file.sheets[0].index, 1);
  const mapping = bankMapping(dataset.columns);
  const options: IngestionOptions = {
    ...DEFAULT_OPTIONS,
    sourceSystem: "FinGence Data bank statement (independently re-read)",
    monetaryMode: "amount_direction",
    dateBasis: "transaction_date",
    dateOrder: "ISO",
    numberFormat: "plain",
    blankSideAsZero: false,
    negativeDebitCredit: "reject",
    bothDebitCredit: "reject",
    currencyDefault: null,
  };
  const errors = mappingErrors(dataset, mapping, options);
  if (errors.length) {
    throw new DemoDocumentReportCompatibilityError(
      "UNSUPPORTED_BANK_LAYOUT",
      `The Data bank statement could not satisfy the reviewed AI Reporting mapping: ${errors.join(" ")}`,
    );
  }

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const generatedDate = new Date(generatedAt);
  if (!Number.isFinite(generatedDate.getTime())) throw new Error("AI Reporting requires a valid generation timestamp.");
  const result = ingestDatasetRun(dataset, mapping, options, {
    idFactory: () => `data-report:${input.context.processingId}:${bank.sha256.slice(0, 12)}`,
    now: () => generatedDate,
  });
  if (result.summary.rejected || result.summary.accepted !== bank.rows.length) {
    throw new DemoDocumentReportCompatibilityError(
      "C1_INGESTION_REJECTED",
      `The independent C1 check accepted ${result.summary.accepted} of ${result.summary.rowsReceived} bank rows while Data accepted ${bank.rows.length}; the older report was withheld.`,
    );
  }

  const payload = createAcceptedDataPayload([result]);
  const rows = payload.datasets[0].normalized;
  const agreement = rows.length === bank.rows.length
    && rows.every((row, index) => rowAgrees(row, bank.rows[index]));
  if (!agreement
    || payload.datasets[0].file_sha256 !== bank.sha256
    || bank.businessId !== scope.businessId
    || bank.currency !== scope.currency) {
    throw new DemoDocumentReportCompatibilityError(
      "INDEPENDENT_VERIFICATION_MISMATCH",
      "The older C1 report and the current Data processing did not independently agree on every bank row, so the report was withheld.",
    );
  }

  const warningPolicy = input.warningPolicy ?? "include";
  const analysis = analyzeAcceptedDataPayload(payload, warningPolicy);
  const business = discoverReportBusinesses(payload).options.find(option => option.businessId === bank.businessId);
  const months = rows.map(row => row.canonical_date.slice(0, 7));
  const quarter = fullCalendarQuarter(months);
  const period = quarter
    ? listAvailableQuarterPeriods(payload, bank.businessId)
      .find(candidate => candidate.year === quarter.year && candidate.quarter === quarter.quarter) ?? null
    : null;
  const registeredName = business?.nameBasis === "REGISTERED_SYNTHETIC" ? business.displayName : null;
  const report = period && registeredName
    ? await createQuarterlyFinancialActivityReport({
        payload,
        warningPolicy,
        generatedAt,
        selection: {
          businessId: bank.businessId,
          businessDisplayName: registeredName,
          currentPeriod: period,
          comparisonPeriod: null,
        },
      })
    : await createLocalManagementReport({
        payload,
        analysis,
        warningPolicy,
        generatedAt,
        organizationName: registeredName ?? bank.businessId,
      });

  return {
    report,
    verification: {
      method: "INDEPENDENT_C1_REINGESTION",
      sourceFile: file.name,
      sourceSha256: file.fingerprint,
      acceptedRows: rows.length,
      comparedRows: bank.rows.length,
      checks: [
        "SOURCE_SHA256",
        "ROW_COUNT",
        "ROW_PROVENANCE",
        "BUSINESS",
        "CURRENCY",
        "DATE",
        "REFERENCE",
        "DESCRIPTION",
        "SOURCE_TRANSACTION_ID",
        "DIRECTION_AND_EXACT_CENTS",
      ],
    },
  };
}
