import { pocRequestAllowed, reconciliationRuntime } from '../../../../../lib/server/poc-reconciliation/runtime';
import { localSessionCookieName } from '../../../../../lib/server/ai-ingestion/m2/session-cookie';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const deny = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
const token = (request: Request) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(localSessionCookieName() + '='))?.slice(localSessionCookieName().length + 1) ?? '';
export async function GET(request: Request) {
    if (!pocRequestAllowed(request)) return deny();
    try {
        const r = await reconciliationRuntime(), url = new URL(request.url), id = url.searchParams.get('id');
        const download = url.searchParams.get('download') === '1';
        const data = id ? await r.reconciliation.get(token(request), id, download) : { selections: await r.reconciliation.list(token(request)) };
        return Response.json(data, { headers: { ...headers, ...(download ? { 'Content-Disposition': 'attachment; filename="fingence-reconciliation.json"' } : {}) } });
    } catch { return deny(); }
}
export async function POST(request: Request) {
    if (!pocRequestAllowed(request)) return deny();
    const url = new URL(request.url);
    if (request.headers.get('origin') !== `${url.protocol}//${request.headers.get('host') ?? url.host}`) return deny();
    try {
        const r = await reconciliationRuntime(); await r.identity.session(token(request));
        // Bound the entire multipart body before formData allocates. Ignore client-supplied length claims.
        const reader = request.body?.getReader(); if (!reader) return deny();
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1100000) { await reader.cancel(); return deny(); } chunks.push(part.value); }
        const copy = new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('content-type') ?? '' }, body: Buffer.concat(chunks) });
        const form = await copy.formData(), bank = form.get('bank'), ledger = form.get('ledger');
        if (!(bank instanceof File) || !(ledger instanceof File) || [...form.keys()].length !== 2) return deny();
        return Response.json(await r.reconciliation.ingest(token(request), new Uint8Array(await bank.arrayBuffer()), new Uint8Array(await ledger.arrayBuffer()), bank.name, ledger.name), { headers });
    } catch { return deny(); }
}
