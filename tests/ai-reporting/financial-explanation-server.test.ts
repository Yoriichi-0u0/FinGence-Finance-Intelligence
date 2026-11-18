import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeAcceptedDataPayload } from "../../lib/analytics/accepted-data-adapter";
import { GET as getExplanationStatus, POST as postExplanation } from "../../app/api/ai-reporting/explain/route";
import {
  FINANCIAL_EXPLANATION_PROMPT_VERSION,
  createDemoDocumentReport,
  createFinancialExplanationRequest,
  createLocalManagementReport,
  type FinancialExplanationModelOutput,
  type FinancialExplanationRequest,
} from "../../lib/ai-reporting";
import { processDocuments, type DocumentInput } from "../../lib/demo/pipeline";
import { createAcceptedDataPayload, type IngestionResult } from "../../lib/ingestion";
import {
  aiReportingRequestAllowed,
  financialExplanationRequestAllowed,
} from "../../lib/server/ai-reporting/access";
import {
  GROQ_FINANCIAL_EXPLANATION_MODEL,
  FinancialExplanationProviderError,
  GroqFinancialExplanationProvider,
  financialExplanationProviderStatus,
  type FinancialExplanationProvider,
} from "../../lib/server/ai-reporting/provider";
import {
  FinancialExplanationServiceError,
  generateFinancialExplanation,
} from "../../lib/server/ai-reporting/service";
import { consultationResults } from "../integration/fixtures";

vi.mock("server-only", () => ({}));

let request: FinancialExplanationRequest;
let dataSampleRequest: FinancialExplanationRequest;

beforeAll(async () => {
  const results: IngestionResult[] = await consultationResults();
  const selected = results.find(result => result.dataset.file.name === "ledger.csv");
  if (!selected) throw new Error("Missing synthetic ledger fixture.");
  const payload = createAcceptedDataPayload([selected]);
  const report = await createLocalManagementReport({
    payload,
    analysis: analyzeAcceptedDataPayload(payload, "include"),
    warningPolicy: "include",
    organizationName: "Synthetic Test Workspace",
    generatedAt: "2026-11-13T08:00:00.000Z",
  });
  request = createFinancialExplanationRequest(report);

  const dataInputs: DocumentInput[] = ["demo-bank-statement-2026-03.csv", "demo-general-ledger-2026-03.csv"].map(name => ({
    name,
    bytes: new Uint8Array(readFileSync(join("public/demo", name))),
    provenance: "PUBLIC_SYNTHETIC_SAMPLE",
  }));
  const dataContext = await processDocuments(dataInputs);
  const dataReport = await createDemoDocumentReport({
    context: dataContext,
    inputs: dataInputs,
    generatedAt: "2026-11-13T08:00:00.000Z",
  });
  dataSampleRequest = createFinancialExplanationRequest(dataReport.report);
});

afterEach(() => vi.unstubAllEnvs());

function configureGroq() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("FINGENCE_AI_REPORTING_LOCAL", "1");
  vi.stubEnv("FINGENCE_AI_EXPLANATION_LOCAL", "1");
  vi.stubEnv("FINGENCE_AI_EXPLANATION_PROVIDER", "groq");
  vi.stubEnv("FINGENCE_AI_EXPLANATION_MODEL", GROQ_FINANCIAL_EXPLANATION_MODEL);
  vi.stubEnv("FINGENCE_AI_EXPLANATION_DISPATCH_AUTHORIZED", "1");
  vi.stubEnv("FINGENCE_AI_EXPLANATION_GROQ_FREE_TIER_CONFIRMED", "1");
  vi.stubEnv("FINGENCE_AI_GATEWAY", "1");
  vi.stubEnv("GROQ_API_KEY", "synthetic-test-key-not-real");
}

function configureHostedGroq() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("FINGENCE_AI_REPORTING_HOSTED", "1");
  vi.stubEnv("FINGENCE_AI_EXPLANATION_HOSTED", "1");
  vi.stubEnv("FINGENCE_AI_EXPLANATION_PROVIDER", "groq");
  vi.stubEnv("FINGENCE_AI_EXPLANATION_MODEL", GROQ_FINANCIAL_EXPLANATION_MODEL);
  vi.stubEnv("FINGENCE_AI_EXPLANATION_DISPATCH_AUTHORIZED", "1");
  vi.stubEnv("FINGENCE_AI_EXPLANATION_GROQ_FREE_TIER_CONFIRMED", "1");
  vi.stubEnv("FINGENCE_AI_GATEWAY", "1");
  vi.stubEnv("GROQ_API_KEY", "synthetic-test-key-not-real");
  vi.stubEnv("FINGENCE_AI_BUDGET_REST_URL", "https://synthetic-budget.invalid");
  vi.stubEnv("FINGENCE_AI_BUDGET_REST_TOKEN", "synthetic-budget-token-not-real");
}

