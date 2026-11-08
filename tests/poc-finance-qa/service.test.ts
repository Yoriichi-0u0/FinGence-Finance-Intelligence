import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity, tokenHash } from '../../lib/server/ai-ingestion/m2/identity';
import { provisionM3Account } from '../../lib/server/financial-m3/management';
import { installReconciliationSchema, createReconciliationService } from '../../lib/server/poc-reconciliation/service';
import { installPocAnomalySchema } from '../../lib/server/poc-anomalies/schema';
import { createPocAnomalies } from '../../lib/server/poc-anomalies/service';
import { createPocFinanceQa } from '../../lib/server/poc-finance-qa/service';
import { m5Database, failingAudit, password } from '../tenant-admin-m5/support';
import { bank, ledger, csv } from '../poc-reconciliation/fixtures';

let pg: PGlite, db: TransactionDatabase, finance: string, other: string, technical: string, admin: string, source: string, copy: string;
const bankBytes = csv([bank]), ledgerBytes = csv([ledger]), sha = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const ask = (token: string, question: string, selection: { source: string; business?: string; period?: string; currency?: string } = { source }) => createPocFinanceQa(db).ask(token, selection, question);
const answered = async (token: string, question: string, selection?: { source: string }) => { const r = await ask(token, question, selection); if (r.status !== 'OK') throw Error('refused'); return r; };
beforeAll(async () => {
    ({ pg, db } = await m5Database()); await installReconciliationSchema(db); await installPocAnomalySchema(db);
    for (const [name, role] of [['finance', 'Finance'], ['other', 'Finance'], ['technical', 'Technical (Management)'], ['admin', 'Admin']] as const)
        await provisionM3Account(db, { email: `${name}@qa.invalid`, password, role, organizationName: name });
    const login = async (n: string) => (await createM2Identity(db).login(`${n}@qa.invalid`, password)).token;
    [finance, other, technical, admin] = await Promise.all(['finance', 'other', 'technical', 'admin'].map(login));
    await createReconciliationService(db, { bank: sha(bankBytes), ledger: sha(ledgerBytes) }).ingest(finance, bankBytes, ledgerBytes, 'bank.csv', 'ledger.csv');
    const anomalies = createPocAnomalies(db);
    const a = await anomalies.upload(finance, 'bank.csv', bankBytes), b = await anomalies.upload(finance, 'copy.csv', Buffer.concat([bankBytes, Buffer.from('\n')]));
    if (a.status !== 'STORED' || b.status !== 'STORED') throw Error('upload failed');
    source = a.sourceId; copy = b.sourceId;
}, 60000);
afterAll(async () => { await pg?.close(); });

