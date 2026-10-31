import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity } from '../../lib/server/ai-ingestion/m2/identity';
import { provisionM3Account, resolveM3Principal } from '../../lib/server/financial-m3/management';
import { createReconciliationService, installReconciliationSchema } from '../../lib/server/poc-reconciliation/service';
import { createReconciliationReviews, reconciliationOutcomeKey, readReconciliationReviewAggregate } from '../../lib/server/poc-reconciliation/reviews';
import { reviewInput } from '../../lib/poc-reconciliation/reviews';
import type { FinancePoCReconciliationV1 } from '../../lib/poc-reconciliation/contracts';
import { m5Database, failingAudit, password } from '../tenant-admin-m5/support';
import { bank, ledger, csv } from './fixtures';

let pg: PGlite, db: TransactionDatabase, finance: string, colleague: string, other: string, tech: string, admin: string, revoked: string;
let id: string, original: FinancePoCReconciliationV1;
const b = csv([bank, { ...bank, BankTransactionID: 'BANK-DUP', BankReference: 'DUP-REF', BankAmountMYR: '50.00', SignedCashMovementMYR: '50.00' }, { ...bank, BankTransactionID: 'BANK-EXACT', BankReference: 'EXACT-REF' }]);
const l = csv([{ ...ledger, CashAccountDebitMYR: '6380.52', SignedCashMovementMYR: '6380.52' }, ...['GL-DUP-A', 'GL-DUP-B'].map(LedgerEntryID => ({ ...ledger, LedgerEntryID, LedgerReference: 'DUP-REF', CashAccountDebitMYR: '50.00', SignedCashMovementMYR: '50.00' })), { ...ledger, LedgerEntryID: 'GL-EXACT', LedgerReference: 'EXACT-REF' }]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
beforeAll(async () => {
    ({ pg, db } = await m5Database()); await installReconciliationSchema(db);
    for (const [name, role] of [['finance', 'Finance'], ['other', 'Finance'], ['tech', 'Technical (Management)'], ['admin', 'Admin']] as const)
        await provisionM3Account(db, { email: `${name}@review.invalid`, password, role, organizationName: name });
    const auth = createM2Identity(db), login = async (name: string) => (await auth.login(`${name}@review.invalid`, password)).token;
    [finance, other, tech, admin] = await Promise.all(['finance', 'other', 'tech', 'admin'].map(login));
    const p = await db.transaction(tx => resolveM3Principal(tx, finance));
    const invited = await provisionM3Account(db, { email: 'colleague@review.invalid', password, role: 'Finance', organizationId: p.organization_id });
    // Fixture-only activation; runtime existing-org enrollment stays Admin-controlled and inactive by default.
    await pg.query('UPDATE fingence_m2.memberships SET active=true WHERE user_id=$1', [invited.userId]);
    colleague = await login('colleague'); revoked = await login('finance'); await auth.logout(revoked);
    const result = await createReconciliationService(db, { bank: hash(b), ledger: hash(l) }).ingest(finance, b, l, 'bank.csv', 'ledger.csv');
    id = result.id; original = result.snapshot;
}, 60000);
afterAll(async () => { await pg?.close(); });

describe('separate, durable Finance exception annotations', () => {
    it('derives stable keys from the saved source pair/status/record identities, independent of ledger order', () => {
        const r = original.results.find(r => r.status === 'AMBIGUOUS_DUPLICATE_LEDGER')!;
        expect(r).toBeDefined();
        expect(reconciliationOutcomeKey(original, r)).toBe(reconciliationOutcomeKey(original, { ...r, ledgerRecordIds: [...r.ledgerRecordIds].reverse() }));
        expect(reconciliationOutcomeKey(original, r)).not.toBe(reconciliationOutcomeKey({ ...original, sources: { ...original.sources, bank: { ...original.sources.bank, sha256: '0'.repeat(64) } } }, r));
    });
    it('requires explanations, rejects invented clearing states, authority and source claims', () => {
        const valid = { reconciliationId: id, outcomeKey: 'a'.repeat(64), state: 'EXPLAINED', rationale: 'Source-supported timing explanation.', expectedVersion: 0 };
        expect(reviewInput.parse(valid).state).toBe('EXPLAINED');
        for (const v of [{ state: 'MATCHED' }, { rationale: '  ' }, { rationale: 'x'.repeat(601) }, { expectedVersion: -1 }, { organizationId: randomUUID() }, { bankSha256: '0'.repeat(64) }, { signedDifference: '0.00' }])
            expect(reviewInput.safeParse({ ...valid, ...v }).success).toBe(false);
        expect(reviewInput.safeParse({ ...valid, state: 'OPEN', rationale: '' }).success).toBe(true);
    });
    it('records decisions once, preserves history and survives another Finance session in the same organization', async () => {
        const service = createReconciliationReviews(db), before = await service.get(finance, id);
        if (before.status !== 'OK') throw Error('read failed');
        expect(before.aggregate).toMatchObject({ eligible: 2, states: { OPEN: 2, INVESTIGATING: 0, EXPLAINED: 0, ESCALATED: 0 } });
        const amount = before.outcomes.find(o => o.status === 'AMOUNT_MISMATCH_REVIEW')!;
        const input = { reconciliationId: id, outcomeKey: amount.key, state: 'EXPLAINED' as const, rationale: 'One-cent discrepancy explained; source posting remains unchanged.', expectedVersion: 0 };
        const saved = await service.review(finance, input); expect(saved.status).toBe('REVIEWED');
        expect(await service.review(finance, input)).toEqual({ status: 'REFUSED', code: 'STALE_REVIEW' });
        const read = await createReconciliationReviews(db).get(colleague, id);
        if (read.status !== 'OK') throw Error('read failed');
        const reviewed = read.outcomes.find(o => o.key === amount.key)!;
        expect(reviewed.review).toMatchObject({ state: 'EXPLAINED', rationale: input.rationale, version: 1 });
        expect(reviewed.review.reviewerId).toBe(before.scope.userId); expect(reviewed.review.decidedAt).not.toBeNull();
        expect(reviewed.history).toHaveLength(1);
        await service.review(colleague, { ...input, state: 'INVESTIGATING', rationale: 'Reopened for investigation by another Finance member.', expectedVersion: 1 });
        const again = await service.get(finance, id); if (again.status !== 'OK') throw Error('read failed');
        const history = again.outcomes.find(o => o.key === amount.key)!.history;
        expect(history.map(h => h.version)).toEqual([2, 1]); expect(history[0].reviewerId).toBe(read.scope.userId);
        expect(history[1].rationale).toBe(input.rationale);
    });
    it('keeps ambiguous duplicates uncleared and all original financial JSON byte-equivalent', async () => {
        const service = createReconciliationReviews(db), view = await service.get(finance, id); if (view.status !== 'OK') throw Error('read failed');
        const duplicate = view.outcomes.find(o => o.status === 'AMBIGUOUS_DUPLICATE_LEDGER')!;
        expect((await service.review(finance, { reconciliationId: id, outcomeKey: duplicate.key, state: 'ESCALATED', rationale: 'Two ledger candidates need investigation; neither is cleared.', expectedVersion: 0 })).status).toBe('REVIEWED');
        expect(await createReconciliationService(db).get(finance, id)).toEqual(original);
        expect(await createReconciliationService(db).get(finance, id, true)).toEqual(original);
        const aggregate = await db.transaction(async tx => readReconciliationReviewAggregate(tx, await resolveM3Principal(tx, finance), id));
        expect(aggregate).toMatchObject({ eligible: 2, states: { OPEN: 0, INVESTIGATING: 1, EXPLAINED: 0, ESCALATED: 1 } });
        expect(original.counts.AMBIGUOUS_DUPLICATE_LEDGER).toBe(1);
    });
    it('rejects wrong roles/tenant, revoked credentials, invalid keys, tampered claims and absent records', async () => {
        const service = createReconciliationReviews(db);
        for (const t of [other, tech, admin]) expect(await service.get(t, id)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        await expect(service.get(revoked, id)).rejects.toThrow('ACCESS_DENIED');
        await expect(service.get('invalid', id)).rejects.toThrow('ACCESS_DENIED');
        expect(await service.get(finance, randomUUID())).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const input = { reconciliationId: id, outcomeKey: 'f'.repeat(64), state: 'EXPLAINED' as const, rationale: 'Not an existing source outcome.', expectedVersion: 0 };
        expect(await service.review(finance, input)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const exact = original.results.find(r => r.status === 'MATCH_EXACT')!;
        expect(exact).toBeDefined();
        expect(await service.review(finance, { ...input, outcomeKey: reconciliationOutcomeKey(original, exact) })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        for (const t of [other, tech, admin]) expect(await service.review(t, input)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        await expect(service.review(finance, { ...input, bankSha256: '0'.repeat(64) } as never)).rejects.toThrow();
        const corrupt: TransactionDatabase = { close: db.close, transaction: work => db.transaction(tx => work({ query: async (sql, args) => {
            const r = await tx.query(sql, args);
            if (sql.includes('SELECT snapshot,bank_sha256')) return { ...r, rows: r.rows.map(row => ({ ...row as object, bank_sha256: '0'.repeat(64) })) } as never;
            return r as never;
        } })) };
        expect(await createReconciliationReviews(corrupt).get(finance, id)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
    });
    it('rolls back a decision if its content-free durable audit cannot commit', async () => {
        const service = createReconciliationReviews(db), view = await service.get(finance, id); if (view.status !== 'OK') throw Error('read failed');
        const current = view.outcomes[0];
        await expect(createReconciliationReviews(failingAudit(db)).review(finance, { reconciliationId: id, outcomeKey: current.key, state: 'EXPLAINED', rationale: 'AUDIT_PAYLOAD_MUST_NOT_APPEAR', expectedVersion: current.review.version })).rejects.toThrow('audit failure');
        const read = await service.get(finance, id); if (read.status !== 'OK') throw Error('read failed');
        expect(read.outcomes[0].review.version).toBe(current.review.version);
        const audits = (await pg.query<{ outcome: string }>("SELECT * FROM security_audit_events WHERE action='reconciliation.reviewed'")).rows;
        expect(audits.filter(a => a.outcome === 'success')).toHaveLength(3);
        expect(JSON.stringify(audits)).not.toContain('One-cent'); expect(JSON.stringify(audits)).not.toContain('AUDIT_PAYLOAD');
    });
    it('installs additively and denies direct anon/authenticated review-table access', async () => {
        await installReconciliationSchema(db);
        expect((await pg.query('SELECT count(*)::int AS n FROM fingence_poc.reconciliation_reviews')).rows[0]).toEqual({ n: 3 });
        for (const role of ['anon', 'authenticated']) {
            await pg.exec(`SET ROLE ${role}`);
            try { await expect(pg.query('SELECT * FROM fingence_poc.reconciliation_reviews')).rejects.toThrow(); }
            finally { await pg.exec('RESET ROLE'); }
        }
    });
});
