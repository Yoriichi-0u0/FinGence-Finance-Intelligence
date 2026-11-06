import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { runPayload, runPayloadSchema } from '../../lib/document-ingestion/run-payload';
import { phase1 } from '../grounded-qa/fixtures';

const post = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost:3000/api/ingestion/runs', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
async function route() { vi.resetModules(); return import('../../app/api/ingestion/runs/route'); }
const RUN_ID = '0b9f7a4e-3c55-4e2b-9a61-6f1d2c3b4a5e';

describe('stored form of an ingestion run', () => {
    it('carries fingerprints, decisions and the verified records, never the file, and passes its own validation', async () => {
        const p = runPayload(await phase1());
        expect(runPayloadSchema.safeParse(p).success).toBe(true);
        expect(p.documents.map(d => [d.role, d.format, d.method, d.records.length])).toEqual([['BANK_STATEMENT', 'CSV', 'EXACT_SIGNATURE', 57], ['GENERAL_LEDGER', 'CSV', 'EXACT_SIGNATURE', 57], ['BANK_HISTORY', 'CSV', 'EXACT_SIGNATURE', 618]]);
        expect(p.documents[0].records.reduce((n, r) => n + BigInt(r.signedCents), 0n)).toBe(2823201n);
        expect(JSON.stringify(p)).not.toMatch(/BankTransactionID,BusinessID/); // no raw document text
    });
});

describe('ingestion run store route', () => {
    beforeEach(() => {
        vi.stubEnv('FINGENCE_INGESTION_STORE', '1'); vi.stubEnv('SUPABASE_URL', 'https://example-project.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-not-real');
        vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN', '');
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('does not exist unless the store is switched on and configured', async () => {
        vi.stubEnv('FINGENCE_INGESTION_STORE', '');
        let r = await route();
        expect([(await r.GET()).status, (await r.POST(post({}))).status]).toEqual([404, 404]);
        vi.stubEnv('FINGENCE_INGESTION_STORE', '1'); vi.stubEnv('SUPABASE_URL', 'https://evil.example.com');
        r = await route();
        expect((await r.GET()).status).toBe(404);
    });
    it('saves a run through the service-role function, with the client stored only as a keyed hash', async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify(RUN_ID), { status: 200 })); vi.stubGlobal('fetch', fetch);
        const res = await (await route()).POST(post(runPayload(await phase1()), { 'x-forwarded-for': '203.0.113.9' }));
        expect([res.status, await res.json()]).toEqual([201, { runId: RUN_ID }]);
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://example-project.supabase.co/rest/v1/rpc/fingence_ingestion_record_run');
        const sent = JSON.parse(init.body as string).payload;
        expect(sent.clientHash).toMatch(/^[0-9a-f]{32}$/);
        expect(init.body as string).not.toContain('203.0.113.9');
    });
    it.each([
        ['a cross-site request', () => post({}, { origin: 'https://other.example' }), 403],
        ['an invalid run', () => post({ documents: [] }), 400],
        ['a request over the size bound', () => post('x'.repeat(1_600_000)), 413],
    ])('refuses %s before any write', async (_, request, status) => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        expect((await (await route()).POST(request())).status).toBe(status);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('sends a new sb_secret key in apikey only (it is not a JWT)', async () => {
        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', ''); vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_not_real');
        const fetch = vi.fn(async () => new Response(JSON.stringify(RUN_ID), { status: 200 })); vi.stubGlobal('fetch', fetch);
        expect((await (await route()).POST(post(runPayload(await phase1())))).status).toBe(201);
        const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
        expect([headers.apikey, headers.Authorization]).toEqual(['sb_secret_not_real', undefined]);
    });
    it('reports a store failure without retrying', async () => {
        const fetch = vi.fn(async () => new Response('{"message":"x"}', { status: 500 })); vi.stubGlobal('fetch', fetch);
        const res = await (await route()).POST(post(runPayload(await phase1())));
        expect([res.status, await res.json(), fetch.mock.calls.length]).toEqual([502, { code: 'STORE_HTTP_500' }, 1]);
    });
});
