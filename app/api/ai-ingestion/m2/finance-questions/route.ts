import { pocRequestAllowed } from '../../../../../lib/server/poc-reconciliation/runtime';
import { financeQaRuntime } from '../../../../../lib/server/poc-finance-qa/runtime';
import { localSessionCookieName } from '../../../../../lib/server/ai-ingestion/m2/session-cookie';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const denied = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
const cookieName = localSessionCookieName(true);
const token = (request: Request) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
const selectionKeys = ['source', 'business', 'period', 'currency'];
const respond = (result: { status: string }) => result.status === 'OK' ? Response.json(result, { headers }) : denied();

/** Read-only, loopback PoC. Organization, role and user come only from the server session; figures only from the server. */
export async function GET(request: Request) {
    if (!pocRequestAllowed(request)) return denied();
    try {
        const params = new URL(request.url).searchParams, keys = [...params.keys()], action = params.get('action');
        if (new Set(keys).size !== keys.length) return denied();
        const { questions } = await financeQaRuntime();
        if (action === 'sources' && keys.length === 1) return respond(await questions.sources(token(request)));
        if (action !== 'context' || !keys.every(k => k === 'action' || selectionKeys.includes(k)) || !params.get('source')) return denied();
        return respond(await questions.context(token(request), Object.fromEntries(selectionKeys.filter(k => params.has(k)).map(k => [k, params.get(k)!])) as { source: string }));
    } catch { return denied(); }
}

/** A question is a same-origin JSON body of string selection keys plus the question text; nothing else is accepted. */
export async function POST(request: Request) {
    if (!pocRequestAllowed(request)) return denied();
    const url = new URL(request.url);
    if (url.searchParams.toString() !== 'action=ask' || request.headers.get('origin') !== `${url.protocol}//${request.headers.get('host') ?? url.host}`
        || !request.headers.get('content-type')?.startsWith('application/json')) return denied();
    try {
        const text = await request.text();
        if (new TextEncoder().encode(text).length > 2048) return denied();
        const body = JSON.parse(text) as Record<string, unknown>;
        if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).every(k => k === 'question' || selectionKeys.includes(k))
            || !Object.values(body).every(v => typeof v === 'string') || typeof body.source !== 'string' || typeof body.question !== 'string') return denied();
        const { question, ...selection } = body as Record<string, string>;
        const { questions } = await financeQaRuntime();
        return respond(await questions.ask(token(request), selection as { source: string }, question));
    } catch { return denied(); }
}
