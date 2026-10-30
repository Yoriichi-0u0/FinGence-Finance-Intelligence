import { m5RequestAllowed } from '../../../../../lib/server/tenant-admin-m5/flags';
import { pocRuntime } from '../../../../../lib/server/poc-anomalies/runtime';
import { localSessionCookieName } from '../../../../../lib/server/ai-ingestion/m2/session-cookie';
import type { SelectionInput } from '../../../../../lib/server/poc-anomalies/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const denied = () => Response.json({ error: 'Unavailable or access denied.' }, { status: 404, headers });
const cookieName = localSessionCookieName(true);
const token = (request: Request) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Parse and stale-review codes reach the caller only after the server authorized a Finance user of the source's organization.
const sourceRefusals = new Set(['NOT_UTF8', 'UNSUPPORTED_LAYOUT', 'EVALUATOR_FILE', 'INVALID_ROWS', 'EMPTY', 'TOO_MANY_ROWS']);
function respond(result: { status: string; code?: string; details?: string[] }) {
    if (result.status !== 'REFUSED')
        return Response.json(result, { headers });
    if (result.code && sourceRefusals.has(result.code))
        return Response.json({ refused: result.code, details: result.details ?? [] }, { status: 422, headers });
    return result.code === 'STALE_REVIEW' ? Response.json({ refused: result.code }, { status: 409, headers }) : denied();
}
async function body(request: Request, limit: number) {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    let bytes = 0;
    const parts: Uint8Array[] = [];
    while (true) {
        const r = await reader.read();
        if (r.done) break;
        bytes += r.value.length;
        if (bytes > limit) { await reader.cancel(); throw new Error(); }
        parts.push(r.value);
    }
    return new Uint8Array(Buffer.concat(parts));
}
/** Selection keys only; organization, role and user always come from the server session. */
function selection(params: URLSearchParams): SelectionInput | null {
    const sourceId = params.get('source'), value: SelectionInput = { sourceId: sourceId ?? '' };
    if (!sourceId || !/^[0-9a-f-]{36}$/.test(sourceId)) return null;
    for (const [key, field, pattern] of [['business', 'businessId', /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/], ['period', 'period', /^\d{4}-\d{2}$/], ['currency', 'currency', /^[A-Z]{3}$/]] as const) {
        const v = params.get(key);
        if (v === null) continue;
        if (!pattern.test(v)) return null;
        value[field] = v;
    }
    return [...params.keys()].every(k => ['action', 'source', 'business', 'period', 'currency', 'format'].includes(k)) ? value : null;
}
export async function GET(request: Request) {
    if (!m5RequestAllowed(request))
        return denied();
    try {
        const params = new URL(request.url).searchParams, action = params.get('action'), { anomalies } = await pocRuntime();
        if (action === 'sources')
            return respond(await anomalies.sources(token(request)));
        const scope = selection(params);
        if (!scope)
            return denied();
        if (action === 'analysis')
            return respond(await anomalies.analysis(token(request), scope));
        const format = params.get('format');
        if (action !== 'report' || (format !== 'pdf' && format !== 'json'))
            return denied();
        const result = await anomalies.report(token(request), scope, format);
        if (result.status !== 'OK')
            return respond(result);
        const s = result.report.selection, name = `fingence-poc-report-${s.businessId}-${s.period}.${format}`;
        return new Response(Buffer.from(result.bytes), { headers: { ...headers, 'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/json', 'Content-Disposition': `attachment; filename="${name}"`, 'X-FinGence-Report-Hash': result.report.reportHash } });
    }
    catch {
        return denied();
    }
}
export async function POST(request: Request) {
    if (!m5RequestAllowed(request))
        return denied();
    const url = new URL(request.url);
    if (request.headers.get('origin') !== `${url.protocol}//${request.headers.get('host') ?? url.host}`)
        return denied();
    try {
        const action = url.searchParams.get('action'), session = token(request), { anomalies } = await pocRuntime();
        if (action === 'upload') {
            let name: string;
            try { name = decodeURIComponent(request.headers.get('x-fingence-file-name') ?? ''); } catch { return denied(); }
            if (!/^[\w .()-]{1,120}$/.test(name) || !/\.csv$/i.test(name))
                return denied();
            return respond(await anomalies.upload(session, name, await body(request, MAX_UPLOAD_BYTES)));
        }
        if (action !== 'review')
            return denied();
        const value = JSON.parse(Buffer.from(await body(request, 4096)).toString()) as Record<string, unknown>;
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4 || typeof value.sourceId !== 'string' || typeof value.rowId !== 'string'
            || !['OPEN', 'EXPLAINED', 'ESCALATED'].includes(value.state as string) || !Number.isInteger(value.expectedVersion) || (value.expectedVersion as number) < 0)
            return denied();
        return respond(await anomalies.review(session, { sourceId: value.sourceId, rowId: value.rowId, state: value.state as 'OPEN' | 'EXPLAINED' | 'ESCALATED', expectedVersion: value.expectedVersion as number }));
    }
    catch {
        return denied();
    }
}
