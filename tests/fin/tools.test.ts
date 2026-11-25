import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { processDocuments, type DocumentInput, type ProcessingContext } from '../../lib/demo/pipeline';
import { groundingIndex, runQueries, type GroundingIndex } from '../../lib/grounded-qa/tools';
import type { Fact } from '../../lib/grounded-qa/facts';
import { processingConfidence } from '../../lib/confidence';
import { toCents } from '../../lib/poc-anomalies/source';
import { FIN_TOOLS, FIN_TOOL_NAMES, MAX_ROWS, UNTRUSTED_FIELDS, rankCandidates, runFinTool, tenthsOf } from '../../lib/fin/tools';

const read = (dir: string, name: string) => readFileSync(join('public/demo', dir, name), 'utf8');
const doc = (name: string, body: string): DocumentInput => ({ name, bytes: new TextEncoder().encode(body), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const MARCH = ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv', 'demo-bank-history-2025-04-to-2026-03.csv'];
const samples = {
    march: MARCH.map(n => doc(n, read('', n))),
    quarter: ['demo-bank-statement-2026-q1-sgd.csv', 'demo-general-ledger-2026-q1-sgd.csv', 'demo-bank-history-2025-04-to-2026-03-sgd.csv'].map(n => doc(n, read('quarter', n))),
    'full year': ['demo-bank-statement-2025-fy-myr.csv', 'demo-general-ledger-2025-fy-myr.csv', 'demo-bank-history-2024-01-to-2025-12-myr.csv'].map(n => doc(n, read('full-year', n))),
    // The March sample with one ledger amount changed in memory (the fixture files are untouched): the books now say
    // 1,500.00 where the bank paid out 1,567.26, which no stated rule explains, so the exception tools have a real item.
    'march, one ledger amount wrong': MARCH.map(n => doc(n, n.includes('ledger') ? read('', n).replace('GrabFood Marketplace Payout,1567.26,0.00,1567.26', 'GrabFood Marketplace Payout,1500.00,0.00,1500.00') : read('', n))),
};
const runs: Record<string, { context: ProcessingContext; index: GroundingIndex }> = {};
beforeAll(async () => {
    for (const [label, inputs] of Object.entries(samples)) { const context = await processDocuments(inputs); runs[label] = { context, index: groundingIndex(context)! }; }
}, 180_000);

/** Arguments that fit each tool on any sample. */
function argsFor(name: string, index: GroundingIndex, ledger: Fact[]): unknown {
    const item = index.context.outputs.resolution?.attention[0]?.id ?? 'none', row = index.context.outputs.anomalies[0]?.row.rowId ?? 'none';
    const money = ledger.flatMap(f => Object.entries(f.fields).filter(([, v]) => v.kind === 'MONEY').map(([k]) => `${f.id}.${k}`));
    return ({
        cash_summary: { period: index.scope.period }, transactions: { direction: 'OUT', counterparty: null, sort: 'LARGEST', limit: 5 }, counterparties: { direction: 'IN', limit: 5 },
        monthly_history: {}, reconciliation: { status: 'ALL_EXCEPTIONS' }, anomalies: { severity: 'ANY' }, exceptions: {}, exception_detail: { id: item }, candidate_matches: { id: item, limit: 3 },
        anomaly_detail: { rowId: row }, categories: { limit: 8 }, cash_flow_statement: {}, biggest_changes: { limit: 4 }, cash_plan: {}, confidence: {}, compute: { op: 'sum', refs: money.slice(0, 2) },
    } as Record<string, unknown>)[name];
}

describe('the assistant\'s tools on every sample', () => {
    for (const label of Object.keys(samples)) it(`${label}: every tool runs, stays bounded, numbers its facts after the task's and cites records`, () => {
        const { index } = runs[label], ledger: Fact[] = [];
        for (const name of FIN_TOOL_NAMES) {
            const result = runFinTool(index, { name, arguments: argsFor(name, index, ledger) }, ledger);
            const expectsMissing = ((name === 'exception_detail' || name === 'candidate_matches') && !index.context.outputs.resolution?.attention.length) || (name === 'anomaly_detail' && !index.context.outputs.anomalies.length);
            if (expectsMissing) { expect(result.ok, name).toBe(false); continue; }
            expect(result, `${label} ${name}: ${JSON.stringify(result).slice(0, 200)}`).toMatchObject({ ok: true });
            if (!result.ok) continue;
            expect(result.facts.length, name).toBeLessThanOrEqual(MAX_ROWS);
            result.facts.forEach((f, i) => expect(f.id).toBe(`F${ledger.length + i + 1}`));
            for (const f of result.facts) for (const v of Object.values(f.fields)) if (v.kind === 'MONEY') expect(v.cents, `${name} ${f.label}`).toMatch(/^-?\d+$/);
            ledger.push(...result.facts);
        }
        expect(ledger.length).toBeGreaterThan(FIN_TOOL_NAMES.length);
    });

    it('re-exposes the grounded Q&A tools unchanged', () => {
        const { index } = runs.march;
        const mine = runFinTool(index, { name: 'counterparties', arguments: { direction: 'IN', limit: 5 } }, []);
        const theirs = runQueries(index, [{ tool: 'counterparties', direction: 'IN', limit: 5 }]);
        expect(mine.ok && mine.facts.map(f => f.fields)).toEqual(theirs.map(f => f.fields));
    });
    it('tells an unchanged earlier period apart from no earlier period at all', () => {
        const { index } = runs['full year'], k = index.context.outputs.classification!;
        const withPrior = (prior: typeof k.prior): GroundingIndex => ({ ...index, context: { ...index.context, outputs: { ...index.context.outputs, classification: { ...k, prior } } } });
        const status = (i: GroundingIndex) => { const r = runFinTool(i, { name: 'biggest_changes', arguments: { limit: 4 } }, []); return r.ok ? r.facts[0].fields.status : null; };
        expect(status(withPrior({ ...k.current, payeeRule: 'same as now' }))).toEqual({ kind: 'TEXT', text: 'No category changed against the earlier period.' });
        expect(status(withPrior(null))).toEqual({ kind: 'TEXT', text: 'No earlier period of the same length to compare with.' });
    });
    it('agrees with the pages: categories, the cash plan and confidence come from the same functions', () => {
        const { index, context } = runs['full year'], o = context.outputs;
        const cats = runFinTool(index, { name: 'categories', arguments: { limit: 19 } }, []);
        expect(cats.ok && cats.facts[0].fields.categories).toEqual({ kind: 'COUNT', n: o.classification!.current.categories.length });
        const plan = runFinTool(index, { name: 'cash_plan', arguments: {} }, []);
        if (o.cashPlan?.status === 'AVAILABLE') expect(plan.ok && plan.facts[0].fields.net).toEqual({ kind: 'MONEY', cents: toCents(o.cashPlan.projection[0].net).toString(), currency: 'MYR' });
        const conf = runFinTool(index, { name: 'confidence', arguments: {} }, []), c = processingConfidence(context);
        expect(conf.ok && conf.facts[0].fields.percent).toEqual(c.status === 'MEASURED' ? { kind: 'PERCENT', tenths: Math.round(c.percent * 10) } : undefined);
    });
});

describe('exceptions and the records that might settle them', () => {
    it('lists exactly the items no rule explained, with their total', () => {
        const { index, context } = runs['march, one ledger amount wrong'], attention = context.outputs.resolution!.attention;
        expect(attention.length).toBeGreaterThan(0);
        const r = runFinTool(index, { name: 'exceptions', arguments: {} }, []);
        expect(r.ok && r.facts[0].fields.items).toEqual({ kind: 'COUNT', n: attention.length });
        expect(r.ok && r.facts.slice(1).map(f => f.fields.id)).toEqual(attention.map(i => ({ kind: 'TEXT', text: i.id })));
    });
    it('opens one item with its own records, and says plainly when an ID is not in this run', () => {
        const { index, context } = runs['march, one ledger amount wrong'], item = context.outputs.resolution!.attention[0];
        const r = runFinTool(index, { name: 'exception_detail', arguments: { id: item.id } }, []);
        expect(r.ok && r.facts[0].fields.amount).toEqual({ kind: 'MONEY', cents: (toCents(item.effect) < 0n ? -toCents(item.effect) : toCents(item.effect)).toString(), currency: 'MYR' });
        expect(r.ok && r.facts[0].sources).toContainEqual({ kind: 'RECONCILIATION', id: item.id });
        expect(runFinTool(index, { name: 'exception_detail', arguments: { id: 'RX-NOT-HERE' } }, [])).toEqual({ tool: 'exception_detail', ok: false, error: 'No reconciliation item RX-NOT-HERE in this run.' });
    });
    it('ranks leads by a shared reference and the amount together, then days apart, and never offers the item\'s own records', () => {
        const row = (recordId: string, cents: string, date: string, reference: string) => ({ recordId, signedCents: cents, date, reference, description: 'd', sourceId: 's', row: 1, businessId: 'b', currency: 'MYR' });
        const pool = [row('A', '-10000', '2026-03-20', 'INV-829'), row('B', '-10050', '2026-03-05', 'X'), row('C', '-10000', '2026-03-06', 'INV-830'), row('D', '-99999', '2026-03-05', 'INV-829'), row('SELF', '-10000', '2026-03-05', 'INV-829'), row('E', '-50000', '2026-03-05', 'Z')];
        const ranked = rankCandidates({ amount: 10000n, date: '2026-03-05', reference: 'Payment INV-829', exclude: new Set(['SELF']) }, pool as never);
        // A and C: same amount and a shared token (A shares two); D: same invoice, different amount; B: close amount only.
        expect(ranked.map(c => c.record.recordId)).toEqual(['A', 'C', 'D', 'B']);
        expect(ranked[0]).toMatchObject({ amountScore: 3, shared: ['INV', '829'], days: 15 });
    });
    it('accepts the reconciliation layer\'s full item IDs, however many ledger records they join', () => {
        const { index } = runs['march, one ledger amount wrong'], long = `2026-03:BANK-DEMO-0003|${Array.from({ length: 12 }, (_, i) => `GL-DEMO-${String(i).padStart(4, '0')}`).join('|')}`;
        expect(long.length).toBeGreaterThan(80);
        // A valid long ID gets past validation and is looked up (it is not in this run, so the answer says so).
        expect(runFinTool(index, { name: 'exception_detail', arguments: { id: long } }, [])).toEqual({ tool: 'exception_detail', ok: false, error: `No reconciliation item ${long} in this run.` });
    });
    it('offers leads for a real unexplained item, labelled as leads', () => {
        const { index, context } = runs['march, one ledger amount wrong'], item = context.outputs.resolution!.attention[0];
        const r = runFinTool(index, { name: 'candidate_matches', arguments: { id: item.id, limit: 3 } }, []);
        expect(r.ok).toBe(true);
        expect(r.ok && r.facts.length).toBeGreaterThan(0);
        if (r.ok) for (const f of r.facts) { expect(f.label).toMatch(/a lead, not confirmed/); for (const own of [item.bankRecordId, ...item.ledgerRecordIds]) expect(f.sources.map(s => s.id)).not.toContain(own); }
        // The bank payout the wrong ledger amount belongs to (its own reference differs) is the first lead: within 5%, same day.
        expect(r.ok && r.facts[0].fields).toMatchObject({ recordId: { text: 'BANK-DEMO-0003' }, side: { text: 'Bank statement' }, amountMatch: { text: 'within 5%' }, daysApart: { n: 0 } });
    });
});

describe('compute: the only way to derive a figure', () => {
    const fact = (id: string, fields: Fact['fields']): Fact => ({ id, label: id, primary: Object.keys(fields)[0], fields, sources: [{ kind: 'TOTALS', id }], query: 0 });
    const ledger = [fact('F1', { net: { kind: 'MONEY', cents: '15000', currency: 'MYR' }, n: { kind: 'COUNT', n: 3 } }), fact('F2', { net: { kind: 'MONEY', cents: '10000', currency: 'MYR' } }), fact('F3', { net: { kind: 'MONEY', cents: '500', currency: 'SGD' } })];
    const run = (op: string, refs: string[]) => runFinTool(runs.march.index, { name: 'compute', arguments: { op, refs } }, ledger);
    it('sums, subtracts and takes percentages in exact cents, citing the facts it used', () => {
        expect(run('sum', ['F1.net', 'F2.net'])).toMatchObject({ ok: true, facts: [{ id: 'F4', fields: { result: { kind: 'MONEY', cents: '25000' } }, sources: [{ id: 'F1' }, { id: 'F2' }] }] });
        expect(run('difference', ['F1.net', 'F2.net'])).toMatchObject({ facts: [{ fields: { result: { cents: '5000' } } }] });
        expect(run('percent_change', ['F1.net', 'F2.net'])).toMatchObject({ facts: [{ fields: { result: { kind: 'PERCENT', tenths: 500 } } }] });
        expect(run('share', ['F2.net', 'F1.net'])).toMatchObject({ facts: [{ fields: { result: { kind: 'PERCENT', tenths: 667 } } }] });
        expect([tenthsOf(1n, 3n), tenthsOf(-1n, 3n), tenthsOf(2n, 3n), tenthsOf(1n, 0n)]).toEqual([333, -333, 667, null]);
    });
    it('refuses anything not an amount in this task, mixed currencies, or the wrong number of amounts', () => {
        expect(run('sum', ['F1.n', 'F2.net'])).toMatchObject({ ok: false, error: 'F1.n is not an amount.' });
        expect(run('sum', ['F9.net', 'F2.net'])).toMatchObject({ ok: false, error: 'F9.net is not a fact field from this task.' });
        expect(run('sum', ['F1.net', 'F3.net'])).toMatchObject({ ok: false, error: 'Those amounts are in different currencies.' });
        expect(run('difference', ['F1.net', 'F2.net', 'F1.net'])).toMatchObject({ ok: false });
        expect(run('sum', ['1500.00', 'F2.net'])).toMatchObject({ ok: false });
    });
});

describe('guard rails', () => {
    it('returns a readable error for an unknown tool or bad arguments, never an exception', () => {
        const { index } = runs.march;
        expect(runFinTool(index, { name: 'apply_entry', arguments: {} }, [])).toEqual({ tool: 'apply_entry', ok: false, error: 'There is no tool called apply_entry.' });
        expect(runFinTool(index, { name: 'transactions', arguments: { direction: 'SIDEWAYS' } }, [])).toMatchObject({ ok: false });
        expect(runFinTool(index, { name: 'cash_summary', arguments: { period: '1999-01' } }, [])).toMatchObject({ ok: false, error: expect.stringContaining('not in this run') });
        expect(runFinTool(index, { name: 'categories', arguments: { limit: 8, sneaky: true } }, [])).toMatchObject({ ok: false });
        for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) expect(runFinTool(index, { name, arguments: {} }, []), name).toEqual({ tool: name, ok: false, error: `There is no tool called ${name}.` });
    });
    it('says when a wrapped list was bounded, with the full count of what matched', () => {
        const { index } = runs['full year'];
        const tx = runFinTool(index, { name: 'transactions', arguments: { direction: 'ANY', counterparty: null, sort: 'LARGEST', limit: 3 } }, []);
        expect(tx).toMatchObject({ ok: true, truncated: true });
        if (tx.ok) { expect(tx.facts).toHaveLength(4); expect(tx.total).toBe((tx.facts[0].fields.matching as { n: number }).n + 1); }
        const cp = runFinTool(index, { name: 'counterparties', arguments: { direction: 'ANY', limit: 2 } }, []);
        expect(cp).toMatchObject({ ok: true, truncated: true });
        if (cp.ok) expect(cp.total).toBe(new Set(index.rows.map(r => r.counterparty)).size);
        expect(runFinTool(index, { name: 'cash_summary', arguments: { period: index.scope.period } }, [])).toMatchObject({ ok: true, truncated: false });
    });
    it('has only read and compute tools: nothing can apply, write or propose yet', () => {
        expect(new Set(Object.values(FIN_TOOLS).map(t => t.tier))).toEqual(new Set(['READ', 'COMPUTE']));
        for (const name of FIN_TOOL_NAMES) expect(name, name).not.toMatch(/apply|write|post|delete|propose|update/);
    });
    it('marks the fields holding document text, so the prompt can quote them as data', () => {
        const { index } = runs['march, one ledger amount wrong'], descriptions = new Set(index.rows.map(r => r.description));
        for (const name of ['transactions', 'exceptions', 'anomalies'] as const) {
            const r = runFinTool(index, { name, arguments: argsFor(name, index, []) }, []);
            if (r.ok) for (const f of r.facts) for (const [k, v] of Object.entries(f.fields)) if (v.kind === 'TEXT' && descriptions.has(v.text) && v.text.length > 12) expect(UNTRUSTED_FIELDS.has(k), `${name}.${k}`).toBe(true);
        }
    });
    it('describes every tool\'s arguments as JSON Schema for the provider', () => {
        for (const name of FIN_TOOL_NAMES) expect(() => z.toJSONSchema(FIN_TOOLS[name].args), name).not.toThrow();
    });
});
