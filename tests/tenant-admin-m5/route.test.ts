import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => { process.env.FINGENCE_M5_LOCAL = '1'; return { enabled: true, runtime: vi.fn() }; });
vi.mock('../../lib/server/tenant-admin-m5/flags', async () => { const { localAccessAllowed } = await import('../../lib/server/ai-ingestion/service');
    return { m5LocalEnabled: () => mock.enabled, m5RequestAllowed: (r: Request) => mock.enabled && localAccessAllowed(r) }; });
vi.mock('../../lib/server/tenant-admin-m5/runtime', () => ({ m5Runtime: mock.runtime }));
import { GET, POST } from '../../app/api/ai-ingestion/m2/admin/route';

const session = 'a'.repeat(43), url = 'http://127.0.0.1:3185/api/ai-ingestion/m2/admin';
const administration = { overview: vi.fn(), auditLog: vi.fn(), invite: vi.fn(), revokeInvitation: vi.fn(), changeMembership: vi.fn(), revokeSessions: vi.fn(), setAccountActive: vi.fn(), enroll: vi.fn() };
const req = (query: string, body?: string, { origin = 'http://127.0.0.1:3185', host = '127.0.0.1:3185', cookie = 'fingence_m5_session=' + session } = {}) => new Request(url + '?' + query,
    { method: body === undefined ? 'GET' : 'POST', headers: { host, origin, cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body });
const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => { vi.resetAllMocks(); mock.enabled = true; vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_LOCAL', '1'); mock.runtime.mockResolvedValue({ administration }); });
afterEach(() => vi.unstubAllEnvs());

describe('local administration HTTP boundary', () => {
    it.each(['GET', 'POST'])('denies %s before opening the database when M5 is disabled or the host is not loopback', async (method) => {
        mock.enabled = false;
        expect((await (method === 'GET' ? GET(req('action=overview')) : POST(req('action=invite', '{}')))).status).toBe(404);
        mock.enabled = true;
        expect((await (method === 'GET' ? GET(req('action=overview', undefined, { host: 'example.com' })) : POST(req('action=invite', '{}', { host: 'example.com', origin: 'http://example.com' })))).status).toBe(404);
        expect(mock.runtime).not.toHaveBeenCalled();
    });
    it('denies cross-origin mutations and enrollment without opening the database', async () => {
        for (const action of ['invite', 'membership', 'enroll'])
            expect((await POST(req('action=' + action, '{}', { origin: 'http://127.0.0.1:9999' }))).status).toBe(404);
        expect(mock.runtime).not.toHaveBeenCalled();
    });
    it('forwards only the HttpOnly session for role-scoped reads and hides refusal details', async () => {
        administration.overview.mockResolvedValue({ status: 'OK', view: 'ADMIN', members: [] });
        const ok = await GET(req('action=overview'));
        expect(ok.status).toBe(200);
        expect(ok.headers.get('cache-control')).toBe('no-store');
        expect(administration.overview).toHaveBeenCalledWith(session);
        administration.auditLog.mockResolvedValue({ status: 'REFUSED', code: 'UNAVAILABLE' });
        const denied = await GET(req('action=audit'));
        expect(denied.status).toBe(404);
        expect(await denied.json()).toEqual({ error: 'Unavailable or access denied.' });
        administration.overview.mockRejectedValue(new Error('ACCESS_DENIED private detail'));
        const failed = await GET(req('action=overview'));
        expect(failed.status).toBe(404);
        expect(await failed.text()).not.toContain('private detail');
        expect((await GET(req('action=invite'))).status).toBe(404);
    });
    it.each([
        ['invite', { email: 'new@m5.invalid', role: 'Finance', organizationId: id }],
        ['invite', { email: 'new@m5.invalid', role: 'Finance', createdBy: id }],
        ['membership', { userId: id, role: 'Admin', active: true, expectedVersion: 1, organizationId: id }],
        ['membership', { userId: id, role: 'Admin', active: 'true', expectedVersion: 1 }],
        ['sessions-revoke', { userId: id, actorId: id }],
        ['account', { userId: id, active: false, organizationId: id }],
        ['invitation-revoke', { invitationId: id, organizationId: id }],
        ['enroll', { code: 'c'.repeat(43), email: 'x@m5.invalid', password: 'Public-synthetic-M5-password', role: 'Admin' }],
        ['enroll', { code: 'c'.repeat(43), email: 'x@m5.invalid', password: 'Public-synthetic-M5-password', organizationId: id }],
        ['unknown', {}],
    ])('rejects browser-supplied tenant, role or actor claims for %s', async (action, body) => {
        expect((await POST(req('action=' + action, JSON.stringify(body)))).status).toBe(404);
        for (const fn of Object.values(administration))
            expect(fn).not.toHaveBeenCalled();
    });
    it('bounds request bodies', async () => {
        expect((await POST(req('action=invite', JSON.stringify({ email: 'x'.repeat(4100), role: 'Finance' })))).status).toBe(404);
        expect(administration.invite).not.toHaveBeenCalled();
    });
    it('maps authorized state refusals to 409 and returns a one-time code without caching', async () => {
        administration.invite.mockResolvedValue({ status: 'INVITED', invitation: { id, email: 'new@m5.invalid', role: 'Finance', expiresAt: '2026-11-01T00:00:00.000Z' }, code: 'k'.repeat(43) });
        const invited = await POST(req('action=invite', JSON.stringify({ email: 'new@m5.invalid', role: 'Finance' })));
        expect(invited.status).toBe(200);
        expect(invited.headers.get('cache-control')).toBe('no-store');
        expect(invited.headers.get('referrer-policy')).toBe('no-referrer');
        expect(administration.invite).toHaveBeenCalledWith(session, { email: 'new@m5.invalid', role: 'Finance' });
        for (const code of ['STALE_MEMBERSHIP', 'LAST_ADMIN_PROTECTED']) {
            administration.changeMembership.mockResolvedValueOnce({ status: 'REFUSED', code });
            const response = await POST(req('action=membership', JSON.stringify({ userId: id, role: 'Finance', active: true, expectedVersion: 2 })));
            expect(response.status).toBe(409);
            expect(await response.json()).toEqual({ refused: code });
        }
        administration.setAccountActive.mockResolvedValue({ status: 'REFUSED', code: 'UNAVAILABLE' });
        expect((await POST(req('action=account', JSON.stringify({ userId: id, active: false })))).status).toBe(404);
        administration.revokeSessions.mockResolvedValue({ status: 'UPDATED', sessionsRevoked: true });
        expect(await (await POST(req('action=sessions-revoke', JSON.stringify({ userId: id })))).json()).toEqual({ status: 'UPDATED', sessionsRevoked: true });
        administration.revokeInvitation.mockResolvedValue({ status: 'REVOKED' });
        expect((await POST(req('action=invitation-revoke', JSON.stringify({ invitationId: id })))).status).toBe(200);
    });
    it('enrolls without a session, never sets a cookie, rate limits and reports only generic code failures', async () => {
        const body = JSON.stringify({ code: 'c'.repeat(43), email: 'x@m5.invalid', password: 'Public-synthetic-M5-password' });
        administration.enroll.mockResolvedValue({ status: 'ENROLLED', membershipActive: false });
        await new Promise(r => setTimeout(r, 1100));
        const enrolled = await POST(req('action=enroll', body, { cookie: '' }));
        expect(enrolled.status).toBe(200);
        expect(enrolled.headers.get('set-cookie')).toBeNull();
        expect(await enrolled.json()).toEqual({ status: 'ENROLLED', membershipActive: false });
        expect((await POST(req('action=enroll', body, { cookie: '' }))).status).toBe(429);
        await new Promise(r => setTimeout(r, 1100));
        administration.enroll.mockResolvedValue({ status: 'REFUSED', code: 'INVITATION_UNAVAILABLE' });
        const refused = await POST(req('action=enroll', body, { cookie: '' }));
        expect(refused.status).toBe(409);
        expect(await refused.json()).toEqual({ refused: 'INVITATION_UNAVAILABLE' });
        await new Promise(r => setTimeout(r, 1100));
        administration.enroll.mockResolvedValue({ status: 'REFUSED', code: 'PASSWORD_POLICY' });
        expect((await POST(req('action=enroll', body, { cookie: '' }))).status).toBe(400);
    });
});
