import "server-only";

import type { FinancialExplanationRequest } from "../../ai-reporting/financial-explanation-schema";
import { financialExplanationModelOutputSchema } from "../../ai-reporting/financial-explanation-schema";
import { serializeFinancialExplanationEvidence } from "../../ai-reporting/financial-explanation-input";
import {
  FINANCIAL_EXPLANATION_SYSTEM_PROMPT,
  buildFinancialExplanationUserPrompt,
} from "../../ai-reporting/prompts/financial-explanation";
import {
  createFinancialExplanationOutputPolicy,
  type FinancialExplanationGenerationMetadata,
} from "../../ai-reporting/financial-explanation-validation";
import { aiGatewayEnabled } from "../ai/groq-interpreter";
import { portableJsonSchema, structuredCompletion } from "../ai/groq";
import { financialExplanationEnabled } from "./access";

export const GROQ_FINANCIAL_EXPLANATION_MODEL = "openai/gpt-oss-20b" as const;
const MAX_COMPLETION_TOKENS = 1_800;

export type FinancialExplanationProviderName = "GROQ";

export class FinancialExplanationProviderError extends Error {
  constructor(readonly code: "PROVIDER_UNAVAILABLE" | "PROVIDER_REQUEST_FAILED" | "PROVIDER_OUTPUT_INCOMPLETE") {
    super(code);
  }
}

export interface FinancialExplanationProviderResult {
  output: unknown;
  generation: FinancialExplanationGenerationMetadata;
}

export interface FinancialExplanationProvider {
  generate(input: FinancialExplanationRequest, signal?: AbortSignal): Promise<FinancialExplanationProviderResult>;
}

export interface FinancialExplanationProviderStatus {
  provider: FinancialExplanationProviderName | null;
  model: string | null;
  ready: boolean;
  dispatchMode: "SHARED_GROQ_GATEWAY_ONLY";
  freeTierConfirmed: boolean;
  message: string;
}

interface ExplanationTransportResponse {
  id: string;
  status: string;
  model: string;
  outputParsed: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface ExplanationTransportRequest {
  model: string;
  instructions: string;
  input: string;
}

/** Test-only seam. Production dispatch always uses FinGence's shared structured-completion gateway. */
export type FinancialExplanationTransport = (
  request: ExplanationTransportRequest,
  signal?: AbortSignal,
) => Promise<ExplanationTransportResponse>;

function configuredModel(): string | null {
  const configured = process.env.FINGENCE_AI_EXPLANATION_MODEL?.trim() || GROQ_FINANCIAL_EXPLANATION_MODEL;
  return configured === GROQ_FINANCIAL_EXPLANATION_MODEL ? configured : null;
}

export function financialExplanationProviderStatus(): FinancialExplanationProviderStatus {
  const providerConfigured = (process.env.FINGENCE_AI_EXPLANATION_PROVIDER?.trim().toLowerCase() || "groq") === "groq";
  const model = providerConfigured ? configuredModel() : null;
  const dispatchAuthorized = process.env.FINGENCE_AI_EXPLANATION_DISPATCH_AUTHORIZED === "1";
  const freeTierConfirmed = process.env.FINGENCE_AI_EXPLANATION_GROQ_FREE_TIER_CONFIRMED === "1";
  const ready = Boolean(
    providerConfigured
    && model
    && financialExplanationEnabled()
    && aiGatewayEnabled()
    && dispatchAuthorized
    && freeTierConfirmed,
  );

  return {
    provider: providerConfigured ? "GROQ" : null,
    model,
    ready,
    dispatchMode: "SHARED_GROQ_GATEWAY_ONLY",
    freeTierConfirmed,
    message: ready
      ? "Groq free-tier explanation requests use FinGence's shared, budgeted AI gateway and Technical log."
      : `AI explanation unavailable: enable the local reporting slice, shared AI gateway, ${GROQ_FINANCIAL_EXPLANATION_MODEL}, free-tier confirmation and explicit explanation dispatch authorization.`,
  };
}

function providerRequest(input: FinancialExplanationRequest, model: string): ExplanationTransportRequest {
  return {
    model,
    instructions: FINANCIAL_EXPLANATION_SYSTEM_PROMPT,
    input: buildFinancialExplanationUserPrompt(
      serializeFinancialExplanationEvidence(input),
      JSON.stringify(createFinancialExplanationOutputPolicy(input)),
    ),
  };
}

function providerResult(response: ExplanationTransportResponse): FinancialExplanationProviderResult {
  if (response.status !== "completed" || response.outputParsed === null) {
    throw new FinancialExplanationProviderError("PROVIDER_OUTPUT_INCOMPLETE");
  }
  return {
    output: response.outputParsed,
    generation: {
      provider: "GROQ",
      actualModelRequest: true,
      modelIdentifier: response.model,
      requestId: response.id,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      generatedAt: new Date().toISOString(),
    },
  };
}

export class GroqFinancialExplanationProvider implements FinancialExplanationProvider {
  constructor(private readonly transport?: FinancialExplanationTransport) {}

  async generate(input: FinancialExplanationRequest, signal?: AbortSignal): Promise<FinancialExplanationProviderResult> {
    const status = financialExplanationProviderStatus();
    if (!status.ready || !status.model || signal?.aborted) {
      throw new FinancialExplanationProviderError("PROVIDER_UNAVAILABLE");
    }
    const request = providerRequest(input, status.model);
    try {
      if (this.transport) return providerResult(await this.transport(request, signal));
      const { content, receipt } = await structuredCompletion({
        feature: "report-explain",
        model: request.model,
        system: request.instructions,
        user: request.input,
        schemaName: "fingence_financial_explanation",
        schema: portableJsonSchema(financialExplanationModelOutputSchema),
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
        reasoningEffort: "low",
      });
      return providerResult({
        id: receipt.requestId ?? "unavailable",
        status: content === null ? "incomplete" : "completed",
        model: receipt.model,
        outputParsed: content,
        inputTokens: receipt.inputTokens,
        outputTokens: receipt.outputTokens,
      });
    } catch (error) {
      if (error instanceof FinancialExplanationProviderError) throw error;
      throw new FinancialExplanationProviderError("PROVIDER_REQUEST_FAILED");
    }
  }
}

export function createConfiguredFinancialExplanationProvider(): FinancialExplanationProvider {
  return new GroqFinancialExplanationProvider();
}
