import 'server-only';
import { z } from 'zod';
import { runPayloadSchema } from '../../document-ingestion/run-payload';
import { boundedJson, noStoreJson as json, sameOrigin } from '../ai/request';
import { hashPassword, passwordAcceptable, verifyPassword } from './password';
import { attemptAllowed, caller, clearedCookie, requireRole, SESSION_HOURS, sessionCookie } from './session';
import { newSecret, ROLES, rpc, secretHash, workspaceStore, type Principal, type Store } from './store';

/** Route logic for /api/workspace/* and the ingestion route, with the store and transport injectable for tests. */
export type Deps = { store: Store | null; transport: typeof fetch; attempts: (headers: Headers, email: string | null) => Promise<boolean> };
export const liveDeps = (): Deps => ({ store: workspaceStore(), transport: fetch, attempts: attemptAllowed });
const notFound = () => new Response('Not found', { status: 404 });
const refuse = (r: { code: string; status: number }) => json({ code: r.code }, r.status);
const email = z.string().trim().toLowerCase().min(3).max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const view = (p: Principal) => ({ signedIn: true, email: p.email, role: p.role, organization: { name: p.organization.name }, processing: p.processing, ai: { enabled: p.ai.enabled } });

export async function session(request: Request, deps: Deps) {
    if (!deps.store) return notFound();
    const who = await caller(request.headers, deps.store, deps.transport);
    if (who.kind === 'UNAVAILABLE') return json({ code: 'WORKSPACE_UNAVAILABLE' }, 503);
    if (who.kind !== 'SIGNED_IN') return new Response(JSON.stringify({ signedIn: false, ended: who.kind === 'ENDED' }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(who.kind === 'ENDED' ? { 'Set-Cookie': clearedCookie() } : {}) } });
    return json(view(who.principal));
}

async function openSession(memberId: string, deps: Deps) {
    const token = newSecret();
    const opened = await rpc<{ sessionId: string }>('fingence_workspace_open_session', { p_member: memberId, p_token_hash: secretHash(token), p_hours: SESSION_HOURS }, deps.store, deps.transport);
    return opened.ok ? token : null;
}
const signedIn = (token: string, body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(token) } });

const signInBody = z.object({ email, password: z.string().min(1).max(512) });
export async function signIn(request: Request, deps: Deps) {
    if (!deps.store) return notFound();
    const read = await boundedJson(request, 4_000);
    if ('refusal' in read) return read.refusal;
    const body = signInBody.safeParse(read.body);
    if (!body.success) return json({ code: 'INVALID_INPUT' }, 400);
    if (!await deps.attempts(request.headers, body.data.email)) return json({ code: 'TOO_MANY_ATTEMPTS' }, 429);
    const found = await rpc<{ memberId: string; passwordHash: string; active: boolean } | null>('fingence_workspace_credentials', { p_email: body.data.email }, deps.store, deps.transport);
    if (!found.ok) return json({ code: 'WORKSPACE_UNAVAILABLE' }, 503);
    const valid = await verifyPassword(body.data.password, found.value?.passwordHash ?? null);
    // One answer for an unknown email, a wrong password and turned-off access.
    if (!valid || !found.value?.active) return json({ code: 'INVALID_CREDENTIALS' }, 401);
    const token = await openSession(found.value.memberId, deps);
    if (!token) return json({ code: 'INVALID_CREDENTIALS' }, 401);
    const who = await caller(new Headers({ cookie: `fingence_session=${token}` }), deps.store, deps.transport);
    return signedIn(token, who.kind === 'SIGNED_IN' ? view(who.principal) : { signedIn: true });
}

