/**
 * LIVE model evaluation (opt-in, billable): FINGENCE_AI_LIVE_EVAL=1 with GROQ_API_KEY in the environment.
 * Optional FINGENCE_AI_EVAL_MODELS (comma list), FINGENCE_AI_EVAL_DOCS (comma list), FINGENCE_AI_EVAL_OUT (JSON path).
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
import type { LayoutProposal } from '../../lib/interpretation/contracts';
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
];
const MODELS = (process.env.FINGENCE_AI_EVAL_MODELS ?? 'openai/gpt-oss-120b').split(',');
const only = process.env.FINGENCE_AI_EVAL_DOCS?.split(',');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Field-level agreement with the hand-written proposal, before any gate. */
function fieldAccuracy(p: unknown, ref: LayoutProposal) {
    const q = p as Partial<LayoutProposal> | null;
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
        for (const model of MODELS) for (const d of DOCS.filter(x => !only || only.includes(x.name))) {
            const bytes = new Uint8Array(readFileSync(join(d.dir, d.name))), table = readTable(bytes)!;
            const evidence = buildEvidence(table, 'f'.repeat(64), d.name);
            let row: Record<string, unknown> = { model, document: d.name, expected: d.expect };
            try {
                const { proposal, receipt } = await proposeLayout(evidence, { model });
                const verdict = verifyProposal(table, proposal);
                const reference = d.reference ? verifyProposal(table, CORRECT[d.reference]) : null;
                const exact = !!verdict.canonical && !!reference?.canonical && decode(verdict.canonical.bytes) === decode(reference.canonical.bytes);
                const accepted = verdict.decision === 'AUTO_ACCEPTED';
                const falseAcceptance = accepted && !exact;
                const outcome = falseAcceptance ? 'FALSE_ACCEPTANCE' : accepted ? 'ACCEPTED_EXACT' : 'QUARANTINED';
                row = { ...row, outcome, meetsExpectation: d.expect === 'ACCEPT' ? outcome === 'ACCEPTED_EXACT' : d.expect === 'QUARANTINE' ? outcome === 'QUARANTINED' : !falseAcceptance,
                    failedGates: verdict.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.detail}`), summary: verdict.summary,
                    mapping: d.reference && d.expect !== 'QUARANTINE' ? fieldAccuracy(proposal, CORRECT[d.reference]) : null, receipt, proposal };
                await sleep(Math.max(8_000, ((receipt.inputTokens ?? 3000) + (receipt.outputTokens ?? 1000)) / 8000 * 60_000 + 2_000));
            } catch (error) {
                row = { ...row, outcome: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error), meetsExpectation: d.expect !== 'ACCEPT' };
                await sleep(20_000);
            }
            rows.push(row);
            console.log(JSON.stringify({ model, document: d.name, outcome: row.outcome, meets: row.meetsExpectation, failed: row.failedGates, mapping: (row.mapping as { correct: number; total: number } | null) ?? null }));
        }
        const out = process.env.FINGENCE_AI_EVAL_OUT;
        if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), rows }, null, 2)); }
        expect(rows.filter(r => r.outcome === 'FALSE_ACCEPTANCE')).toEqual([]);
    }, 3_600_000);
});
