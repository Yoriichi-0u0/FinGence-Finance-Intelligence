import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { workspaceStore, type Store } from '../workspace/store';

/**
 * Where saved documents live: a PRIVATE Supabase Storage bucket on the hosted workspace (the file bytes are never in the
 * database), or a folder under .local/dev/files when developing against the local store. Only the server reads or writes
 * it, with the service key; a browser gets a document only through a session-checked route (a 60-second signed link).
 * Objects are named <organization>/<sha256>/<key>: each document is stored once per organization, and every stored copy
 * has its own key, so removing an old copy can never touch a copy a concurrent save has just stored.
 */
export const FILES_BUCKET = process.env.FINGENCE_FILES_BUCKET ?? 'fingence-documents';
export const objectPath = (organization: string, sha256: string, key: string) => `${organization}/${sha256}/${key}`;
const SAFE_PATH = /^[0-9a-f-]{36}\/[0-9a-f]{64}\/[0-9a-f-]{36}$/;

export type FileStore = {
    put: (path: string, bytes: Uint8Array, contentType: string) => Promise<boolean>;
    /** A short-lived link the browser can fetch directly, or null when the store serves bytes itself (local). */
    signedUrl: (path: string) => Promise<string | null>;
    read: (path: string) => Promise<Uint8Array | null>;
    remove: (paths: string[]) => Promise<void>;
};

export function fileStore(store: Store | null = workspaceStore(), transport: typeof fetch = fetch): FileStore | null {
    if (!store) return null;
    return store.key === 'local-development' ? localFiles(join(process.cwd(), '.local', 'dev', 'files')) : supabaseFiles(store, transport);
}

const headers = (store: Store) => ({ apikey: store.key, ...(store.key.startsWith('sb_') ? {} : { Authorization: `Bearer ${store.key}` }) });

function supabaseFiles(store: Store, transport: typeof fetch): FileStore {
    const base = `${store.url}/storage/v1`;
    const call = (path: string, init: RequestInit) => transport(`${base}${path}`, { redirect: 'error', signal: AbortSignal.timeout(30_000), ...init, headers: { ...headers(store), ...(init.headers ?? {}) } });
    return {
        async put(path, bytes, contentType) {
            if (!SAFE_PATH.test(path)) return false;
            try { return (await call(`/object/${FILES_BUCKET}/${path}`, { method: 'POST', body: bytes.slice(), headers: { 'Content-Type': contentType, 'x-upsert': 'true' } })).ok; }
            catch { return false; }
        },
        async signedUrl(path) {
            if (!SAFE_PATH.test(path)) return null;
            try {
                const res = await call(`/object/sign/${FILES_BUCKET}/${path}`, { method: 'POST', body: JSON.stringify({ expiresIn: 60 }), headers: { 'Content-Type': 'application/json' } });
                const body = await res.json().catch(() => null) as { signedURL?: string } | null;
                return res.ok && body?.signedURL ? `${base}${body.signedURL}` : null;
            } catch { return null; }
        },
        async read(path) {
            if (!SAFE_PATH.test(path)) return null;
            try { const res = await call(`/object/authenticated/${FILES_BUCKET}/${path}`, { method: 'GET' }); return res.ok ? new Uint8Array(await res.arrayBuffer()) : null; }
            catch { return null; }
        },
        async remove(paths) {
            const safe = paths.filter(p => SAFE_PATH.test(p));
            if (!safe.length) return;
            try { await call(`/object/${FILES_BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: safe }), headers: { 'Content-Type': 'application/json' } }); } catch { /* a leftover object is harmless and private */ }
        },
    };
}

function localFiles(root: string): FileStore {
    const at = (path: string) => join(root, ...path.split('/'));
    return {
        async put(path, bytes) { if (!SAFE_PATH.test(path)) return false; await mkdir(dirname(at(path)), { recursive: true }); await writeFile(at(path), bytes); return true; },
        async signedUrl() { return null; },
        async read(path) { if (!SAFE_PATH.test(path)) return null; try { return new Uint8Array(await readFile(at(path))); } catch { return null; } },
        async remove(paths) { for (const p of paths) if (SAFE_PATH.test(p)) await rm(at(p), { force: true }); },
    };
}

/** A test double kept in memory. */
export function memoryFiles(): FileStore & { objects: Map<string, Uint8Array> } {
    const objects = new Map<string, Uint8Array>();
    return {
        objects,
        async put(path, bytes) { if (!SAFE_PATH.test(path)) return false; objects.set(path, bytes.slice()); return true; },
        async signedUrl() { return null; },
        async read(path) { return objects.get(path) ?? null; },
        async remove(paths) { for (const p of paths) objects.delete(p); },
    };
}
