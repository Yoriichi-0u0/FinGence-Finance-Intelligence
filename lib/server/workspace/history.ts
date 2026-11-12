import 'server-only';
import { savedRunSchema } from '../../history/saved-run';
import { boundedForm, noStoreJson as json, sameOrigin } from '../ai/request';
import { fileStore, objectPath, type FileStore } from '../files/store';
import { saveRun } from '../history/save';
import { requireRole } from './session';
import { rpc, type Store } from './store';

/**
 * History: each person's saved runs. Everyone lists and opens their own; Admins and Superadmins may list everyone's in the
 * organization ("all") and open or delete any of them. A document is only ever served after that check, and only to a
 * member of its organization: by a 60-second signed link to the private bucket, or (developing locally) streamed here.
 */
export type HistoryDeps = { store: Store | null; transport: typeof fetch; files?: FileStore | null };
const notFound = () => new Response('Not found', { status: 404 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const status = (error: string) => error.startsWith('STORE_') ? 503 : error === 'FORBIDDEN' ? 403 : error === 'NOT_FOUND' ? 404 : error === 'STORAGE_FULL' ? 507 : 502;
const fail = (error: string) => json({ code: error.startsWith('STORE_') ? 'WORKSPACE_UNAVAILABLE' : error }, status(error));
const filesOf = (deps: HistoryDeps) => deps.files === undefined ? fileStore(deps.store, deps.transport) : deps.files;
export const MAX_SAVE_BYTES = 4_000_000;

export async function listHistory(request: Request, deps: HistoryDeps) {
    if (!deps.store) return notFound();
    const scope = new URL(request.url).searchParams.get('scope') === 'all' ? 'all' : 'mine';
    const who = await requireRole(request.headers, scope === 'all' ? 'ADMIN' : 'FINANCE', deps.store, deps.transport);
    if ('refusal' in who) return json({ code: who.refusal.code }, who.refusal.status);
    const result = await rpc('fingence_workspace_history', { p_token_hash: who.tokenHash, p_scope: scope }, deps.store, deps.transport);
    return result.ok ? json({ scope, role: who.principal.role, ...result.value as object }) : fail(result.error);
}

type Saved = { organizationId: string; documents: { sha256: string; contentType: string; name: string; stored: boolean; objectKey: string | null }[]; filesKept: boolean };
async function load(request: Request, id: string, deps: HistoryDeps) {
    const who = await requireRole(request.headers, 'FINANCE', deps.store, deps.transport);
    if ('refusal' in who) return { ok: false as const, response: json({ code: who.refusal.code }, who.refusal.status) };
    if (!UUID.test(id)) return { ok: false as const, response: json({ code: 'NOT_FOUND' }, 404) };
    const result = await rpc<Saved & Record<string, unknown>>('fingence_workspace_saved_run', { p_token_hash: who.tokenHash, p_id: id }, deps.store, deps.transport);
    return result.ok ? { ok: true as const, run: result.value, who } : { ok: false as const, response: fail(result.error) };
}

/** One saved run: what is needed to reopen it (the restore bundle and the list of its documents). */
export async function openSaved(request: Request, id: string, deps: HistoryDeps) {
    if (!deps.store) return notFound();
    const got = await load(request, id, deps);
    if (!got.ok) return got.response;
    const { organizationId: _org, ...run } = got.run;
    void _org;
    return json({ ...run, documents: run.documents.map(({ objectKey: _key, ...d }) => { void _key; return d; }) });
}

/** One document of a saved run. */
export async function savedDocument(request: Request, id: string, index: string, deps: HistoryDeps) {
    if (!deps.store) return notFound();
    const got = await load(request, id, deps);
    if (!got.ok) return got.response;
    const i = Number(index), doc = Number.isInteger(i) ? got.run.documents[i] : undefined;
    if (!doc || !got.run.filesKept || !doc.stored || !doc.objectKey) return json({ code: 'FILE_NOT_KEPT' }, 404);
    const files = filesOf(deps), path = objectPath(got.run.organizationId, doc.sha256, doc.objectKey);
    if (!files) return json({ code: 'FILES_UNAVAILABLE' }, 503);
    const link = await files.signedUrl(path);
    if (link) return Response.redirect(link, 302);
    const bytes = await files.read(path);
    return bytes ? new Response(bytes.slice(), { headers: { 'Content-Type': doc.contentType, 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${doc.name.replace(/[^\w.-]+/g, '_')}"` } }) : json({ code: 'FILE_NOT_FOUND' }, 404);
}

/** Delete a saved run (its owner, or an Admin and above); documents no other saved run uses are removed from storage. */
export async function deleteSaved(request: Request, id: string, deps: HistoryDeps) {
    if (!deps.store) return notFound();
    if (!sameOrigin(request.headers)) return json({ code: 'CROSS_ORIGIN' }, 403);
    const who = await requireRole(request.headers, 'FINANCE', deps.store, deps.transport);
    if ('refusal' in who) return json({ code: who.refusal.code }, who.refusal.status);
    if (!UUID.test(id)) return json({ code: 'NOT_FOUND' }, 404);
    const result = await rpc<{ deleted: string; removeFiles: { sha256: string; key: string }[] }>('fingence_workspace_delete_run', { p_token_hash: who.tokenHash, p_id: id }, deps.store, deps.transport);
    if (!result.ok) return fail(result.error);
    // Exactly the copies this delete unregistered: a copy stored again since has a new key and is untouched.
    await filesOf(deps)?.remove(result.value.removeFiles.map(f => objectPath(who.principal.organization.id, f.sha256, f.key)));
    return json({ deleted: result.value.deleted, filesRemoved: result.value.removeFiles.length });
}

/** A run processed in this browser (server jobs save themselves): its description as JSON, and its documents. */
export async function saveBrowserRun(request: Request, deps: HistoryDeps) {
    if (!deps.store) return notFound();
    const read = await boundedForm(request, MAX_SAVE_BYTES);
    if ('refusal' in read) return read.refusal;
    const who = await requireRole(request.headers, 'FINANCE', deps.store, deps.transport);
    if ('refusal' in who) return json({ code: who.refusal.code }, who.refusal.status);
    let description: unknown;
    try { description = JSON.parse(String(read.form.get('run') ?? '')); } catch { return json({ code: 'INVALID_RUN' }, 400); }
    const parsed = savedRunSchema.safeParse(description);
    if (!parsed.success) return json({ code: 'INVALID_RUN', issue: parsed.error.issues[0]?.path.join('.') ?? null }, 400);
    const files = read.form.getAll('file').filter((f): f is File => f instanceof File);
    const documents = await Promise.all(files.map(async (f, i) => ({ name: parsed.data.documents[i]?.name ?? f.name, provenance: parsed.data.documents[i]?.provenance ?? 'USER_SUPPLIED' as const, bytes: new Uint8Array(await f.arrayBuffer()) })));
    const saved = await saveRun(who.principal.organization.id, who.principal.memberId, parsed.data as Parameters<typeof saveRun>[2], documents, { store: deps.store, transport: deps.transport, files: filesOf(deps) });
    return 'error' in saved ? fail(saved.error) : json(saved, 201);
}
