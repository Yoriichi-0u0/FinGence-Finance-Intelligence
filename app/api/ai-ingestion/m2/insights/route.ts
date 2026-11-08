import { pocRequestAllowed } from '../../../../../lib/server/poc-reconciliation/runtime';
import { insightsRuntime } from '../../../../../lib/server/poc-insights/runtime';
import { localSessionCookieName } from '../../../../../lib/server/ai-ingestion/m2/session-cookie';
import { insightsQuery } from '../../../../../lib/poc-insights/model';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const denied = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
const invalid = () => Response.json({ error: 'Invalid source selection or filters.' }, { status: 400, headers });
const cookieName = localSessionCookieName(true);
/** Read-only, loopback PoC. No browser organization, role, amount or verification claim is accepted. */
export async function GET(request: Request) {
    if (!pocRequestAllowed(request)) return denied();
    const params = new URL(request.url).searchParams;
    if (new Set(params.keys()).size !== [...params.keys()].length) return invalid();
    const list = params.get('action') === 'sources' && params.size === 1;
    const query = insightsQuery.safeParse(Object.fromEntries(params));
    if (!list && !query.success) return invalid();
    const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
    try {
        const { insights } = await insightsRuntime();
        const result = list ? await insights.sources(token) : await insights.read(token, query.data!);
        return result.status === 'OK' ? Response.json(result, { headers }) : denied();
    } catch { return denied(); }
}
/** This endpoint never accepts financial writes, including with local flags enabled. */
export async function POST() { return denied(); }
