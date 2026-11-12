import 'server-only';
import type { DocumentInput } from '../../demo/pipeline';
import type { SavedRunPayload } from '../../history/saved-run';
import { sha256Hex } from '../../history/saved-run';
import { fileStore, objectPath, type FileStore } from '../files/store';
import { rpc, workspaceStore, type Store } from '../workspace/store';

/**
 * Save a completed run to its person's History: the documents into private storage (each once per organization, and only
 * while the organization is under its free-plan cap), then the run itself. Never throws; a run that could not be saved is
 * reported, and processing is unaffected.
 */
export type SaveDeps = { store?: Store | null; transport?: typeof fetch; files?: FileStore | null };
export async function saveRun(organization: string, member: string, payload: SavedRunPayload, documents: DocumentInput[], deps: SaveDeps = {}): Promise<{ id: string; filesKept: boolean } | { error: string }> {
    const store = deps.store === undefined ? workspaceStore() : deps.store, transport = deps.transport ?? fetch;
    if (!store) return { error: 'NOT_CONFIGURED' };
    const files = deps.files === undefined ? fileStore(store, transport) : deps.files;
    try {
        // The documents sent must be the documents described: same count, same fingerprints.
        const shas = await Promise.all(documents.map(d => sha256Hex(d.bytes)));
        if (shas.length !== payload.documents.length || shas.some((s, i) => s !== payload.documents[i].sha256)) return { error: 'DOCUMENTS_MISMATCH' };
        // Two tries: if a document this save relied on was deleted meanwhile (FILES_CHANGED), plan again and upload it.
        for (let attempt = 0; attempt < 2; attempt++) {
            const plan = await rpc<{ upload: { sha256: string; key: string }[]; filesFit: boolean; rowsFit: boolean }>('fingence_workspace_plan_save', { p_org: organization, p_member: member, p_files: payload.documents.map(d => ({ sha256: d.sha256, bytes: d.bytes })) }, store, transport);
            if (!plan.ok) return { error: plan.error };
            if (!plan.value.rowsFit) return { error: 'STORAGE_FULL' };
            let kept = !!files && plan.value.filesFit;
            const keys = new Map<string, string>();
            if (kept) for (const { sha256, key } of plan.value.upload) {
                if (keys.has(sha256)) continue;
                const i = shas.indexOf(sha256);
                if (i < 0 || !await files!.put(objectPath(organization, sha256, key), documents[i].bytes, payload.documents[i].contentType)) { kept = false; break; }
                keys.set(sha256, key);
            }
            const run = { ...payload, filesKept: kept, documents: payload.documents.map(d => keys.has(d.sha256) ? { ...d, objectKey: keys.get(d.sha256) } : d) };
            const saved = await rpc<{ id: string; filesKept: boolean }>('fingence_workspace_save_run', { p_org: organization, p_member: member, p_run: run }, store, transport);
            if (saved.ok) return saved.value;
            if (saved.error !== 'FILES_CHANGED') return { error: saved.error };
        }
        return { error: 'FILES_CHANGED' };
    } catch { return { error: 'SAVE_FAILED' }; }
}
