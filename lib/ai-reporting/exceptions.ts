import type {
  ExceptionResolution,
  ExceptionSeverity,
  ReportException,
  ReportExceptionCode,
} from "./contracts";

export interface ReportExceptionPolicy {
  defaultSeverity: ExceptionSeverity;
  blocksPublication: boolean;
  resolution: ExceptionResolution;
  defaultMessage: string;
}

/** Stable default behavior. Callers may add context but must not weaken these policies. */
export const REPORT_EXCEPTION_POLICY: Readonly<Record<ReportExceptionCode, ReportExceptionPolicy>> = {
  EVIDENCE_METADATA_INCONSISTENT: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "PROVIDE_DATA",
    defaultMessage: "Evidence bundle metadata does not agree with the evidence items it describes.",
  },
  UNSUPPORTED_FINANCIAL_MEANING: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "OBTAIN_APPROVAL",
    defaultMessage: "The evidence does not carry an approved financial interpretation for this claim.",
  },
  INTERPRETATION_UNAVAILABLE: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "OBTAIN_APPROVAL",
    defaultMessage: "A required financial interpretation is unavailable or is not bound to trusted approval context.",
  },
  MIXED_CURRENCY: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "SEPARATE_VALUES",
    defaultMessage: "Monetary evidence contains multiple currencies and must remain separated unless an approved conversion exists.",
  },
  CURRENCY_UNSPECIFIED: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "PROVIDE_DATA",
    defaultMessage: "At least one monetary value has no currency and cannot be silently relabelled.",
  },
  WARNING_RECORDS_INCLUDED: {
    defaultSeverity: "WARNING", blocksPublication: false, resolution: "DISCLOSE",
    defaultMessage: "WARNING records are included and claims using them require a visible caveat.",
  },
  WARNING_RECORDS_EXCLUDED: {
    defaultSeverity: "INFO", blocksPublication: false, resolution: "DISCLOSE",
    defaultMessage: "WARNING records were excluded under the selected warning policy.",
  },
  REJECTED_ROWS_PRESENT: {
    defaultSeverity: "WARNING", blocksPublication: false, resolution: "DISCLOSE",
    defaultMessage: "Rejected rows exist in source quality counts but their contents are excluded from report evidence.",
  },
  AMBIGUOUS_REPORTING_BATCH: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "CLARIFY_SCOPE",
    defaultMessage: "The authoritative reporting population or batch is ambiguous.",
  },
  INSUFFICIENT_HISTORY: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "PROVIDE_DATA",
    defaultMessage: "The requested analysis does not have sufficient approved history.",
  },
  BUDGET_SOURCE_UNAVAILABLE: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "PROVIDE_DATA",
    defaultMessage: "No approved budget source is available for the requested comparison.",
  },
  RECONCILIATION_UNAVAILABLE: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "PROVIDE_DATA",
    defaultMessage: "Reconciliation status is unavailable and must not be inferred from ingestion acceptance.",
  },
  CLAIM_NOT_GROUNDED: {
    defaultSeverity: "BLOCKING", blocksPublication: true, resolution: "REJECT_CLAIM",
    defaultMessage: "The claim is not fully supported by its cited evidence.",
  },
};

export function createReportException(
  code: ReportExceptionCode,
  options: {
    exceptionId?: string;
    message?: string;
    evidenceIds?: readonly string[];
  } = {},
): ReportException {
  const policy = REPORT_EXCEPTION_POLICY[code];
  return {
    exceptionId: options.exceptionId ?? `policy:${code}`,
    code,
    severity: policy.defaultSeverity,
    blocksPublication: policy.blocksPublication,
    message: options.message ?? policy.defaultMessage,
    resolution: policy.resolution,
    evidenceIds: options.evidenceIds ?? [],
  };
}