const joinBody = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/), password: z.string().max(512) });
export async function join(request: Request, deps: Deps) {
    if (!deps.store) return notFound();
    const read = await boundedJson(request, 4_000);
    if ('refusal' in read) return read.refusal;
    const body = joinBody.safeParse(read.body);
    if (!body.success) return json({ code: 'INVALID_CODE' }, 400);
    if (!passwordAcceptable(body.data.password)) return json({ code: 'PASSWORD_RULE' }, 400);
    if (!await deps.attempts(request.headers, null)) return json({ code: 'TOO_MANY_ATTEMPTS' }, 429);
    const redeemed = await rpc<{ email: string }>('fingence_workspace_redeem', { p_code_hash: secretHash(body.data.code), p_password_hash: await hashPassword(body.data.password) }, deps.store, deps.transport);
    if (!redeemed.ok) return json({ code: redeemed.error.startsWith('STORE_') ? 'WORKSPACE_UNAVAILABLE' : redeemed.error }, redeemed.error.startsWith('STORE_') ? 503 : 400);
    const found = await rpc<{ memberId: string } | null>('fingence_workspace_credentials', { p_email: redeemed.value.email }, deps.store, deps.transport);
    const token = found.ok && found.value ? await openSession(found.value.memberId, deps) : null;
    if (!token) return json({ joined: true, signedIn: false });
    const who = await caller(new Headers({ cookie: `fingence_session=${token}` }), deps.store, deps.transport);
    return signedIn(token, who.kind === 'SIGNED_IN' ? view(who.principal) : { signedIn: true });
}

