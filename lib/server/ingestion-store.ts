import 'server-only';
import { createHash } from 'node:crypto';
import type { RunPayload } from '../document-ingestion/run-payload';

/**
 * Durable store for ingestion runs: the FinGence Supabase project's `fingence_ingestion` schema, written only through
 * `public.fingence_ingestion_record_run`, which only the service role may execute. Off unless
 * FINGENCE_INGESTION_STORE=1 with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set; the key never leaves the server.
 */
export function ingestionStore(): { url: string; key: string } | null {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (process.env.FINGENCE_INGESTION_STORE !== '1' || !url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) return null;
    return { url: url.replace(/\/$/, ''), key };
}
/** A client address is stored only as a keyed hash, so runs from one client can be counted but not traced. */
export const clientHash = (client: string, secret: string) => createHash('sha256').update(`${secret}\u0000${client}`).digest('hex').slice(0, 32);

export async function recordRun(payload: RunPayload & { clientHash: string | null }, store = ingestionStore(), transport: typeof fetch = fetch): Promise<{ runId: string } | { error: string }> {
    if (!store) return { error: 'NOT_CONFIGURED' };
    let response: Response;
    try {
        response = await transport(`${store.url}/rest/v1/rpc/fingence_ingestion_record_run`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
            headers: { apikey: store.key, Authorization: `Bearer ${store.key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload }),
        });
    } catch { return { error: 'STORE_UNREACHABLE' }; }
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok || typeof body !== 'string' || !/^[0-9a-f-]{36}$/.test(body)) return { error: `STORE_HTTP_${response.status}` };
    return { runId: body };
}
