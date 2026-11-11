import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { rpc, workspaceStore } from '../server/workspace/store';
import { aiCallSchema, type AiCall, type AiCaller } from './contract';
import type { AiFeature } from './features';
import { estimateUsd } from './prices';

/**
 * The door every AI call goes through. Wrap the call in withAiCall: it times it, reads the model, request ID and
 * token usage from the reply, prices it, and records one line of metadata for the Technical log. Nothing the model
 * was sent or answered is recorded. A logging failure never changes the call's result.
 *
 *   const reply = await withAiCall({ feature: 'recon-suggest', model: 'openai/gpt-oss-120b' },
 *       () => groq.chat.completions.create({ model: 'openai/gpt-oss-120b', messages }));
 *
 * Guide: docs/ai-integration/ai-calls.md.
 */
export type { AiCall, AiCaller } from './contract';
export { AI_FEATURES, featureLabel, type AiFeature } from './features';
export { MODEL_PRICES, estimateUsd } from './prices';

type Verdict = NonNullable<AiCall['verdict']>;
export type AiCallMeta = {
    /** A slug from lib/ai-calls/features.ts. */
    feature: AiFeature;
    model: string;
    provider?: string;
    /** Which key pays, as a name; defaults to the AI_KEY_LABEL environment variable. Never the key. */
    keyLabel?: string | null;
    processingId?: string | null;
};
/** What the call itself can add while it runs (e.g. which of several keys it used). */
export type AiCallNote = { keyLabel?: string | null; requestId?: string | null; model?: string; inputTokens?: number | null; outputTokens?: number | null; estimatedUsd?: number | null };
/** The feature's own verdict on a successful reply, when it decides on the server. */
export type AiJudge<T> = (result: T) => { verdict?: Verdict | null; reasonCode?: string | null } | null | undefined | void;

const callers = new AsyncLocalStorage<AiCaller | null>();
/** Runs fn with this caller; every AI call inside it (however deep) is attributed to them. */
export const runAsCaller = <T>(caller: AiCaller | null, fn: () => T): T => callers.run(caller, fn);
export const currentCaller = (): AiCaller | null => callers.getStore() ?? null;

export type AiCallSink = (call: AiCall, caller: AiCaller | null) => Promise<void>;
let sinkOverride: AiCallSink | null = null;
/** Tests (and only tests) replace where calls go; null restores the default. */
export function setAiCallSink(sink: AiCallSink | null) { sinkOverride = sink; }

export async function withAiCall<T>(meta: AiCallMeta, run: (note: AiCallNote) => Promise<T>, judge?: AiJudge<T>): Promise<T> {
    const note: AiCallNote = {}, started = Date.now();
    let result: T;
    try { result = await run(note); }
    catch (error) {
        await record(meta, note, { ...failure(error), verdict: null }, Date.now() - started);
        throw error;
    }
    let judged: ReturnType<AiJudge<T>> = null;
    try { judged = judge?.(result); } catch { judged = { reasonCode: 'JUDGE_FAILED' }; }
    await record({ ...meta, ...usageOf(result, meta.model) }, note, { status: 'OK', verdict: judged?.verdict ?? null, reasonCode: judged?.reasonCode ?? null }, Date.now() - started);
    return result;
}

/** For a call that never reached a model but should still appear (e.g. refused by a pre-check): status and reason only. */
export async function recordAiRefusal(meta: AiCallMeta, reasonCode: string) {
    await record(meta, {}, { status: 'REFUSED', verdict: null, reasonCode }, 0);
}

