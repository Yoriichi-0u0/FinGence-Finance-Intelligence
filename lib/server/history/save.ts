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
        const plan = await rpc<{ upload: string[]; filesFit: boolean; rowsFit: boolean }>('fingence_workspace_plan_save', { p_org: organization, p_member: member, p_files: payload.documents.map(d => ({ sha256: d.sha256, bytes: d.bytes })) }, store, transport);
        if (!plan.ok) return { error: plan.error };
        if (!plan.value.rowsFit) return { error: 'STORAGE_FULL' };
        let kept = !!files && plan.value.filesFit;
        if (kept) for (const sha of new Set(plan.value.upload)) {
            const i = shas.indexOf(sha);
            if (i < 0 || !await files!.put(objectPath(organization, sha), documents[i].bytes, payload.documents[i].contentType)) { kept = false; break; }
        }
        const saved = await rpc<{ id: string; filesKept: boolean }>('fingence_workspace_save_run', { p_org: organization, p_member: member, p_run: { ...payload, filesKept: kept } }, store, transport);
        return saved.ok ? saved.value : { error: saved.error };
    } catch { return { error: 'SAVE_FAILED' }; }
}
