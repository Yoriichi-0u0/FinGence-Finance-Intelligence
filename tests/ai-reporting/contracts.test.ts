import { describe, expect, it } from "vitest";
import {
  AI_REPORTING_CONTRACT_VERSION,
  EVIDENCE_BUNDLE_VERSION,
  REPORT_EXCEPTION_CODES,
  type GroundedAnswer,
  type QuestionIntent,
  type ReportRequest,
} from "../../lib/ai-reporting";
import {
  SYNTHETIC_PERIOD,
  SYNTHETIC_SOURCE_DEBIT,
  createSyntheticEvidenceBundle,
} from "./fixtures/synthetic-evidence";

describe("AI Reporting contracts", () => {
  it("keeps source structure financially uninterpreted and preserves exact decimal text", () => {
    expect(SYNTHETIC_SOURCE_DEBIT.evidenceClass).toBe("VERIFIED_SOURCE_STRUCTURE");
    expect(SYNTHETIC_SOURCE_DEBIT.sourceField).toBe("debit");
    expect(SYNTHETIC_SOURCE_DEBIT.interpretation).toMatchObject({ status: "UNAVAILABLE" });
    expect(SYNTHETIC_SOURCE_DEBIT.value).toMatchObject({
      kind: "MONETARY",
      amount: "9007199254740993.1",
      currency: "MYR",
      currencyBasis: "SOURCE",
      monetaryBasis: "debit_credit",
    });
    expect(SYNTHETIC_SOURCE_DEBIT.value.kind).toBe("MONETARY");
    expect(SYNTHETIC_SOURCE_DEBIT.value.amount).toBe("9007199254740993.1");
  });

  it("retains rejected counts but structurally excludes rejected records", () => {
    const bundle = createSyntheticEvidenceBundle();
    expect(bundle).toMatchObject({
      bundleVersion: EVIDENCE_BUNDLE_VERSION,
      contractVersion: AI_REPORTING_CONTRACT_VERSION,
      quality: { rejectedCount: 1, rejectedRecordsInEvidence: 0 },
    });
    expect(bundle.items.every(item => !Object.hasOwn(item, "rejectedRecord"))).toBe(true);
  });

  it("requires report scope and actor context to identify trusted resolution", () => {
    const request: ReportRequest = {
      contractVersion: AI_REPORTING_CONTRACT_VERSION,
      requestId: "synthetic-request-001",
      trustedContext: {
        organizationId: "synthetic-organization",
        actorId: "synthetic-actor",
        resolution: "TRUSTED_SERVER_CONTEXT",
      },
      period: SYNTHETIC_PERIOD,
      population: {
        snapshotId: "synthetic-snapshot-001",
        snapshotSha256: "c".repeat(64),
        persistenceAttemptIds: [],
        ingestionBatchIds: ["synthetic-batch-001"],
        datasetIds: ["synthetic-ledger:0"],
        selection: "EXPLICIT",
      },
      templateId: "synthetic-template",
      templateVersion: "0.1",
      warningPolicy: "INCLUDE_WITH_CAVEATS",
      interpretationApprovalIds: [],
      language: "en",
      audience: "FINANCE_ANALYST",
    };
    expect(request.trustedContext.resolution).toBe("TRUSTED_SERVER_CONTEXT");
    expect(request.population.selection).toBe("EXPLICIT");
  });

  it("represents clarification and unavailable answers without inventing a metric", () => {
    const intent: QuestionIntent = {
      contractVersion: AI_REPORTING_CONTRACT_VERSION,
      questionId: "question-001",
      originalQuestion: "What was profit?",
      status: "NEEDS_CLARIFICATION",
      reason: "No approved profit definition or reporting population was supplied.",
      clarificationQuestions: ["Which approved profit definition and period should be used?"],
    };
    const answer: GroundedAnswer = {
      status: "UNAVAILABLE",
      questionId: intent.questionId,
      exceptions: [],
    };
    expect(intent.status).toBe("NEEDS_CLARIFICATION");
    expect(answer.status).toBe("UNAVAILABLE");
  });

  it("publishes one stable, duplicate-free exception code catalog", () => {
    expect(new Set(REPORT_EXCEPTION_CODES).size).toBe(REPORT_EXCEPTION_CODES.length);
    expect(REPORT_EXCEPTION_CODES).toEqual(expect.arrayContaining([
      "UNSUPPORTED_FINANCIAL_MEANING",
      "INTERPRETATION_UNAVAILABLE",
      "CURRENCY_UNSPECIFIED",
      "MIXED_CURRENCY",
      "WARNING_RECORDS_INCLUDED",
      "WARNING_RECORDS_EXCLUDED",
      "REJECTED_ROWS_PRESENT",
      "CLAIM_NOT_GROUNDED",
    ]));
  });
});
