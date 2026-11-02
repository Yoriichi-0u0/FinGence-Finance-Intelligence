/**
 * LIVE model evaluation (opt-in, billable): FINGENCE_AI_LIVE_EVAL=1 with GROQ_API_KEY in the environment.
 * Optional FINGENCE_AI_EVAL_MODELS (comma list), FINGENCE_AI_EVAL_DOCS (comma list), FINGENCE_AI_EVAL_REPEATS (default 1),
 * FINGENCE_AI_EVAL_OUT (JSON path), FINGENCE_AI_EVAL_MAX_WAIT (s, default 900), FINGENCE_AI_EVAL_TIMEOUT_MS.
 * Each document is interpreted once per model, then judged ONLY by the deterministic gates and compared with
 * the canonical result of the hand-written correct proposal. Paced for the free tier (8k tokens/minute).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
vi.mock('server-only', () => ({}));
import { buildEvidence, readTable } from '../../lib/interpretation/evidence';
import { verifyProposal } from '../../lib/interpretation/gates';
import { proposeLayout } from '../../lib/server/ai/groq-interpreter';
import { InterpreterUnavailable, parseProposal, type LayoutProposal } from '../../lib/interpretation/contracts';
import { CORRECT } from './proposals';

const LIVE = process.env.FINGENCE_AI_LIVE_EVAL === '1' && !!process.env.GROQ_API_KEY;
type Expect = 'ACCEPT' | 'QUARANTINE' | 'ACCEPT_EXACT_OR_QUARANTINE';
const DOCS: { name: string; dir: string; expect: Expect; reference: string | null }[] = [
    { name: 'bank-statement-march-2026-export.csv', dir: 'public/demo/unfamiliar', expect: 'ACCEPT', reference: 'bank-statement-march-2026-export.csv' },
    { name: 'general-ledger-cash-march-2026.csv', dir: 'public/demo/unfamiliar', expect: 'ACCEPT', reference: 'general-ledger-cash-march-2026.csv' },
    { name: 'penyata-bank-mac-2026.csv', dir: 'public/demo/unfamiliar', expect: 'ACCEPT', reference: 'penyata-bank-mac-2026.csv' },
    { name: 'ledger-signed-march-2026.csv', dir: 'public/demo/unfamiliar', expect: 'ACCEPT', reference: 'ledger-signed-march-2026.csv' },
    { name: 'prompt-injection-in-cell.csv', dir: 'tests/fixtures/interpretation', expect: 'ACCEPT_EXACT_OR_QUARANTINE', reference: 'bank-statement-march-2026-export.csv' },
    { name: 'opaque-headings-no-balance.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'corrupted-running-balance.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'mislabelled-withdrawal-deposit.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'usd-statement.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'staff-roster.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    // Release-readiness set: no running balance, so direction, role and account rest on headings and wording.
    { name: 'bank-debit-credit-no-balance.csv', dir: 'tests/fixtures/interpretation', expect: 'ACCEPT', reference: 'bank-debit-credit-no-balance.csv' },
    { name: 'bank-dr-cr-no-balance.csv', dir: 'tests/fixtures/interpretation', expect: 'ACCEPT', reference: 'bank-dr-cr-no-balance.csv' },
    { name: 'signed-amount-reversed-no-balance.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'ledger-signed-opaque-no-balance.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'ledger-multiple-accounts.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'ledger-sales-account.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'ledger-bank-loan-account.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'ledger-no-account-evidence.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
    { name: 'bank-ambiguous-debit-credit.csv', dir: 'tests/fixtures/interpretation', expect: 'QUARANTINE', reference: null },
];
const MODELS = (process.env.FINGENCE_AI_EVAL_MODELS ?? 'openai/gpt-oss-120b').split(',');
const only = process.env.FINGENCE_AI_EVAL_DOCS?.split(',');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Longest provider Retry-After the harness will wait out (daily token caps can ask for long waits). */
const MAX_WAIT_SECONDS = Number(process.env.FINGENCE_AI_EVAL_MAX_WAIT ?? 900);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Field-level agreement with the hand-written proposal, before any gate (v2 proposals are flattened first). */
function fieldAccuracy(p: unknown, ref: LayoutProposal) {
    const flat = parseProposal(p), q = (flat.success ? flat.data : p) as Partial<LayoutProposal> | null;
    const fields: [string, unknown, unknown][] = [
        ['role', q?.role, ref.role], ['headerLine', q?.headerLine, ref.headerLine], ['representation', q?.representation, ref.representation],
        ['dateFormat', q?.dateFormat, ref.dateFormat], ['numberFormat', q?.numberFormat, ref.numberFormat],
        ...Object.entries(ref.columns).map(([k, v]) => [`columns.${k}`, (q?.columns as Record<string, unknown> | undefined)?.[k], v] as [string, unknown, unknown]),
    ];
    const wrong = fields.filter(([, a, b]) => a !== b).map(([k, a, b]) => `${k}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    return { correct: fields.length - wrong.length, total: fields.length, wrong };
}

describe.skipIf(!LIVE)('live layout interpretation evaluation', () => {
    it('interprets every document with every model; zero false acceptances', async () => {
        const rows: Record<string, unknown>[] = [];
        const repeats = Math.max(1, Number(process.env.FINGENCE_AI_EVAL_REPEATS ?? 1));
        // Models alternate; each waits only for its OWN per-minute token budget (Groq limits are per model).
        const nextAllowed = new Map<string, number>();
        for (let run = 1; run <= repeats; run++) for (const d of DOCS.filter(x => !only || only.includes(x.name))) for (const model of MODELS) {
            await sleep(Math.max(0, (nextAllowed.get(model) ?? 0) - Date.now()));
            const bytes = new Uint8Array(readFileSync(join(d.dir, d.name))), table = readTable(bytes)!;
            const evidence = buildEvidence(table, 'f'.repeat(64), d.name);
            let row: Record<string, unknown> = { run, model, document: d.name, expected: d.expect };
            try {
                // A provider 429 is refused before processing (not billed, not a sample): wait it out and ask again.
                const call = async (attempt = 0): Promise<Awaited<ReturnType<typeof proposeLayout>>> => {
                    try { return await proposeLayout(evidence, { model, reasoningEffort: (process.env.FINGENCE_AI_EVAL_REASONING as 'low' | 'medium' | 'high' | undefined) ?? 'low' }); }
                    catch (error) {
                        const wait = error instanceof InterpreterUnavailable && error.code === 'RATE_LIMITED' ? error.retryAfterSeconds ?? 30 : null;
                        if (wait === null || wait > MAX_WAIT_SECONDS || attempt >= 24) throw error;
                        console.log(JSON.stringify({ model, document: d.name, rateLimitedWaitSeconds: wait }));
                        await sleep(wait * 1000 + 1000); return call(attempt + 1);
                    }
                };
                const { proposal, receipt } = await call();
                const verdict = verifyProposal(table, proposal);
                const reference = d.reference ? verifyProposal(table, CORRECT[d.reference]) : null;
                const exact = !!verdict.canonical && !!reference?.canonical && decode(verdict.canonical.bytes) === decode(reference.canonical.bytes);
                const accepted = verdict.decision === 'AUTO_ACCEPTED';
                const falseAcceptance = accepted && !exact;
                const outcome = falseAcceptance ? 'FALSE_ACCEPTANCE' : accepted ? 'ACCEPTED_EXACT' : 'QUARANTINED';
                row = { ...row, reasoning: process.env.FINGENCE_AI_EVAL_REASONING ?? 'low', outcome, meetsExpectation: d.expect === 'ACCEPT' ? outcome === 'ACCEPTED_EXACT' : d.expect === 'QUARANTINE' ? outcome === 'QUARANTINED' : !falseAcceptance,
                    // Whether the MODEL itself recognised the problem (abstained or listed it) before any gate ran.
                    schemaVersion: (() => { const f = parseProposal(proposal); return f.success ? f.version : 'invalid'; })(),
                    modelAbstained: (() => { const f = parseProposal(proposal); return f.success && f.data.role === 'UNSUPPORTED'; })(), unresolved: (proposal as { unresolved?: unknown } | null)?.unresolved ?? null,
                    failedGates: verdict.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.detail}`), summary: verdict.summary,
                    mapping: d.reference && d.expect !== 'QUARANTINE' ? fieldAccuracy(proposal, CORRECT[d.reference]) : null, receipt, proposal };
                nextAllowed.set(model, Date.now() + Math.max(8_000, ((receipt.inputTokens ?? 3000) + (receipt.outputTokens ?? 1000)) / 8000 * 60_000 + 2_000));
            } catch (error) {
                row = { ...row, outcome: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error), meetsExpectation: d.expect !== 'ACCEPT' };
                nextAllowed.set(model, Date.now() + 20_000);
            }
            rows.push(row);
            if (process.env.FINGENCE_AI_EVAL_OUT) { mkdirSync(dirname(process.env.FINGENCE_AI_EVAL_OUT), { recursive: true }); writeFileSync(process.env.FINGENCE_AI_EVAL_OUT, JSON.stringify({ date: new Date().toISOString(), complete: false, rows }, null, 2)); }
            console.log(JSON.stringify({ run, model, document: d.name, abstained: row.modelAbstained, outcome: row.outcome, meets: row.meetsExpectation, failed: row.failedGates, mapping: (row.mapping as { correct: number; total: number } | null) ?? null }));
        }
        const out = process.env.FINGENCE_AI_EVAL_OUT;
        if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), complete: true, rows }, null, 2)); }
        expect(rows.filter(r => r.outcome === 'FALSE_ACCEPTANCE')).toEqual([]);
    }, Number(process.env.FINGENCE_AI_EVAL_TIMEOUT_MS ?? 3_600_000));
});
