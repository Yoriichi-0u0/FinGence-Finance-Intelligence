import "server-only";
import {
  FinancialExplanationValidationError,
  validateFinancialExplanationOutput,
  validateFinancialExplanationRequest,
  type ValidatedFinancialExplanation,
} from "../../ai-reporting/financial-explanation-validation";
import {
  createConfiguredFinancialExplanationProvider,
  financialExplanationProviderStatus,
  FinancialExplanationProviderError,
  type FinancialExplanationProvider,
} from "./provider";

// SHA-256 allowlist of the repository's published synthetic sample bytes.
// Update these values deliberately if a registered sample file changes.
const registeredSyntheticHashes = new Set([
  "da31e6f437ddff7cfb3a029db21caa56320bd1c6162c5701503f60687ba9ef3e", // Data: Rimba Demo Kitchen bank statement
  "48668a7eb1fca288f8c853aee5a7b6d2ebcf9076e7cd7ba95a6d7f0df386a5fc", // Data: Straits Demo Bakery Q1 bank statement
  "42e0789e996c5b4af3653d39128f6c91190faefa7708f1c1ec5d8bfc54fb14d9", // ledger.csv
  "8a4d11c7b5850dc99c1392ec1bd941cf4fa04fac2b61f621dffb35a0226896cf", // bank_statement.xlsx
  "6224c108304ab11e0919919e2454492e8d3dbad9448771e5088d310a3736ccfd", // edge_cases.csv
  "13c0d038845941abb8e974bc55832f0b1f157bac343c4f4ab5189ba0b0a30bfb", // optional supplied synthetic Datasets.xlsx; bytes remain outside Git
]);

export class FinancialExplanationServiceError extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "PROVIDER_UNAVAILABLE" | "REGISTERED_SYNTHETIC_REQUIRED" | "PROVIDER_REQUEST_FAILED" | "OUTPUT_REJECTED",
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function generateFinancialExplanation(
  requestValue: unknown,
  provider?: FinancialExplanationProvider,
  signal?: AbortSignal,
): Promise<ValidatedFinancialExplanation> {
  let input: ReturnType<typeof validateFinancialExplanationRequest>;
  try {
    input = validateFinancialExplanationRequest(requestValue);
  } catch (error) {
    if (error instanceof FinancialExplanationValidationError) {
      throw new FinancialExplanationServiceError("INVALID_REQUEST", 400, "The AI explanation request is invalid.");
    }
    throw error;
  }
  if (!registeredSyntheticHashes.has(input.sourceFileSha256)) {
    throw new FinancialExplanationServiceError(
      "REGISTERED_SYNTHETIC_REQUIRED",
      403,
      "AI explanation is restricted to the registered synthetic demonstration files.",
    );
  }
  if (signal?.aborted) {
    throw new FinancialExplanationServiceError("PROVIDER_REQUEST_FAILED", 499, "The AI explanation request was canceled.");
  }
  if (!provider && !financialExplanationProviderStatus().ready) {
    throw new FinancialExplanationServiceError(
      "PROVIDER_UNAVAILABLE",
      503,
      "AI explanation unavailable: the local model provider is not configured and authorized.",
    );
  }
  try {
    const response = await (provider ?? createConfiguredFinancialExplanationProvider()).generate(input, signal);
    return validateFinancialExplanationOutput(input, response.output, response.generation);
  } catch (error) {
    if (error instanceof FinancialExplanationValidationError) {
      throw new FinancialExplanationServiceError("OUTPUT_REJECTED", 422, "The AI response was withheld because it did not pass the reporting checks.");
    }
    if (error instanceof FinancialExplanationProviderError) {
      const unavailable = error.code === "PROVIDER_UNAVAILABLE";
      throw new FinancialExplanationServiceError(
        unavailable ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED",
        unavailable ? 503 : 502,
        unavailable
          ? "AI explanation unavailable: the local model provider is not configured and authorized."
          : "The AI provider request did not complete. No generated explanation is being shown.",
      );
    }
    if (error instanceof FinancialExplanationServiceError) throw error;
    throw new FinancialExplanationServiceError("PROVIDER_REQUEST_FAILED", 502, "The AI explanation request failed safely.");
  }
}
