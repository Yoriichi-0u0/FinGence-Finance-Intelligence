import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ usePathname: () => '/ai-report', useRouter: () => ({ push: () => undefined }) }));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AI_REPORT_SECTIONS, AI_REPORT_STORE, clearAiReportCache, comparisonFacts, groundedFeature, resolutionFacts, waitableLimit, previousMonth, writeReportSection } from '../../lib/ai-report/sections';
import { COMMENTARY_QUESTION, renderedText } from '../../lib/grounded-qa/commentary';
import type { QaModel } from '../../lib/grounded-qa/client';
import { askRequestSchema, MAX_FACTS, MAX_QUESTION, type AskRequest } from '../../lib/grounded-qa/contracts';
import { preCheck } from '../../lib/grounded-qa/gates';
import { catalogue, groundingIndex, runQueries, type GroundingIndex } from '../../lib/grounded-qa/tools';
import { InterpreterUnavailable } from '../../lib/interpretation/contracts';
import { processDocuments, type ProcessingContext } from '../../lib/demo/pipeline';
import { doc, phase1 } from '../grounded-qa/fixtures';

const receipt = { provider: 'GROQ' as const, model: 'recorded-test', requestId: null, latencyMs: 0, inputTokens: null, outputTokens: null, estimatedUsd: null, mode: 'LIVE' as const };
type Sentence = { text: string; cites: string[] };
/** A recorded model that refuses any request the gateway itself would refuse. */
const writes = (sentences: (req: AskRequest) => Sentence[], seen: AskRequest[] = []): QaModel => ({
    async call(req) { if (!askRequestSchema.safeParse(req).success) throw Error('request the gateway would refuse'); seen.push(req); return { content: { answer: { kind: 'ANSWERED', sentences: sentences(req), derived: [] } }, receipt }; },
});
const factId = (req: AskRequest, label: RegExp) => req.stage === 'answer' ? req.facts.find(f => label.test(f.label))!.id : '';

let month: ProcessingContext, quarter: ProcessingContext, mi: GroundingIndex, qi: GroundingIndex;
beforeAll(async () => {
    month = await phase1();
    const q = (name: string) => ({ ...doc(`quarter/${name}`), name });
    quarter = await processDocuments([q('demo-bank-statement-2026-q1-sgd.csv'), q('demo-general-ledger-2026-q1-sgd.csv'), q('demo-bank-history-2025-04-to-2026-03-sgd.csv')]);
    mi = groundingIndex(month)!; qi = groundingIndex(quarter)!;
});

