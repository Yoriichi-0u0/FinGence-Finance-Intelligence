import { describe, expect, it } from 'vitest';
import { processDocuments } from '../../lib/demo/pipeline';
import { doc, phase1 } from './fixtures';
import { catalogue, groundingIndex, runQueries } from '../../lib/grounded-qa/tools';
import { formatValue, modelView } from '../../lib/grounded-qa/facts';
import { catalogueSchema, toolCallSchema } from '../../lib/grounded-qa/contracts';

const show = (f: { fields: Record<string, Parameters<typeof formatValue>[0]> }, field: string) => formatValue(f.fields[field]);

describe('grounding index and catalogue', () => {
    it('describe only scope and allowed filter values, never amounts or records', async () => {
        const index = groundingIndex(await phase1())!, cat = catalogue(index);
        expect(catalogueSchema.safeParse(cat).success).toBe(true);
        expect(cat.scope).toEqual({ businessId: 'DEMO-001', businessName: 'Rimba Demo Kitchen (Synthetic)', period: '2026-03', currency: 'MYR' });
        expect(cat.months).toHaveLength(12);
        expect(cat.counterparties).toContain('Borneo Fresh Supplies');
        expect(cat.reconciliationStatuses).toEqual(['ALL_EXCEPTIONS', 'MATCH_EXACT', 'MATCH_DATE_SHIFT', 'BANK_ONLY', 'LEDGER_ONLY', 'AMOUNT_MISMATCH_REVIEW', 'AMBIGUOUS_DUPLICATE_LEDGER', 'REFERENCE_MISMATCH_REVIEW']);
        const serialized = JSON.stringify(cat);
        expect(serialized).not.toMatch(/\d+\.\d{2}/); // no amounts
        expect(serialized).not.toMatch(/BANK-DEMO|GL-DEMO|\d{4}-\d{2}-\d{2}/); // no records or dates
    });
    it('is unavailable for a quarantined processing', async () => {
        const c = await processDocuments([doc('demo-bank-statement-2026-03.csv')]);
        expect(c.status).toBe('QUARANTINED');
        expect(groundingIndex(c)).toBeNull();
    });
    it('only accepts catalogue members as filter values', async () => {
        const cat = catalogue(groundingIndex(await phase1())!), schema = toolCallSchema(cat);
        expect(schema.safeParse({ tool: 'transactions', direction: 'OUT', counterparty: 'Borneo Fresh Supplies', sort: 'LARGEST', limit: 3 }).success).toBe(true);
        expect(schema.safeParse({ tool: 'transactions', direction: 'OUT', counterparty: 'Invented Supplier Sdn Bhd', sort: 'LARGEST', limit: 3 }).success).toBe(false);
        expect(schema.safeParse({ tool: 'cash_summary', period: '2024-01' }).success).toBe(false);
        expect(schema.safeParse({ tool: 'transactions', direction: 'OUT', counterparty: null, sort: 'LARGEST', limit: 50 }).success).toBe(false);
    });
});