function validOutput(): FinancialExplanationModelOutput {
  return {
    promptVersion: FINANCIAL_EXPLANATION_PROMPT_VERSION,
    managementSummary: "The supplied source-value total is presented with evidence and interpretation limits for management review.",
  };
}

const requestHeaders = {
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
  "sec-fetch-site": "same-origin",
};
const liveProviderTestEnabled = process.env.FINGENCE_AI_REPORTING_LIVE_TEST === "1";

describe("local AI explanation access boundary", () => {
  it("separates local reporting access from the additional model-dispatch flag", () => {
    configureGroq();
    vi.stubEnv("FINGENCE_AI_EXPLANATION_LOCAL", "0");
    expect(aiReportingRequestAllowed(new Request(
      "http://127.0.0.1:3000/ai-reporting",
      { headers: requestHeaders },
    ))).toBe(true);
    expect(financialExplanationRequestAllowed(new Request(
      "http://127.0.0.1:3000/api/ai-reporting/explain",
      { headers: requestHeaders },
    ))).toBe(false);
  });

  it("requires development, both explicit feature flags and a loopback request", () => {
    configureGroq();
    expect(financialExplanationRequestAllowed(new Request(
      "http://127.0.0.1:3000/api/ai-reporting/explain",
      { headers: requestHeaders },
    ))).toBe(true);
    expect(financialExplanationRequestAllowed(new Request(
      "https://example.com/api/ai-reporting/explain",
      { headers: { host: "example.com", origin: "https://example.com" } },
    ))).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(financialExplanationRequestAllowed(new Request(
      "http://127.0.0.1:3000/api/ai-reporting/explain",
      { headers: requestHeaders },
    ))).toBe(false);
  });

  it("reports unavailable without explicit per-feature dispatch authorization", async () => {
    configureGroq();
    vi.stubEnv("FINGENCE_AI_EXPLANATION_DISPATCH_AUTHORIZED", "0");
    const status = await getExplanationStatus(new Request(
      "http://127.0.0.1:3000/api/ai-reporting/explain",
      { headers: requestHeaders },
    ));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      ready: false,
      dispatchMode: "SHARED_GROQ_GATEWAY_ONLY",
    });

    const response = await postExplanation(new Request(
      "http://127.0.0.1:3000/api/ai-reporting/explain",
      {
        method: "POST",
        headers: { ...requestHeaders, "content-type": "application/json" },
        body: JSON.stringify(request),
      },
    ));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "PROVIDER_UNAVAILABLE" },
    });
  });
});

describe("hosted AI explanation access boundary", () => {
  it("requires explicit hosted flags and same-origin requests", () => {
    configureHostedGroq();
    const sameOrigin = new Request("https://fingence.example/api/ai-reporting/explain", {
      headers: { origin: "https://fingence.example", "sec-fetch-site": "same-origin" },
    });
    expect(aiReportingRequestAllowed(sameOrigin)).toBe(true);
    expect(financialExplanationRequestAllowed(sameOrigin)).toBe(true);
    expect(financialExplanationProviderStatus()).toMatchObject({ ready: true });

    expect(financialExplanationRequestAllowed(new Request(
      "https://fingence.example/api/ai-reporting/explain",
      { headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" } },
    ))).toBe(false);

    vi.stubEnv("FINGENCE_AI_EXPLANATION_HOSTED", "0");
    expect(financialExplanationRequestAllowed(sameOrigin)).toBe(false);
  });
});

describe("shared Groq financial explanation provider", () => {
  it("requires the shared gateway, fixed model, free-tier confirmation and feature authorization", () => {
    configureGroq();
    expect(financialExplanationProviderStatus()).toMatchObject({
      provider: "GROQ",
      model: GROQ_FINANCIAL_EXPLANATION_MODEL,
      ready: true,
      freeTierConfirmed: true,
    });
    vi.stubEnv("FINGENCE_AI_EXPLANATION_MODEL", "another-model");
    expect(financialExplanationProviderStatus()).toMatchObject({ model: null, ready: false });
  });

  it("uses minimized structured evidence through the test transport seam", async () => {
    configureGroq();
    const transport = vi.fn(async (providerRequest: { model: string; instructions: string; input: string }) => ({
      id: "groq-response-test",
      status: "completed",
      model: providerRequest.model,
      outputParsed: validOutput(),
      inputTokens: 110,
      outputTokens: 55,
    }));
    const result = await new GroqFinancialExplanationProvider(transport).generate(request);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0][0].instructions).toContain("FinGence financial reporting assistant");
    expect(transport.mock.calls[0][0].input).toContain("<approved_evidence_json>");
    expect(transport.mock.calls[0][0].input).toContain("<required_output_policy_json>");
    expect(result.generation).toMatchObject({
      provider: "GROQ",
      actualModelRequest: true,
      requestId: "groq-response-test",
    });
  });

  it("converts transport failures without leaking provider details", async () => {
    configureGroq();
    const provider = new GroqFinancialExplanationProvider(async () => {
      throw new Error("provider detail containing secret material");
    });
    await expect(provider.generate(request)).rejects.toEqual(
      new FinancialExplanationProviderError("PROVIDER_REQUEST_FAILED"),
    );
    await expect(provider.generate(request)).rejects.not.toThrow(/secret material/);
  });
});