type Usage = { model?: string; requestId?: string | null; inputTokens?: number | null; outputTokens?: number | null; estimatedUsd?: number | null };
/** Reads usage from a FinGence `{ receipt }`, an OpenAI-compatible chat completion (Groq, OpenAI) or a Responses API reply. */
function usageOf(result: unknown, fallbackModel: string): Usage {
    const r = result as { receipt?: { provider?: unknown; model?: unknown; requestId?: unknown; inputTokens?: unknown; outputTokens?: unknown; estimatedUsd?: unknown };
        id?: unknown; model?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; input_tokens?: unknown; output_tokens?: unknown } } | null;
    if (!r || typeof r !== 'object') return {};
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
    const str = (v: unknown) => typeof v === 'string' ? v : null;
    if (r.receipt && typeof r.receipt === 'object') {
        const x = r.receipt;
        return { model: str(x.model) ?? fallbackModel, requestId: str(x.requestId), inputTokens: num(x.inputTokens), outputTokens: num(x.outputTokens), estimatedUsd: num(x.estimatedUsd) };
    }
    const u = r.usage && typeof r.usage === 'object' ? r.usage : null;
    return { model: str(r.model) ?? fallbackModel, requestId: str(r.id), inputTokens: num(u?.prompt_tokens) ?? num(u?.input_tokens), outputTokens: num(u?.completion_tokens) ?? num(u?.output_tokens) };
}

const toCode = (value: string) => { const c = value.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^[^A-Z]+/, '').slice(0, 60); return c || 'ERROR'; };
/** A thrown error as a status and code: FinGence's InterpreterUnavailable codes, or an SDK error's HTTP status. */
function failure(error: unknown): { status: AiCall['status']; reasonCode: string } {
    const e = error as { code?: unknown; status?: unknown } | null;
    const code = typeof e?.code === 'string' ? e.code : null, status = typeof e?.status === 'number' ? e.status : null;
    if (code === 'RATE_LIMITED' || status === 429) return { status: 'RATE_LIMITED', reasonCode: 'RATE_LIMITED' };
    if (code?.startsWith('PROVIDER_HTTP_')) return { status: 'REFUSED', reasonCode: toCode(code) };
    if (status !== null && status >= 400 && status < 500) return { status: 'REFUSED', reasonCode: `HTTP_${status}` };
    if (status !== null) return { status: 'FAILED', reasonCode: `HTTP_${status}` };
    return { status: 'FAILED', reasonCode: code ? toCode(code) : 'ERROR' };
}

let dropped = 0;
/** How many calls could not be recorded since start (invalid metadata or an unreachable store). */
export const droppedAiCalls = () => dropped;

async function record(meta: AiCallMeta & Usage, note: AiCallNote, outcome: { status: AiCall['status']; verdict: AiCall['verdict']; reasonCode: string | null }, latencyMs: number) {
    const model = note.model ?? meta.model, inputTokens = note.inputTokens ?? meta.inputTokens ?? null, outputTokens = note.outputTokens ?? meta.outputTokens ?? null;
    const label = note.keyLabel ?? meta.keyLabel ?? process.env.AI_KEY_LABEL ?? null;
    const call = aiCallSchema.safeParse({
        feature: meta.feature, provider: meta.provider ?? 'GROQ', model, keyLabel: label, requestId: note.requestId ?? meta.requestId ?? null,
        status: outcome.status, verdict: outcome.verdict, reasonCode: outcome.reasonCode ? toCode(outcome.reasonCode) : null,
        inputTokens, outputTokens, estimatedUsd: note.estimatedUsd ?? meta.estimatedUsd ?? estimateUsd(model, inputTokens, outputTokens),
        latencyMs: Math.max(0, Math.round(latencyMs)), processingId: meta.processingId ?? null,
    });
    if (!call.success) { dropped++; return; }
    const sink = sinkOverride ?? defaultSink();
    if (!sink) return;
    // Bounded: a slow or unreachable store costs the caller at most two seconds, and never an error.
    await Promise.race([sink(call.data, currentCaller()).catch(() => { dropped++; }), new Promise(resolve => setTimeout(resolve, 2_000))]);
}

/** Where calls go: the hosted log for a signed-in caller; otherwise, on a developer's machine, a local JSONL file. */
function defaultSink(): AiCallSink | null {
    if (process.env.VITEST) return null;
    const store = workspaceStore(), local = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
    return async (call, caller) => {
        if (store && caller) {
            const saved = await rpc('fingence_workspace_record_ai_call', { p_call: { ...call, organizationId: caller.organizationId, memberId: caller.memberId, jobId: caller.jobId } }, store);
            if (!saved.ok) dropped++;
            return;
        }
        if (local) {
            const dir = join(process.cwd(), '.local', 'ai-calls');
            await mkdir(dir, { recursive: true });
            await appendFile(join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), ...call })}\n`);
        }
    };
}
