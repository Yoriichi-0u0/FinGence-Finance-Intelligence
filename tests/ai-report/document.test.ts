import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type ProcessingContext } from '../../lib/demo/pipeline';
import { kindOf, reportDocument } from '../../lib/ai-report/document';
import { AI_REPORT_SECTIONS, cashPlanFacts } from '../../lib/ai-report/sections';
import { groundingIndex, runQueries } from '../../lib/grounded-qa/tools';

const load = (dir: string, names: string[]) => processDocuments(names.map(n => ({ name: n, bytes: new Uint8Array(readFileSync(join('public/demo', dir, n))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' as const })));
let year: ProcessingContext, quarter: ProcessingContext;
beforeAll(async () => {
    year = await load('full-year', ['demo-bank-statement-2025-fy-myr.csv', 'demo-general-ledger-2025-fy-myr.csv', 'demo-bank-history-2024-01-to-2025-12-myr.csv']);
    quarter = await load('quarter', ['demo-bank-statement-2026-q1-sgd.csv', 'demo-general-ledger-2026-q1-sgd.csv', 'demo-bank-history-2025-04-to-2026-03-sgd.csv']);
});

describe('report document (Bursa-style cash report)', () => {
    it('names the report like a listed company does', () => {
        expect([kindOf(['2026-03']), kindOf(['2026-01', '2026-02', '2026-03']), kindOf(['2026-02', '2026-03', '2026-04']), kindOf(Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`))]).toEqual(['MONTHLY', 'QUARTERLY', 'PERIOD', 'ANNUAL']);
    });

    it('states an annual year against the year before, and the statement adds up to the bank movement and the balances', () => {
        const d = reportDocument(year)!;
        expect(d.groups.map(g => [g.label, g.columns.map(c => c.label)])).toEqual([['Twelve months ended', ['31 December 2025', '31 December 2024']]]);
        d.columns.forEach((_, i) => {
            const lines = d.statement.flatMap(s => [...s.receipts, ...s.payments]).reduce((t, l) => t + l.values[i], 0n);
            expect(lines).toBe(d.netIncrease[i]);
            expect(d.statement.reduce((t, s) => t + s.net[i], 0n)).toBe(d.netIncrease[i]);
            expect(d.opening[i]! + d.netIncrease[i]).toBe(d.closing[i]);
        });
        expect([d.opening, d.closing, d.netIncrease]).toEqual([[22324026n, 18500000n], [41714316n, 22324026n], [19390290n, 3824026n]]);
        expect(d.highlights.map(h => [h.label, h.value, h.prior])).toEqual([['Cash received', 168670315n, 121817670n], ['Cash paid', -149280025n, -117993644n], ['Net cash from operating activities', 33030290n, 8864026n], ['Cash and bank balances', 41714316n, 22324026n]]);
    });

    it('writes the explanatory notes from the records', () => {
        const n = reportDocument(year)!.notes;
        expect(n.seasonal[0]).toMatch(/^Over the 12 months to December 2025, receipts were highest in December 2025/);
        expect(n.unusual.map(u => [u.label, u.amount])).toEqual([['Equipment', -8600000n], ['Insurance', -1480000n], ['Sales refunds', -240000n], ['Selangor Demo Hardware', -168420n], ['Kilat Demo Trading', -745000n]]);
        expect(n.unusual.find(u => u.label === 'Kilat Demo Trading')!.why).toMatch(/^Not recorded in the books and still flagged/);
        expect(n.investing.map(l => [l.category, l.values])).toEqual([['Equipment', [-8600000n, 0n]]]);
        expect(n.financing.map(l => [l.category, l.values])).toEqual([['Loan repayment', [-5040000n, -5040000n]]]);
        expect(n.reconciliation).toEqual({ months: 12, explained: 12, entries: 18, unexplained: 0n, open: 2 });
    });

    it('a quarter compares with the preceding quarter when last year is not in the history', () => {
        const d = reportDocument(quarter)!;
        expect(d.kind).toBe('QUARTERLY');
        expect(d.groups.map(g => [g.label, g.columns.map(c => c.label)])).toEqual([['Individual quarter ended', ['31 March 2026', '31 December 2025']]]);
        expect(d.closing[0]! - d.opening[0]!).toBe(d.netIncrease[0]);
    });

    it('the AI outlook cites the six-month cash plan, so the report and Forecasting never disagree', () => {
        const index = groundingIndex(year)!, facts = cashPlanFacts(index), plan = year.outputs.cashPlan!;
        if (plan.status !== 'AVAILABLE') throw Error('no plan');
        expect(facts.map(f => f.label)).toEqual([
            'Cash plan for 2026-01, planned category by category from the verified history (not a promise)',
            'Planned cash balance at the end of 2026-06, from the verified balance at the end of 2025-12',
            'Regular and scheduled payments over 2026-01 to 2026-03',
        ]);
        expect(facts[0].fields.net).toEqual({ kind: 'MONEY', cents: (BigInt(plan.projection[0].net.replace('.', ''))).toString(), currency: 'MYR' });
        const outlook = AI_REPORT_SECTIONS.find(s => s.id === 'outlook')!;
        expect(outlook.queries(index).map(q => q.tool)).toEqual(['cash_summary']);
        expect(runQueries(index, outlook.queries(index)).length + facts.length).toBeLessThanOrEqual(12);
    });
});