describe('AI report sections', () => {
    it('each question fits the gateway and passes its pre-check; FinGence chooses every query', () => {
        for (const index of [mi, qi]) for (const s of AI_REPORT_SECTIONS) {
            expect(s.question.length).toBeLessThanOrEqual(MAX_QUESTION);
            expect(preCheck(s.question, catalogue(index).counterparties), s.id).toBeNull();
            expect(runQueries(index, s.queries(index)).length).toBeLessThanOrEqual(MAX_FACTS);
        }
    });
    it('compares with the preceding period of the same length, computed by FinGence (never a quarter against one month)', () => {
        expect(previousMonth('2026-03')).toBe('2026-02');
        expect(previousMonth('2026-01')).toBe('2025-12');
        expect(comparisonFacts(mi)[0].label).toBe('Preceding period of the same length (2026-02)');
        const q = comparisonFacts(qi);
        expect(q[0].label).toBe('Preceding period of the same length (2025-10/2025-12)');
        // The same figures the page's summary-of-results table shows.
        expect(q[0].fields).toMatchObject({ moneyIn: { cents: '7188227' }, moneyOut: { cents: '4761768' } });
        expect(q[3].fields).toMatchObject({ change: { cents: '-538751' }, changePercent: { kind: 'PERCENT', tenths: -222 } });
        for (const s of AI_REPORT_SECTIONS) expect(s.queries(qi).map(x => x.tool)).not.toContain('monthly_history');
    });
    it('states what the reconciliation rules resolved and what is still unexplained, not the matcher\u2019s exceptions as open', () => {
        const fact = resolutionFacts(qi)[0], res = quarter.outputs.resolution!;
        expect(fact.fields.unexplained).toEqual({ kind: 'COUNT', n: res.totals.resolutions.UNEXPLAINED });
        expect((fact.fields.matcherExceptions as { n: number }).n).toBeGreaterThan(res.totals.resolutions.UNEXPLAINED);
        expect(fact.fields.timingCleared).toEqual({ kind: 'COUNT', n: res.totals.resolutions.TIMING_CLEARED });
        for (const id of ['summary', 'reconciliation'] as const) expect(AI_REPORT_SECTIONS.find(s => s.id === id)!.extra!(qi).map(f => f.label)).toContain(fact.label);
    });
    it('gives no comparison when the history does not cover the preceding months', () => {
        expect(comparisonFacts({ ...mi, history: mi.rows })).toEqual([]);
    });
    it('every section request passes the gateway schema for a month and for a quarter (any sample, any format the Data page read)', async () => {
        for (const index of [mi, qi]) for (const s of AI_REPORT_SECTIONS) {
            const seen: AskRequest[] = [];
            const run = await writeReportSection(index, writes(req => [{ text: 'FinGence reviewed this.', cites: [factId(req, /./)] }], seen), s.id);
            expect(seen).toHaveLength(1);
            expect(seen[0]).toMatchObject({ stage: 'answer', question: s.question });
            expect(run.status).not.toBe('UNAVAILABLE');
        }
    });
    it('a faithful paragraph is accepted, and every figure in it is rendered by FinGence from the records', async () => {
        const run = await writeReportSection(mi, writes(req => {
            const now = factId(req, /^Cash summary for 2026-03/), before = factId(req, /^Preceding period/), change = factId(req, /^Change in net cash/);
            return [{ text: `In {${now}.period}, money in was {${now}.moneyIn} and money out {${now}.moneyOut}, a net of {${now}.net}.`, cites: [now] }, { text: `Against {${before}.period}, when the net was {${before}.net}, net cash movement changed by {${change}.change} ({${change}.changePercent}).`, cites: [before, change] }];
        }), 'summary');
        expect(run.status).toBe('ANSWERED');
        const text = renderedText(run.verdict!.sentences!);
        expect(text[0]).toBe('In March 2026, money in was MYR 68,633.32 and money out MYR 40,401.31, a net of MYR 28,232.01.');
        expect(text[1]).toMatch(/^Against February 2026, when the net was MYR [\d,.]+, net cash movement changed by −?MYR [\d,.]+ \(-?\d+\.\d%\)\.$/);
    });
    it.each([
        ['a figure typed by the model', 'Money in was MYR 68,633.32.'],
        ['an accounting conclusion', 'The business made a profit this month.'],
        ['advice', 'Management should cut costs.'],
    ])('%s is withheld, so the report shows FinGence’s own summary', async (_, text) => {
        const run = await writeReportSection(mi, writes(req => [{ text, cites: [factId(req, /^Cash summary/)] }]), 'cash');
        expect(run.status).toBe('WITHHELD');
    });
    it('waits out per-minute limits (Groq\u2019s and FinGence\u2019s per person), never a daily limit', () => {
        expect(['RATE_LIMITED', 'CLIENT_RATE_LIMITED'].map(waitableLimit)).toEqual([true, true]);
        expect(['CLIENT_DAILY_LIMIT', 'DAILY_LIMIT', 'DAILY_BUDGET_EXHAUSTED', 'NOT_CONFIGURED', null].map(waitableLimit)).toEqual([false, false, false, false, false]);
    });
    it('an unavailable model leaves the deterministic report', async () => {
        const run = await writeReportSection(mi, { async call() { throw new InterpreterUnavailable('NOT_CONFIGURED'); } }, 'outlook');
        expect(run).toMatchObject({ status: 'UNAVAILABLE', error: 'NOT_CONFIGURED', receipts: [] });
    });
    it('the tab\u2019s copy of a written report is removed with the results, and a missing store never throws', () => {
        const store = new Map<string, string>([[AI_REPORT_STORE, '{"runs":{}}'], ['other', 'kept']]);
        vi.stubGlobal('sessionStorage', { removeItem: (k: string) => store.delete(k) });
        clearAiReportCache();
        expect([...store.keys()]).toEqual(['other']);
        vi.stubGlobal('sessionStorage', undefined);
        expect(() => clearAiReportCache()).not.toThrow();
        vi.unstubAllGlobals();
    });
    it('clearing, processing or reopening a run on Data clears the AI report too', async () => {
        const source = (await import('node:fs')).readFileSync('components/demo/context.tsx', 'utf8');
        expect(source.match(/clearAiReportCache\(\)/g)).toHaveLength(3);
    });
    it('the Technical log attributes the AI report to its own feature', () => {
        expect(AI_REPORT_SECTIONS.map(s => groundedFeature(s.question))).toEqual(Array(AI_REPORT_SECTIONS.length).fill('report-explain'));
        expect(groundedFeature(COMMENTARY_QUESTION)).toBe('report-commentary');
        expect(groundedFeature('Who did we pay the most?')).toBe('finance-qa');
    });
});

