import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import * as h from '../../lib/server/workspace/handlers';
import { newSecret, rpc, secretHash, type Store } from '../../lib/server/workspace/store';
import { rpcTransport, workspaceDatabase } from './db';

/**
 * Renaming the assistant end to end, against the real migrations (up to workspace v9) in an in-memory Postgres: each
 * member keeps the name they gave their assistant, only a clean name is accepted, and nobody reads or renames another
 * member's assistant, in the server and the database.
 */
const ORIGIN = 'http://localhost:3000';
const store: Store = { url: 'https://example-project.supabase.co', key: 'sb_secret_not_real' };
let db: PGlite, deps: h.Deps;
const req = (path: string, cookie?: string, body?: unknown, method = body === undefined ? 'GET' : 'PUT') => new Request(`${ORIGIN}${path}`, {
    method, headers: { host: 'localhost:3000', origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
const token = (cookie: string) => secretHash(cookie.split('=')[1]);
async function redeem(code: string) { return cookieOf(await h.join(req('/api/workspace/join', undefined, { code, password: 'correct horse battery' }, 'POST'), deps)); }
async function invite(by: string, email: string, role: string) { return (await (await h.teamChange(req('/api/workspace/team', by, { action: 'invite', email, role }, 'POST'), deps)).json()).code as string; }
const load = async (cookie?: string) => { const res = await h.assistantSettings(req('/api/workspace/assistant', cookie), deps); return [res.status, await res.json()] as const; };
const save = async (cookie: string | undefined, settings: unknown) => { const res = await h.assistantSettingsChange(req('/api/workspace/assistant', cookie, { settings }), deps); return [res.status, await res.json()] as const; };
const rows = async () => (await db.query<{ n: number }>('select count(*)::int n from fingence_workspace.assistant_settings')).rows[0].n;

let superadmin: string, admin: string, finance: string, finance2: string;
beforeAll(async () => {
    db = await workspaceDatabase();
    deps = { store, transport: rpcTransport(db), attempts: async () => true };
    const code = newSecret();
    await db.query('select public.fingence_workspace_bootstrap($1, $2, $3)', ['SAIC', 'super@example.invalid', secretHash(code)]);
    superadmin = await redeem(code);
    admin = await redeem(await invite(superadmin, 'admin@example.invalid', 'ADMIN'));
    finance = await redeem(await invite(admin, 'finance@example.invalid', 'FINANCE'));
    finance2 = await redeem(await invite(admin, 'finance2@example.invalid', 'FINANCE'));
}, 60_000);

describe('Naming the assistant: each member keeps their own', () => {
    it('a member who never renamed it gets null (the assistant is Fin)', async () => {
        expect(await load(finance)).toEqual([200, { settings: null, updatedAt: null }]);
    });
    it('a Finance user renames it and loads the name back; renaming again replaces it', async () => {
        const [status, out] = await save(finance, { v: 1, name: 'Kira' });
        expect(status).toBe(200);
        expect(out).toMatchObject({ ok: true, settings: { v: 1, name: 'Kira' }, updatedAt: expect.any(String) });
        expect((await load(finance))[1].settings).toEqual({ v: 1, name: 'Kira' });
        expect((await save(finance, { v: 1, name: 'Mei Ling' }))[0]).toBe(200);
        expect((await load(finance))[1].settings.name).toBe('Mei Ling');
        expect(await rows()).toBe(1);
    });
    it('keeps names in any script', async () => {
        expect((await save(finance2, { v: 1, name: '小金' }))[0]).toBe(200);
        expect((await load(finance2))[1].settings.name).toBe('小金');
        expect((await save(finance2, null))[0]).toBe(200);
    });
    it('one member never reads or renames another member\'s assistant', async () => {
        for (const other of [finance2, admin, superadmin]) expect((await load(other))[1].settings).toBeNull();
        expect((await save(admin, { v: 1, name: 'Sen' }))[0]).toBe(200);
        expect((await load(finance))[1].settings.name).toBe('Mei Ling');
        const { rows: args } = await db.query<{ name: string; args: string }>(
            "select p.proname name, pg_get_function_identity_arguments(p.oid) args from pg_proc p where p.proname in ('fingence_workspace_assistant', 'fingence_workspace_save_assistant') order by 1");
        expect(args).toEqual([{ name: 'fingence_workspace_assistant', args: 'p_token_hash text' }, { name: 'fingence_workspace_save_assistant', args: 'p_token_hash text, p_settings jsonb' }]);
    });
    it('going back to Fin removes only that member\'s settings', async () => {
        expect(await save(admin, null)).toEqual([200, { ok: true, settings: null, updatedAt: null }]);
        expect((await load(admin))[1].settings).toBeNull();
        expect((await load(finance))[1].settings).not.toBeNull();
    });
    it('a name with digits, symbols or markup, an extra key or another version is refused, in the server and the database', async () => {
        const bad: unknown[] = [
            { v: 1, name: 'Fin 2' }, { v: 1, name: 'RM' }, { v: 1, name: '<b>' }, { v: 1, name: 'Fin!' }, { v: 1, name: '' },
            { v: 1, name: ' Fin' }, { v: 1, name: 'A'.repeat(21) }, { v: 2, name: 'Kira' }, { v: 1, name: 'Kira', tone: 'warm' }, { v: 1 }, 'Kira',
        ];
        for (const settings of bad) expect(await save(finance, settings), JSON.stringify(settings)).toEqual([400, { code: 'INVALID_SETTINGS' }]);
        // The database refuses digits, symbols, spacing faults, length and shape on its own, whatever the server sends.
        for (const settings of [bad[0], bad[2], bad[3], bad[4], bad[5], bad[6], bad[7], bad[8], { v: 1, name: 'Fin  Two' }, { v: 1, name: '[x]' }, { v: 1, name: 'a\\b' }])
            expect(await rpc('fingence_workspace_save_assistant', { p_token_hash: token(finance), p_settings: settings }, store, deps.transport), JSON.stringify(settings)).toEqual({ ok: false, error: 'INVALID_SETTINGS' });
        const member = (await db.query<{ id: string }>("select id::text from fingence_workspace.members where email = 'finance2@example.invalid'")).rows[0].id;
        await expect(db.query('insert into fingence_workspace.assistant_settings (member_id, settings) values ($1, $2)', [member, JSON.stringify({ v: 1, name: 'R2D2' })])).rejects.toThrow(/assistant_settings_shape/);
        expect((await load(finance))[1].settings.name).toBe('Mei Ling');
    });
    it('a visitor, an ended session and a cross-site write are refused', async () => {
        expect((await load())[0]).toBe(401);
        expect((await save(undefined, { v: 1, name: 'Kira' }))[0]).toBe(401);
        expect(await rpc('fingence_workspace_assistant', { p_token_hash: 'f'.repeat(64) }, store, deps.transport)).toEqual({ ok: false, error: 'FORBIDDEN' });
        const crossSite = new Request(`${ORIGIN}/api/workspace/assistant`, { method: 'PUT', headers: { host: 'localhost:3000', origin: 'https://evil.example', 'content-type': 'application/json', cookie: finance }, body: JSON.stringify({ settings: { v: 1, name: 'Evil' } }) });
        expect((await h.assistantSettingsChange(crossSite, deps)).status).toBe(403);
        const signedOut = await redeem(await invite(admin, 'leaver@example.invalid', 'FINANCE'));
        await h.signOut(req('/api/workspace/sign-out', signedOut, {}, 'POST'), deps);
        expect((await load(signedOut))[0]).toBe(401);
    });
    it('only the service role may call the functions, and the table cannot be read directly', async () => {
        for (const fn of ['fingence_workspace_assistant(text)', 'fingence_workspace_save_assistant(text, jsonb)']) {
            const { rows: r } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(`select has_function_privilege('anon', 'public.${fn}', 'execute') anon, has_function_privilege('authenticated', 'public.${fn}', 'execute') authenticated, has_function_privilege('service_role', 'public.${fn}', 'execute') service`);
            expect(r[0], fn).toEqual({ anon: false, authenticated: false, service: true });
        }
        const { rows: t } = await db.query<{ anon: boolean; authenticated: boolean; forced: boolean }>(
            "select has_table_privilege('anon', 'fingence_workspace.assistant_settings', 'select') anon, has_table_privilege('authenticated', 'fingence_workspace.assistant_settings', 'select') authenticated, (select relforcerowsecurity from pg_class where oid = 'fingence_workspace.assistant_settings'::regclass) forced");
        expect(t[0]).toEqual({ anon: false, authenticated: false, forced: true });
    });
    it('the migration can run again on an existing store without losing names', async () => {
        const { readFileSync } = await import('node:fs');
        await db.exec(readFileSync('supabase/sql/workspace-v9-assistant.sql', 'utf8'));
        expect((await load(finance))[1].settings.name).toBe('Mei Ling');
    });
});
