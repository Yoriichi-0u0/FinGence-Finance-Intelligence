import { m5RequestAllowed } from '../../../../../lib/server/tenant-admin-m5/flags';
import { m5Runtime } from '../../../../../lib/server/tenant-admin-m5/runtime';
import { localSessionCookieName } from '../../../../../lib/server/ai-ingestion/m2/session-cookie';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const denied = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
const cookieName = localSessionCookieName(true);
const token = (request: Request) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
// Refusal codes only reach the caller after the server has authorized the Admin and scoped the target to its organization.
const conflicts = new Set(['STALE_MEMBERSHIP', 'LAST_ADMIN_PROTECTED', 'ALREADY_MEMBER', 'STALE_ACCOUNT', 'STALE_INVITATION', 'INVITATION_UNAVAILABLE']);
function respond(result: { status: string; code?: string }) {
    if (result.status !== 'REFUSED')
        return Response.json(result, { headers });
    if (result.code === 'PASSWORD_POLICY')
        return Response.json({ refused: result.code }, { status: 400, headers });
    return result.code && conflicts.has(result.code) ? Response.json({ refused: result.code }, { status: 409, headers }) : denied();
}
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
} const value = JSON.parse(Buffer.concat(parts).toString()); if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(); return value as Record<string, unknown>; }
/** Exact typed key allowlists: organization, actor and role claims never come from the browser. */
type Shape = Record<string, 'string' | 'boolean' | 'number'>;
const exact = (body: Record<string, unknown>, shape: Shape) => Object.keys(body).length === Object.keys(shape).length && Object.entries(shape).every(([k, type]) => typeof body[k] === type);
const shapes: Record<string, Shape> = { invite: { email: 'string', role: 'string' }, 'invitation-revoke': { invitationId: 'string' }, membership: { userId: 'string', role: 'string', active: 'boolean', expectedVersion: 'number' }, 'sessions-revoke': { userId: 'string' }, account: { userId: 'string', active: 'boolean' } };
export async function GET(request: Request) {
    if (!m5RequestAllowed(request))
        return denied();
    try {
        const action = new URL(request.url).searchParams.get('action'), { administration } = await m5Runtime();
        if (action === 'overview')
            return respond(await administration.overview(token(request)));
        if (action === 'audit')
            return respond(await administration.auditLog(token(request)));
        return denied();
    }
    catch {
        return denied();
    }
}
let lastEnrollment = 0;
export async function POST(request: Request) {
    if (!m5RequestAllowed(request))
        return denied();
    const url = new URL(request.url);
    if (request.headers.get('origin') !== `${url.protocol}//${request.headers.get('host') ?? url.host}`)
        return denied();
    try {
        const action = url.searchParams.get('action'), body = await input(request), session = token(request);
        if (action === 'enroll') {
            if (!exact(body, { code: 'string', email: 'string', password: 'string' }))
                return denied();
            if (Date.now() - lastEnrollment < 1000)
                return Response.json({ error: 'Please wait before trying again.' }, { status: 429, headers });
            lastEnrollment = Date.now();
            // Enrollment never issues a session cookie; sign-in remains an explicit, separate step.
            return respond(await (await m5Runtime()).administration.enroll({ code: body.code, email: body.email, password: body.password }));
        }
        if (!action || !shapes[action] || !exact(body, shapes[action]))
            return denied();
        const { administration } = await m5Runtime();
        if (action === 'invite')
            return respond(await administration.invite(session, { email: body.email, role: body.role }));
        if (action === 'invitation-revoke')
            return respond(await administration.revokeInvitation(session, body.invitationId));
        if (action === 'membership')
            return respond(await administration.changeMembership(session, { userId: body.userId, role: body.role, active: body.active, expectedVersion: body.expectedVersion }));
        if (action === 'sessions-revoke')
            return respond(await administration.revokeSessions(session, body.userId));
        return respond(await administration.setAccountActive(session, { userId: body.userId, active: body.active }));
    }
    catch {
        return denied();
    }
}