describe('Finance questions over persisted PoC sources', () => {
    it('answers from the server-resolved selection and the reconciliation bound to the exact bank SHA, with a committed audit', async () => {
        const r = await answered(finance, 'What is the bank-versus-ledger difference?');
        expect(r.selection).toMatchObject({ sourceId: source, sha256: sha(bankBytes), businessId: 'BUS-001', period: '2026-03', currency: 'MYR' });
        expect(r.answer).toMatchObject({ status: 'ANSWERED', answerOrigin: 'DETERMINISTIC_VERIFIED_SOURCE', liveModel: false, intent: 'RECONCILIATION_DIFFERENCE' });
        expect(r.answer.facts.filter(f => f.unit === 'MONEY').map(f => f.value)).toEqual(['6380.53', '6380.53', '0.00']);
        expect((await answered(finance, 'How many transactions were matched?')).answer.headline).toBe('1 of 1 bank records matched a ledger entry: 1 exact and 0 date shift.');
        expect((await answered(finance, 'How much cash movement was recorded?')).answer.facts[0]).toEqual({ id: 'net', label: 'Net signed movement', value: '6380.53', unit: 'MONEY', currency: 'MYR' });
        expect(r.scope).toMatchObject({ role: 'Finance' });
        expect((await pg.query("SELECT 1 FROM security_audit_events WHERE action='financial_record.read' AND outcome='success' AND target_id=$1", [source])).rows.length).toBeGreaterThanOrEqual(3);
    });
    it('never inherits a reconciliation into another upload with identical rows but different bytes', async () => {
        const r = await answered(finance, 'What is the bank-versus-ledger difference?', { source: copy });
        expect(r.selection.sha256).not.toBe(sha(bankBytes));
        expect(r.reconciliation).toBe('UNAVAILABLE');
        expect(r.answer).toMatchObject({ status: 'UNAVAILABLE', code: 'RECONCILIATION_UNAVAILABLE', facts: [] });
        expect(r.answer.interpretation).toContain('No unique reconciliation snapshot matches this uploaded bank source');
        expect((await answered(finance, 'How much cash movement was recorded?', { source: copy })).answer.facts[0].value).toBe('6380.53');
    });
    it('refuses unsupported questions without figures and refuses one-month forecasts', async () => {
        for (const q of ['What is net profit?', 'Is this fraud?', 'What is the gross margin ratio?']) {
            const r = await answered(finance, q);
            expect(r.answer).toMatchObject({ status: 'REFUSED', facts: [], records: [] });
        }
        expect((await answered(finance, 'What is the next-month cash-movement forecast?')).answer).toMatchObject({ status: 'UNAVAILABLE', code: 'FORECAST_UNAVAILABLE', facts: [] });
        for (const q of ['', '   ', 'x'.repeat(301)]) expect(await ask(finance, q)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
    });
    it('denies other tenants, non-Finance roles, unknown sources and unobserved selections', async () => {
        const service = createPocFinanceQa(db);
        for (const token of [other, technical, admin]) {
            expect(await service.ask(token, { source }, 'How much cash movement was recorded?')).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
            expect(await service.context(token, { source })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        }
        expect((await pg.query("SELECT 1 FROM security_audit_events WHERE action='authorization.denied' AND target_id='poc-finance-questions'")).rows).toHaveLength(4);
        for (const selection of [{ source: '11111111-1111-4111-8111-111111111111' }, { source, business: 'BUS-999' }, { source, period: '2026-04' }, { source, currency: 'USD' }, { source: 'not-a-uuid' }])
            expect(await service.ask(finance, selection, 'How much cash movement was recorded?')).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const context = await service.context(finance, { source });
        expect(context.status === 'OK' && context.suggestions).toContain('What is the bank-versus-ledger difference?');
        const list = await service.sources(finance);
        expect(list.status === 'OK' && list.sources.map(s => s.id).sort()).toEqual([source, copy].sort());
    });
    it('fails closed on revoked, expired or invalid sessions and membership removal', async () => {
        const auth = createM2Identity(db);
        const revoked = (await auth.login('finance@qa.invalid', password)).token; await auth.logout(revoked);
        const expired = (await auth.login('finance@qa.invalid', password)).token;
        await pg.query("UPDATE fingence_m2.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [tokenHash(expired)]);
        for (const token of [revoked, expired, 'invalid']) await expect(ask(token, 'How much cash movement was recorded?')).rejects.toThrow('ACCESS_DENIED');
        await pg.query("UPDATE fingence_m2.memberships SET active=false WHERE user_id=(SELECT id FROM fingence_m2.users WHERE email='other@qa.invalid')");
        await expect(createPocFinanceQa(db).sources(other)).rejects.toThrow('ACCESS_DENIED');
    });
    it('delivers nothing when the audit fails or the stored bytes no longer match their hash', async () => {
        await expect(createPocFinanceQa(failingAudit(db)).ask(finance, { source }, 'How much cash movement was recorded?')).rejects.toThrow('audit failure');
        await pg.query('UPDATE fingence_poc.anomaly_sources SET content=$1 WHERE id=$2', [new Uint8Array([1, 2]), source]);
        await expect(ask(finance, 'How much cash movement was recorded?')).rejects.toThrow('SOURCE_INTEGRITY');
        await pg.query('UPDATE fingence_poc.anomaly_sources SET content=$1 WHERE id=$2', [bankBytes, source]);
    });
});
