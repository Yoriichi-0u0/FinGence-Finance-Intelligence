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
 * The workspace end to end: the route handlers against the real migration (supabase/sql/workspace-v1.sql) in an
 * in-memory Postgres, through a PostgREST-shaped transport. Every role boundary is checked in both the server and the database.
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

let admin: string, finance: string, management: string;
beforeAll(async () => {
    db = await workspaceDatabase();
    deps = { store, transport: rpcTransport(db), attempts: async () => true };
    admin = await join(await bootstrap('Rimba Demo Kitchen', 'Admin@Example.invalid'));
    finance = await join(await invite(admin, 'finance@example.invalid', 'FINANCE'));
    management = await join(await invite(admin, 'ops@example.invalid', 'MANAGEMENT'));
}, 60_000);

describe('joining and signing in', () => {
    it('an owner code makes the first Admin; an Admin invitation is the only approval a member needs', async () => {
        expect(await body(await h.session(req('/api/workspace/session', { cookie: admin }), deps))).toEqual([200, expect.objectContaining({ signedIn: true, email: 'admin@example.invalid', role: 'ADMIN', organization: { name: 'Rimba Demo Kitchen' } })]);
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

describe('each role sees only its own part', () => {
    it('Finance processes; the run is recorded for the organization and attributed to them', async () => {
        const [status, out] = await body(await h.recordRun(req('/api/ingestion/runs', { body: runPayload(await phase1()), cookie: finance }), deps));
        expect(status).toBe(201);
        const run = (await db.query<{ organization_id: string; email: string }>('select r.organization_id::text, m.email from fingence_ingestion.runs r join fingence_workspace.members m on m.id = r.member_id where r.id = $1', [out.runId])).rows[0];
        expect(run.email).toBe('finance@example.invalid');
    });
    it('Management sees every run, its documents, checks and model receipts, but never the records', async () => {
        const [status, ops] = await body(await h.operations(req('/api/workspace/operations', { cookie: management }), deps));
        expect(status).toBe(200);
        expect(ops.runs[0]).toMatchObject({ by: 'finance@example.invalid', documents: 3, accepted: 3, quarantined: 0, unavailable: 0 });
        expect(ops.sessions.map((s: { email: string }) => s.email)).toEqual(expect.arrayContaining(['admin@example.invalid', 'finance@example.invalid', 'ops@example.invalid']));
        const [, detail] = await body(await h.operations(req(`/api/workspace/operations?run=${ops.runs[0].id}`, { cookie: management }), deps));
        expect(detail.documents.map((d: { name: string; record_count: number; decision: string }) => [d.decision, d.record_count])).toEqual([['AUTO_ACCEPTED', 57], ['AUTO_ACCEPTED', 57], ['AUTO_ACCEPTED', 618]]);
        expect(detail.documents[0]).toMatchObject({ method: 'EXACT_SIGNATURE', format: 'CSV', role: 'BANK_STATEMENT', reason: expect.any(String), checks: [] });
        expect(JSON.stringify(detail)).not.toMatch(/signed_cents|signedCents|"records"/);
    });
    it('Admin manages the team and sees sessions and the audit trail, not runs', async () => {
        const [, ops] = await body(await h.operations(req('/api/workspace/operations', { cookie: admin }), deps));
        expect(ops.runs).toBeNull();
        expect(ops.audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['member.joined', 'invitation.issued', 'session.opened']));
        expect((await h.operations(req(`/api/workspace/operations?run=${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, { cookie: admin }), deps)).status).toBe(403);
        const [, team] = await body(await h.team(req('/api/workspace/team', { cookie: admin }), deps));
        expect(team.members.map((m: { email: string; role: string }) => [m.email, m.role]).slice(0, 3)).toEqual([['admin@example.invalid', 'ADMIN'], ['finance@example.invalid', 'FINANCE'], ['ops@example.invalid', 'MANAGEMENT']]);
    });
    it('every other combination is refused, by the server and again by the database', async () => {
        const payload = runPayload(await phase1());
        expect((await h.team(req('/api/workspace/team', { cookie: finance }), deps)).status).toBe(403);
        expect((await h.team(req('/api/workspace/team', { cookie: management }), deps)).status).toBe(403);
        expect((await h.operations(req('/api/workspace/operations', { cookie: finance }), deps)).status).toBe(403);
        expect((await h.operationsChange(req('/api/workspace/operations', { body: { action: 'resume' }, cookie: admin }), deps)).status).toBe(403);
        for (const who of [admin, management]) expect((await h.recordRun(req('/api/ingestion/runs', { body: payload, cookie: who }), deps)).status).toBe(403);
        expect(await body(await h.recordRun(req('/api/ingestion/runs', { body: payload }), deps))).toEqual([401, { code: 'SIGN_IN_REQUIRED' }]);
        // The database refuses on its own, whatever the server asks.
        const token = (c: string) => secretHash(c.split('=')[1]);
        expect((await db.query<{ r: unknown }>('select public.fingence_workspace_team($1) r', [token(finance)])).rows[0].r).toEqual({ error: 'FORBIDDEN' });
        expect((await db.query<{ r: unknown }>('select public.fingence_workspace_set_processing($1, true, $2) r', [token(admin), 'x'])).rows[0].r).toEqual({ error: 'FORBIDDEN' });
        expect((await db.query<{ r: unknown }>('select public.fingence_workspace_record_run($1, $2) r', [token(management), JSON.stringify(payload)])).rows[0].r).toEqual({ error: 'FORBIDDEN' });
    });
    it('only the service role may call the functions or read the tables', async () => {
        for (const role of ['anon', 'authenticated']) {
            await db.exec(`set role ${role}`);
            await expect(db.query('select public.fingence_workspace_principal($1)', ['0'.repeat(64)])).rejects.toThrow(/permission denied/);
            await expect(db.query('select * from fingence_workspace.members')).rejects.toThrow(/permission denied/);
            await db.exec('reset role');
        }
    });
    it('another organization sees nothing of this one', async () => {
        const other = await join(await bootstrap('Other Org', 'admin@other.invalid'));
        const otherOps = await join(await invite(other, 'ops@other.invalid', 'MANAGEMENT'));
        const [, ops] = await body(await h.operations(req('/api/workspace/operations', { cookie: otherOps }), deps));
        expect([ops.runs, ops.sessions.map((s: { email: string }) => s.email).sort()]).toEqual([[], ['admin@other.invalid', 'ops@other.invalid']]);
        const runId = (await db.query<{ id: string }>('select id::text from fingence_ingestion.runs limit 1')).rows[0].id;
        expect((await h.operations(req(`/api/workspace/operations?run=${runId}`, { cookie: otherOps }), deps)).status).toBe(404);
        expect((await h.teamChange(req('/api/workspace/team', { body: { action: 'end-sessions', memberId: await memberId('finance@example.invalid') }, cookie: other }), deps)).status).toBe(404);
    });
});

describe('Management steps in when something is wrong', () => {
    it('a pause stops Finance processing at once, with the reason shown to them, until it is resumed', async () => {
        const headers = new Headers({ cookie: finance });
        expect(await body(await h.operationsChange(req('/api/workspace/operations', { body: { action: 'pause', reason: '' }, cookie: management }), deps))).toEqual([400, { code: 'INVALID_INPUT' }]);
        expect((await h.operationsChange(req('/api/workspace/operations', { body: { action: 'pause', reason: 'Checking scanned statements' }, cookie: management }), deps)).status).toBe(200);
        expect(await processingRefusal(headers, store, deps.transport)).toEqual({ code: 'PROCESSING_PAUSED', status: 423, reason: 'Checking scanned statements' });
        expect(await body(await h.recordRun(req('/api/ingestion/runs', { body: runPayload(await phase1()), cookie: finance }), deps))).toEqual([423, { code: 'PROCESSING_PAUSED' }]);
        expect((await body(await h.session(req('/api/workspace/session', { cookie: finance }), deps)))[1].processing).toMatchObject({ paused: true, reason: 'Checking scanned statements' });
        expect((await h.operationsChange(req('/api/workspace/operations', { body: { action: 'resume' }, cookie: management }), deps)).status).toBe(200);
        expect(await processingRefusal(headers, store, deps.transport)).toBeNull();
    });
    it('the public demo (no session) is not affected by any organization', async () => {
        expect(await processingRefusal(new Headers(), store, deps.transport)).toBeNull();
    });
    it('Management (or Admin) can end a session: that person is signed out and their processing is refused', async () => {
        const victim = (await h.signIn(req('/api/workspace/sign-in', { body: { email: 'second@example.invalid', password: 'correct horse battery' } }), deps));
        const cookie = cookieOf(victim);
        expect(await processingRefusal(new Headers({ cookie }), store, deps.transport)).toBeNull();
        expect(await body(await h.operationsChange(req('/api/workspace/operations', { body: { action: 'end-sessions', memberId: await memberId('second@example.invalid') }, cookie: management }), deps))).toEqual([200, { ok: true, sessionsEnded: 2 }]);
        expect(await processingRefusal(new Headers({ cookie }), store, deps.transport)).toEqual({ code: 'SESSION_ENDED', status: 401 });
        expect((await caller(new Headers({ cookie }), store, deps.transport)).kind).toBe('ENDED');
        const ended = await h.session(req('/api/workspace/session', { cookie }), deps);
        expect([await ended.json(), ended.headers.get('set-cookie')]).toEqual([{ signedIn: false, ended: true }, expect.stringMatching(/Max-Age=0/)]);
        const [, ops] = await body(await h.operations(req('/api/workspace/operations', { cookie: management }), deps));
        expect(ops.audit[0]).toMatchObject({ action: 'session.ended', actor: 'ops@example.invalid', detail: { sessionsEnded: 2 } });
    });
});

describe('Admin changes access', () => {
    it('a role change or turning access off signs the member out; a stale version is refused', async () => {
        const id = await memberId('short@example.invalid');
        const cookie = cookieOf(await h.signIn(req('/api/workspace/sign-in', { body: { email: 'short@example.invalid', password: 'correct horse battery' } }), deps));
        const update = (role: string, active: boolean, version: number) => h.teamChange(req('/api/workspace/team', { body: { action: 'update-member', memberId: id, role, active, version }, cookie: admin }), deps);
        expect(await body(await update('MANAGEMENT', true, 1))).toEqual([200, { ok: true, version: 2, sessionsEnded: 2 }]);
        expect((await caller(new Headers({ cookie }), store, deps.transport)).kind).toBe('ENDED');
        expect(await body(await update('FINANCE', false, 1))).toEqual([409, { code: 'STALE' }]);
        expect((await body(await update('FINANCE', false, 2)))[0]).toBe(200);
        expect((await h.signIn(req('/api/workspace/sign-in', { body: { email: 'short@example.invalid', password: 'correct horse battery' } }), deps)).status).toBe(401);
    });
    it('the last active Admin cannot be demoted or turned off', async () => {
        const id = await memberId('admin@example.invalid');
        const version = (await db.query<{ version: number }>('select version from fingence_workspace.members where id = $1', [id])).rows[0].version;
        expect(await body(await h.teamChange(req('/api/workspace/team', { body: { action: 'update-member', memberId: id, role: 'FINANCE', active: true, version }, cookie: admin }), deps))).toEqual([409, { code: 'LAST_ADMIN' }]);
        expect(await body(await h.teamChange(req('/api/workspace/team', { body: { action: 'update-member', memberId: id, role: 'ADMIN', active: false, version }, cookie: admin }), deps))).toEqual([409, { code: 'LAST_ADMIN' }]);
    });
    it('an invitation can be withdrawn, and an email that already has an account cannot be invited', async () => {
        const code = await invite(admin, 'later@example.invalid', 'FINANCE');
        const [, team] = await body(await h.team(req('/api/workspace/team', { cookie: admin }), deps));
        const pending = team.invitations.find((i: { email: string }) => i.email === 'later@example.invalid');
        expect((await h.teamChange(req('/api/workspace/team', { body: { action: 'revoke-invitation', invitationId: pending.id }, cookie: admin }), deps)).status).toBe(200);
        expect(await body(await h.join(req('/api/workspace/join', { body: { code, password: 'correct horse battery' } }), deps))).toEqual([400, { code: 'INVITATION_UNAVAILABLE' }]);
        expect(await body(await h.teamChange(req('/api/workspace/team', { body: { action: 'invite', email: 'finance@example.invalid', role: 'ADMIN' }, cookie: admin }), deps))).toEqual([409, { code: 'ALREADY_MEMBER' }]);
    });
    it('signing out ends only that session', async () => {
        const cookie = cookieOf(await h.signIn(req('/api/workspace/sign-in', { body: { email: 'ops@example.invalid', password: 'correct horse battery' } }), deps));
        const out = await h.signOut(req('/api/workspace/sign-out', { method: 'POST', cookie }), deps);
        expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
        expect((await caller(new Headers({ cookie }), store, deps.transport)).kind).toBe('ENDED');
        expect((await caller(new Headers({ cookie: management }), store, deps.transport)).kind).toBe('SIGNED_IN');
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
        expect(await processingRefusal(new Headers({ cookie: finance }), null, deps.transport)).toBeNull();
    });
});
