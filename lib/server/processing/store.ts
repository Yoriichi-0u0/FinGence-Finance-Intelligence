import 'server-only';
import { ingestionStore } from '../ingestion-store';

/**
 * The store behind server processing: the `fingence_processing` and `fingence_ingestion` schemas, reached only through
 * their service-role functions (PostgREST RPC). Off unless FINGENCE_PROCESSING_JOBS=1 and either
 * - the Supabase ingestion store is configured (FINGENCE_INGESTION_STORE=1, SUPABASE_URL, SUPABASE_SECRET_KEY), or
 * - in development only, FINGENCE_PROCESSING_LOCAL_URL points at the local store on this machine (`node scripts/dev-store.mjs`),
 *   which runs the same migrations in PGlite, so the whole flow works locally with no hosted change and no sign-in.
 */
export type ProcessingStore = { url: string; key: string | null; local: boolean };
/** Without sign-in every job belongs to this one organization; with the workspace on, jobs belong to the signed-in member's organization. */
export const PROCESSING_ORGANIZATION = 'fingence-default';
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

export function processingStore(env: Readonly<Record<string, string | undefined>> = process.env): ProcessingStore | null {
    if (env.FINGENCE_PROCESSING_JOBS !== '1') return null;
    const local = env.FINGENCE_PROCESSING_LOCAL_URL;
    if (local && env.NODE_ENV === 'development' && !env.VERCEL && LOCAL.test(local)) return { url: local, key: null, local: true };
    const hosted = ingestionStore();
    return hosted ? { ...hosted, local: false } : null;
}

export class StoreError extends Error { constructor(readonly code: string) { super(code); } }

/** Calls one store function with named arguments and returns its JSON result. Never logs arguments or keys. */
export async function rpc<T>(fn: string, args: Record<string, unknown>, store: ProcessingStore | null = processingStore(), transport: typeof fetch = fetch): Promise<T> {
    if (!store) throw new StoreError('NOT_CONFIGURED');
    if (!/^fingence_(processing|ingestion)_[a-z_]+$/.test(fn)) throw new StoreError('UNKNOWN_FUNCTION');
    let response: Response;
    try {
        response = await transport(`${store.url}/rest/v1/rpc/${fn}`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
            headers: { ...(store.key ? { apikey: store.key, ...(store.key.startsWith('sb_') ? {} : { Authorization: `Bearer ${store.key}` }) } : {}), 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
        });
    } catch { throw new StoreError('STORE_UNREACHABLE'); }
    if (!response.ok) throw new StoreError(`STORE_HTTP_${response.status}`);
    return await response.json() as T;
}

/**
 * The Management console has no sign-in yet, so it exists only where that is safe: with the local store on this
 * machine, or on a deployment whose owner explicitly opened it (FINGENCE_MANAGEMENT_CONSOLE=1) until the workspace's
 * Management (Technical) role (#74) guards it.
 */
export function managementEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
    const store = processingStore(env);
    // Retired once sign-in is on: Admins use Operations, and the workspace's pause is the only pause switch.
    return !!store && (store.local || env.FINGENCE_MANAGEMENT_CONSOLE === '1') && env.FINGENCE_WORKSPACE !== '1';
}
