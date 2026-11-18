/**
 * Provider-independent AI Reporting contracts.
 *
 * These contracts describe trusted in-process values. They are not runtime
 * validation for arbitrary JSON and they do not assign accounting meaning to
 * ingestion fields.
 */

export const AI_REPORTING_CONTRACT_VERSION = "0.1" as const;
export const EVIDENCE_BUNDLE_VERSION = "0.1" as const;
export const GROUNDING_POLICY_VERSION = "0.1" as const;

declare const exactDecimalBrand: unique symbol;

/** Monetary and other decimal values remain text and must never pass through number. */
export type ExactDecimalString = string & { readonly [exactDecimalBrand]: true };

export type ReportingDateBasis = "TRANSACTION_DATE" | "POSTING_DATE" | "CANONICAL_DATE";

export interface ReportingPeriod {
  startDate: string;
  endDate: string;
  timezone: string;
  dateBasis: ReportingDateBasis;
}

export type WarningPolicy = "INCLUDE_WITH_CAVEATS" | "EXCLUDE";
export type EvidenceSensitivity = "UNCLASSIFIED" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
export type CurrencyBasis = "SOURCE" | "DATASET_DEFAULT" | null;
export type MonetaryBasis =
  | "source_signed_amount"
  | "source_amount_with_direction"
  | "debit_credit"
  | "approved_interpretation";

export interface CurrencyScope {
  status: "NONE" | "SINGLE" | "MIXED";
  currencies: readonly string[];
  hasMissingCurrency: boolean;
}

export interface TrustedRequestContext {
  organizationId: string;
  actorId: string;
  resolution: "TRUSTED_SERVER_CONTEXT";
}

export interface ReportingPopulation {
  snapshotId: string;
  snapshotSha256: string;
  persistenceAttemptIds: readonly string[];
  ingestionBatchIds: readonly string[];
  datasetIds: readonly string[];
  selection: "EXPLICIT";
}

export interface ReportRequest {
  contractVersion: typeof AI_REPORTING_CONTRACT_VERSION;
  requestId: string;
  trustedContext: TrustedRequestContext;
  period: ReportingPeriod;
  population: ReportingPopulation;
  templateId: string;
  templateVersion: string;
  warningPolicy: WarningPolicy;
  interpretationApprovalIds: readonly string[];
  language: string;
  audience: "FINANCE_ANALYST" | "MANAGEMENT_REVIEWER" | "OTHER_APPROVED";
}

export interface SourceLineage {
  schemaVersion: string;
  rulesetVersion: string;
  datasetId: string;
  sourceSystem: string;
  sourceFile: string;
  sourceSheet: string | null;
  fileSha256: string;
  ingestionBatchId: string;
  ingestedAt: string;
  sourceRowId: string | null;
  sourceRowNumber: number | null;
}

export type EvidenceScalar =
  | string
  | boolean
  | null
  | { kind: "excel_date" | "excel_number"; value: string };

export interface EvidenceWarning {
  rule: string;
  category: "technical" | "business";
  field: string;
  sourceColumn: string | null;
  originalValue: EvidenceScalar;
  message: string;
  sensitivity: EvidenceSensitivity;
}

export type EvidenceValue =
  | {
      kind: "MONETARY";
      amount: ExactDecimalString;
      currency: string | null;
      currencyBasis: CurrencyBasis;
      monetaryBasis: MonetaryBasis;
      sourceComponent: "DEBIT" | "CREDIT" | "SOURCE_AMOUNT" | "BALANCE" | "DERIVED_TOTAL" | "APPROVED_METRIC";
    }
  | { kind: "DECIMAL"; value: ExactDecimalString; unit: "PERCENTAGE" | "RATIO" | "OTHER" }
  | { kind: "COUNT"; value: number; unit: "RECORDS" | "WARNINGS" | "REJECTIONS" | "OTHER" }
  | { kind: "TEXT"; value: string }
  | { kind: "DATE"; value: string };

export type NonApprovedInterpretation =
  | { status: "NOT_APPLICABLE" }
  | { status: "UNAVAILABLE"; reason: string; requiredForRequest: boolean }
  | {
      status: "REFERENCE_ONLY";
      approvalReference: string;
      reason: string;
      requiredForRequest: boolean;
    };

export interface InterpretationApproval {
  status: "APPROVED";
  interpretationId: string;
  label: string;
  definitionReference: string;
  approvalReference: string;
  approvedByActorId: string;
  approvedAt: string;
  organizationId: string;
  snapshotId: string;
  source: "TRUSTED_SERVER_CONTEXT";
}