describe('AI report page', async () => {
    const { reportKind, periodEnded, priorPeriod } = await import('../../components/ai-report/ai-report');
    const { DemoModule, isReady } = await import('../../components/demo/modules');
    const { DemoProcessingProvider } = await import('../../components/demo/context');
    const render = (context: ProcessingContext) => {
        if (!isReady(context)) throw Error('sample did not process');
        const Provider = DemoProcessingProvider as (props: { enabled: boolean; children?: React.ReactNode }) => React.ReactNode;
        return renderToStaticMarkup(createElement(Provider, { enabled: true }, createElement(DemoModule, { view: 'ai-report', context }))).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
    };
    it('is titled like a listed company’s interim report', () => {
        expect([reportKind(['2026-03']), periodEnded(['2026-03'])]).toEqual(['Monthly report', 'for the month ended 31 March 2026']);
        expect([reportKind(['2026-01', '2026-02', '2026-03']), periodEnded(['2026-01', '2026-02', '2026-03'])]).toEqual(['Quarterly report · Q1 2026', 'for the first quarter ended 31 March 2026']);
        expect(reportKind(['2026-02', '2026-03', '2026-04'])).toBe('Period report');
    });
    it('compares with the same number of preceding months from the verified history', () => {
        expect(priorPeriod(month as never)?.months).toEqual(['2026-02']);
        expect(priorPeriod(quarter as never)?.months).toEqual(['2025-10', '2025-11', '2025-12']);
    });
    it('renders the whole report from the processed run without AI, with FinGence’s own summaries', () => {
        const text = render(month);
        for (const s of ['Monthly report', 'Cash report for the month ended 31 March 2026', 'Summary of results', 'Increase (decrease)', '1. Review of performance', '2. Cash received and paid', '3. Reconciliation with the books', '4. Matters for review', '5. Commentary on prospects', 'Notes: basis of preparation'])
            expect(text).toContain(s);
        expect(text).toContain('cash in was MYR 68,633.32');
        expect(text).toContain('AI writing is not switched on here');
        expect(text).not.toContain('Write with AI');
    });
    it('renders a quarter as a quarterly report with its months', () => {
        const text = render(quarter);
        expect(text).toContain('Quarterly report · Q1 2026');
        expect(text).toContain('for the first quarter ended 31 March 2026');
        expect(text).toContain('Cash by month');
        const unexplained = quarter.outputs.resolution!.totals.resolutions.UNEXPLAINED;
        expect(text).toContain(`${unexplained} unexplained after rules`);
        expect(text).not.toMatch(/\d+ remain open/);
    });
});

describe('AI report gateway key', () => {
    beforeEach(() => { vi.stubEnv('GROQ_API_KEY', 'test-key-not-real'); vi.stubEnv('FINGENCE_AI_GATEWAY', '1'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN', ''); });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
    const get = async (query: string) => { vi.resetModules(); const r = await import('../../app/api/ai/ask/route'); return (await r.GET(new Request(`http://localhost:3000/api/ai/ask${query}`))).json(); };
    it('is unavailable until GROQ_API_KEY5 is set, while the Q&A stays available on the shared keys', async () => {
        vi.stubEnv('GROQ_API_KEY5', '');
        expect(await get('?for=ai-report')).toEqual({ available: false });
        expect(await get('')).toMatchObject({ available: true });
        vi.stubEnv('GROQ_API_KEY5', 'test-key-five-not-real');
        expect(await get('?for=ai-report')).toMatchObject({ available: true });
    });
    it('sends AI report calls only on key 5 and fails closed without it', async () => {
        const index = groundingIndex(await phase1())!, section = AI_REPORT_SECTIONS[4], facts = runQueries(index, section.queries(index));
        const { modelView } = await import('../../lib/grounded-qa/facts');
        const body = { stage: 'answer', question: section.question, scope: catalogue(index).scope, facts: modelView(facts) };
        const keys: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { keys.push(String((init.headers as Record<string, string>).Authorization ?? (init.headers as Record<string, string>).authorization)); return new Response(JSON.stringify({ id: 'x', model: 'openai/gpt-oss-120b', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: { kind: 'INSUFFICIENT', missing: 'test' } }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200 }); }));
        const post = () => new Request('http://localhost:3000/api/ai/ask', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000' }, body: JSON.stringify(body) });
        vi.stubEnv('GROQ_API_KEY5', '');
        vi.resetModules(); let r = await import('../../app/api/ai/ask/route');
        expect((await r.POST(post())).status).toBe(502);
        expect(keys).toEqual([]);
        vi.stubEnv('GROQ_API_KEY5', 'test-key-five-not-real');
        vi.resetModules(); r = await import('../../app/api/ai/ask/route');
        expect((await r.POST(post())).status).toBe(200);
        expect(keys).toEqual(['Bearer test-key-five-not-real']);
    });
});
