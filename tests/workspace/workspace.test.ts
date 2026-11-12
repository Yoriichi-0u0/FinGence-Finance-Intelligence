import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import { runPayload } from '../../lib/document-ingestion/run-payload';
import * as h from '../../lib/server/workspace/handlers';
import { caller, processingRefusal } from '../../lib/server/workspace/session';
import { newSecret, secretHash, workspaceStore, type Store } from '../../lib/server/workspace/store';
import { phase1 } from '../grounded-qa/fixtures';
import { rpcTransport, workspaceDatabase } from './db';

/**
 * The workspace end to end (SAIC users only): the route handlers against the real migrations (supabase/sql/workspace-v1.sql,
 * then workspace-v2-saic.sql) in an in-memory Postgres, through a PostgREST-shaped transport. Three stacked roles,
 * Finance user < Admin < Superadmin; every boundary is checked in both the server and the database.
 */
const ORIGIN = 'http://localhost:3000';
const store: Store = { url: 'https://example-project.supabase.co', key: 'sb_secret_not_real' };
let db: PGlite, deps: h.Deps;
const req = (path: string, init: { method?: string; body?: unknown; cookie?: string | null } = {}) => new Request(`${ORIGIN}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { host: 'localhost:3000', origin: ORIGIN, 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
});
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
const body = async (res: Response) => [res.status, await res.json()] as const;
async function bootstrap(name: string, email: string) {
    const code = newSecret();
    await db.query('select public.fingence_workspace_bootstrap($1, $2, $3)', [name, email, secretHash(code)]);
    return code;
}
async function join(code: string, password = 'correct horse battery') {
    const res = await h.join(req('/api/workspace/join', { body: { code, password } }), deps);
    expect(res.status).toBe(200);
    return cookieOf(res);
}
async function invite(admin: string, email: string, role: string) {
    const [status, out] = await body(await h.teamChange(req('/api/workspace/team', { body: { action: 'invite', email, role }, cookie: admin }), deps));
    expect(status).toBe(200);
    return out.code as string;
}
const memberId = async (email: string) => (await db.query<{ id: string }>('select id::text from fingence_workspace.members where email = $1', [email])).rows[0].id;

const token = (c: string) => secretHash(c.split('=')[1]);
const dbCall = async (sql: string, args: unknown[]) => (await db.query<{ r: unknown }>(sql, args)).rows[0].r;
const team = (cookie: string, body: unknown) => h.teamChange(req('/api/workspace/team', { body, cookie }), deps);
const ops = (cookie: string, body: unknown) => h.operationsChange(req('/api/workspace/operations', { body, cookie }), deps);
const version = async (id: string) => (await db.query<{ version: number }>('select version from fingence_workspace.members where id = $1', [id])).rows[0].version;
const signIn = async (email: string) => cookieOf(await h.signIn(req('/api/workspace/sign-in', { body: { email, password: 'correct horse battery' } }), deps));

let superadmin: string, admin: string, finance: string;
beforeAll(async () => {
    db = await workspaceDatabase();
    deps = { store, transport: rpcTransport(db), attempts: async () => true };
    superadmin = await join(await bootstrap('SAIC', 'Super@Example.invalid'));
    admin = await join(await invite(superadmin, 'admin@example.invalid', 'ADMIN'));
    finance = await join(await invite(admin, 'finance@example.invalid', 'FINANCE'));
}, 60_000);

describe('joining and signing in', () => {
    it('the owner code makes the first Superadmin; an invitation is the only approval anyone else needs', async () => {
        expect(await body(await h.session(req('/api/workspace/session', { cookie: superadmin }), deps))).toEqual([200, expect.objectContaining({ signedIn: true, email: 'super@example.invalid', role: 'SUPERADMIN', organization: { name: 'SAIC' }, ai: { enabled: true } })]);
        expect((await body(await h.session(req('/api/workspace/session', { cookie: admin }), deps)))[1]).toMatchObject({ role: 'ADMIN' });
        expect((await body(await h.session(req('/api/workspace/session', { cookie: finance }), deps)))[1]).toMatchObject({ role: 'FINANCE', processing: { paused: false } });
    });
    it('a code works once, and the database keeps only hashes of codes, tokens and passwords', async () => {
        const code = await invite(admin, 'second@example.invalid', 'FINANCE');
        await join(code);
        expect(await body(await h.join(req('/api/workspace/join', { body: { code, password: 'another long password' } }), deps))).toEqual([400, { code: 'INVITATION_UNAVAILABLE' }]);
        const dump = JSON.stringify((await db.query('select (select json_agg(m) from fingence_workspace.members m) a, (select json_agg(s) from fingence_workspace.sessions s) b, (select json_agg(i) from fingence_workspace.invitations i) c')).rows);
        expect(dump).not.toContain(code);
        expect(dump).not.toContain(finance.split('=')[1]);
        expect(dump).not.toContain('correct horse battery');
        expect(dump).toContain('scrypt$');
    });
    it('a short password is refused before the code is used', async () => {
        const code = await invite(admin, 'short@example.invalid', 'FINANCE');
        expect(await body(await h.join(req('/api/workspace/join', { body: { code, password: 'too short' } }), deps))).toEqual([400, { code: 'PASSWORD_RULE' }]);
        await join(code);
    });
    it('a wrong password and an unknown email get the same answer; the right one opens a session', async () => {
        const attempt = (email: string, password: string) => h.signIn(req('/api/workspace/sign-in', { body: { email, password } }), deps);
        expect(await body(await attempt('finance@example.invalid', 'wrong password!!'))).toEqual([401, { code: 'INVALID_CREDENTIALS' }]);
        expect(await body(await attempt('nobody@example.invalid', 'correct horse battery'))).toEqual([401, { code: 'INVALID_CREDENTIALS' }]);
        const ok = await attempt(' FINANCE@example.invalid ', 'correct horse battery');
        expect([ok.status, ok.headers.get('set-cookie')]).toEqual([200, expect.stringMatching(/^fingence_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200/)]);
    });
    it('too many attempts are refused before any password check', async () => {
        const res = await h.signIn(req('/api/workspace/sign-in', { body: { email: 'finance@example.invalid', password: 'x' } }), { ...deps, attempts: async () => false });
        expect(await body(res)).toEqual([429, { code: 'TOO_MANY_ATTEMPTS' }]);
    });
    it('cross-origin sign-in is refused', async () => {
        const res = await h.signIn(new Request(`${ORIGIN}/api/workspace/sign-in`, { method: 'POST', headers: { host: 'localhost:3000', origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }), deps);
        expect(res.status).toBe(403);
    });
});

describe('SAIC users only', () => {
    it('there is no public demo: without a session, processing and run recording are refused', async () => {
        expect(await processingRefusal(new Headers(), {}, store, deps.transport)).toEqual({ code: 'SIGN_IN_REQUIRED', status: 401 });
        expect(await body(await h.recordRun(req('/api/ingestion/runs', { body: runPayload(await phase1()) }), deps))).toEqual([401, { code: 'SIGN_IN_REQUIRED' }]);
    });
    it('there is one organization: the owner script reuses it, and the database refuses a second', async () => {
        const again = await join(await bootstrap('Another name', 'super2@example.invalid'));
        expect((await body(await h.session(req('/api/workspace/session', { cookie: again }), deps)))[1]).toMatchObject({ role: 'SUPERADMIN', organization: { name: 'SAIC' } });
        expect((await db.query<{ n: number }>('select count(*)::int n from fingence_workspace.organizations')).rows[0].n).toBe(1);
        await expect(db.query(`insert into fingence_workspace.organizations (name) values ('Other')`)).rejects.toThrow(/duplicate key/);
    });
    it('only the service role may call the functions or read the tables', async () => {
        for (const role of ['anon', 'authenticated']) {
            await db.exec(`set role ${role}`);
            await expect(db.query('select public.fingence_workspace_principal($1)', ['0'.repeat(64)])).rejects.toThrow(/permission denied/);
            await expect(db.query('select public.fingence_workspace_set_ai($1, false)', ['0'.repeat(64)])).rejects.toThrow(/permission denied/);
            await expect(db.query('select * from fingence_workspace.members')).rejects.toThrow(/permission denied/);
            await db.exec('reset role');
        }
    });
});

describe('every role processes; the roles stack', () => {
    it('a Finance user, an Admin and a Superadmin can all process, and each run is attributed to them', async () => {
        for (const [who, email] of [[finance, 'finance@example.invalid'], [admin, 'admin@example.invalid'], [superadmin, 'super@example.invalid']] as const) {
            const [status, out] = await body(await h.recordRun(req('/api/ingestion/runs', { body: runPayload(await phase1()), cookie: who }), deps));
            expect(status).toBe(201);
            expect((await db.query<{ email: string }>('select m.email from fingence_ingestion.runs r join fingence_workspace.members m on m.id = r.member_id where r.id = $1', [out.runId])).rows[0].email).toBe(email);
            expect(await processingRefusal(new Headers({ cookie: who }), { ai: true }, store, deps.transport)).toBeNull();
        }
    });
    it('a Finance user has no Team or Operations', async () => {
        expect((await h.team(req('/api/workspace/team', { cookie: finance }), deps)).status).toBe(403);
        expect((await h.operations(req('/api/workspace/operations', { cookie: finance }), deps)).status).toBe(403);
        expect((await ops(finance, { action: 'pause', reason: 'x' })).status).toBe(403);
        expect(await dbCall('select public.fingence_workspace_team($1) r', [token(finance)])).toEqual({ error: 'FORBIDDEN' });
        expect(await dbCall('select public.fingence_workspace_set_processing($1, true, $2) r', [token(finance), 'x'])).toEqual({ error: 'FORBIDDEN' });
    });
    it('an Admin sees every run, its documents, checks and model receipts, never the records, and no audit trail', async () => {
        const [status, o] = await body(await h.operations(req('/api/workspace/operations', { cookie: admin }), deps));
        expect(status).toBe(200);
        expect(o.runs).toHaveLength(3);
        expect(o.runs.at(-1)).toMatchObject({ by: 'finance@example.invalid', documents: 3, accepted: 3, quarantined: 0, unavailable: 0 });
        expect([o.audit, o.ai]).toEqual([null, { enabled: true, since: null, by: null }]);
        const [, detail] = await body(await h.operations(req(`/api/workspace/operations?run=${o.runs[0].id}`, { cookie: admin }), deps));
        expect(detail.documents.map((d: { record_count: number; decision: string }) => [d.decision, d.record_count])).toEqual([['AUTO_ACCEPTED', 57], ['AUTO_ACCEPTED', 57], ['AUTO_ACCEPTED', 618]]);
        expect(JSON.stringify(detail)).not.toMatch(/signed_cents|signedCents|"records"/);
    });
    it('a Superadmin also sees the audit trail', async () => {
        const [, o] = await body(await h.operations(req('/api/workspace/operations', { cookie: superadmin }), deps));
        expect(o.audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['member.joined', 'invitation.issued', 'session.opened']));
    });
});

describe('each manages only people below their own role', () => {
    it('an Admin invites Finance users only; a Superadmin also invites Admins; nobody invites a Superadmin in the app', async () => {
        expect(await body(await team(admin, { action: 'invite', email: 'x1@example.invalid', role: 'ADMIN' }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
        expect(await body(await team(admin, { action: 'invite', email: 'x1@example.invalid', role: 'SUPERADMIN' }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
        expect(await body(await team(superadmin, { action: 'invite', email: 'x1@example.invalid', role: 'SUPERADMIN' }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
        expect((await team(superadmin, { action: 'invite', email: 'admin2@example.invalid', role: 'ADMIN' })).status).toBe(200);
        expect(await dbCall('select public.fingence_workspace_invite($1, $2, $3, $4) r', [token(admin), 'x2@example.invalid', 'ADMIN', 'a'.repeat(64)])).toEqual({ error: 'ROLE_NOT_ALLOWED' });
    });
    it('an Admin cannot withdraw an Admin invitation; a Superadmin can', async () => {
        const [, t] = await body(await h.team(req('/api/workspace/team', { cookie: superadmin }), deps));
        const pending = t.invitations.find((i: { email: string }) => i.email === 'admin2@example.invalid');
        expect(await body(await team(admin, { action: 'revoke-invitation', invitationId: pending.id }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
        expect((await team(superadmin, { action: 'revoke-invitation', invitationId: pending.id })).status).toBe(200);
    });
    it('an Admin cannot change another Admin, a Superadmin or themselves, nor make anyone an Admin', async () => {
        const fin = await memberId('second@example.invalid'), adm = await memberId('admin@example.invalid'), sup = await memberId('super@example.invalid');
        expect(await body(await team(admin, { action: 'update-member', memberId: fin, role: 'ADMIN', active: true, version: await version(fin) }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
        expect(await body(await team(admin, { action: 'update-member', memberId: adm, role: 'FINANCE', active: true, version: await version(adm) }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
        expect(await body(await team(admin, { action: 'update-member', memberId: sup, role: 'FINANCE', active: false, version: await version(sup) }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
        expect(await body(await team(admin, { action: 'end-sessions', memberId: sup }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
    });
    it('a Superadmin cannot change another Superadmin or themselves', async () => {
        const sup = await memberId('super@example.invalid'), sup2 = await memberId('super2@example.invalid');
        expect(await body(await team(superadmin, { action: 'update-member', memberId: sup2, role: 'ADMIN', active: true, version: await version(sup2) }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
        expect(await body(await team(superadmin, { action: 'update-member', memberId: sup, role: 'SUPERADMIN', active: false, version: await version(sup) }))).toEqual([403, { code: 'ROLE_NOT_ALLOWED' }]);
    });
    it('a role change or turning access off signs the member out; a stale version is refused', async () => {
        const id = await memberId('short@example.invalid');
        const cookie = await signIn('short@example.invalid');
        expect(await body(await team(superadmin, { action: 'update-member', memberId: id, role: 'ADMIN', active: true, version: 1 }))).toEqual([200, { ok: true, version: 2, sessionsEnded: 2 }]);
        expect((await caller(new Headers({ cookie }), store, deps.transport)).kind).toBe('ENDED');
        expect(await body(await team(superadmin, { action: 'update-member', memberId: id, role: 'FINANCE', active: false, version: 1 }))).toEqual([409, { code: 'STALE' }]);
        expect((await team(superadmin, { action: 'update-member', memberId: id, role: 'FINANCE', active: false, version: 2 })).status).toBe(200);
        expect((await h.signIn(req('/api/workspace/sign-in', { body: { email: 'short@example.invalid', password: 'correct horse battery' } }), deps)).status).toBe(401);
    });
    it('an Admin signs out a Finance user: their processing is refused at once', async () => {
        const cookie = await signIn('second@example.invalid');
        expect(await processingRefusal(new Headers({ cookie }), {}, store, deps.transport)).toBeNull();
        expect(await body(await ops(admin, { action: 'end-sessions', memberId: await memberId('second@example.invalid') }))).toEqual([200, { ok: true, sessionsEnded: 2 }]);
        expect(await processingRefusal(new Headers({ cookie }), {}, store, deps.transport)).toEqual({ code: 'SESSION_ENDED', status: 401 });
        const ended = await h.session(req('/api/workspace/session', { cookie }), deps);
        expect([await ended.json(), ended.headers.get('set-cookie')]).toEqual([{ signedIn: false, ended: true }, expect.stringMatching(/Max-Age=0/)]);
        const [, o] = await body(await h.operations(req('/api/workspace/operations', { cookie: superadmin }), deps));
        expect(o.audit[0]).toMatchObject({ action: 'session.ended', actor: 'admin@example.invalid', detail: { sessionsEnded: 2 } });
    });
    it('an invitation can be withdrawn, and an email that already has an account cannot be invited', async () => {
        const code = await invite(admin, 'later@example.invalid', 'FINANCE');
        const [, t] = await body(await h.team(req('/api/workspace/team', { cookie: admin }), deps));
        const pending = t.invitations.find((i: { email: string }) => i.email === 'later@example.invalid');
        expect((await team(admin, { action: 'revoke-invitation', invitationId: pending.id })).status).toBe(200);
        expect(await body(await h.join(req('/api/workspace/join', { body: { code, password: 'correct horse battery' } }), deps))).toEqual([400, { code: 'INVITATION_UNAVAILABLE' }]);
        expect(await body(await team(admin, { action: 'invite', email: 'finance@example.invalid', role: 'FINANCE' }))).toEqual([409, { code: 'ALREADY_MEMBER' }]);
    });
});

describe('stepping in when something is wrong', () => {
    it('an Admin pauses processing: everyone is refused at once, with the reason, until it is resumed', async () => {
        const headers = new Headers({ cookie: finance });
        expect(await body(await ops(admin, { action: 'pause', reason: '' }))).toEqual([400, { code: 'INVALID_INPUT' }]);
        expect((await ops(admin, { action: 'pause', reason: 'Checking scanned statements' })).status).toBe(200);
        expect(await processingRefusal(headers, {}, store, deps.transport)).toEqual({ code: 'PROCESSING_PAUSED', status: 423, reason: 'Checking scanned statements' });
        expect(await body(await h.recordRun(req('/api/ingestion/runs', { body: runPayload(await phase1()), cookie: superadmin }), deps))).toEqual([423, { code: 'PROCESSING_PAUSED' }]);
        expect((await body(await h.session(req('/api/workspace/session', { cookie: finance }), deps)))[1].processing).toMatchObject({ paused: true, reason: 'Checking scanned statements' });
        expect((await ops(admin, { action: 'resume' })).status).toBe(200);
        expect(await processingRefusal(headers, {}, store, deps.transport)).toBeNull();
    });
    it('only a Superadmin turns the AI off; the AI routes are then refused, while rule-based processing continues', async () => {
        expect(await body(await ops(admin, { action: 'ai', enabled: false }))).toEqual([403, { code: 'FORBIDDEN' }]);
        expect(await dbCall('select public.fingence_workspace_set_ai($1, false) r', [token(admin)])).toEqual({ error: 'FORBIDDEN' });
        expect(await body(await ops(superadmin, { action: 'ai', enabled: false }))).toEqual([200, { ok: true, enabled: false }]);
        const headers = new Headers({ cookie: finance });
        expect(await processingRefusal(headers, { ai: true }, store, deps.transport)).toEqual({ code: 'AI_OFF', status: 423 });
        expect(await processingRefusal(headers, {}, store, deps.transport)).toBeNull();
        expect((await body(await h.session(req('/api/workspace/session', { cookie: finance }), deps)))[1].ai).toEqual({ enabled: false });
        const [, o] = await body(await h.operations(req('/api/workspace/operations', { cookie: superadmin }), deps));
        expect([o.ai.enabled, o.ai.by, o.audit[0].action]).toEqual([false, 'super@example.invalid', 'ai.disabled']);
        expect((await ops(superadmin, { action: 'ai', enabled: true })).status).toBe(200);
        expect(await processingRefusal(headers, { ai: true }, store, deps.transport)).toBeNull();
    });
    it('signing out ends only that session', async () => {
        const cookie = await signIn('admin@example.invalid');
        const out = await h.signOut(req('/api/workspace/sign-out', { method: 'POST', cookie }), deps);
        expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
        expect((await caller(new Headers({ cookie }), store, deps.transport)).kind).toBe('ENDED');
        expect((await caller(new Headers({ cookie: admin }), store, deps.transport)).kind).toBe('SIGNED_IN');
    });
});

describe('changing your own password', () => {
    const change = (cookie: string | null, b: unknown) => h.changePassword(req('/api/workspace/password', { body: b, cookie }), deps);
    let member: string;
    beforeAll(async () => {
        const boss = await signIn('super@example.invalid');
        member = await join(await invite(boss, 'handed-out@example.invalid', 'FINANCE'));
    });
    it('needs a session, the same origin, the right current password and a valid new one', async () => {
        expect((await change(null, { current: 'correct horse battery', next: 'a brand new passphrase' })).status).toBe(401);
        const cross = await h.changePassword(new Request(`${ORIGIN}/api/workspace/password`, { method: 'POST', headers: { host: 'localhost:3000', origin: 'https://evil.example', 'content-type': 'application/json', cookie: member }, body: JSON.stringify({ current: 'correct horse battery', next: 'a brand new passphrase' }) }), deps);
        expect(cross.status).toBe(403);
        expect(await body(await change(member, { current: 'not my password', next: 'a brand new passphrase' }))).toEqual([401, { code: 'WRONG_PASSWORD' }]);
        expect(await body(await change(member, { current: 'correct horse battery', next: 'too short' }))).toEqual([400, { code: 'PASSWORD_RULE' }]);
        expect(await body(await change(member, { current: 'correct horse battery', next: 'correct horse battery' }))).toEqual([400, { code: 'PASSWORD_UNCHANGED' }]);
        expect(await body(await change(member, { current: 'correct horse battery', next: 'a brand new passphrase', role: 'ADMIN' }))).toEqual([400, { code: 'INVALID_INPUT' }]);
    });
    it('wrong current passwords are rate-limited like sign-in', async () => {
        const res = await h.changePassword(req('/api/workspace/password', { body: { current: 'x', next: 'a brand new passphrase' }, cookie: member }), { ...deps, attempts: async () => false });
        expect(await body(res)).toEqual([429, { code: 'TOO_MANY_ATTEMPTS' }]);
    });
    it('the new password replaces the old one, ends every other sign-in, and keeps this one', async () => {
        const other = cookieOf(await h.signIn(req('/api/workspace/sign-in', { body: { email: 'handed-out@example.invalid', password: 'correct horse battery' } }), deps));
        const [status, out] = await body(await change(member, { current: 'correct horse battery', next: 'a brand new passphrase' }));
        expect(status).toBe(200);
        expect(out).toEqual({ changed: true, otherSessionsEnded: 1 });
        expect((await caller(new Headers({ cookie: member }), store, deps.transport)).kind).toBe('SIGNED_IN');
        expect((await caller(new Headers({ cookie: other }), store, deps.transport)).kind).toBe('ENDED');
        expect((await h.signIn(req('/api/workspace/sign-in', { body: { email: 'handed-out@example.invalid', password: 'correct horse battery' } }), deps)).status).toBe(401);
        expect((await h.signIn(req('/api/workspace/sign-in', { body: { email: 'handed-out@example.invalid', password: 'a brand new passphrase' } }), deps)).status).toBe(200);
    });
    it('only the hash is stored, the change is audited without detail, and a stale current hash is refused', async () => {
        const id = await memberId('handed-out@example.invalid');
        const stored = (await db.query<{ password_hash: string }>('select password_hash from fingence_workspace.members where id = $1', [id])).rows[0].password_hash;
        expect(stored).toMatch(/^scrypt\$/);
        expect(stored).not.toContain('brand new');
        const audit = (await db.query<{ detail: unknown }>("select detail from fingence_workspace.audit where action = 'member.password_changed' and target_id = $1", [id])).rows;
        expect(audit).toEqual([{ detail: {} }]);
        expect(await dbCall('select public.fingence_workspace_change_password($1, $2, $3) as r', [token(member), 'scrypt$stale$hash-that-is-long-enough-to-pass', 'scrypt$new$hash-that-is-long-enough-to-pass'])).toEqual({ error: 'PASSWORD_CHANGED_ELSEWHERE' });
    });
    it('only the service role may call it', async () => {
        const grants = (await db.query<{ anon: boolean; auth: boolean; service: boolean }>("select has_function_privilege('anon', 'public.fingence_workspace_change_password(text, text, text)', 'execute') anon, has_function_privilege('authenticated', 'public.fingence_workspace_change_password(text, text, text)', 'execute') auth, has_function_privilege('service_role', 'public.fingence_workspace_change_password(text, text, text)', 'execute') service")).rows[0];
        expect(grants).toEqual({ anon: false, auth: false, service: true });
    });
});

describe('configuration', () => {
    it('a loopback stand-in is honoured only in development, never in a production build or on Vercel', () => {
        vi.stubEnv('FINGENCE_WORKSPACE', '1'); vi.stubEnv('FINGENCE_WORKSPACE_LOCAL_URL', 'http://127.0.0.1:54329'); vi.stubEnv('FINGENCE_INGESTION_STORE', ''); vi.stubEnv('VERCEL', '');
        vi.stubEnv('NODE_ENV', 'development');
        expect(workspaceStore()).toEqual({ url: 'http://127.0.0.1:54329', key: 'local-development' });
        vi.stubEnv('VERCEL', '1');
        expect(workspaceStore()).toBeNull();
        vi.stubEnv('VERCEL', ''); vi.stubEnv('NODE_ENV', 'production');
        expect(workspaceStore()).toBeNull();
        vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('FINGENCE_WORKSPACE_LOCAL_URL', 'http://evil.example:80');
        expect(workspaceStore()).toBeNull();
        vi.stubEnv('FINGENCE_WORKSPACE', ''); vi.stubEnv('FINGENCE_WORKSPACE_LOCAL_URL', 'http://127.0.0.1:54329');
        expect(workspaceStore()).toBeNull();
        vi.unstubAllEnvs();
    });
});

describe('when the workspace is off', () => {
    it('every workspace route is absent', async () => {
        const off = { ...deps, store: null };
        for (const res of [await h.session(req('/x'), off), await h.signIn(req('/x', { body: {} }), off), await h.join(req('/x', { body: {} }), off), await h.team(req('/x'), off), await h.operations(req('/x'), off), await h.recordRun(req('/x', { body: {} }), off)])
            expect(res.status).toBe(404);
        expect(await processingRefusal(new Headers({ cookie: finance }), {}, null, deps.transport)).toBeNull();
    });
});