export async function signOut(request: Request, deps: Deps) {
    if (!deps.store) return notFound();
    if (!sameOrigin(request.headers)) return json({ code: 'CROSS_ORIGIN' }, 403);
    const who = await caller(request.headers, deps.store, deps.transport);
    if (who.kind === 'SIGNED_IN') await rpc('fingence_workspace_sign_out', { p_token_hash: who.tokenHash }, deps.store, deps.transport);
    return new Response(JSON.stringify({ signedIn: false }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': clearedCookie() } });
}

const fail = (error: string) => json({ code: error.startsWith('STORE_') ? 'WORKSPACE_UNAVAILABLE' : error }, error.startsWith('STORE_') ? 503 : error === 'FORBIDDEN' || error === 'ROLE_NOT_ALLOWED' ? 403 : error === 'NOT_FOUND' ? 404 : 409);

/** Admin and above: the team, invitations (a one-time code shown once), role and access changes, ending sessions. Each acts only on people below their own level. */
export async function team(request: Request, deps: Deps) {
    if (!deps.store) return notFound();
    const who = await requireRole(request.headers, 'ADMIN', deps.store, deps.transport);
    if ('refusal' in who) return refuse(who.refusal);
    const result = await rpc('fingence_workspace_team', { p_token_hash: who.tokenHash }, deps.store, deps.transport);
    return result.ok ? json({ organization: who.principal.organization.name, self: who.principal.memberId, ...result.value as object }) : fail(result.error);
}
const teamAction = z.discriminatedUnion('action', [
    z.object({ action: z.literal('invite'), email, role: z.enum(ROLES as [string, ...string[]]) }),
    z.object({ action: z.literal('revoke-invitation'), invitationId: uuid }),
    z.object({ action: z.literal('update-member'), memberId: uuid, role: z.enum(ROLES as [string, ...string[]]), active: z.boolean(), version: z.number().int().min(1) }),
    z.object({ action: z.literal('end-sessions'), memberId: uuid }),
]);
export async function teamChange(request: Request, deps: Deps) {
    if (!deps.store) return notFound();
    const read = await boundedJson(request, 4_000);
    if ('refusal' in read) return read.refusal;
    const body = teamAction.safeParse(read.body);
    if (!body.success) return json({ code: 'INVALID_INPUT' }, 400);
    const who = await requireRole(request.headers, 'ADMIN', deps.store, deps.transport);
    if ('refusal' in who) return refuse(who.refusal);
    const t = { p_token_hash: who.tokenHash }, d = body.data;
    if (d.action === 'invite') {
        const code = newSecret();
        const result = await rpc<{ invitationId: string; expiresAt: string }>('fingence_workspace_invite', { ...t, p_email: d.email, p_role: d.role, p_code_hash: secretHash(code) }, deps.store, deps.transport);
        return result.ok ? json({ ...result.value, code }) : fail(result.error);
    }
    const result = d.action === 'revoke-invitation' ? await rpc('fingence_workspace_revoke_invitation', { ...t, p_invitation: d.invitationId }, deps.store, deps.transport)
        : d.action === 'update-member' ? await rpc('fingence_workspace_update_member', { ...t, p_member: d.memberId, p_role: d.role, p_active: d.active, p_version: d.version }, deps.store, deps.transport)
            : await rpc('fingence_workspace_end_member_sessions', { ...t, p_member: d.memberId }, deps.store, deps.transport);
    return result.ok ? json(result.value) : fail(result.error);
}

/** Admin and above: backend processing (runs, checks, model calls), open sessions, pause and the AI switch; the audit trail for Superadmin. */
export async function operations(request: Request, deps: Deps) {
    if (!deps.store) return notFound();
    const who = await requireRole(request.headers, 'ADMIN', deps.store, deps.transport);
    if ('refusal' in who) return refuse(who.refusal);
    const run = new URL(request.url).searchParams.get('run');
    if (run !== null) {
        if (!uuid.safeParse(run).success) return json({ code: 'INVALID_INPUT' }, 400);
        const detail = await rpc('fingence_workspace_run', { p_token_hash: who.tokenHash, p_run: run }, deps.store, deps.transport);
        return detail.ok ? json(detail.value) : fail(detail.error);
    }
    const result = await rpc('fingence_workspace_operations', { p_token_hash: who.tokenHash }, deps.store, deps.transport);
    return result.ok ? json({ organization: who.principal.organization.name, role: who.principal.role, self: who.principal.memberId, ...result.value as object }) : fail(result.error);
}
const operationsAction = z.discriminatedUnion('action', [
    z.object({ action: z.literal('pause'), reason: z.string().trim().min(1).max(500) }),
    z.object({ action: z.literal('resume') }),
    z.object({ action: z.literal('end-sessions'), memberId: uuid }),
    z.object({ action: z.literal('ai'), enabled: z.boolean() }),
]);
export async function operationsChange(request: Request, deps: Deps) {
    if (!deps.store) return notFound();
    const read = await boundedJson(request, 4_000);
    if ('refusal' in read) return read.refusal;
    const body = operationsAction.safeParse(read.body);
    if (!body.success) return json({ code: 'INVALID_INPUT' }, 400);
    const d = body.data;
    // Turning the AI on or off is for a Superadmin; pausing and signing people out for an Admin and above.
    const who = await requireRole(request.headers, d.action === 'ai' ? 'SUPERADMIN' : 'ADMIN', deps.store, deps.transport);
    if ('refusal' in who) return refuse(who.refusal);
    const t = { p_token_hash: who.tokenHash };
    const result = d.action === 'ai' ? await rpc('fingence_workspace_set_ai', { ...t, p_enabled: d.enabled }, deps.store, deps.transport)
        : d.action === 'end-sessions' ? await rpc('fingence_workspace_end_member_sessions', { ...t, p_member: d.memberId }, deps.store, deps.transport)
        : await rpc('fingence_workspace_set_processing', { ...t, p_paused: d.action === 'pause', p_reason: d.action === 'pause' ? d.reason : null }, deps.store, deps.transport);
    return result.ok ? json(result.value) : fail(result.error);
}

/** Any signed-in member: a completed run is recorded for the organization automatically. Refused when paused or not signed in. */
export async function recordRun(request: Request, deps: Deps) {
    if (!deps.store) return notFound();
    const read = await boundedJson(request, 1_500_000);
    if ('refusal' in read) return read.refusal;
    const parsed = runPayloadSchema.safeParse(read.body);
    if (!parsed.success) return json({ code: 'INVALID_RUN', issue: parsed.error.issues[0]?.path.join('.') ?? null }, 400);
    const who = await requireRole(request.headers, 'FINANCE', deps.store, deps.transport);
    if ('refusal' in who) return refuse(who.refusal);
    const result = await rpc<{ runId: string }>('fingence_workspace_record_run', { p_token_hash: who.tokenHash, p_payload: { ...parsed.data, clientHash: null } }, deps.store, deps.transport);
    if (result.ok) return json(result.value, 201);
    return result.error === 'PROCESSING_PAUSED' ? json({ code: 'PROCESSING_PAUSED' }, 423) : fail(result.error);
}
