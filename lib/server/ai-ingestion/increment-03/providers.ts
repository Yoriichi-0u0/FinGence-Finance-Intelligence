import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { resolve } from "node:path";
import { QuotaLedger, type OneShotAuthorization } from "./quota";
import { hash, type prepareRequest } from "../../../ai-ingestion/increment-03/plan";
export class UncertainDispatchError extends Error {
  constructor(code: string, readonly provider: "LIVE_GROQ" | "LIVE_OLLAMA", readonly reservationId: string) { super(code); }
}
export type InferenceRequest03 = ReturnType<typeof prepareRequest>;
export interface Receipt03 {
  mode: "LIVE_GROQ" | "LIVE_OLLAMA" | "RECORDED_TEST"; model: string; requestId: string | null;
  inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; estimatedUsd: number | null;
  retries: 0; durationMs: number; outputHash: string; finishReason?: string;
}
export interface Provider03 { propose(request: InferenceRequest03, signal?: AbortSignal): Promise<{ plan: unknown; receipt: Receipt03 }> }
const usageSchema = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(),
  completion_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().optional() }).optional() });
// The injectable transport exists for offline tests, never HTTP/CLI request data.
type GroqTransport = (body: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
export class GroqProvider03 implements Provider03 {
  constructor(private ledger: QuotaLedger, private transport?: GroqTransport, private approval?: OneShotAuthorization) {}
  async propose(request: InferenceRequest03, signal?: AbortSignal) {
    if (!process.env.GROQ_API_KEY || process.env.FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED !== "1" || process.env.FINGENCE_AI03_FREE_PLAN_CONFIRMED !== "1") throw new Error("LIVE_GROQ_UNAVAILABLE");
    if (signal?.aborted) throw new Error("REQUEST_CANCELED");
    const body = { model: "openai/gpt-oss-20b", messages: request.messages, reasoning_effort: "low", temperature: 0,
      max_completion_tokens: 1600, response_format: { type: "json_schema", json_schema: { name: "financial_plan_03", strict: true, schema: request.schema } } };
    const reservation = this.ledger.reserve(request.inputTokenBound + body.max_completion_tokens, this.approval);
    try {
    const start = performance.now(); let response: unknown;
    try {
      const send = this.transport ?? (async (data: Record<string, unknown>, s?: AbortSignal) => {
        const client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1", maxRetries: 0, timeout: 60000 });
        return client.chat.completions.create(data as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal: s });
      });
      response = await send(body, signal);
    } catch { this.ledger.finish(reservation, "UNKNOWN"); throw new UncertainDispatchError("GROQ_REQUEST_FAILED", "LIVE_GROQ", reservation); }
    const parsed = z.object({ id: z.string(), model: z.literal("openai/gpt-oss-20b"), usage: usageSchema }).safeParse(response);
    if (!parsed.success) { this.ledger.finish(reservation, "UNKNOWN"); throw new UncertainDispatchError("GROQ_INCOMPLETE", "LIVE_GROQ", reservation); }
    const r = parsed.data;
    this.ledger.finish(reservation, "COMPLETED", { inputTokens: r.usage.prompt_tokens, outputTokens: r.usage.completion_tokens });
    const choices = z.object({ choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ content: z.string().nullable() }) })).length(1) }).safeParse(response);
    const content = choices.success ? choices.data.choices[0].message.content : null;
    const overBound = content !== null && Buffer.byteLength(content) > 65536;
    const usageOverBound = r.usage.prompt_tokens + r.usage.completion_tokens > request.inputTokenBound + body.max_completion_tokens;
    const finishReason = overBound || usageOverBound ? "output_bound" : choices.success ? choices.data.choices[0].finish_reason : "invalid_response";
    let plan: unknown = null;
    if (content !== null && !overBound) { try { plan = JSON.parse(content); } catch { plan = content; } }
    return { plan, receipt: { mode: "LIVE_GROQ" as const, finishReason, model: r.model, requestId: r.id, inputTokens: r.usage.prompt_tokens, outputTokens: r.usage.completion_tokens,
      reasoningTokens: r.usage.completion_tokens_details?.reasoning_tokens ?? null, estimatedUsd: 0, retries: 0 as const, durationMs: Math.round(performance.now() - start), outputHash: hash(plan) } };
    } catch (error) {
      if (error instanceof UncertainDispatchError) throw error;
      // Even a ledger lock/I/O failure after dispatch must retain uncertain-attempt identity.
      throw new UncertainDispatchError("GROQ_POST_DISPATCH_FAILED", "LIVE_GROQ", reservation);
    }
  }
}
export class OllamaProvider03 implements Provider03 {
  constructor(private endpoint = "http://127.0.0.1:11434", private ledger = new QuotaLedger(resolve(".ai-local/increment-03"))) {
    const u = new URL(endpoint);
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new Error("OLLAMA_LOOPBACK_REQUIRED");
  }
  async propose(request: InferenceRequest03, signal?: AbortSignal) {
    const model = process.env.FINGENCE_AI03_OLLAMA_MODEL;
    if (process.env.FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED !== "1" || !model || !["qwen3:4b-instruct", "gpt-oss:20b"].includes(model)) throw new Error("LIVE_OLLAMA_UNAVAILABLE");
    const start = performance.now(), abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
    // No pull/create endpoints. The approved model must already exist locally.
    const tags = await fetch(`${this.endpoint}/api/tags`, { signal: abort, redirect: "error" }).then(r => r.json()) as { models?: { name: string }[] };
    if (!tags.models?.some(m => m.name === model)) throw new Error("OLLAMA_MODEL_NOT_INSTALLED");
    const reservation = this.ledger.reserve(request.inputTokenBound + 1600);
    let settled = false;
    try {
      const response = await fetch(`${this.endpoint}/api/chat`, { method: "POST", signal: abort, redirect: "error", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: request.messages, format: request.schema, stream: false, options: { temperature: 0, seed: 42, num_ctx: 16384, num_predict: 1600 } }) });
      if (!response.ok) throw new Error("OLLAMA_REQUEST_FAILED");
      const reader = response.body?.getReader(); if (!reader) throw new Error("OLLAMA_INCOMPLETE"); let bytes = 0; const chunks: Uint8Array[] = [];
      while (true) { const n = await reader.read(); if (n.done) break; bytes += n.value.length; if (bytes > 65536) { await reader.cancel(); throw new Error("OLLAMA_OUTPUT_BOUND"); } chunks.push(n.value); }
      const r = z.object({ model: z.string(), done: z.literal(true), done_reason: z.string(), message: z.object({ content: z.string() }), prompt_eval_count: z.number().int().nonnegative(), eval_count: z.number().int().nonnegative() }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      this.ledger.finish(reservation, "COMPLETED", { inputTokens: r.prompt_eval_count, outputTokens: r.eval_count }); settled = true;
      if (r.model !== model) throw new Error("OLLAMA_MODEL_MISMATCH"); let plan: unknown; try { plan = JSON.parse(r.message.content); } catch { plan = r.message.content; }
    return { plan, receipt: { mode: "LIVE_OLLAMA" as const, finishReason: r.done_reason, model, requestId: null, inputTokens: r.prompt_eval_count, outputTokens: r.eval_count, reasoningTokens: null,
      estimatedUsd: 0, retries: 0 as const, durationMs: Math.round(performance.now() - start), outputHash: hash(plan) } };
    } catch {
      try { if (!settled) this.ledger.finish(reservation, "UNKNOWN"); } catch { /* Reservation remains unresolved; never retry or claim no execution. */ }
      throw new UncertainDispatchError("OLLAMA_REQUEST_FAILED", "LIVE_OLLAMA", reservation);
    }
  }
}
