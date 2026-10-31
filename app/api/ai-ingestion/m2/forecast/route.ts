import { pocRequestAllowed } from '../../../../../lib/server/poc-reconciliation/runtime';
import { forecastRuntime } from '../../../../../lib/server/poc-forecast/runtime';
import { localSessionCookieName } from '../../../../../lib/server/ai-ingestion/m2/session-cookie';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const denied = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
const cookieName = localSessionCookieName(true);
const token = (request: Request) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
/** Read-only. Selection keys only; organization, role and user always come from the server session. */
export async function GET(request: Request) {
    if (!pocRequestAllowed(request))
        return denied();
    try {
        const params = new URL(request.url).searchParams, action = params.get('action');
        if (![...params.keys()].every(k => ['action', 'source', 'business'].includes(k)))
            return denied();
        const { forecast } = await forecastRuntime();
        if (action === 'sources' && params.size === 1) {
            const result = await forecast.sources(token(request));
            return result.status === 'OK' ? Response.json(result, { headers }) : denied();
        }
        const sourceId = params.get('source'), businessId = params.get('business');
        if (action !== 'forecast' || !sourceId || !/^[0-9a-f-]{36}$/.test(sourceId) || (businessId !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(businessId)))
            return denied();
        const result = await forecast.forecast(token(request), businessId === null ? { sourceId } : { sourceId, businessId });
        return result.status === 'OK' ? Response.json(result, { headers }) : denied();
    }
    catch {
        return denied();
    }
}
