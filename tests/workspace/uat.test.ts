import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import * as h from '../../lib/server/workspace/handlers';
import { newSecret, secretHash, type Store } from '../../lib/server/workspace/store';
import { EMPTY_ANSWERS, setTask, type UatAnswers } from '../../lib/uat/tasks';
import { rpcTransport, workspaceDatabase } from './db';

/**
 * The Testing checklist (UAT) end to end, against the real migrations (workspace v1, v2 and v8-uat) in an in-memory Postgres:
 * each member saves and loads only their own answers, only the strict answer shape is accepted, submitting is recorded, and
 * only Admins and Superadmins read everyone's results, in the server and the database.
 */
const ORIGIN = 'http://localhost:3000';
const store: Store = { url: 'https://example-project.supabase.co', key: 'sb_secret_not_real' };
let db: PGlite, deps: h.Deps;
const req = (path: string, cookie?: string, body?: unknown, method = body === undefined ? 'GET' : 'PUT', headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, {
    method, headers: { host: 'localhost:3000', origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
async function redeem(code: string) { return cookieOf(await h.join(req('/api/workspace/join', undefined, { code, password: 'correct horse battery' }, 'POST'), deps)); }
async function invite(by: string, email: string, role: string) { return (await (await h.teamChange(req('/api/workspace/team', by, { action: 'invite', email, role }, 'POST'), deps)).json()).code as string; }
const load = async (cookie?: string) => { const res = await h.uat(req('/api/workspace/uat', cookie), deps); return [res.status, await res.json()] as const; };
let seq = 0;
const save = async (cookie: string | undefined, answers: unknown, submit?: boolean, version = 'abc1234', order: { page: string; seq: number } = { page: 'test-page-0001', seq: ++seq }) => {
    const res = await h.uatChange(req('/api/workspace/uat', cookie, { answers, order, ...(submit === undefined ? {} : { submit }) }), deps, version);
    return [res.status, await res.json()] as const;
};
const results = async (cookie?: string) => { const res = await h.uatResults(req('/api/workspace/uat/results', cookie), deps); return [res.status, await res.json()] as const; };
const rows = async () => (await db.query<{ n: number }>('select count(*)::int n from fingence_workspace.uat_results')).rows[0].n;

const passTwo: UatAnswers = { ...setTask(setTask(EMPTY_ANSWERS, 1, { result: 'PASS' }), 2, { result: 'ISSUE', kind: 'CONFUSING', severity: 'WORKAROUND', note: 'Had to reload to see step 3.' }), context: { device: 'Chrome · macOS · 1440 px' } };

let superadmin: string, admin: string, finance: string, finance2: string;
beforeAll(async () => {
    db = await workspaceDatabase();
    deps = { store, transport: rpcTransport(db), attempts: async () => true };
    const code = newSecret();
    await db.query('select public.fingence_workspace_bootstrap($1, $2, $3)', ['SAIC', 'super@example.invalid', secretHash(code)]);
    superadmin = await redeem(code);
    admin = await redeem(await invite(superadmin, 'admin@example.invalid', 'ADMIN'));
    finance = await redeem(await invite(admin, 'finance@saic.example', 'FINANCE'));
    finance2 = await redeem(await invite(admin, 'finance2@example.invalid', 'FINANCE'));
}, 60_000);

describe('Testing checklist: each tester keeps their own answers', () => {
    it('nobody signed in is refused, and a member who has not started gets nulls', async () => {
        expect((await load())[0]).toBe(401);
        expect((await save(undefined, passTwo))[0]).toBe(401);
        expect(await load(finance)).toEqual([200, { answers: null, submittedAt: null, updatedAt: null }]);
    });
    it('a Finance user saves as they go and loads the same answers back; saving again replaces them', async () => {
        const [status, out] = await save(finance, passTwo);
        expect(status).toBe(200);
        expect(out).toEqual({ ok: true, submittedAt: null, updatedAt: expect.any(String) });
        expect((await load(finance))[1].answers).toEqual(passTwo);
        const more = { ...setTask(passTwo, 3, { result: 'NOT_DONE' }), overall: { trust: 4, useful: 'Reconciliation' } };
        expect((await save(finance, more))[0]).toBe(200);
        expect((await load(finance))[1].answers).toEqual(more);
        expect(await rows()).toBe(1);
        const { rows: [row] } = await db.query<{ app_version: string }>('select app_version from fingence_workspace.uat_results');
        expect(row.app_version).toBe('abc1234');
    });
    it('submitting records when, and later saves keep it while staying editable', async () => {
        const [, out] = await save(finance, passTwo, true);
        expect(out.submittedAt).toEqual(expect.any(String));
        const [, again] = await save(finance, setTask(passTwo, 1, { result: 'PASS', note: 'Fine.' }));
        expect(again.submittedAt).toBe(out.submittedAt);
        expect((await load(finance))[1].answers.tasks['1'].note).toBe('Fine.');
    });
    it('one member never reads or changes another member\'s answers', async () => {
        for (const other of [finance2, admin, superadmin]) expect((await load(other))[1].answers).toBeNull();
        expect((await save(finance2, setTask(EMPTY_ANSWERS, 1, { result: 'NOT_DONE' })))[0]).toBe(200);
        expect((await load(finance))[1].answers.tasks['1'].result).toBe('PASS');
        // The member is always the one behind the session token: no function that writes or reads one person's answers takes a member ID.
        const { rows: args } = await db.query<{ name: string; args: string }>(
            "select p.proname name, pg_get_function_identity_arguments(p.oid) args from pg_proc p where p.proname like 'fingence_workspace%uat%' order by 1");
        expect(args).toEqual([
            { name: 'fingence_workspace_save_uat', args: 'p_token_hash text, p_answers jsonb, p_submit boolean, p_version text, p_page text, p_seq integer' },
            { name: 'fingence_workspace_uat', args: 'p_token_hash text' },
            { name: 'fingence_workspace_uat_results', args: 'p_token_hash text' },
        ]);
    });
});

describe('Testing checklist: saves from one page keep their order', () => {
    it('an older save from the same page that arrives last changes nothing; another page always saves', async () => {
        const newer = setTask(passTwo, 4, { result: 'PASS', note: 'Typed just before leaving the page' });
        expect((await save(finance, newer, undefined, 'abc1234', { page: 'tab-one-0001', seq: 7 }))[1]).toMatchObject({ ok: true });
        // The autosave of seconds earlier, still in flight, reaches the database after the save sent on leaving.
        expect((await save(finance, passTwo, undefined, 'abc1234', { page: 'tab-one-0001', seq: 6 }))[1]).toMatchObject({ ok: true, stale: true });
        expect((await load(finance))[1].answers.tasks['4'].note).toBe('Typed just before leaving the page');
        // The same tester on another device or a later visit starts a new page, whose first save counts.
        expect((await save(finance, passTwo, undefined, 'abc1234', { page: 'tab-two-0001', seq: 1 }))[1].stale).toBeUndefined();
        expect((await load(finance))[1].answers.tasks['4']).toBeUndefined();
    });
    it('a save without its order is refused', async () => {
        const res = await h.uatChange(req('/api/workspace/uat', finance, { answers: passTwo }), deps);
        expect(res.status).toBe(400);
    });
});

describe('Testing checklist: only the strict answer shape is stored', () => {
    const bad: [string, unknown][] = [
        ['an unknown top-level field', { ...passTwo, email: 'x@example.invalid' }],
        ['a task that does not exist', { ...passTwo, tasks: { 12: { result: 'PASS' } } }],
        ['an unknown result', setTask(passTwo, 1, { result: 'MAYBE' as never })],
        ['an unknown field in a task', { ...passTwo, tasks: { 1: { result: 'PASS', amount: '100.00' } } }],
        ['a note over 2,000 characters', setTask(passTwo, 1, { result: 'PASS', note: 'x'.repeat(2001) })],
        ['a trust score of 6', { ...passTwo, overall: { trust: 6 } }],
        ['a device description over 120 characters', { ...passTwo, context: { device: 'x'.repeat(121) } }],
        ['a missing version', { tasks: {}, overall: {}, context: {} }],
    ];
    it.each(bad)('the server refuses %s', async (_, answers) => {
        const before = (await load(finance2))[1];
        expect(await save(finance2, answers)).toEqual([400, { code: 'INVALID_ANSWERS' }]);
        expect((await load(finance2))[1]).toEqual(before);
    });
    it('the database refuses the same, even when called directly', async () => {
        for (const [, answers] of bad) {
            const { rows: [r] } = await db.query<{ ok: boolean }>('select fingence_workspace.valid_uat($1::jsonb) ok', [JSON.stringify(answers)]);
            expect(r.ok).toBe(false);
        }
        const { rows: [good] } = await db.query<{ ok: boolean }>('select fingence_workspace.valid_uat($1::jsonb) ok', [JSON.stringify(passTwo)]);
        expect(good.ok).toBe(true);
        await expect(db.query("insert into fingence_workspace.uat_results (member_id, organization_id, answers, app_version) select id, organization_id, '{\"v\":1,\"tasks\":{},\"overall\":{},\"context\":{},\"x\":1}', 'local' from fingence_workspace.members limit 1")).rejects.toThrow(/uat_results_answers_shape/);
    });
    it('a cross-site request and an oversized body are refused before the store is asked', async () => {
        const cross = await h.uatChange(req('/api/workspace/uat', finance, { answers: passTwo, order: { page: 'test-page-0001', seq: 999 } }, 'PUT', { origin: 'https://evil.example' }), deps);
        expect(cross.status).toBe(403);
        const huge = await h.uatChange(req('/api/workspace/uat', finance, { answers: { ...passTwo, padding: 'x'.repeat(210_000) } }), deps);
        expect(huge.status).toBe(413);
    });
});

describe('Testing checklist: everyone\'s results are for Admins and Superadmins only', () => {
    it('a Finance user is refused, in the server and the database', async () => {
        expect((await results(finance))[0]).toBe(403);
        const token = secretHash(finance.split('=')[1]);
        const { rows: [r] } = await db.query<{ out: { error: string } }>('select public.fingence_workspace_uat_results($1) out', [token]);
        expect(r.out).toEqual({ error: 'FORBIDDEN' });
    });
    it('an Admin sees every tester in the organization with their role, answers and status, newest first', async () => {
        const [status, out] = await results(admin);
        expect(status).toBe(200);
        expect(out.testers.map((t: { email: string }) => t.email)).toEqual(['finance@saic.example', 'finance2@example.invalid']);
        const first = out.testers.find((t: { email: string }) => t.email === 'finance@saic.example');
        expect(first).toMatchObject({ role: 'FINANCE', active: true, mine: false, appVersion: 'abc1234', submittedAt: expect.any(String), answers: { tasks: { 2: { result: 'ISSUE', severity: 'WORKAROUND' } } } });
        expect(out.testers.find((t: { email: string }) => t.email === 'finance2@example.invalid').submittedAt).toBeNull();
        expect((await results(superadmin))[0]).toBe(200);
    });
    it('the functions are for the service role only, and the table has row security forced', async () => {
        const { rows: grants } = await db.query<{ fn: string; anon: boolean; auth: boolean; service: boolean }>(`select p.proname fn, has_function_privilege('anon', p.oid, 'execute') anon,
            has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('service_role', p.oid, 'execute') service from pg_proc p where p.proname like 'fingence_workspace%uat%'`);
        expect(grants).toHaveLength(3);
        for (const g of grants) expect(g).toMatchObject({ anon: false, auth: false, service: true });
        const { rows: [t] } = await db.query<{ rls: boolean; forced: boolean }>("select relrowsecurity rls, relforcerowsecurity forced from pg_class where oid = 'fingence_workspace.uat_results'::regclass");
        expect(t).toEqual({ rls: true, forced: true });
    });
    it('answers belong to the member: removing a member would remove them', async () => {
        const { rows: [fk] } = await db.query<{ action: string }>("select confdeltype action from pg_constraint where conrelid = 'fingence_workspace.uat_results'::regclass and contype = 'f' and confrelid = 'fingence_workspace.members'::regclass");
        expect(fk.action).toBe('c');
    });
});

describe('appVersion', () => {
    it('is the short commit on Vercel and "local" elsewhere', () => {
        expect(h.appVersion({ VERCEL_GIT_COMMIT_SHA: '5E58A99F00112233445566778899AABBCCDDEEFF' })).toBe('5e58a99');
        expect(h.appVersion({})).toBe('local');
        expect(h.appVersion({ VERCEL_GIT_COMMIT_SHA: 'not a sha' })).toBe('local');
    });
});
