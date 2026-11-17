import { pocRequestAllowed } from '../../../../../lib/server/poc-reconciliation/runtime';
import { financeQaRuntime } from '../../../../../lib/server/poc-finance-qa/runtime';
import { FinanceChatError, financeChatErrorExplanation } from '../../../../../lib/server/poc-finance-qa/groq-chat';
import { localSessionCookieName } from '../../../../../lib/server/ai-ingestion/m2/session-cookie';
import { budgetStore } from '../../../../../lib/server/ai/budget';
import { groqKeys } from '../../../../../lib/server/ai/groq';
import { qaModel } from '../../../../../lib/server/ai/grounded-qa';
import { MAX_QUESTION } from '../../../../../lib/poc-finance-qa/answer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const denied = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
const cookieName = localSessionCookieName(true);
const token = (request: Request) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
function sameLoopbackOrigin(request: Request, url: URL) {
    try {
        // Next may expose an internal localhost URL even when the browser used 127.0.0.1.
        // pocRequestAllowed has already verified that this Host is loopback on the same port.
        const host = request.headers.get('host') ?? url.host;
        return request.headers.get('origin') === new URL(url.protocol + '//' + host).origin;
    } catch { return false; }
}
const selectionKeys = ['source', 'business', 'period', 'currency'];
const respond = (result: { status: string }) => result.status === 'OK' ? Response.json(result, { headers }) : denied();
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (body: Record<string, unknown>, allowed: string[]) => Object.keys(body).every(k => allowed.includes(k));

/** Read-only, loopback PoC. Organization, role and user come only from the server session; figures only from the server. */
export async function GET(request: Request) {
    if (!pocRequestAllowed(request)) return denied();
    try {
        const params = new URL(request.url).searchParams, keys = [...params.keys()], action = params.get('action');
        if (new Set(keys).size !== keys.length) return denied();
        if (action === 'chat-status' && keys.length === 1) {
            if (process.env.FINGENCE_POC_GROQ !== '1') return denied();
            return Response.json({ groqAvailable: groqKeys().length > 0 && !!budgetStore(), model: qaModel() }, { headers });
        }
        const { questions } = await financeQaRuntime();
        if (action === 'sources' && keys.length === 1) return respond(await questions.sources(token(request)));
        if (action !== 'context' || !keys.every(k => k === 'action' || selectionKeys.includes(k)) || !params.get('source')) return denied();
        return respond(await questions.context(token(request), Object.fromEntries(selectionKeys.filter(k => params.has(k)).map(k => [k, params.get(k)!])) as { source: string }));
    } catch { return denied(); }
}

/** The old deterministic read endpoint remains for poc:dev; the Groq chat adds explicit preview and consent actions. */
export async function POST(request: Request) {
    if (!pocRequestAllowed(request)) return denied();
    const url = new URL(request.url), action = url.searchParams.get('action');
    if (action !== 'ask' && process.env.FINGENCE_POC_GROQ !== '1') return denied();
    if (url.searchParams.toString() !== 'action=' + action || !['ask', 'chat-preview', 'chat-send'].includes(action ?? '')
        || !sameLoopbackOrigin(request, url) || !request.headers.get('content-type')?.startsWith('application/json')) return denied();
    try {
        const text = await request.text();
        if (new TextEncoder().encode(text).length > 4096) return denied();
        const body = JSON.parse(text) as unknown;
        if (!isRecord(body)) return denied();
        const runtime = await financeQaRuntime();
        if (action === 'ask') {
            if (!onlyKeys(body, ['question', ...selectionKeys]) || !Object.values(body).every(v => typeof v === 'string')
                || typeof body.source !== 'string' || typeof body.question !== 'string' || !body.question.trim() || body.question.length > MAX_QUESTION) return denied();
            const { question, ...selection } = body as Record<string, string>;
            return respond(await runtime.questions.ask(token(request), selection as { source: string }, question));
        }
        if (action === 'chat-preview') {
            if (!onlyKeys(body, ['question', ...selectionKeys]) || !selectionKeys.every(k => typeof body[k] === 'string')
                || typeof body.question !== 'string' || !body.question.trim() || body.question.length > MAX_QUESTION) return denied();
            const preview = await runtime.chat.preview(token(request), {
                source: body.source as string, business: body.business as string,
                period: body.period as string, currency: body.currency as string,
            }, body.question);
            return Response.json(preview, { headers });
        }
        if (!onlyKeys(body, ['previewId', 'payloadHash', 'consent'])) return denied();
        const reply = await runtime.chat.send(request, token(request), body);
        return Response.json(reply, { headers });
    } catch (error) {
        if (error instanceof FinanceChatError) return Response.json({ code: error.code, explanation: financeChatErrorExplanation(error.code) }, { status: error.status, headers });
        return denied();
    }
}




