import {
  AI_REPORTING_CONTRACT_VERSION,
  EVIDENCE_BUNDLE_VERSION,
  type ClaimCaveatCode,
  type ClaimProposal,
  type DeterministicCalculationEvidence,
  type EvidenceBundle,
  type EvidenceValue,
  type GroundedClaim,
  type ReportException,
} from "./contracts";
import { REPORT_EXCEPTION_POLICY, createReportException } from "./exceptions";
import {
  FINANCIAL_EXPLANATION_RESULT_VERSION,
  financialExplanationModelOutputSchema,
  financialExplanationRequestSchema,
  type FinancialExplanationLimitationCode,
  type FinancialExplanationRequest,
  type FinancialExplanationTopic,
} from "./financial-explanation-schema";
import { deriveCurrencyScope, exactDecimal, groundClaim } from "./grounding-policy";

const disallowedNarrativeMeaning = /\b(?:revenue|income|expenses?|profit|cash[ -]?flows?|cash inflows?|cash outflows?|budget(?:ed)?|reconcil(?:e|ed|iation)|fraud|audited?)\b/i;
const disallowedNarrativeEvaluation = /\b(?:improv(?:e|ed|ing)|declin(?:e|ed|ing)|grew|growth|healthy|strong|weak|performance|trend|caused|because)\b/i;
const disallowedNarrativeOverstatement = /\b(?:passed\s+(?:the\s+)?quality\s+checks?|potential\s+anomal(?:y|ies))\b/i;

export class FinancialExplanationValidationError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INVALID_OUTPUT" | "UNSUPPORTED_OUTPUT", message: string) {
    super(message);
  }
}

export interface FinancialExplanationGenerationMetadata {
  provider: "OPENAI" | "GROQ" | "TEST";
  actualModelRequest: boolean;
  modelIdentifier: string;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  generatedAt: string;
}

export interface ValidatedFinancialExplanation {
  version: typeof FINANCIAL_EXPLANATION_RESULT_VERSION;
  status: "AI_DRAFT_REQUIRES_REVIEW";
  managementSummary: string;
  claims: readonly { topic: FinancialExplanationTopic; claim: GroundedClaim }[];
  limitationCodes: readonly FinancialExplanationLimitationCode[];
  references: readonly { evidenceId: string; label: string }[];
  bundleExceptions: readonly { code: ReportException["code"]; severity: ReportException["severity"]; blocksPublication: boolean }[];
  validation: {
    assurance: "STRUCTURAL_ONLY";
    status: "PASSED";
    semanticReviewRequired: true;
    publicationAuthorized: false;
  };
  generation: FinancialExplanationGenerationMetadata & { promptVersion: FinancialExplanationRequest["promptVersion"] };
}

function toEvidenceValue(value: FinancialExplanationRequest["bundle"]["evidenceItems"][number]["value"]): EvidenceValue {
  if (value.kind === "MONETARY") return { ...value, amount: exactDecimal(value.amount) };
  if (value.kind === "COUNT") return value;
  return value;
}

