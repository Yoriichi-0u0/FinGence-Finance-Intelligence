import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { createM2Identity } from '../../lib/server/ai-ingestion/m2/identity';
import { bootstrapOrganization, createTenantAdministration } from '../../lib/server/tenant-admin-m5/service';
import { installPocAnomalySchema } from '../../lib/server/poc-anomalies/schema';
import { createPocAnomalies } from '../../lib/server/poc-anomalies/service';
import { createPocForecast, type ForecastRefused, type ForecastView } from '../../lib/server/poc-forecast/service';
import { parseSource } from '../../lib/poc-anomalies/source';
import { forecastBusiness } from '../../lib/poc-forecast/forecast';
import { m5Database, password } from '../tenant-admin-m5/support';
import { csv, type Fixture } from '../poc-anomalies/support';

let pg: PGlite, db: TransactionDatabase;
const admin = () => createTenantAdministration(db), forecast = () => createPocForecast(db), anomalies = () => createPocAnomalies(db);
const audits = async (action: string, actor?: string) => (await pg.query<{ actor_id: string; outcome: string; target_id: string }>('SELECT actor_id::text,outcome,target_id FROM public.security_audit_events WHERE action=$1 AND ($2::text IS NULL OR actor_id::text=$2) ORDER BY id', [action, actor ?? null])).rows;
async function member(adminToken: string, email: string, role: 'Finance' | 'Technical (Management)') {
    const invite = await admin().invite(adminToken, { email, role });
    if (invite.status !== 'INVITED') throw new Error(invite.code);
    await admin().enroll({ code: invite.code, email, password });
    const userId = (await pg.query<{ id: string }>('SELECT id::text FROM fingence_m2.users WHERE email=$1', [email])).rows[0].id;
    const changed = await admin().changeMembership(adminToken, { userId, role, active: true, expectedVersion: 1 });
    if (changed.status !== 'UPDATED') throw new Error(changed.code);
    return { userId, token: (await createM2Identity(db).login(email, password)).token };
}
async function organization(name: string) {
    const org = await bootstrapOrganization(db, { name, adminEmail: `admin@${name}.poc.invalid` });
    await admin().enroll({ code: org.code, email: `admin@${name}.poc.invalid`, password });
    const adminToken = (await createM2Identity(db).login(`admin@${name}.poc.invalid`, password)).token;
    return { id: org.organizationId, adminToken, finance: await member(adminToken, `finance@${name}.poc.invalid`, 'Finance') };
}
const ok = <T extends { status: string }>(value: T | ForecastRefused) => { if (value.status === 'REFUSED') throw new Error('REFUSED'); return value as T; };
/** Twelve months Sep 2025 - Aug 2026 for two businesses, plus a March-only third business. */
const monthly: Fixture[] = [];
['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].forEach((p, i) => {
    monthly.push({ id: `A-C-${i}`, business: 'BUS-A', direction: 'Credit', amount: `${1000 + 100 * i}.00`, date: `${p}-10` }, { id: `A-D-${i}`, business: 'BUS-A', amount: `${1300 + 7 * i}.35`, date: `${p}-12` });
    monthly.push({ id: `B-C-${i}`, business: 'BUS-B', direction: 'Credit', amount: '50.00', date: `${p}-03` }, { id: `B-D-${i}`, business: 'BUS-B', amount: '20.00', date: `${p}-04` });
});
monthly.push({ id: 'C-D-0', business: 'BUS-C', amount: '10.00', date: '2026-03-02' });
const file = csv(monthly), march = csv([{ id: 'M-1', direction: 'Credit', amount: '5.00', date: '2026-03-02' }, { id: 'M-2', amount: '2.00', date: '2026-03-03' }]);
let a: Awaited<ReturnType<typeof organization>>, b: Awaited<ReturnType<typeof organization>>, tech: Awaited<ReturnType<typeof member>>, sourceId: string, marchId: string;

beforeAll(async () => {
    ({ pg, db } = await m5Database());
    await installPocAnomalySchema(db);
    a = await organization('fc-a');
    b = await organization('fc-b');
    tech = await member(a.adminToken, 'tech@fc-a.poc.invalid', 'Technical (Management)');
    const stored = await anomalies().upload(a.finance.token, 'twelve.csv', file), marchStored = await anomalies().upload(a.finance.token, 'march.csv', march);
    if (stored.status !== 'STORED' || marchStored.status !== 'STORED') throw new Error('upload');
    sourceId = stored.sourceId; marchId = marchStored.sourceId;
}, 60000);
afterAll(async () => { await pg?.close(); });

