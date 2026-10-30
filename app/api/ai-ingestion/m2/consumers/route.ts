import { m3RequestAllowed, m3Runtime } from '../../../../../lib/server/financial-m3/runtime';
import type { M2Role } from '../../../../../lib/server/ai-ingestion/m2/identity';
import { localSessionCookieName } from '../../../../../lib/server/ai-ingestion/m2/session-cookie';
import { m5LocalEnabled } from '../../../../../lib/server/tenant-admin-m5/flags';
import { m5Runtime } from '../../../../../lib/server/tenant-admin-m5/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const denied = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
const cookieName = localSessionCookieName(true);
/** When M5 is active, legacy membership management delegates to M5 enforcement and keeps this route's generic failure contract. */
const administration = async () => m5LocalEnabled() ? (await m5Runtime()).administration : null;
const legacy = (result: { status: string }) => result.status === 'REFUSED' ? denied() : Response.json(result, { headers });
const token = (request: Request) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName+'='))?.slice(cookieName.length+1) ?? '';
async function input(request: Request) { const reader = request.body?.getReader(); if (!reader)
    throw new Error(); let bytes = 0; const parts: Uint8Array[] = []; while (true) {
    const r = await reader.read();
    if (r.done)
        break;
    bytes += r.value.length;
    if (bytes > 4096) {
        await reader.cancel();
        throw new Error();
    }
    parts.push(r.value);
} return JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown>; }
export async function GET(request: Request) {
    if (!m3RequestAllowed(request))
        return denied();
    try {
        const context = await m3Runtime(), url = new URL(request.url), session = token(request), action = url.searchParams.get('action');
        if (action === 'management') {
            const m5 = await administration();
            return m5 ? legacy(await m5.overview(session)) : Response.json(await context.management.overview(session), { headers });
        }
        if (!url.searchParams.has('batch'))
            return Response.json({ jobs: await context.consumers.list(session) }, { headers });
        const id = url.searchParams.get('batch')!, warnings = url.searchParams.get('warnings') ?? 'exclude';
        if (warnings !== 'include' && warnings !== 'exclude')
            return denied();
        if (action === 'export') {
            const facts = await context.consumers.export(session, id, warnings);
            return Response.json(facts, { headers: { ...headers, 'Content-Disposition': 'attachment; filename="fingence-v2-financial-report.json"' } });
        }
        return Response.json(await context.consumers.snapshot(session, id, warnings), { headers });
    }
    catch {
        return denied();
    }
}
export async function POST(request: Request) {
    if (!m3RequestAllowed(request))
        return denied();
    const url = new URL(request.url);
    if (request.headers.get('origin') !== `${url.protocol}//${request.headers.get('host') ?? url.host}`)
        return denied();
    try {
        const context = await m3Runtime(), session = token(request), body = await input(request), action = url.searchParams.get('action');
        if (action === 'membership') {
            if (Object.keys(body).some(k => !['userId', 'role', 'active', 'expectedVersion'].includes(k)) || typeof body.userId !== 'string' || typeof body.role !== 'string' || typeof body.active !== 'boolean' || typeof body.expectedVersion !== 'number')
                return denied();
            const m5 = await administration();
            if (m5)
                return legacy(await m5.changeMembership(session, { userId: body.userId, role: body.role, active: body.active, expectedVersion: body.expectedVersion }));
            return Response.json(await context.management.membership(session, body as {
                userId: string;
                role: M2Role;
                active: boolean;
                expectedVersion: number;
            }), { headers });
        }
        if (action === 'revoke') {
            if (typeof body.userId !== 'string' || Object.keys(body).some(k => k !== 'userId'))
                return denied();
            const m5 = await administration();
            return m5 ? legacy(await m5.revokeSessions(session, body.userId)) : Response.json(await context.management.revoke(session, body.userId), { headers });
        }
        if (action !== 'question' || Object.keys(body).some(k => k !== 'question') || typeof body.question !== 'string')
            return denied();
        const id = url.searchParams.get('batch'), warnings = url.searchParams.get('warnings') ?? 'exclude';
        if (!id || warnings !== 'include' && warnings !== 'exclude')
            return denied();
        return Response.json(await context.consumers.answer(session, id, warnings, body.question), { headers });
    }
    catch {
        return denied();
    }
}
