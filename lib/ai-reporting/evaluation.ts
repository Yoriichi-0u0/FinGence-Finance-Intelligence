export const COMPLETENESS_RUBRIC_VERSION = "0.1" as const;
export type CompletenessScore = 0 | 1 | 2;

export const REPORT_COMPLETENESS_RUBRIC = [
  {
    criterionId: "SCOPE_AND_PERIOD",
    section: "Scope and reporting period",
    completeWhen: "The population snapshot, period, timezone, and date basis are stated without ambiguity.",
  },
  {
    criterionId: "RESULTS_WITH_CONTEXT",
    section: "Results",
    completeWhen: "Each reported value has evidence, currency, monetary basis, period, and approved interpretation where required.",
  },
  {
    criterionId: "QUALITY_AND_WARNINGS",
    section: "Data quality",
    completeWhen: "Accepted, warning, excluded-warning, and rejected counts and the warning policy are disclosed.",
  },
  {
    criterionId: "EXCEPTIONS_AND_LIMITATIONS",
    section: "Exceptions and limitations",
    completeWhen: "Unavailable meanings, missing or mixed currencies, and other applicable blocking or warning exceptions are visible.",
  },
  {
    criterionId: "EVIDENCE_TRACEABILITY",
    section: "Evidence",
    completeWhen: "Every factual claim cites existing evidence that supports its exact value and context.",
  },
] as const;

export type CompletenessCriterionId = typeof REPORT_COMPLETENESS_RUBRIC[number]["criterionId"];

export interface CompletenessAssessment {
  rubricVersion: typeof COMPLETENESS_RUBRIC_VERSION;
  scores: Readonly<Record<CompletenessCriterionId, CompletenessScore>>;
  total: number;
  maximum: number;
  complete: boolean;
  incompleteCriteria: readonly CompletenessCriterionId[];
}

export function assessCompleteness(
  scores: Readonly<Record<CompletenessCriterionId, CompletenessScore>>,
): CompletenessAssessment {
  const criteria = REPORT_COMPLETENESS_RUBRIC.map(item => item.criterionId);
  const incompleteCriteria = criteria.filter(id => scores[id] !== 2);
  return {
    rubricVersion: COMPLETENESS_RUBRIC_VERSION,
    scores,
    total: criteria.reduce((total, id) => total + scores[id], 0),
    maximum: criteria.length * 2,
    complete: incompleteCriteria.length === 0,
    incompleteCriteria,
  };
}

export const TASK_TIME_MEASURES = [
  "END_TO_END_ACTIVE_MS",
  "DRAFT_PREPARATION_ACTIVE_MS",
  "REVIEW_ACTIVE_MS",
  "CORRECTION_ACTIVE_MS",
] as const;
export type TaskTimeMeasure = typeof TASK_TIME_MEASURES[number];

export const USER_ERROR_CODES = [
  "WRONG_REPORTING_POPULATION",
  "WRONG_PERIOD_OR_DATE_BASIS",
  "CURRENCY_OR_MONETARY_BASIS_CONFLATION",
  "MISSED_WARNING_OR_REJECTED_COUNT",
  "UNSUPPORTED_FINANCIAL_INTERPRETATION",
  "UNSUPPORTED_REPORT_APPROVAL",
  "INVALID_EVIDENCE_CITATION",
  "INCORRECT_CORRECTION",
] as const;
export type UserErrorCode = typeof USER_ERROR_CODES[number];

export interface TaskCompletionInput {
  submitted: boolean;
  completeness: CompletenessAssessment;
  unsupportedFinancialClaimCount: number;
  blockingExceptionCount: number;
}

export function isTaskComplete(input: TaskCompletionInput): boolean {
  return input.submitted
    && input.completeness.complete
    && input.unsupportedFinancialClaimCount === 0
    && input.blockingExceptionCount === 0;
}
