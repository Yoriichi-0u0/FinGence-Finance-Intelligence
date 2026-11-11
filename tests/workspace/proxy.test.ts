import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { NextRequest } from 'next/server';
import { config, proxy } from '../../proxy';

/** SAIC users only: with the workspace on, nothing but signing in and joining is reachable without a session cookie. */
const at = (path: string, cookie?: string) => proxy(new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : {}));
const on = () => {
    vi.stubEnv('FINGENCE_WORKSPACE', '1'); vi.stubEnv('FINGENCE_INGESTION_STORE', '1');
    vi.stubEnv('SUPABASE_URL', 'https://example-project.supabase.co'); vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_not_real');
};
afterEach(() => vi.unstubAllEnvs());

describe('the sign-in proxy', () => {
    it('sends a page request without a session to sign in, and refuses an API request', async () => {
        on();
        for (const path of ['/', '/data', '/reports', '/team', '/operations', '/management']) {
            const res = at(path);
            expect([res.status, res.headers.get('location')]).toEqual([307, 'http://localhost:3000/sign-in']);
        }
        for (const path of ['/api/ai/ask', '/api/processing/jobs', '/api/ingestion/runs', '/api/workspace/team', '/api/workspace/operations']) {
            const res = at(path);
            expect([res.status, await res.json()]).toEqual([401, { code: 'SIGN_IN_REQUIRED' }]);
        }
    });
    it('lets signing in and joining through, and anything with a session cookie (each route then checks it in the database)', () => {
        on();
        for (const path of ['/sign-in', '/join', '/api/workspace/sign-in', '/api/workspace/join', '/api/workspace/session', '/api/workspace/sign-out'])
            expect(at(path).headers.get('x-middleware-next')).toBe('1');
        expect(at('/data', `fingence_session=${'a'.repeat(43)}`).headers.get('x-middleware-next')).toBe('1');
    });
    it('changes nothing when the workspace is off', () => {
        vi.stubEnv('FINGENCE_WORKSPACE', '');
        expect(at('/data').headers.get('x-middleware-next')).toBe('1');
    });
    it('does not run on static assets', () => {
        const pattern = new RegExp(`^${config.matcher[0].replace('/((?!', '/(?!').replace(').*)', ').*')}$`);
        for (const path of ['/_next/static/chunks/app.js', '/_next/image', '/favicon.ico', '/icon.png', '/branding/FinGence_Logo_96.png']) expect(pattern.test(path)).toBe(false);
        for (const path of ['/data', '/samples/demo-bank-statement-2026-03.csv', '/demo/x.pdf']) expect(pattern.test(path)).toBe(true);
    });
});
