import { NextResponse, type NextRequest } from 'next/server';
import { workspaceEnabled } from '@/lib/server/workspace/store';

/**
 * SAIC users only: with the workspace on, every page and API needs a session, except signing in and joining.
 * This is the optimistic check (is there a session cookie at all); every data route also verifies the session, the role
 * and the organization in the database, so an ended or forged cookie gets nothing. With the workspace off, nothing changes.
 */
const OPEN_PAGES = new Set(['/sign-in', '/join']);
const OPEN_APIS = new Set(['/api/workspace/sign-in', '/api/workspace/join', '/api/workspace/session', '/api/workspace/sign-out']);

export function proxy(request: NextRequest) {
    if (!workspaceEnabled()) return NextResponse.next();
    const { pathname } = request.nextUrl;
    if (OPEN_PAGES.has(pathname) || OPEN_APIS.has(pathname) || request.cookies.has('fingence_session')) return NextResponse.next();
    if (pathname.startsWith('/api/')) return NextResponse.json({ code: 'SIGN_IN_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.redirect(new URL('/sign-in', request.url));
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)'],
};
