import { describe, expect, it } from "vitest";
import {
  REPORT_COMPLETENESS_RUBRIC,
  TASK_TIME_MEASURES,
  USER_ERROR_CODES,
  assessCompleteness,
  isTaskComplete,
  type CompletenessCriterionId,
  type CompletenessScore,
} from "../../lib/ai-reporting";

function scores(score: CompletenessScore): Record<CompletenessCriterionId, CompletenessScore> {
  return Object.fromEntries(REPORT_COMPLETENESS_RUBRIC.map(item => [item.criterionId, score])) as
    Record<CompletenessCriterionId, CompletenessScore>;
}

describe("AI Reporting evaluation definitions", () => {
  it("requires every rubric criterion to be fully satisfied", () => {
    const complete = assessCompleteness(scores(2));
    expect(complete).toMatchObject({ total: 10, maximum: 10, complete: true, incompleteCriteria: [] });

    const partialScores = scores(2);
    partialScores.QUALITY_AND_WARNINGS = 1;
    const partial = assessCompleteness(partialScores);
    expect(partial).toMatchObject({ total: 9, maximum: 10, complete: false });
    expect(partial.incompleteCriteria).toEqual(["QUALITY_AND_WARNINGS"]);
  });

  it("defines task completion as submitted, complete, grounded, and unblocked", () => {
    const completeness = assessCompleteness(scores(2));
    expect(isTaskComplete({ submitted: true, completeness, unsupportedFinancialClaimCount: 0, blockingExceptionCount: 0 })).toBe(true);
    expect(isTaskComplete({ submitted: true, completeness, unsupportedFinancialClaimCount: 1, blockingExceptionCount: 0 })).toBe(false);
    expect(isTaskComplete({ submitted: false, completeness, unsupportedFinancialClaimCount: 0, blockingExceptionCount: 0 })).toBe(false);
  });

  it("keeps task-time and user-error measures explicit and duplicate-free", () => {
    expect(TASK_TIME_MEASURES).toEqual([
      "END_TO_END_ACTIVE_MS", "DRAFT_PREPARATION_ACTIVE_MS", "REVIEW_ACTIVE_MS", "CORRECTION_ACTIVE_MS",
    ]);
    expect(new Set(USER_ERROR_CODES).size).toBe(USER_ERROR_CODES.length);
    expect(USER_ERROR_CODES).toContain("UNSUPPORTED_FINANCIAL_INTERPRETATION");
    expect(USER_ERROR_CODES).toContain("CURRENCY_OR_MONETARY_BASIS_CONFLATION");
  });
});
