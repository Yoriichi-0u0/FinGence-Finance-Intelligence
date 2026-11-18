import { z } from "zod";
import {
  REPORT_EXCEPTION_CODES,
  type MonetaryBasis,
} from "./contracts";
import { FINANCIAL_EXPLANATION_PROMPT_VERSION } from "./prompts/financial-explanation";

export const FINANCIAL_EXPLANATION_REQUEST_VERSION = "financial-explanation-request-0.1" as const;
export const FINANCIAL_EXPLANATION_RESULT_VERSION = "financial-explanation-result-0.1" as const;

export const FINANCIAL_EXPLANATION_TOPICS = [
  "SOURCE_VALUE_TOTAL",
  "DATA_QUALITY",
  "STATISTICAL_REVIEW_FLAG",
] as const;

export const FINANCIAL_EXPLANATION_LIMITATION_CODES = [
  "SOURCE_VALUES_NOT_FINANCIAL_STATEMENT_METRICS",
  "WARNINGS_PRESENT",
  "REJECTED_ROWS_EXCLUDED",
  "MISSING_CURRENCY",
  "MIXED_CURRENCY",
  "STATISTICAL_FLAGS_REQUIRE_REVIEW",
  "HUMAN_REVIEW_REQUIRED",
] as const;

const monetaryBases = [
  "source_signed_amount",
  "source_amount_with_direction",
  "debit_credit",
  "approved_interpretation",
] as const satisfies readonly MonetaryBasis[];
const boundedId = z.string().min(1).max(300);
const exactDecimalText = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const periodSchema = z.strictObject({
  startDate: z.string().min(1).max(32),
  endDate: z.string().min(1).max(32),
  timezone: z.string().min(1).max(80),
  dateBasis: z.enum(["TRANSACTION_DATE", "POSTING_DATE", "CANONICAL_DATE"]),
});
const currencyScopeSchema = z.strictObject({
  status: z.enum(["NONE", "SINGLE", "MIXED"]),
  currencies: z.array(z.string().min(1).max(12)).max(16),
  hasMissingCurrency: z.boolean(),
});
const qualitySchema = z.strictObject({
  acceptedCount: z.number().int().nonnegative(),
  validCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  includedWarningCount: z.number().int().nonnegative(),
  excludedWarningCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  rejectedRecordsInEvidence: z.literal(0),
});
const promptEvidenceValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("MONETARY"),
    amount: exactDecimalText,
    currency: z.string().min(1).max(12).nullable(),
    currencyBasis: z.enum(["SOURCE", "DATASET_DEFAULT"]).nullable(),
    monetaryBasis: z.enum(monetaryBases),
    sourceComponent: z.enum(["DEBIT", "CREDIT", "SOURCE_AMOUNT", "BALANCE", "DERIVED_TOTAL", "APPROVED_METRIC"]),
  }),
  z.strictObject({ kind: z.literal("COUNT"), value: z.number().int().nonnegative(), unit: z.enum(["RECORDS", "WARNINGS", "REJECTIONS", "OTHER"]) }),
  z.strictObject({ kind: z.literal("TEXT"), value: z.literal("STATISTICAL_AMOUNT_REVIEW_FLAG") }),
]);
const promptEvidenceItemSchema = z.strictObject({
  evidenceId: boundedId,
  evidenceClass: z.literal("DETERMINISTIC_CALCULATION"),
  label: z.string().min(1).max(160),
  value: promptEvidenceValueSchema,
  period: periodSchema,
  warningRules: z.array(z.strictObject({
    rule: z.string().min(1).max(120),
    category: z.enum(["technical", "business"]),
    field: z.string().min(1).max(120),
  })).max(32),
  derivation: z.strictObject({
    functionId: z.enum([
      "analytics.aggregateSourceRecords",
      "analytics.detectRobustAmountAnomalies.count",
      "ingestion.createAcceptedDataPayload.quality",
    ]),
    version: z.string().min(1).max(80),
  }),
  interpretationStatus: z.enum(["NOT_APPLICABLE", "UNAVAILABLE"]),
});
const exceptionSchema = z.strictObject({
  code: z.enum(REPORT_EXCEPTION_CODES),
  severity: z.enum(["INFO", "WARNING", "BLOCKING"]),
  blocksPublication: z.boolean(),
  evidenceIds: z.array(boundedId).max(64),
});

export const financialExplanationRequestSchema = z.strictObject({
  requestVersion: z.literal(FINANCIAL_EXPLANATION_REQUEST_VERSION),
  promptVersion: z.literal(FINANCIAL_EXPLANATION_PROMPT_VERSION),
  reportId: boundedId,
  sourceFileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  requestedAudience: z.literal("MANAGEMENT"),
  untrustedSourceTextPolicy: z.literal("EXCLUDED_FROM_MODEL_INPUT"),
  bundle: z.strictObject({
    bundleId: boundedId,
    snapshotId: boundedId,
    snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
    schemaVersion: z.string().min(1).max(40),
    rulesetVersion: z.string().min(1).max(40),
    period: periodSchema,
    warningPolicy: z.enum(["INCLUDE_WITH_CAVEATS", "EXCLUDE"]),
    currencyScope: currencyScopeSchema,
    quality: qualitySchema,
    sensitivity: z.enum(["UNCLASSIFIED", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
    evidenceItems: z.array(promptEvidenceItemSchema).min(1).max(64),
    exceptions: z.array(exceptionSchema).max(32),
  }),
});

/** Strict model output; additional semantic and evidence checks run afterward. */
export const financialExplanationModelOutputSchema = z.strictObject({
  promptVersion: z.literal(FINANCIAL_EXPLANATION_PROMPT_VERSION),
  managementSummary: z.string().min(1).max(800).regex(/^[^0-9]+$/),
});

export type FinancialExplanationRequest = z.infer<typeof financialExplanationRequestSchema>;
export type FinancialExplanationModelOutput = z.infer<typeof financialExplanationModelOutputSchema>;
export type FinancialExplanationTopic = typeof FINANCIAL_EXPLANATION_TOPICS[number];
export type FinancialExplanationLimitationCode = typeof FINANCIAL_EXPLANATION_LIMITATION_CODES[number];