interface EvidenceBase {
  evidenceId: string;
  value: EvidenceValue;
  period: ReportingPeriod;
  warnings: readonly EvidenceWarning[];
  sensitivity: EvidenceSensitivity;
}

/** A preserved source fact. It has no revenue/expense/profit/cash-flow meaning. */
export interface VerifiedSourceEvidence extends EvidenceBase {
  evidenceClass: "VERIFIED_SOURCE_STRUCTURE";
  sourceField: "debit" | "credit" | "source_amount" | "balance" | "date" | "count" | "other";
  lineage: SourceLineage;
  interpretation: NonApprovedInterpretation;
}

export interface DeterministicDerivation {
  functionId: string;
  version: string;
  inputEvidenceIds: readonly string[];
}

/** A reproducible calculation whose accounting meaning is still not implied. */
export interface DeterministicCalculationEvidence extends EvidenceBase {
  evidenceClass: "DETERMINISTIC_CALCULATION";
  derivation: DeterministicDerivation;
  lineage: readonly SourceLineage[];
  interpretation: NonApprovedInterpretation;
}

/** A value whose financial meaning has a separately trusted, scope-bound approval. */
export interface ApprovedFinancialInterpretationEvidence extends EvidenceBase {
  evidenceClass: "APPROVED_FINANCIAL_INTERPRETATION";
  basisEvidenceIds: readonly string[];
  derivation: DeterministicDerivation | null;
  lineage: readonly SourceLineage[];
  interpretation: InterpretationApproval;
}

export type EvidenceItem =
  | VerifiedSourceEvidence
  | DeterministicCalculationEvidence
  | ApprovedFinancialInterpretationEvidence;

export interface EvidenceQualitySummary {
  acceptedCount: number;
  validCount: number;
  warningCount: number;
  includedWarningCount: number;
  excludedWarningCount: number;
  rejectedCount: number;
  /** Rejected contents are outside the normal AI evidence path; only their count is retained. */
  rejectedRecordsInEvidence: 0;
}

export interface EvidenceSnapshot {
  snapshotId: string;
  snapshotSha256: string;
  schemaVersion: string;
  rulesetVersion: string;
  datasetIds: readonly string[];
  ingestionBatchIds: readonly string[];
  createdAt: string;
}

export interface EvidenceBundle {
  bundleVersion: typeof EVIDENCE_BUNDLE_VERSION;
  contractVersion: typeof AI_REPORTING_CONTRACT_VERSION;
  bundleId: string;
  snapshot: EvidenceSnapshot;
  period: ReportingPeriod;
  warningPolicy: WarningPolicy;
  currencyScope: CurrencyScope;
  quality: EvidenceQualitySummary;
  sensitivity: EvidenceSensitivity;
  items: readonly EvidenceItem[];
  exceptions: readonly ReportException[];
}

export const REPORT_EXCEPTION_CODES = [
  "EVIDENCE_METADATA_INCONSISTENT",
  "UNSUPPORTED_FINANCIAL_MEANING",
  "INTERPRETATION_UNAVAILABLE",
  "MIXED_CURRENCY",
  "CURRENCY_UNSPECIFIED",
  "WARNING_RECORDS_INCLUDED",
  "WARNING_RECORDS_EXCLUDED",
  "REJECTED_ROWS_PRESENT",
  "AMBIGUOUS_REPORTING_BATCH",
  "INSUFFICIENT_HISTORY",
  "BUDGET_SOURCE_UNAVAILABLE",
  "RECONCILIATION_UNAVAILABLE",
  "CLAIM_NOT_GROUNDED",
] as const;

export type ReportExceptionCode = typeof REPORT_EXCEPTION_CODES[number];
export type ExceptionSeverity = "INFO" | "WARNING" | "BLOCKING";
export type ExceptionResolution =
  | "DISCLOSE"
  | "CLARIFY_SCOPE"
  | "PROVIDE_DATA"
  | "OBTAIN_APPROVAL"
  | "SEPARATE_VALUES"
  | "REJECT_CLAIM";

export interface ReportException {
  exceptionId: string;
  code: ReportExceptionCode;
  severity: ExceptionSeverity;
  blocksPublication: boolean;
  message: string;
  resolution: ExceptionResolution;
  evidenceIds: readonly string[];
}