function toEvidenceBundle(input: FinancialExplanationRequest): EvidenceBundle {
  const items: DeterministicCalculationEvidence[] = input.bundle.evidenceItems.map(item => ({
    evidenceId: item.evidenceId,
    evidenceClass: "DETERMINISTIC_CALCULATION",
    value: toEvidenceValue(item.value),
    period: item.period,
    warnings: item.warningRules.map(warning => ({
      ...warning,
      sourceColumn: null,
      originalValue: null,
      message: `The deterministic evidence includes warning rule ${warning.rule}.`,
      sensitivity: input.bundle.sensitivity,
    })),
    sensitivity: input.bundle.sensitivity,
    derivation: { ...item.derivation, inputEvidenceIds: [] },
    lineage: [],
    interpretation: item.interpretationStatus === "NOT_APPLICABLE"
      ? { status: "NOT_APPLICABLE" }
      : {
          status: "UNAVAILABLE",
          reason: "No approved financial-statement interpretation is attached to this deterministic evidence.",
          requiredForRequest: false,
        },
  }));
  const exceptions = input.bundle.exceptions.map(exception =>
    createReportException(exception.code, { evidenceIds: exception.evidenceIds }));
  return {
    bundleVersion: EVIDENCE_BUNDLE_VERSION,
    contractVersion: AI_REPORTING_CONTRACT_VERSION,
    bundleId: input.bundle.bundleId,
    snapshot: {
      snapshotId: input.bundle.snapshotId,
      snapshotSha256: input.bundle.snapshotSha256,
      schemaVersion: input.bundle.schemaVersion,
      rulesetVersion: input.bundle.rulesetVersion,
      datasetIds: [],
      ingestionBatchIds: [],
      createdAt: "1970-01-01T00:00:00.000Z",
    },
    period: input.bundle.period,
    warningPolicy: input.bundle.warningPolicy,
    currencyScope: input.bundle.currencyScope,
    quality: input.bundle.quality,
    sensitivity: input.bundle.sensitivity,
    items,
    exceptions,
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateFinancialExplanationRequest(value: unknown): FinancialExplanationRequest {
  const result = financialExplanationRequestSchema.safeParse(value);
  if (!result.success) throw new FinancialExplanationValidationError("INVALID_INPUT", "The AI explanation request does not match the approved input contract.");
  const input = result.data;
  const evidenceIds = input.bundle.evidenceItems.map(item => item.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new FinancialExplanationValidationError("INVALID_INPUT", "Evidence IDs must be unique.");
  }
  for (const exception of input.bundle.exceptions) {
    const policy = REPORT_EXCEPTION_POLICY[exception.code];
    if (exception.severity !== policy.defaultSeverity || exception.blocksPublication !== policy.blocksPublication) {
      throw new FinancialExplanationValidationError("INVALID_INPUT", "Exception metadata cannot weaken the reporting policy.");
    }
    if (exception.evidenceIds.some(evidenceId => !evidenceIds.includes(evidenceId))) {
      throw new FinancialExplanationValidationError("INVALID_INPUT", "Exception references must resolve to supplied evidence IDs.");
    }
  }
  const derived = deriveCurrencyScope(toEvidenceBundle(input).items);
  const declaredCurrencies = [...input.bundle.currencyScope.currencies].sort();
  if (derived.status !== input.bundle.currencyScope.status
    || derived.hasMissingCurrency !== input.bundle.currencyScope.hasMissingCurrency
    || !arraysEqual(derived.currencies, declaredCurrencies)) {
    throw new FinancialExplanationValidationError("INVALID_INPUT", "Currency scope does not match the supplied deterministic evidence.");
  }
  return input;
}

function assertSafeNarrative(value: string, label: string): void {
  if (!value.trim() || value.length > 800) {
    throw new FinancialExplanationValidationError("INVALID_OUTPUT", `${label} is empty or exceeds the bounded length.`);
  }
  if (/\d/.test(value)) {
    throw new FinancialExplanationValidationError("UNSUPPORTED_OUTPUT", `${label} contains a numeric token outside structured value assertions.`);
  }
  if (disallowedNarrativeMeaning.test(value)
    || disallowedNarrativeEvaluation.test(value)
    || disallowedNarrativeOverstatement.test(value)) {
    throw new FinancialExplanationValidationError("UNSUPPORTED_OUTPUT", `${label} contains unsupported financial meaning or evaluative language.`);
  }
}

function requiredLimitations(input: FinancialExplanationRequest): FinancialExplanationLimitationCode[] {
  const required: FinancialExplanationLimitationCode[] = [
    "SOURCE_VALUES_NOT_FINANCIAL_STATEMENT_METRICS",
    "HUMAN_REVIEW_REQUIRED",
  ];
  if (input.bundle.quality.warningCount > 0) required.push("WARNINGS_PRESENT");
  if (input.bundle.quality.rejectedCount > 0) required.push("REJECTED_ROWS_EXCLUDED");
  if (input.bundle.currencyScope.hasMissingCurrency) required.push("MISSING_CURRENCY");
  if (input.bundle.currencyScope.status === "MIXED") required.push("MIXED_CURRENCY");
  if (input.bundle.evidenceItems.some(item => item.derivation.functionId === "analytics.detectRobustAmountAnomalies.count"
    && item.value.kind === "COUNT"
    && item.value.value > 0)) {
    required.push("STATISTICAL_FLAGS_REQUIRE_REVIEW");
  }
  return required;
}

function requiredCaveatsForEvidence(
  input: FinancialExplanationRequest,
  item: FinancialExplanationRequest["bundle"]["evidenceItems"][number],
): ClaimCaveatCode[] {
  const required: ClaimCaveatCode[] = [];
  if (item.warningRules.length > 0) required.push("WARNING_EVIDENCE");
  if (input.bundle.currencyScope.hasMissingCurrency || input.bundle.currencyScope.status === "MIXED") {
    required.push("CURRENCY_LIMITATION");
  }
  if (item.interpretationStatus !== "NOT_APPLICABLE") required.push("INTERPRETATION_LIMITATION");
  if (input.bundle.quality.rejectedCount > 0) required.push("REJECTED_COUNT");
  return required;
}

interface FinancialExplanationClaimPlanItem {
  claimId: string;
  sectionId: "key-observations" | "data-quality";
  topic: FinancialExplanationTopic;
  evidenceIds: readonly [string];
  valueAssertions: ClaimProposal["valueAssertions"];
  caveatCodes: readonly ClaimCaveatCode[];
  evidenceLabel: string;
  deterministicText: string;
}

function createFinancialExplanationClaimPlan(
  input: FinancialExplanationRequest,
): FinancialExplanationClaimPlanItem[] {
  const sourceValues: FinancialExplanationRequest["bundle"]["evidenceItems"][number][] = [];
  for (const item of input.bundle.evidenceItems) {
    if (item.derivation.functionId !== "analytics.aggregateSourceRecords" || item.value.kind !== "MONETARY") continue;
    const sourceComponent = item.value.sourceComponent;
    if (sourceValues.some(selected => selected.value.kind === "MONETARY"
      && selected.value.sourceComponent === sourceComponent)) continue;
    sourceValues.push(item);
    if (sourceValues.length === 2) break;
  }
  const quality = input.bundle.evidenceItems.find(item =>
    item.derivation.functionId === "ingestion.createAcceptedDataPayload.quality"
      && item.evidenceId.endsWith(":included"))
    ?? input.bundle.evidenceItems.find(item =>
      item.derivation.functionId === "ingestion.createAcceptedDataPayload.quality");
  const statistical = input.bundle.evidenceItems.find(item =>
    item.derivation.functionId === "analytics.detectRobustAmountAnomalies.count"
      && item.value.kind === "COUNT"
      && item.value.value > 0);
  const selected = [...sourceValues, quality, statistical].filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  );
  const fallback = selected.length > 0 ? selected : [input.bundle.evidenceItems[0]];

  return fallback.map(item => {
    const topic: FinancialExplanationTopic = item.derivation.functionId === "analytics.aggregateSourceRecords"
      ? "SOURCE_VALUE_TOTAL"
      : item.derivation.functionId === "analytics.detectRobustAmountAnomalies.count"
        ? "STATISTICAL_REVIEW_FLAG"
        : "DATA_QUALITY";
    const sourceComponent = item.value.kind === "MONETARY" ? item.value.sourceComponent : null;
    const claimId = topic === "SOURCE_VALUE_TOTAL"
      ? sourceComponent === "CREDIT"
        ? "ai-claim-recorded-credits"
        : sourceComponent === "DEBIT"
          ? "ai-claim-recorded-debits"
          : "ai-claim-source-value"
      : topic === "STATISTICAL_REVIEW_FLAG"
        ? "ai-claim-statistical-review"
        : "ai-claim-data-quality";
    const valueAssertions: ClaimProposal["valueAssertions"] = item.value.kind === "MONETARY"
      ? [{
          evidenceId: item.evidenceId,
          exactValue: exactDecimal(item.value.amount),
          currency: item.value.currency,
          monetaryBasis: item.value.monetaryBasis,
        }]
      : [];
    return {
      claimId,
      sectionId: topic === "DATA_QUALITY" || topic === "STATISTICAL_REVIEW_FLAG"
        ? "data-quality" as const
        : "key-observations" as const,
      topic,
      evidenceIds: [item.evidenceId] as const,
      valueAssertions,
      caveatCodes: requiredCaveatsForEvidence(input, item),
      evidenceLabel: item.label,
      deterministicText: topic === "SOURCE_VALUE_TOTAL"
        ? sourceComponent === "CREDIT"
          ? "This is recorded bank credit activity for the selected reporting period. It retains its source-field meaning and has no approved financial-statement classification."
          : sourceComponent === "DEBIT"
            ? "This is recorded bank debit activity for the selected reporting period. It retains its source-field meaning and has no approved financial-statement classification."
            : "This is a supplied source-field total with no approved financial-statement classification."
        : topic === "STATISTICAL_REVIEW_FLAG"
          ? "These statistical flags identify records for separate review; they do not confirm a data-quality issue."
          : "This is the record count included under the selected warning policy. Inclusion does not mean every record was accepted without warnings.",
    };
  });
}

/** Deterministic claim plan sent beside evidence; the model authors prose only. */
export function createFinancialExplanationOutputPolicy(input: FinancialExplanationRequest) {
  return {
    narrativeDigitsAllowed: false,
    modelAuthoredFields: ["managementSummary"] as const,
    reportLimitationCodes: requiredLimitations(input),
    claimPlan: createFinancialExplanationClaimPlan(input),
  };
}

export function validateFinancialExplanationOutput(
  requestValue: unknown,
  outputValue: unknown,
  generation: FinancialExplanationGenerationMetadata,
): ValidatedFinancialExplanation {
  const input = validateFinancialExplanationRequest(requestValue);
  const parsed = financialExplanationModelOutputSchema.safeParse(outputValue);
  if (!parsed.success) throw new FinancialExplanationValidationError("INVALID_OUTPUT", "The model response does not match the strict explanation schema.");
  const output = parsed.data;
  assertSafeNarrative(output.managementSummary, "Management summary");
  const claimPlan = createFinancialExplanationClaimPlan(input);
  const evidenceById = new Map(input.bundle.evidenceItems.map(item => [item.evidenceId, item]));
  const bundle = toEvidenceBundle(input);
  const grounded = claimPlan.map(planned => {
    const proposal: ClaimProposal = {
      claimId: planned.claimId,
      sectionId: planned.sectionId,
      text: planned.deterministicText,
      kind: "DETERMINISTIC_RESULT",
      evidenceIds: planned.evidenceIds,
      valueAssertions: planned.valueAssertions,
      financialMeaning: null,
      caveatCodes: planned.caveatCodes,
    };
    const supported = groundClaim(proposal, bundle);
    if (supported.support.status === "UNSUPPORTED") {
      throw new FinancialExplanationValidationError("UNSUPPORTED_OUTPUT", `Claim ${planned.claimId} failed structural grounding.`);
    }
    return { topic: planned.topic, claim: supported };
  });

  const limitationCodes = requiredLimitations(input);
  const citedIds = [...new Set(grounded.flatMap(item => item.claim.evidenceIds))];
  return {
    version: FINANCIAL_EXPLANATION_RESULT_VERSION,
    status: "AI_DRAFT_REQUIRES_REVIEW",
    managementSummary: output.managementSummary,
    claims: grounded,
    limitationCodes,
    references: citedIds.map(evidenceId => ({ evidenceId, label: evidenceById.get(evidenceId)!.label })),
    bundleExceptions: input.bundle.exceptions.map(exception => ({
      code: exception.code,
      severity: exception.severity,
      blocksPublication: exception.blocksPublication,
    })),
    validation: {
      assurance: "STRUCTURAL_ONLY",
      status: "PASSED",
      semanticReviewRequired: true,
      publicationAuthorized: false,
    },
    generation: { ...generation, promptVersion: input.promptVersion },
  };
}
