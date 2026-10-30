import { m2Runtime, m2LocalEnabled } from '../../../../lib/server/ai-ingestion/m2/runtime';
import { localAccessAllowed } from '../../../../lib/server/ai-ingestion/service';
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const cookieName = 'fingence_m2_session';
const cookie = (value: string, age: number) => `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api/ai-ingestion/m2; Max-Age=${age}`;
const token = (r: Request) => r.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
const deny = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
async function body(request: Request, limit: number) { const reader = request.body?.getReader(); if (!reader)
    throw new Error(); const chunks: Uint8Array[] = []; let total = 0; while (true) {
    const item = await reader.read();
    if (item.done)
        break;
    total += item.value.length;
    if (total > limit) {
        await reader.cancel();
        throw new Error();
    }
    chunks.push(item.value);
} return Buffer.concat(chunks); }
export async function GET(request: Request) {
    if (!m2LocalEnabled() || !localAccessAllowed(request))
        return deny();
    try {
        const db = await m2Runtime(), url = new URL(request.url), session = token(request);
        if (url.searchParams.get('action') === 'session') {
            try {
                return Response.json({ active: true, ...await db.identity.session(session), mode: 'SIMULATED', liveProviderAvailable: false }, { headers });
            }
            catch {
                return Response.json({ active: false }, { headers });
            }
        }
        const id = url.searchParams.get('id');
        if(id&&url.searchParams.get('action')==='reference')return Response.json(await db.pipeline.reference(session,id),{headers});
        if (id) {
            const policy = url.searchParams.get('warnings') ?? 'exclude';
            if (policy !== 'include' && policy !== 'exclude')
                return deny();
            return Response.json(await db.pipeline.get(session, id, policy), { headers });
        }
        return Response.json({ jobs: await db.pipeline.list(session) }, { headers });
    }
    catch {
        return deny();
    }
}
let lastSignIn = 0;
export async function POST(request: Request) {
    if (!m2LocalEnabled() || !localAccessAllowed(request))
        return deny();
    const url = new URL(request.url);
    if (request.headers.get('origin') !== `${url.protocol}//${request.headers.get('host') ?? url.host}`)
        return deny();
    try {
        const db = await m2Runtime(), session = token(request), action = url.searchParams.get('action');
        if (action === 'login') {
            if (Date.now() - lastSignIn < 1000)
                return Response.json({ error: 'Please wait before signing in again.' }, { status: 429, headers });
            lastSignIn = Date.now();
            const input = JSON.parse((await body(request, 4096)).toString());
            if (typeof input.email !== 'string' || typeof input.password !== 'string')
                return deny();
            const result = await db.identity.login(input.email, input.password);
            return Response.json({ active: true, role: result.principal.role, userId: result.principal.user_id, organizationId: result.principal.organization_id, membershipVersion: result.principal.version }, { headers: { ...headers, 'Set-Cookie': cookie(result.token, 1800) } });
        }
        if (action === 'logout') {
            await db.identity.logout(session);
            return Response.json({ active: false }, { headers: { ...headers, 'Set-Cookie': cookie('', 0) } });
        }
        await db.identity.session(session);
        if (action === 'reserve')
            return Response.json(await db.pipeline.reserve(session), { headers });
        const id = url.searchParams.get('id');
        if (!id)
            return deny();
        if (action === 'cancel')
            return Response.json(await db.pipeline.cancel(session, id), { headers });
        if (action === 'investigate')
            return Response.json(await db.pipeline.investigate(session, id), { headers });
        if (action === 'question') {
            const policy = url.searchParams.get('warnings') ?? 'exclude';
            if (policy !== 'include' && policy !== 'exclude')
                return deny();
            const input = JSON.parse((await body(request, 4096)).toString());
            const result = await db.pipeline.get(session, id, policy);
            if (typeof input.question !== 'string' || !['what is the source-signed total?', 'what is the sum of signed source amounts?'].includes(input.question.trim().toLowerCase()))
                return Response.json({ status: 'UNSUPPORTED', reason: 'Only source-signed totals are supported; live AI and accounting interpretations are unavailable.' }, { headers });
            return Response.json({ status: 'DETERMINISTIC_ONLY', claims: result.report?.groups.filter(g => g.status === 'AVAILABLE') ?? [], publicationEligible: false }, { headers });
        }
        if (action !== 'process')
            return deny();
        const bytes = await body(request, 11 * 1024 * 1024);
        const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData();
        const file = form.get('file');
        if (!(file instanceof File) || [...form.keys()].some(k => k !== 'file') || form.getAll('file').length !== 1)
            return deny();
        const encoder = new TextEncoder();
        let closed = false;
        const stream = new ReadableStream({ async start(controller) { const send = (value: unknown) => { if (!closed)
                controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); }; try {
                send({ result: await db.pipeline.process(session, id, new Uint8Array(await file.arrayBuffer()), file.name, stage => send({ stage })) });
            }
            catch {
                send({ error: 'Processing was not confirmed. Retrieve the original operation; never retry it automatically.' });
            }
            finally {
                if (!closed) {
                    closed = true;
                    controller.close();
                }
            } }, cancel() { closed = true; } });
        return new Response(stream, { headers: { ...headers, 'Content-Type': 'application/x-ndjson' } });
    }
    catch {
        return deny();
    }
}
