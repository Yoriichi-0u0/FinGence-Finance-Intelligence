import 'server-only';
import { budgetStore, clientAddress } from '../ai/budget';
import { atLeast, rpc, secretHash, workspaceStore, type Principal, type Role, type Store } from './store';

export const SESSION_COOKIE = 'fingence_session';
export const SESSION_HOURS = 12;

/** The session token from the request's Cookie header, if it is well formed. */
export function sessionToken(headers: Headers): string | null {
    for (const part of (headers.get('cookie') ?? '').split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === SESSION_COOKIE) { const value = rest.join('='); return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null; }
    }
    return null;
}
const secure = () => process.env.NODE_ENV === 'production';
export const sessionCookie = (token: string) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure() ? '; Secure' : ''}`;
export const clearedCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure() ? '; Secure' : ''}`;

/**
 * Who is making this request:
 * - ANONYMOUS: no session cookie;
 * - ENDED: a cookie whose session is over (signed out elsewhere, ended by an Admin or Superadmin, expired, access changed);
 * - SIGNED_IN: an open session of an active member.
 */
export type Caller = { kind: 'ANONYMOUS' } | { kind: 'ENDED' } | { kind: 'UNAVAILABLE' } | { kind: 'SIGNED_IN'; principal: Principal; tokenHash: string };
export async function caller(headers: Headers, store: Store | null = workspaceStore(), transport: typeof fetch = fetch): Promise<Caller> {
    const token = sessionToken(headers);
    if (!token) return headers.get('cookie')?.includes(`${SESSION_COOKIE}=`) ? { kind: 'ENDED' } : { kind: 'ANONYMOUS' };
    const tokenHash = secretHash(token);
    const result = await rpc<Principal | null>('fingence_workspace_principal', { p_token_hash: tokenHash }, store, transport);
    if (!result.ok) return { kind: 'UNAVAILABLE' };
    return result.value ? { kind: 'SIGNED_IN', principal: result.value, tokenHash } : { kind: 'ENDED' };
}

/**
 * Who may use processing when the workspace is on (SAIC users only): a signed-in member of any role. There is no public
 * demo: without a session the request is refused. `principal` is null when the workspace is off (the public deployment).
 */
export type MemberGate = { refusal: { code: string; status: number; reason?: string | null } } | { principal: Principal | null };
export async function signedInMember(headers: Headers, store: Store | null = workspaceStore(), transport: typeof fetch = fetch): Promise<MemberGate> {
    if (!store) return { principal: null };
    const who = await caller(headers, store, transport);
    if (who.kind === 'ANONYMOUS') return { refusal: { code: 'SIGN_IN_REQUIRED', status: 401 } };
    if (who.kind === 'ENDED') return { refusal: { code: 'SESSION_ENDED', status: 401 } };
    if (who.kind === 'UNAVAILABLE') return { refusal: { code: 'WORKSPACE_UNAVAILABLE', status: 503 } };
    return { principal: who.principal };
}

/**
 * The processing gate for the AI, ingestion and job routes: a signed-in member whose organization's processing is not
 * paused; with `ai`, also refused while a Superadmin has turned the AI off. Ending a session stops that person at once.
 */
export async function processingGate(headers: Headers, options: { ai?: boolean } = {}, store: Store | null = workspaceStore(), transport: typeof fetch = fetch): Promise<MemberGate> {
    const gate = await signedInMember(headers, store, transport);
    if ('refusal' in gate || !gate.principal) return gate;
    const p = gate.principal;
    if (p.processing.paused) return { refusal: { code: 'PROCESSING_PAUSED', status: 423, reason: p.processing.reason } };
    if (options.ai && !p.ai.enabled) return { refusal: { code: 'AI_OFF', status: 423 } };
    return gate;
}
export async function processingRefusal(headers: Headers, options: { ai?: boolean } = {}, store: Store | null = workspaceStore(), transport: typeof fetch = fetch) {
    const gate = await processingGate(headers, options, store, transport);
    return 'refusal' in gate ? gate.refusal : null;
}

export type Required = { refusal: { code: string; status: number } } | { principal: Principal; tokenHash: string };
/** A signed-in member whose role is at least `minimum`. */
export async function requireRole(headers: Headers, minimum: Role, store: Store | null = workspaceStore(), transport: typeof fetch = fetch): Promise<Required> {
    const who = await caller(headers, store, transport);
    if (who.kind === 'UNAVAILABLE') return { refusal: { code: 'WORKSPACE_UNAVAILABLE', status: 503 } };
    if (who.kind !== 'SIGNED_IN') return { refusal: { code: 'SIGN_IN_REQUIRED', status: 401 } };
    if (!atLeast(who.principal.role, minimum)) return { refusal: { code: 'FORBIDDEN', status: 403 } };
    return { principal: who.principal, tokenHash: who.tokenHash };
}

/** Sign-in and join attempts: 10 a minute per client and 30 an hour per email (shared counter store; in memory locally). */
export async function attemptAllowed(headers: Headers, email: string | null, now = Date.now()) {
    const budget = budgetStore();
    if (!budget) return process.env.NODE_ENV !== 'production';
    const minute = Math.floor(now / 60_000), hour = Math.floor(now / 3_600_000);
    const client = secretHash(`${budget.secret}\u0000${clientAddress(headers)}`).slice(0, 32);
    if (await budget.store.add(`fg:auth:c:${client}:m:${minute}`, 1, 120) > 10) return false;
    if (email && await budget.store.add(`fg:auth:e:${secretHash(`${budget.secret}\u0000${email}`).slice(0, 32)}:h:${hour}`, 1, 7200) > 30) return false;
    return true;
}
