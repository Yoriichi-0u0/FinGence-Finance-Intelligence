import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity } from '../../lib/server/ai-ingestion/m2/identity';
import { provisionM3Account } from '../../lib/server/financial-m3/management';
import { installReconciliationSchema, createReconciliationService } from '../../lib/server/poc-reconciliation/service';
import { installPocAnomalySchema } from '../../lib/server/poc-anomalies/schema';
import { createPocAnomalies } from '../../lib/server/poc-anomalies/service';
import { createPocFinanceQa } from '../../lib/server/poc-finance-qa/service';
import { acceptNarration, narrationRequest, templateNarrator } from '../../lib/poc-finance-qa/narration';
import { m5Database, password } from '../tenant-admin-m5/support';

/** The issue #46 demo journeys on the owner-unpacked synthetic pack (never committed). Feature files only.
 * Each question recomputes facts over the 6,000-row file, so a journey can take several seconds under a full serial run. */
const candidates = [process.env.FINGENCE_POC_DATASET_DIR, '../../datasets/poc-2026-03', '.local/datasets/poc-2026-03'].filter(Boolean) as string[];
const directory = candidates.find(d => existsSync(join(d, 'source_transactions_6000.csv')) && existsSync(join(d, 'demo_general_ledger_mar2026.csv')));
let pg: PGlite, db: TransactionDatabase, finance: string, march: string, full: string;
const value = (facts: { id: string; value: string }[], id: string) => facts.find(f => f.id === id)?.value;

describe.skipIf(!directory)('Finance questions on the supplied March and full-year sources', () => {
    beforeAll(async () => {
        ({ pg, db } = await m5Database()); await installReconciliationSchema(db); await installPocAnomalySchema(db);
        await provisionM3Account(db, { email: 'finance@qa-ref.invalid', password, role: 'Finance', organizationName: 'qa-ref' });
        finance = (await createM2Identity(db).login('finance@qa-ref.invalid', password)).token;
        const bank = readFileSync(join(directory!, 'demo_bank_statement_mar2026.csv')), ledger = readFileSync(join(directory!, 'demo_general_ledger_mar2026.csv'));
        await createReconciliationService(db).ingest(finance, bank, ledger, 'demo_bank_statement_mar2026.csv', 'demo_general_ledger_mar2026.csv');
        const anomalies = createPocAnomalies(db), a = await anomalies.upload(finance, 'demo_bank_statement_mar2026.csv', bank), b = await anomalies.upload(finance, 'source_transactions_6000.csv', readFileSync(join(directory!, 'source_transactions_6000.csv')));
        if (a.status !== 'STORED' || b.status !== 'STORED') throw Error('upload failed');
        march = a.sourceId; full = b.sourceId;
    }, 120000);
    afterAll(async () => { await pg?.close(); });
    const ask = async (selection: { source: string; business?: string; period?: string }, question: string) => {
        const r = await createPocFinanceQa(db).ask(finance, selection, question); if (r.status !== 'OK') throw Error('refused');
        // Every real answer must also pass the future narration contract unchanged: no figure outside its facts.
        const request = narrationRequest(r.answer);
        if (request) expect(acceptNarration(r.answer, await templateNarrator.narrate(request), 'DETERMINISTIC_TEMPLATE').accepted).toBe(true);
        return r.answer;
    };

    it('journey A: March bank and ledger', async () => {
        const s = () => ({ source: march });
        const cash = await ask(s(), 'How much cash movement was recorded?');
        expect(cash.selection).toMatchObject({ businessId: 'BUS-001', period: '2026-03', currency: 'MYR' });
        expect(cash.headline).toBe('Net signed bank cash movement for BUS-001 · 2026-03 is MYR 102,950.56.');
        expect((await ask(s(), 'How many source records, credits and debits are there?')).headline).toBe('175 source records for BUS-001 · 2026-03: 60 credits totalling MYR 230,966.35 and 115 debits totalling MYR -128,015.79.');
        const diff = await ask(s(), 'What is the bank-versus-ledger difference?');
        expect(diff.headline).toBe('Bank minus ledger for BUS-001 · 2026-03 is MYR 2,516.06 (bank MYR 102,950.56, ledger MYR 100,434.50).');
        expect(['MATCH_EXACT', 'MATCH_DATE_SHIFT', 'BANK_ONLY', 'LEDGER_ONLY', 'AMOUNT_MISMATCH_REVIEW', 'AMBIGUOUS_DUPLICATE_LEDGER', 'REFERENCE_MISMATCH_REVIEW'].map(k => value(diff.facts, `count.${k}`))).toEqual(['151', '6', '7', '6', '4', '3', '4']);
        expect((await ask(s(), 'How many transactions were matched?')).headline).toBe('157 of 175 bank records matched a ledger entry: 151 exact and 6 date shift.');
        expect((await ask(s(), 'Which transactions require review?')).headline).toBe('24 reconciliation outcomes and 14 open anomaly review candidates need review for BUS-001 · 2026-03.');
        expect((await ask(s(), 'How many anomalies were identified?')).headline).toMatch(/^14 of 175 source records for BUS-001 · 2026-03 are anomaly review candidates/);
        expect((await ask(s(), 'How many months of history are observed?')).headline).toBe('1 observed month for BUS-001 (MYR): 2026-03.');
        expect(await ask(s(), 'What is the next-month cash-movement forecast?')).toMatchObject({ status: 'UNAVAILABLE', code: 'FORECAST_UNAVAILABLE', facts: [] });
        expect(await ask(s(), 'What is net profit?')).toMatchObject({ status: 'REFUSED', code: 'UNSUPPORTED_METRIC', facts: [] });
    }, 60000);
    it('journey B: full 6,000-row source never inherits the March reconciliation', async () => {
        const s = () => ({ source: full, business: 'BUS-001', period: '2026-03' });
        expect((await ask(s(), 'How much cash movement was recorded?')).headline).toBe('Net signed bank cash movement for BUS-001 · 2026-03 is MYR 102,950.56.');
        expect((await ask(s(), 'How many anomalies were identified?')).headline).toMatch(/^9 of 175 source records/);
        expect(await ask(s(), 'What is the bank-versus-ledger difference?')).toMatchObject({ status: 'UNAVAILABLE', code: 'RECONCILIATION_UNAVAILABLE', facts: [] });
        expect((await ask(s(), 'How many months of history are observed?')).headline).toBe('12 consecutive observed months for BUS-001 (MYR), 2025-09 to 2026-08.');
        const f = await ask(s(), 'What is the next-month statistical cash-movement forecast?');
        expect(f.headline).toBe('Six-month baseline for BUS-001 in 2026-09: receipts MYR 205,774.83, payments MYR 129,113.73, derived net MYR 76,661.10.');
        expect(['wape.receipts', 'wape.payments', 'wape.net', 'pooled.net.mean6', 'pooled.net.last'].map(id => value(f.facts, id))).toEqual(['10.22', '9.54', '31.10', '52.85', '46.90']);
        expect(f.interpretation).toContain('net is experimental and low confidence');
        expect(f.interpretation).toContain('Pooled across 3 businesses, net WAPE is 52.85%, worse than simply repeating last month (46.90%).');
        expect((await ask({ source: full, business: 'BUS-001', period: '2026-03' }, 'Cash movement for BUS-002?')).code).toBe('SELECTION_MISMATCH');
    }, 60000);
});
