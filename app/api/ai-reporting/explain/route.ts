import { estimateUsd, runAsCaller } from "@/lib/ai-calls";
import { admit, clientAddress } from "@/lib/server/ai/budget";
import { worstCaseCompletionUsd } from "@/lib/server/ai/groq";
import { boundedJson, noStoreJson as json } from "@/lib/server/ai/request";
import {
  aiReportingRequestAllowed,
  financialExplanationRequestAllowed,
} from "@/lib/server/ai-reporting/access";
import { financialExplanationProviderStatus } from "@/lib/server/ai-reporting/provider";
import {
  FinancialExplanationServiceError,
  generateFinancialExplanation,
} from "@/lib/server/ai-reporting/service";
import { aiCaller, processingGate } from "@/lib/server/workspace/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_COMPLETION_TOKENS = 1_800;
let running = false;

function notFound(): Response {
  return json({ error: "Not found" }, 404);
}

async function gateRequest(request: Request) {
  const gate = await processingGate(request.headers, { ai: true });
  if ("refusal" in gate) {
    return {
      refusal: json({
        error: {
          code: gate.refusal.code,
          message: gate.refusal.reason ?? "The AI explanation request is unavailable.",
        },
      }, gate.refusal.status),
    } as const;
  }
  return gate;
}

export async function GET(request: Request) {
  if (!aiReportingRequestAllowed(request)) return notFound();
  const gate = await gateRequest(request);
  if ("refusal" in gate) return gate.refusal;
  return json(financialExplanationProviderStatus());
}

export async function POST(request: Request) {
  if (!financialExplanationRequestAllowed(request)) return notFound();
  const read = await boundedJson(request, MAX_REQUEST_BYTES);
  if ("refusal" in read) return read.refusal;
  const gate = await gateRequest(request);
  if ("refusal" in gate) return gate.refusal;
  if (running) {
    return json({
      error: {
        code: "REQUEST_IN_PROGRESS",
        message: "Another local AI explanation is already running.",
      },
    }, 409);
  }

  const provider = financialExplanationProviderStatus();
  if (!provider.ready || !provider.model) {
    return json({
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "AI explanation unavailable: the shared model gateway is not configured and authorized.",
      },
    }, 503);
  }

  const admission = await admit({
    client: clientAddress(request.headers),
    worstCaseUsd: worstCaseCompletionUsd(
      MAX_REQUEST_BYTES + 32_000,
      MAX_COMPLETION_TOKENS,
      provider.model,
    ),
  });
  if (!admission.admitted) {
    return json({
      error: {
        code: admission.code,
        message: "The AI explanation budget is unavailable or exhausted.",
        ...(admission.retryAfterSeconds ? { retryAfterSeconds: admission.retryAfterSeconds } : {}),
      },
    }, admission.status);
  }

  running = true;
  return runAsCaller(aiCaller(gate.principal), async () => {
    try {
      const explanation = await generateFinancialExplanation(read.body, undefined, request.signal);
      await admission.settle(estimateUsd(
        explanation.generation.modelIdentifier,
        explanation.generation.inputTokens,
        explanation.generation.outputTokens,
      ));
      return json({ explanation });
    } catch (error) {
      await admission.settle(null);
      if (error instanceof FinancialExplanationServiceError) {
        return json({ error: { code: error.code, message: error.message } }, error.status);
      }
      return json({
        error: {
          code: "REQUEST_FAILED",
          message: "The AI explanation request failed safely.",
        },
      }, 500);
    } finally {
      running = false;
    }
  });
}
