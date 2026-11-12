import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import * as h from '../../lib/server/workspace/handlers';
import * as history from '../../lib/server/workspace/history';
import { memoryFiles, objectPath } from '../../lib/server/files/store';
import { saveRun } from '../../lib/server/history/save';
import { savedRunPayload } from '../../lib/history/saved-run';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';
import { newSecret, secretHash, type Store } from '../../lib/server/workspace/store';
import { rpcTransport, workspaceDatabase } from './db';

/**
 * History end to end, against the real migrations (workspace v1–v3 and v6-saved-runs) in an in-memory Postgres, with the
 * private file bucket in memory: each person's runs are saved with their documents, listed, reopened and deleted; nobody
 * sees another Finance user's runs; Admins see everyone's; a document is stored once; the free-plan cap is kept.
 */
const ORIGIN = 'http://localhost:3000';
const store: Store = { url: 'https://example-project.supabase.co', key: 'sb_secret_not_real' };
let db: PGlite, deps: h.Deps, organization: string;
const files = memoryFiles();
const hdeps = () => ({ store, transport: deps.transport, files });
const req = (path: string, cookie?: string, init: { method?: string; body?: BodyInit; type?: string } = {}) => new Request(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET', headers: { host: 'localhost:3000', origin: ORIGIN, ...(init.type ? { 'content-type': init.type } : {}), ...(cookie ? { cookie } : {}) }, ...(init.body ? { body: init.body } : {}),
});
const json = (path: string, cookie: string | undefined, body: unknown) => new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { host: 'localhost:3000', origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
async function redeem(code: string) { return cookieOf(await h.join(json('/api/workspace/join', undefined, { code, password: 'correct horse battery' }), deps)); }
async function invite(by: string, email: string, role: string) { return (await (await h.teamChange(json('/api/workspace/team', by, { action: 'invite', email, role }), deps)).json()).code as string; }
const memberId = async (email: string) => (await db.query<{ id: string }>('select id::text from fingence_workspace.members where email = $1', [email])).rows[0].id;
const doc = (p: string): DocumentInput => ({ name: p.split('/').at(-1)!, bytes: new Uint8Array(readFileSync(join('public/demo', p))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const march = () => ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv'].map(doc);
const list = async (cookie: string, scope = 'mine') => { const res = await history.listHistory(req(`/api/workspace/history?scope=${scope}`, cookie), hdeps()); return [res.status, await res.json()] as const; };

let admin: string, finance: string, finance2: string;
beforeAll(async () => {
    db = await workspaceDatabase();
    deps = { store, transport: rpcTransport(db), attempts: async () => true };
    const code = newSecret();
    await db.query('select public.fingence_workspace_bootstrap($1, $2, $3)', ['SAIC', 'super@example.invalid', secretHash(code)]);
    const superadmin = await redeem(code);
    admin = await redeem(await invite(superadmin, 'admin@example.invalid', 'ADMIN'));
    finance = await redeem(await invite(admin, 'finance@example.invalid', 'FINANCE'));
    finance2 = await redeem(await invite(admin, 'finance2@example.invalid', 'FINANCE'));
    organization = (await db.query<{ id: string }>('select id::text from fingence_workspace.organizations')).rows[0].id;
}, 60_000);

async function saveMarch(email: string) {
    const c = await processDocuments(march());
    const payload = await savedRunPayload(c, march(), { interpretations: {} }, '2026-11-12T03:00:00.000Z');
    return { c, saved: await saveRun(organization, await memberId(email), payload, march(), { store, transport: deps.transport, files }) };
}

describe('History: saved runs per person', () => {
    let id: string;
    it('a completed run is saved with its documents, each stored once per organization in the private bucket', async () => {
        const { c, saved } = await saveMarch('finance@example.invalid');
        expect(saved).toMatchObject({ filesKept: true });
        id = (saved as { id: string }).id;
        expect(files.objects.size).toBe(2);
        // The same documents again (another run, another person): nothing new is stored.
        expect((await saveMarch('finance2@example.invalid')).saved).toMatchObject({ filesKept: true });
        expect(files.objects.size).toBe(2);
        const [status, out] = await list(finance);
        expect(status).toBe(200);
        expect(out.runs).toHaveLength(1);
        expect(out.runs[0]).toMatchObject({ id, mine: true, processingId: c.processingId, businessName: c.scope!.businessName, period: '2026-03', currency: 'MYR', confidence: { status: 'MEASURED', percent: 100, band: 'HIGH' }, filesKept: true });
        expect(out.runs[0]).not.toHaveProperty('bundle');
        expect(out.usage).toMatchObject({ runs: 2, filesCap: 900000000 });
    });
    it('reopening returns the restore bundle and the documents, which reproduce the same processing exactly', async () => {
        const res = await history.openSaved(req(`/api/workspace/history/${id}`, finance), id, hdeps());
        const run = await res.json();
        expect(run).toMatchObject({ processingId: expect.any(String), bundle: { interpretations: {} } });
        expect(run).not.toHaveProperty('organizationId');
        const back: DocumentInput[] = [];
        for (const [i, d] of (run.documents as { name: string; provenance: DocumentInput['provenance'] }[]).entries()) {
            const file = await history.savedDocument(req(`/api/workspace/history/${id}/document/${i}`, finance), id, String(i), hdeps());
            expect(file.status).toBe(200);
            back.push({ name: d.name, provenance: d.provenance, bytes: new Uint8Array(await file.arrayBuffer()) });
        }
        expect((await processDocuments(back)).processingId).toBe(run.processingId);
    });
    it('a Finance user never sees, opens, downloads or deletes another person\'s run; an Admin can', async () => {
        expect((await list(finance2))[1].runs.every((r: { id: string }) => r.id !== id)).toBe(true);
        expect((await history.openSaved(req('/x', finance2), id, hdeps())).status).toBe(404);
        expect((await history.savedDocument(req('/x', finance2), id, '0', hdeps())).status).toBe(404);
        expect((await history.deleteSaved(req('/x', finance2, { method: 'DELETE' }), id, hdeps())).status).toBe(404);
        expect((await list(finance, 'all'))[0]).toBe(403);
        const [, all] = await list(admin, 'all');
        expect(all.runs.map((r: { by: string }) => r.by).sort()).toEqual(['finance2@example.invalid', 'finance@example.invalid']);
        expect((await history.openSaved(req('/x', admin), id, hdeps())).status).toBe(200);
    });
    it('deleting removes the run, and a document only when no other saved run uses it', async () => {
        expect((await history.deleteSaved(req('/x', finance, { method: 'DELETE', type: 'application/json' }), id, hdeps())).status).toBe(200);
        expect((await list(finance))[1].runs).toHaveLength(0);
        expect(files.objects.size).toBe(2);
        const other = (await list(finance2))[1].runs[0].id;
        const res = await history.deleteSaved(req('/x', admin, { method: 'DELETE' }), other, hdeps());
        expect(await res.json()).toMatchObject({ filesRemoved: 2 });
        expect(files.objects.size).toBe(0);
        // The deletion is in the audit trail, with who deleted it.
        expect((await db.query<{ n: number }>("select count(*)::int n from fingence_workspace.audit where action = 'run.deleted'")).rows[0].n).toBe(2);
    });
    it('a cross-site delete is refused', async () => {
        const r = new Request(`${ORIGIN}/x`, { method: 'DELETE', headers: { host: 'localhost:3000', origin: 'https://evil.example', cookie: finance } });
        expect((await history.deleteSaved(r, '00000000-0000-4000-8000-000000000001', hdeps())).status).toBe(403);
    });
    it('over the files cap, the run is saved without its documents and cannot be reopened from them', async () => {
        await db.query("insert into fingence_workspace.saved_files (organization_id, sha256, bytes, content_type) values ($1::uuid, $2, 50000000, 'text/csv')", [organization, 'f'.repeat(64)]);
        for (let i = 0; i < 17; i++) await db.query("insert into fingence_workspace.saved_files (organization_id, sha256, bytes, content_type) values ($1::uuid, $2, 50000000, 'text/csv')", [organization, i.toString(16).padStart(64, 'e')]);
        const { saved } = await saveMarch('finance@example.invalid');
        expect(saved).toMatchObject({ filesKept: false });
        expect(files.objects.size).toBe(0);
        const runId = (saved as { id: string }).id;
        expect((await history.savedDocument(req('/x', finance), runId, '0', hdeps())).status).toBe(404);
        expect((await list(finance))[1].runs[0]).toMatchObject({ filesKept: false });
    });
    it('the documents sent must be the documents described', async () => {
        const c = await processDocuments(march());
        const payload = await savedRunPayload(c, march(), { interpretations: {} }, '2026-11-12T03:00:00.000Z');
        const swapped = [march()[1], march()[0]];
        expect(await saveRun(organization, await memberId('finance@example.invalid'), payload, swapped, { store, transport: deps.transport, files })).toEqual({ error: 'DOCUMENTS_MISMATCH' });
    });
    it('only the service role may call the functions, and the tables cannot be read directly', async () => {
        for (const fn of ['fingence_workspace_plan_save(uuid, uuid, jsonb)', 'fingence_workspace_save_run(uuid, uuid, jsonb)', 'fingence_workspace_history(text, text)', 'fingence_workspace_saved_run(text, uuid)', 'fingence_workspace_delete_run(text, uuid)']) {
            const { rows } = await db.query<{ anon: boolean; auth: boolean; service: boolean }>(`select has_function_privilege('anon', 'public.${fn}', 'execute') anon, has_function_privilege('authenticated', 'public.${fn}', 'execute') auth, has_function_privilege('service_role', 'public.${fn}', 'execute') service`);
            expect(rows[0], fn).toEqual({ anon: false, auth: false, service: true });
        }
        for (const t of ['saved_runs', 'saved_files']) expect((await db.query<{ s: boolean }>(`select has_table_privilege('authenticated', 'fingence_workspace.${t}', 'select') s`)).rows[0].s).toBe(false);
    });
    it('a document path is always <organization>/<sha256>', () => {
        expect(objectPath(organization, 'a'.repeat(64))).toBe(`${organization}/${'a'.repeat(64)}`);
    });
});
