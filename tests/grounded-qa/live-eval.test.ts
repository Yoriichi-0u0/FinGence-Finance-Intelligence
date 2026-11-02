/**
 * LIVE grounded Q&A evaluation (opt-in, billable): FINGENCE_QA_LIVE_EVAL=1 with GROQ_API_KEY in the environment.
 * FINGENCE_QA_EVAL_MODELS (comma list), FINGENCE_QA_EVAL_IDS (comma list of question IDs), FINGENCE_QA_EVAL_REPEATS (default 1),
 * FINGENCE_QA_EVAL_FIRST_RUN (run label to start from), FINGENCE_QA_EVAL_OUT (JSON path, written after every question), FINGENCE_QA_EVAL_MAX_WAIT (s, default 900), FINGENCE_QA_EVAL_TIMEOUT_MS.
 * Each question runs the real browser orchestration (pre-check, plan gate, tools, answer gate) against the server's
 * model call, and is scored only against figures computed from the verified records.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
vi.mock('server-only', () => ({}));
import { askGrounded, type QaModel } from '../../lib/grounded-qa/client';
import { groundingIndex } from '../../lib/grounded-qa/tools';
import { InterpreterUnavailable } from '../../lib/interpretation/contracts';
import { askModel, QA_PROMPT_REVISION } from '../../lib/server/ai/grounded-qa';
import { phase1 } from './fixtures';
import { QUESTIONS, score } from './eval-set';

const LIVE = process.env.FINGENCE_QA_LIVE_EVAL === '1' && !!process.env.GROQ_API_KEY;
const MODELS = (process.env.FINGENCE_QA_EVAL_MODELS ?? 'openai/gpt-oss-120b').split(',');
const IDS = process.env.FINGENCE_QA_EVAL_IDS?.split(',');
const MAX_WAIT = Number(process.env.FINGENCE_QA_EVAL_MAX_WAIT ?? 900);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe.skipIf(!LIVE)('live grounded Q&A evaluation', () => {
    it('answers every question with every model; zero fabricated figures', async () => {
        const index = groundingIndex(await phase1())!, rows: Record<string, unknown>[] = [], nextAllowed = new Map<string, number>();
        const repeats = Math.max(1, Number(process.env.FINGENCE_QA_EVAL_REPEATS ?? 1)), out = process.env.FINGENCE_QA_EVAL_OUT;
        const first = Math.max(1, Number(process.env.FINGENCE_QA_EVAL_FIRST_RUN ?? 1));
        for (let run = first; run < first + repeats; run++) for (const q of QUESTIONS.filter(x => !IDS || IDS.includes(x.id))) for (const modelName of MODELS) {
            // Each stage waits for its own model's per-minute budget; an unbilled 429 is waited out and asked again (not a sample).
            const model: QaModel = {
                async call(req) {
                    for (let attempt = 0; ; attempt++) {
                        await sleep(Math.max(0, (nextAllowed.get(modelName) ?? 0) - Date.now()));
                        try {
                            const r = await askModel(req, { model: modelName, reasoningEffort: 'low' });
                            nextAllowed.set(modelName, Date.now() + Math.max(4_000, ((r.receipt.inputTokens ?? 2500) + (r.receipt.outputTokens ?? 500)) / 8000 * 60_000 + 1_500));
                            return r;
                        } catch (error) {
                            const wait = error instanceof InterpreterUnavailable && error.code === 'RATE_LIMITED' ? error.retryAfterSeconds ?? 30 : null;
                            if (wait === null || wait > MAX_WAIT || attempt >= 24) throw error;
                            console.log(JSON.stringify({ model: modelName, id: q.id, rateLimitedWaitSeconds: wait }));
                            await sleep(wait * 1000 + 1000);
                        }
                    }
                },
            };
            const result = await askGrounded(index, q.question, model), s = score(q, index, result);
            rows.push({
                run, model: modelName, promptRevision: QA_PROMPT_REVISION, id: q.id, category: q.category, expected: q.expect, question: q.question, status: result.status, outcome: s.outcome, meets: s.meets,
                rendered: s.rendered, missingKeys: s.missing, refusal: result.refusal, queries: result.queries, error: result.error,
                failedChecks: [...result.planChecks, ...(result.verdict?.checks ?? [])].filter(c => !c.passed).map(c => `${c.id}: ${c.detail}`),
                receipts: result.receipts, calls: result.receipts.length,
                latencyMs: result.receipts.reduce((n, r) => n + r.latencyMs, 0), estimatedUsd: result.receipts.reduce((n, r) => n + (r.estimatedUsd ?? 0), 0),
            });
            console.log(JSON.stringify({ run, model: modelName, id: q.id, status: result.status, outcome: s.outcome, meets: s.meets }));
            if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), complete: false, rows }, null, 2)); }
        }
        if (out) writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), complete: true, rows }, null, 2));
        expect(rows.filter(r => r.outcome === 'FABRICATED')).toEqual([]);
    }, Number(process.env.FINGENCE_QA_EVAL_TIMEOUT_MS ?? 3_600_000));
});
