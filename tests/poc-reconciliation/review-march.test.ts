import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity } from '../../lib/server/ai-ingestion/m2/identity';
import { provisionM3Account } from '../../lib/server/financial-m3/management';
import { createReconciliationService, installReconciliationSchema } from '../../lib/server/poc-reconciliation/service';
import { createReconciliationReviews } from '../../lib/server/poc-reconciliation/reviews';
import { m5Database, password } from '../tenant-admin-m5/support';
const directory = process.env.FINGENCE_POC_DATASET_DIR;
describe.skipIf(!directory || !existsSync(join(directory, 'demo_bank_statement_mar2026.csv')))('original March financial snapshot with separate human review decisions', () => {
    let pg: PGlite, db: TransactionDatabase, token: string;
    beforeAll(async () => {
        ({ pg, db } = await m5Database()); await installReconciliationSchema(db);
        await provisionM3Account(db, { email: 'march@review.invalid', password, role: 'Finance', organizationName: 'Synthetic March review test' });
        token = (await createM2Identity(db).login('march@review.invalid', password)).token;
    }, 60000);
    afterAll(async () => { await pg?.close(); });
    it('annotates amount mismatch and duplicate ambiguity without changing 181 outcomes, source evidence or MYR 2516.06 discrepancy', async () => {
        const base = createReconciliationService(db), reviews = createReconciliationReviews(db);
        const original = await base.ingest(token, readFileSync(join(directory!, 'demo_bank_statement_mar2026.csv')), readFileSync(join(directory!, 'demo_general_ledger_mar2026.csv')), 'bank.csv', 'ledger.csv');
        const before = await base.get(token, original.id, true), view = await reviews.get(token, original.id);
        if (view.status !== 'OK') throw Error('review unavailable');
        expect(view.aggregate.eligible).toBe(24); expect(view.aggregate.states.OPEN).toBe(24);
        for (const [status, state] of [['AMOUNT_MISMATCH_REVIEW', 'EXPLAINED'], ['AMBIGUOUS_DUPLICATE_LEDGER', 'ESCALATED']] as const) {
            const outcome = view.outcomes.find(o => o.status === status)!;
            expect((await reviews.review(token, { reconciliationId: original.id, outcomeKey: outcome.key, state, rationale: 'Synthetic evidence annotated; original discrepancy remains uncleared.', expectedVersion: 0 })).status).toBe('REVIEWED');
        }
        const after = await base.get(token, original.id, true), saved = await reviews.get(token, original.id);
        expect(JSON.stringify(after)).toBe(JSON.stringify(before));
        expect(after.cashMovement).toEqual({ bank: '102950.56', ledger: '100434.50', signedDifference: '2516.06' });
        expect(after.rows.bank).toHaveLength(175); expect(after.rows.ledger).toHaveLength(177); expect(after.results).toHaveLength(181);
        expect(Object.values(after.counts)).toEqual(Object.values(before.counts));
        if (saved.status !== 'OK') throw Error('review unavailable');
        expect(saved.aggregate.states).toEqual({ OPEN: 22, INVESTIGATING: 0, EXPLAINED: 1, ESCALATED: 1 });
        expect(saved.outcomes.filter(o => o.review.version === 1)).toHaveLength(2);
    });
});
