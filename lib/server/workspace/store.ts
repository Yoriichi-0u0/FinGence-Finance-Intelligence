import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { ingestionStore } from '../ingestion-store';

/**
 * The hosted workspace: one organization (SAIC), members in one of three stacked roles, sessions and processing control, in the Supabase
 * schema `fingence_workspace` (supabase/sql/workspace-v1.sql, then workspace-v2-saic.sql). Off unless FINGENCE_WORKSPACE=1 and the ingestion store
 * is configured; every call goes through a SECURITY DEFINER function that only the service role may execute.
 */
export type Store = { url: string; key: string };
export function workspaceStore(): Store | null {
    if (process.env.FINGENCE_WORKSPACE !== '1') return null;
    // Development only (never on Vercel or in a production build): a loopback stand-in running the same migrations.
    const local = process.env.FINGENCE_WORKSPACE_LOCAL_URL;
    if (local && process.env.NODE_ENV === 'development' && !process.env.VERCEL && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(local)) return { url: local, key: 'local-development' };
    return ingestionStore();
}
export const workspaceEnabled = () => workspaceStore() !== null;

/** SAIC only, three stacked roles: each includes everything the one below it may do (supabase/sql/workspace-v2-saic.sql). */
export type Role = 'FINANCE' | 'ADMIN' | 'SUPERADMIN';
export const ROLES: readonly Role[] = ['FINANCE', 'ADMIN', 'SUPERADMIN'];
const RANK: Record<Role, number> = { FINANCE: 1, ADMIN: 2, SUPERADMIN: 3 };
/** Whether a role is at least the given one (Superadmin ⊇ Admin ⊇ Finance user). */
export const atLeast = (role: Role, minimum: Role) => (RANK[role] ?? 0) >= RANK[minimum];
export type Principal = {
    sessionId: string; memberId: string; email: string; role: Role;
    organization: { id: string; name: string };
    processing: { paused: boolean; reason: string | null; since: string | null };
    ai: { enabled: boolean; since: string | null };
};

/** A random 256-bit secret (session token or one-time code) and the hash the database keeps instead of it. */
export const newSecret = () => randomBytes(32).toString('base64url');
export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: string };
/** One database function call. A function's own refusal ({ error }) is returned as such; transport failures become STORE_*. */
export async function rpc<T>(fn: string, args: Record<string, unknown>, store: Store | null = workspaceStore(), transport: typeof fetch = fetch): Promise<RpcResult<T>> {
    if (!store) return { ok: false, error: 'NOT_CONFIGURED' };
    let response: Response;
    try {
        response = await transport(`${store.url}/rest/v1/rpc/${fn}`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
            headers: { apikey: store.key, ...(store.key.startsWith('sb_') ? {} : { Authorization: `Bearer ${store.key}` }), 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
        });
    } catch { return { ok: false, error: 'STORE_UNREACHABLE' }; }
    const body = await response.json().catch(() => undefined) as unknown;
    if (!response.ok || body === undefined) return { ok: false, error: `STORE_HTTP_${response.status}` };
    if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') return { ok: false, error: (body as { error: string }).error };
    return { ok: true, value: body as T };
}
