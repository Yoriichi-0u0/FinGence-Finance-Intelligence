import { z } from 'zod';
import { pocRequestAllowed, reconciliationRuntime } from '../../../../../../lib/server/poc-reconciliation/runtime';
import { localSessionCookieName } from '../../../../../../lib/server/ai-ingestion/m2/session-cookie';
import { reviewInput } from '../../../../../../lib/poc-reconciliation/reviews';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const deny = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
const token = (r: Request) => r.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(localSessionCookieName() + '='))?.slice(localSessionCookieName().length + 1) ?? '';
export async function GET(request: Request) {
    if (!pocRequestAllowed(request)) return deny();
    try {
        const q = new URL(request.url).searchParams;
        if ([...q.keys()].length !== 1 || !q.has('id')) return deny();
        const id = z.uuid().parse(q.get('id')), service = await reconciliationRuntime();
        const result = await service.reviews.get(token(request), id);
        return result.status === 'OK' ? Response.json(result, { headers }) : deny();
    } catch { return deny(); }
}
export async function POST(request: Request) {
    if (!pocRequestAllowed(request)) return deny();
    const url = new URL(request.url);
    if (request.headers.get('origin') !== `${url.protocol}//${request.headers.get('host') ?? url.host}` || !request.headers.get('content-type')?.startsWith('application/json')) return deny();
    try {
        const reader = request.body?.getReader(); if (!reader) return deny();
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4096) { await reader.cancel(); return deny(); } chunks.push(part.value); }
        const input = reviewInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))), service = await reconciliationRuntime();
        const result = await service.reviews.review(token(request), input);
        if (result.status === 'REVIEWED') return Response.json(result, { headers });
        if (result.code === 'STALE_REVIEW') return Response.json({ code: result.code, error: 'The review changed. Reload review details before saving.' }, { status: 409, headers });
        return deny();
    } catch { return deny(); }
}