export type ClaimKind = "SOURCE_STRUCTURE" | "DETERMINISTIC_RESULT" | "FINANCIAL_INTERPRETATION" | "LIMITATION";
export type ClaimCaveatCode = "WARNING_EVIDENCE" | "CURRENCY_LIMITATION" | "INTERPRETATION_LIMITATION" | "REJECTED_COUNT";

export interface ClaimValueAssertion {
  evidenceId: string;
  exactValue: ExactDecimalString;
  currency: string | null;
  monetaryBasis: MonetaryBasis | null;
}

export interface ClaimProposal {
  claimId: string;
  sectionId: string;
  text: string;
  kind: ClaimKind;
  evidenceIds: readonly string[];
  valueAssertions: readonly ClaimValueAssertion[];
  financialMeaning: { interpretationId: string; label: string } | null;
  caveatCodes: readonly ClaimCaveatCode[];
}

export interface ClaimSupport {
  /** This result checks structured references and fields, not arbitrary narrative entailment. */
  assurance: "STRUCTURAL_ONLY";
  status: "SUPPORTED" | "SUPPORTED_WITH_CAVEAT" | "UNSUPPORTED";
  policyVersion: typeof GROUNDING_POLICY_VERSION;
  requiredCaveats: readonly ClaimCaveatCode[];
  exceptions: readonly ReportException[];
}

export interface GroundedClaim extends ClaimProposal {
  support: ClaimSupport;
}

export interface ReportSection {
  sectionId: string;
  title: string;
  narrative: string;
  claimIds: readonly string[];
}

export interface ReportDraft {
  contractVersion: typeof AI_REPORTING_CONTRACT_VERSION;
  reportId: string;
  workflowState: "DRAFT";
  request: ReportRequest;
  evidenceBundleId: string;
  inputSnapshotId: string;
  generation: {
    method: "MANUAL_TEMPLATE" | "PROVIDER_NEUTRAL_AI";
    promptVersion: string | null;
    modelIdentifier: string | null;
    policyVersion: typeof GROUNDING_POLICY_VERSION;
  };
  sections: readonly ReportSection[];
  claims: readonly GroundedClaim[];
  exceptions: readonly ReportException[];
  validation: {
    assurance: "STRUCTURAL_ONLY";
    status: "NOT_VALIDATED" | "PASSED" | "FAILED";
    validatedAt: string | null;
    unsupportedClaimIds: readonly string[];
  };
  createdAt: string;
}

export interface ReportArtifact {
  contractVersion: typeof AI_REPORTING_CONTRACT_VERSION;
  artifactId: string;
  sourceDraftId: string;
  workflowState: "APPROVED";
  inputSnapshotId: string;
  evidenceBundleId: string;
  sections: readonly ReportSection[];
  claims: readonly GroundedClaim[];
  exceptions: readonly ReportException[];
  approval: {
    reviewerActorId: string;
    organizationId: string;
    approvedAt: string;
    source: "TRUSTED_SERVER_CONTEXT";
  };
}

interface QuestionIntentBase {
  contractVersion: typeof AI_REPORTING_CONTRACT_VERSION;
  questionId: string;
  originalQuestion: string;
}

export type QuestionFilter = {
  field: "dataset_id" | "source_system" | "account_code" | "entity_id" | "currency" | "monetary_basis";
  operator: "EQUALS" | "IN";
  values: readonly string[];
};

export type QuestionIntent =
  | (QuestionIntentBase & {
      status: "READY";
      metricId: string;
      period: ReportingPeriod;
      groupBy: readonly ("PERIOD" | "CURRENCY" | "MONETARY_BASIS" | "DATASET")[];
      filters: readonly QuestionFilter[];
      interpretationApprovalIds: readonly string[];
      deterministicPlanVersion: string;
    })
  | (QuestionIntentBase & {
      status: "NEEDS_CLARIFICATION";
      reason: string;
      clarificationQuestions: readonly string[];
    })
  | (QuestionIntentBase & {
      status: "UNSUPPORTED";
      exception: ReportException;
    });

export type GroundedAnswer =
  | {
      status: "ANSWERED";
      questionId: string;
      answer: string;
      claims: readonly GroundedClaim[];
      evidenceBundleId: string;
      exceptions: readonly ReportException[];
    }
  | {
      status: "NEEDS_CLARIFICATION";
      questionId: string;
      clarificationPrompt: string;
      exceptions: readonly ReportException[];
    }
  | {
      status: "UNAVAILABLE";
      questionId: string;
      exceptions: readonly ReportException[];
    };
