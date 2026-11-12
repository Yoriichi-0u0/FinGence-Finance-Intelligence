import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import * as h from '../../lib/server/workspace/handlers';
import { newSecret, rpc, secretHash, type Store } from '../../lib/server/workspace/store';
import { DEFAULT_LAYOUT, move, setVisible, type Layout } from '../../lib/dashboard/layout';
import { rpcTransport, workspaceDatabase } from './db';

/**
 * "Customise dashboard" end to end, against the real migrations (workspace v1, v2 and v4-preferences) in an in-memory
 * Postgres: each member saves and loads their own Overview layout, only known cards are accepted, and nobody reads
 * another member's layout, in the server and the database.
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
const load = async (cookie?: string) => { const res = await h.preferences(req('/api/workspace/preferences', cookie), deps); return [res.status, await res.json()] as const; };
const save = async (cookie: string | undefined, dashboard: unknown) => { const res = await h.preferencesChange(req('/api/workspace/preferences', cookie, { dashboard }), deps); return [res.status, await res.json()] as const; };
const rows = async () => (await db.query<{ n: number }>('select count(*)::int n from fingence_workspace.preferences')).rows[0].n;

// Chart hidden, "Flagged" first, the largest counterparties shown.
const shuffled: Layout = setVisible(setVisible(DEFAULT_LAYOUT, 'cash-chart', false), 'counterparties', true);
const mine: Layout = DEFAULT_LAYOUT.cards.findIndex(c => c.id === 'flagged') > 0
    ? [...Array(DEFAULT_LAYOUT.cards.findIndex(c => c.id === 'flagged'))].reduce<Layout>(l => move(l, 'flagged', -1, false), shuffled) : shuffled;

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

describe('Customise dashboard: each member keeps their own Overview layout', () => {
    it('a member with no saved layout gets null (the default is shown)', async () => {
        expect(await load(finance)).toEqual([200, { dashboard: null, updatedAt: null }]);
    });
    it('a Finance user saves a layout and loads it back, in the order saved', async () => {
        expect(mine.cards[0].id).toBe('flagged');
        const [status, out] = await save(finance, mine);
        expect(status).toBe(200);
        expect(out).toMatchObject({ ok: true, dashboard: mine, updatedAt: expect.any(String) });
        const [, back] = await load(finance);
        expect(back.dashboard).toEqual(mine);
        expect(back.dashboard.cards.map((c: { id: string }) => c.id)).toEqual(mine.cards.map(c => c.id));
        // Saving again replaces it: still one row for this member.
        expect((await save(finance, setVisible(mine, 'checks', false)))[0]).toBe(200);
        expect((await load(finance))[1].dashboard.cards.find((c: { id: string }) => c.id === 'checks').visible).toBe(false);
        expect(await rows()).toBe(1);
    });
    it('one member never reads or changes another member\'s layout', async () => {
        // Same role, same organization: the other Finance user, the Admin and the Superadmin each still have the default.
        for (const other of [finance2, admin, superadmin]) expect((await load(other))[1].dashboard).toBeNull();
        // Another member saving their own layout leaves the first one's untouched.
        const theirs = setVisible(DEFAULT_LAYOUT, 'last-runs', true);
        expect((await save(admin, theirs))[0]).toBe(200);
        expect((await load(admin))[1].dashboard).toEqual(theirs);
        expect((await load(finance))[1].dashboard.cards[0].id).toBe('flagged');
        // No function takes a member ID: the member is always the one behind the session token.
        const { rows: args } = await db.query<{ name: string; args: string }>(
            "select p.proname name, pg_get_function_identity_arguments(p.oid) args from pg_proc p where p.proname in ('fingence_workspace_preferences', 'fingence_workspace_save_preferences') order by 1");
        expect(args).toEqual([{ name: 'fingence_workspace_preferences', args: 'p_token_hash text' }, { name: 'fingence_workspace_save_preferences', args: 'p_token_hash text, p_dashboard jsonb' }]);
    });
    it('Reset to default removes only that member\'s layout', async () => {
        expect(await save(admin, null)).toEqual([200, { ok: true, dashboard: null, updatedAt: null }]);
        expect((await load(admin))[1].dashboard).toBeNull();
        expect((await load(finance))[1].dashboard).not.toBeNull();
    });
    it('an unknown card, a repeated card, an extra key or another version is refused, in the server and the database', async () => {
        const bad: unknown[] = [
            { v: 1, cards: [{ id: 'profit-and-loss', visible: true }] },
            { v: 1, cards: [{ id: 'figures', visible: true }, { id: 'figures', visible: false }] },
            { v: 1, cards: [{ id: 'figures', visible: true, width: 3 }] },
            { v: 1, cards: [{ id: 'figures', visible: 'yes' }] },
            { v: 1, cards: [] },
            { v: 2, cards: [{ id: 'figures', visible: true }] },
            { v: 1, cards: [{ id: 'figures', visible: true }], html: '<script>' },
            [{ id: 'figures', visible: true }],
        ];
        for (const layout of bad) {
            expect(await save(finance, layout), JSON.stringify(layout)).toEqual([400, { code: 'INVALID_LAYOUT' }]);
            // The database refuses it on its own, whatever the server sends.
            expect(await rpc('fingence_workspace_save_preferences', { p_token_hash: token(finance), p_dashboard: layout }, store, deps.transport)).toEqual({ ok: false, error: 'INVALID_LAYOUT' });
        }
        // ...and so does the table, even for a write that skips the function.
        const member = (await db.query<{ id: string }>("select id::text from fingence_workspace.members where email = 'finance2@example.invalid'")).rows[0].id;
        await expect(db.query('insert into fingence_workspace.preferences (member_id, dashboard) values ($1, $2)', [member, JSON.stringify(bad[0])])).rejects.toThrow(/preferences_dashboard_shape/);
        // The saved layout is unchanged.
        expect((await load(finance))[1].dashboard.cards[0].id).toBe('flagged');
    });
    it('a visitor, an ended session and a cross-site write are refused', async () => {
        expect((await load())[0]).toBe(401);
        expect((await save(undefined, DEFAULT_LAYOUT))[0]).toBe(401);
        expect(await rpc('fingence_workspace_preferences', { p_token_hash: 'f'.repeat(64) }, store, deps.transport)).toEqual({ ok: false, error: 'FORBIDDEN' });
        const crossSite = new Request(`${ORIGIN}/api/workspace/preferences`, { method: 'PUT', headers: { host: 'localhost:3000', origin: 'https://evil.example', 'content-type': 'application/json', cookie: finance }, body: JSON.stringify({ dashboard: DEFAULT_LAYOUT }) });
        expect((await h.preferencesChange(crossSite, deps)).status).toBe(403);
        // An ended session reads nothing.
        const signedOut = await redeem(await invite(admin, 'leaver@example.invalid', 'FINANCE'));
        expect((await save(signedOut, mine))[0]).toBe(200);
        await h.signOut(req('/api/workspace/sign-out', signedOut, {}, 'POST'), deps);
        expect((await load(signedOut))[0]).toBe(401);
    });
    it('only the service role may call the functions, and the table cannot be read directly', async () => {
        for (const fn of ['fingence_workspace_preferences(text)', 'fingence_workspace_save_preferences(text, jsonb)']) {
            const { rows: r } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(`select has_function_privilege('anon', 'public.${fn}', 'execute') anon, has_function_privilege('authenticated', 'public.${fn}', 'execute') authenticated, has_function_privilege('service_role', 'public.${fn}', 'execute') service`);
            expect(r[0], fn).toEqual({ anon: false, authenticated: false, service: true });
        }
        const { rows: t } = await db.query<{ anon: boolean; authenticated: boolean; forced: boolean }>(
            "select has_table_privilege('anon', 'fingence_workspace.preferences', 'select') anon, has_table_privilege('authenticated', 'fingence_workspace.preferences', 'select') authenticated, (select relforcerowsecurity from pg_class where oid = 'fingence_workspace.preferences'::regclass) forced");
        expect(t[0]).toEqual({ anon: false, authenticated: false, forced: true });
    });
    it('the migration can run again on an existing store without losing layouts', async () => {
        const { readFileSync } = await import('node:fs');
        await db.exec(readFileSync('supabase/sql/workspace-v4-preferences.sql', 'utf8'));
        expect((await load(finance))[1].dashboard.cards[0].id).toBe('flagged');
    });
});