describe("AI explanation service validation", () => {
  it("accepts a registered synthetic input and returns a structurally checked draft", async () => {
    const provider: FinancialExplanationProvider = {
      generate: async () => ({
        output: validOutput(),
        generation: {
          provider: "TEST",
          actualModelRequest: false,
          modelIdentifier: "synthetic-test-model",
          requestId: null,
          inputTokens: null,
          outputTokens: null,
          generatedAt: "2026-11-13T08:01:00.000Z",
        },
      }),
    };
    const result = await generateFinancialExplanation(request, provider);
    expect(result.validation).toMatchObject({
      assurance: "STRUCTURAL_ONLY",
      publicationAuthorized: false,
    });
  });

  it("accepts the bank document registered for the connected Data report", async () => {
    const provider: FinancialExplanationProvider = {
      generate: async () => ({
        output: validOutput(),
        generation: {
          provider: "TEST",
          actualModelRequest: false,
          modelIdentifier: "synthetic-test-model",
          requestId: null,
          inputTokens: null,
          outputTokens: null,
          generatedAt: "2026-11-13T08:01:00.000Z",
        },
      }),
    };
    expect(dataSampleRequest.sourceFileSha256).toBe("da31e6f437ddff7cfb3a029db21caa56320bd1c6162c5701503f60687ba9ef3e");
    await expect(generateFinancialExplanation(dataSampleRequest, provider)).resolves.toMatchObject({
      validation: { assurance: "STRUCTURAL_ONLY", publicationAuthorized: false },
    });
  });

  it("rejects an unregistered source hash before dispatching", async () => {
    const provider: FinancialExplanationProvider = { generate: vi.fn() };
    const tampered = structuredClone(request);
    tampered.sourceFileSha256 = "0".repeat(64);
    await expect(generateFinancialExplanation(tampered, provider)).rejects.toMatchObject({
      code: "REGISTERED_SYNTHETIC_REQUIRED",
      status: 403,
    } satisfies Partial<FinancialExplanationServiceError>);
    expect(provider.generate).not.toHaveBeenCalled();
  });
});

describe("credentialed local AI explanation smoke check", () => {
  it.runIf(liveProviderTestEnabled)("completes the registered Data sample through the local API route", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");

    expect(process.env.GROQ_API_KEY).toBeTruthy();
    expect(financialExplanationProviderStatus()).toMatchObject({
      provider: "GROQ",
      model: GROQ_FINANCIAL_EXPLANATION_MODEL,
      ready: true,
    });

    const response = await postExplanation(new Request(
      "http://127.0.0.1:3000/api/ai-reporting/explain",
      {
        method: "POST",
        headers: { ...requestHeaders, "content-type": "application/json" },
        body: JSON.stringify(dataSampleRequest),
      },
    ));
    const body = await response.json() as {
      explanation?: {
        status: string;
        generation: { provider: string; actualModelRequest: boolean; modelIdentifier: string };
        validation: { status: string; publicationAuthorized: boolean };
      };
      error?: { code?: string; message?: string };
    };

    expect(body.error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(body.explanation).toMatchObject({
      status: "AI_DRAFT_REQUIRES_REVIEW",
      generation: {
        provider: "GROQ",
        actualModelRequest: true,
        modelIdentifier: GROQ_FINANCIAL_EXPLANATION_MODEL,
      },
      validation: {
        status: "PASSED",
        publicationAuthorized: false,
      },
    });
  }, 60_000);
});