describe('tools reproduce the verified Phase 1 figures', () => {
    it('cash summary and reconciliation equal the published figures', async () => {
        const index = groundingIndex(await phase1())!;
        const [summary, rec] = runQueries(index, [{ tool: 'cash_summary', period: '2026-03' }, { tool: 'reconciliation', status: 'ALL_EXCEPTIONS' }]);
        expect([show(summary, 'moneyIn'), show(summary, 'moneyOut'), show(summary, 'net'), show(summary, 'transactions')]).toEqual(['MYR 68,633.32', 'MYR 40,401.31', 'MYR 28,232.01', '57']);
        expect([show(rec, 'difference'), show(rec, 'matched'), show(rec, 'exceptions'), show(rec, 'bankOnly'), show(rec, 'ledgerOnly')]).toEqual(['−MYR 2,692.92', '50', '9', '3', '2']);
    });
    it('the forecast and monthly history equal the forecast page', async () => {
        const index = groundingIndex(await phase1())!, [f] = runQueries(index, [{ tool: 'forecast' }]);
        expect([show(f, 'period'), show(f, 'net'), show(f, 'basisMonths')]).toEqual(['April 2026', 'MYR 35,446.45', '6']);
        expect(runQueries(index, [{ tool: 'monthly_history' }])).toHaveLength(12);
    });
    it('transaction and counterparty queries agree with an independent recomputation from the rows', async () => {
        const index = groundingIndex(await phase1())!, rows = index.rows;
        const out = rows.filter(r => r.signedAmount.startsWith('-')).map(r => ({ id: r.rowId, cents: Math.round(-Number(r.signedAmount) * 100), cp: r.counterparty }));
        const largest = [...out].sort((a, b) => b.cents - a.cents)[0];
        const [all, top] = runQueries(index, [{ tool: 'transactions', direction: 'OUT', counterparty: null, sort: 'LARGEST', limit: 1 }]);
        expect(show(all, 'matching')).toBe(String(out.length));
        expect(top.sources).toEqual([{ kind: 'BANK_ROW', id: largest.id }]);
        expect(show(top, 'id')).toBe(largest.id);
        const byCp = new Map<string, number>(); for (const r of out) byCp.set(r.cp, (byCp.get(r.cp) ?? 0) + r.cents);
        const [first] = runQueries(index, [{ tool: 'counterparties', direction: 'OUT', limit: 3 }]);
        const expected = [...byCp].sort((a, b) => b[1] - a[1])[0];
        expect(show(first, 'name')).toBe(expected[0]);
        expect(first.fields.total).toEqual({ kind: 'MONEY', cents: String(expected[1]), currency: 'MYR' });
        expect(first.sources.length).toBe(out.filter(r => r.cp === expected[0]).length);
    });
    it('filters by an exact counterparty and keeps every source record', async () => {
        const index = groundingIndex(await phase1())!;
        const [summary, ...listed] = runQueries(index, [{ tool: 'transactions', direction: 'IN', counterparty: 'GrabFood Marketplace Payout', sort: 'EARLIEST', limit: 8 }]);
        const rows = index.rows.filter(r => r.counterparty === 'GrabFood Marketplace Payout');
        expect(show(summary, 'matching')).toBe(String(rows.length));
        expect(summary.sources.map(s => s.id).sort()).toEqual(rows.map(r => r.rowId).sort());
        expect(listed.map(f => show(f, 'date'))).toEqual([...rows].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8).map(r => show({ fields: { d: { kind: 'DATE', iso: r.date } } }, 'd')));
    });
    it('anomaly facts carry the detector rationale and the non-finding note', async () => {
        const index = groundingIndex(await phase1())!, [summary, first] = runQueries(index, [{ tool: 'anomalies', severity: 'ANY' }]);
        expect(show(summary, 'candidates')).toBe('6');
        expect(show(summary, 'note')).toMatch(/never a finding of error or fraud/);
        expect(show(first, 'rationale')).toMatch(/robust deviations/);
    });
    it('numbers facts across queries, caps them and shows the model labels and formatted values only', async () => {
        const index = groundingIndex(await phase1())!;
        const facts = runQueries(index, [{ tool: 'monthly_history' }, { tool: 'transactions', direction: 'ANY', counterparty: null, sort: 'LATEST', limit: 8 }, { tool: 'anomalies', severity: 'ANY' }, { tool: 'reconciliation', status: 'ALL_EXCEPTIONS' }]);
        expect(facts.length).toBeLessThanOrEqual(48);
        expect(facts.map(f => f.id)).toEqual(facts.map((_, i) => `F${i + 1}`));
        const view = JSON.stringify(modelView(facts));
        expect(view).not.toContain('"sources"');
        expect(view).not.toContain('"cents"');
    });
    it('is deterministic', async () => {
        const a = runQueries(groundingIndex(await phase1())!, [{ tool: 'counterparties', direction: 'ANY', limit: 10 }]);
        const b = runQueries(groundingIndex(await phase1())!, [{ tool: 'counterparties', direction: 'ANY', limit: 10 }]);
        expect(b).toEqual(a);
    });
});