describe('PoC cash forecast service', () => {
    it('forecasts the first business of a Finance-uploaded source from its stored bytes and audits the read', async () => {
        const view = ok(await forecast().forecast(a.finance.token, { sourceId })) as ForecastView;
        expect(view).toMatchObject({ publicationEligible: false, dataOrigin: 'SYNTHETIC_UPLOADED_SOURCE', scope: { organizationId: a.id, userId: a.finance.userId, role: 'Finance' }, selection: { businessId: 'BUS-A' } });
        expect(view.options.map(o => [o.businessId, o.rows])).toEqual([['BUS-A', 24], ['BUS-B', 24], ['BUS-C', 1]]);
        expect(view.source).toMatchObject({ id: sourceId, fileName: 'twelve.csv', rowCount: 49 });
        // Exactly the pure module's result over the parsed stored rows of that business.
        expect(view.business).toEqual(forecastBusiness(parseSource(file).rows.filter(r => r.businessId === 'BUS-A')));
        expect(view.business.forecast).toMatchObject({ status: 'AVAILABLE', period: '2026-09', credits: '1850.00', debits: '1359.85', net: '490.15' });
        expect(view.portfolio).toMatchObject({ currency: 'MYR', included: ['BUS-A', 'BUS-B'], excluded: [{ businessId: 'BUS-C', code: 'INSUFFICIENT_HISTORY' }] });
        expect(view.portfolio.backtest!.credits.methods[0].tests).toBe(12);
        expect(view.limitations.join(' ')).toMatch(/not revenue, profit, expenses or a statutory cash flow statement/);
        expect((await audits('financial_record.read', a.finance.userId)).at(-1)).toMatchObject({ outcome: 'success', target_id: sourceId });
    });
    it('returns history with an explicit unavailable forecast for March-only input', async () => {
        const view = ok(await forecast().forecast(a.finance.token, { sourceId: marchId })) as ForecastView;
        expect(view.business.history.map(m => [m.period, m.credits, m.debits, m.net])).toEqual([['2026-03', '5.00', '2.00', '3.00']]);
        expect(view.business.forecast).toMatchObject({ status: 'UNAVAILABLE', code: 'INSUFFICIENT_HISTORY' });
        expect(view.portfolio).toMatchObject({ included: [], backtest: null });
        const short = ok(await forecast().forecast(a.finance.token, { sourceId, businessId: 'BUS-C' })) as ForecastView;
        expect(short.business.forecast).toMatchObject({ status: 'UNAVAILABLE', code: 'INSUFFICIENT_HISTORY' });
    });
    it('lists only the caller organization sources', async () => {
        expect(ok(await forecast().sources(a.finance.token)).sources.map(s => s.id).sort()).toEqual([sourceId, marchId].sort());
        expect(ok(await forecast().sources(b.finance.token)).sources).toEqual([]);
    });
    it('refuses another organization source, an unknown business and a malformed id with an audited failure', async () => {
        for (const [token, input] of [[b.finance.token, { sourceId }], [a.finance.token, { sourceId, businessId: 'BUS-Z' }], [a.finance.token, { sourceId: 'x' }]] as const)
            expect(await forecast().forecast(token, input)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect((await audits('financial_record.read', b.finance.userId)).at(-1)).toMatchObject({ outcome: 'failure', target_id: 'poc-forecast' });
    });
    it('refuses Finance-only reads for other roles with a committed authorization denial', async () => {
        expect(await forecast().sources(tech.token)).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect(await forecast().forecast(tech.token, { sourceId })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect((await audits('authorization.denied', tech.userId)).map(r => r.target_id)).toEqual(['poc-forecast-sources', 'poc-forecast']);
    });
    it('refuses stored bytes that no longer match the recorded source hash', async () => {
        const tampered = await anomalies().upload(a.finance.token, 'tamper.csv', csv(monthly.slice(0, 30)));
        if (tampered.status !== 'STORED') throw new Error('upload');
        await pg.query('UPDATE fingence_poc.anomaly_sources SET content=$1 WHERE id=$2', [file, tampered.sourceId]);
        expect(await forecast().forecast(a.finance.token, { sourceId: tampered.sourceId })).toEqual({ status: 'REFUSED', code: 'UNAVAILABLE' });
    });
    it('rejects revoked and demoted sessions before reading any source', async () => {
        const extra = await member(a.adminToken, 'finance2@fc-a.poc.invalid', 'Finance');
        ok(await forecast().forecast(extra.token, { sourceId }));
        await createM2Identity(db).logout(extra.token);
        await expect(forecast().forecast(extra.token, { sourceId })).rejects.toThrow();
        const again = (await createM2Identity(db).login('finance2@fc-a.poc.invalid', password)).token;
        const changed = await admin().changeMembership(a.adminToken, { userId: extra.userId, role: 'Technical (Management)', active: true, expectedVersion: 2 });
        expect(changed.status).toBe('UPDATED');
        await expect(forecast().sources(again)).rejects.toThrow();
    });
});
