import 'server-only';
import { budgetStore, clientAddress } from '../ai/budget';
import { rpc, secretHash, workspaceStore, type Principal, type Role, type Store } from './store';

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
 * - ANONYMOUS: no session cookie (the public demo);
 * - ENDED: a cookie whose session is over (signed out elsewhere, ended by Management or Admin, expired, access changed);
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
 * The processing gate for the AI and ingestion routes when the workspace is on. The public demo (no cookie) is unchanged;
 * a signed-in person must be Finance and their organization's processing must not be paused; an ended session is refused,
 * so ending a session stops that person's processing at once.
 */
export async function processingRefusal(headers: Headers, store: Store | null = workspaceStore(), transport: typeof fetch = fetch): Promise<{ code: string; status: number; reason?: string | null } | null> {
    if (!store) return null;
    const who = await caller(headers, store, transport);
    if (who.kind === 'ANONYMOUS') return null;
    if (who.kind === 'ENDED') return { code: 'SESSION_ENDED', status: 401 };
    if (who.kind === 'UNAVAILABLE') return { code: 'WORKSPACE_UNAVAILABLE', status: 503 };
    if (who.principal.role !== 'FINANCE') return { code: 'ROLE_DOES_NOT_PROCESS', status: 403 };
    if (who.principal.processing.paused) return { code: 'PROCESSING_PAUSED', status: 423, reason: who.principal.processing.reason };
    return null;
}

export type Required = { refusal: { code: string; status: number } } | { principal: Principal; tokenHash: string };
export async function requireRole(headers: Headers, roles: Role[], store: Store | null = workspaceStore(), transport: typeof fetch = fetch): Promise<Required> {
    const who = await caller(headers, store, transport);
    if (who.kind === 'UNAVAILABLE') return { refusal: { code: 'WORKSPACE_UNAVAILABLE', status: 503 } };
    if (who.kind !== 'SIGNED_IN') return { refusal: { code: 'SIGN_IN_REQUIRED', status: 401 } };
    if (!roles.includes(who.principal.role)) return { refusal: { code: 'FORBIDDEN', status: 403 } };
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
